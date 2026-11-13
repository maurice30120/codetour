import type { Node } from "web-tree-sitter";
import { GRAMMAR_SPECS } from "./queries";
import type { GrammarId } from "./grammars";
import { extensionsForLanguage, grammarForLanguage } from "./languages";
import type {
  CallSyntax,
  LanguagePack,
  PackAnalysisResult,
  RawCallSite,
  ReceiverKind
} from "./pack";

/**
 * Built-in GENERIC pack of the engine (NOT one of the per-language packs of
 * #151–#154): it extracts structural facts only — declarations and raw call
 * sites — from the prebuilt grammar. Resolution against the local graph happens
 * in the engine, which turns provable relations into edges and everything else
 * into explicit ambiguity sites (never guessed edges). Language packs plugged
 * via `registerPack` replace this default for their language and may emit
 * pre-resolved edges (e.g. interface relations, heuristic) themselves.
 */

const SYNTAX_PRIORITY: Record<CallSyntax, number> = { super: 2, new: 1, call: 0 };

const THIS_RECEIVER_TYPES = new Set(["this_expression", "this"]);
const SUPER_RECEIVER_TYPES = new Set(["super", "base_expression"]);

function lastSegment(text: string): string {
  const base = text.split(".").pop() ?? text;
  return base.replace(/<[^>]*>/g, "").trim();
}

export function createDefaultPack(language: string): LanguagePack {
  const grammarId = grammarForLanguage(language);
  if (!grammarId) throw new Error(`no grammar for language: ${language}`);
  const spec = GRAMMAR_SPECS[grammarId as GrammarId];

  return {
    language,
    grammarId,
    extensions: extensionsForLanguage(language),
    analyze(input): PackAnalysisResult {
      const { tree, createQuery, file } = input;
      const query = createQuery(spec.query);
      const nodes: PackAnalysisResult["nodes"] = [];
      const calls: RawCallSite[] = [];
      const seenCallNodes = new Map<number, CallSyntax>();

      const startLineOf = (node: Node): number => node.startPosition.row + 1;
      const endLineOf = (node: Node): number => node.endPosition.row + 1;

      const enclosingClassName = (node: Node): string | undefined => {
        let p = node.parent;
        while (p) {
          if (spec.classNodeTypes.includes(p.type)) {
            return p.childForFieldName("name")?.text ?? undefined;
          }
          p = p.parent;
        }
        return undefined;
      };
      const declFullName = (decl: Node): string => {
        const name = decl.childForFieldName("name")?.text ?? "";
        if (!name) return "";
        const cls = enclosingClassName(decl);
        return cls ? `${cls}.${name}` : name;
      };
      const callerNameOf = (node: Node): string => {
        let p = node.parent;
        while (p) {
          if (spec.declNodeTypes.includes(p.type)) return declFullName(p);
          p = p.parent;
        }
        return "";
      };
      const calleeOf = (callNode: Node): Node | null =>
        callNode.childForFieldName("function") ?? callNode.childForFieldName("name");
      const receiverOfCallee = (callee: Node | null): Node | null => {
        if (!callee) return null;
        return callee.childForFieldName("object") ?? callee.childForFieldName("expression");
      };
      const classifyReceiver = (receiver: Node | null): ReceiverKind => {
        if (!receiver) return "none";
        if (THIS_RECEIVER_TYPES.has(receiver.type) || receiver.text === "self") return "this";
        if (SUPER_RECEIVER_TYPES.has(receiver.type)) return "super";
        if (
          receiver.type === "call" &&
          receiver.childForFieldName("function")?.text === "super"
        ) {
          return "super";
        }
        return "member";
      };

      const recordCall = (
        callNode: Node,
        info: { name: string; syntax: CallSyntax; receiver: ReceiverKind }
      ): void => {
        if (!info.name) return;
        const previous = seenCallNodes.get(callNode.startIndex);
        if (previous !== undefined && SYNTAX_PRIORITY[previous] >= SYNTAX_PRIORITY[info.syntax]) {
          return;
        }
        seenCallNodes.set(callNode.startIndex, info.syntax);
        calls.push({
          file: file.path,
          line: startLineOf(callNode),
          name: info.name,
          syntax: info.syntax,
          receiver: info.receiver,
          caller: callerNameOf(callNode)
        });
      };

      for (const match of query.matches(tree.rootNode)) {
        const caps = new Map<string, Node>();
        for (const capture of match.captures) {
          if (!caps.has(capture.name)) caps.set(capture.name, capture.node);
        }

        const classDecl = caps.get("class.decl");
        if (classDecl) {
          const name = caps.get("class.name")?.text ?? "";
          if (name) {
            nodes.push({
              name: `${name}.constructor`,
              filePath: file.path,
              startLine: startLineOf(classDecl),
              endLine: endLineOf(classDecl)
            });
          }
          continue;
        }

        const decl = caps.get("method.def") ?? caps.get("fn.decl");
        if (decl) {
          const name = declFullName(decl);
          if (name) {
            nodes.push({
              name,
              filePath: file.path,
              startLine: startLineOf(decl),
              endLine: endLineOf(decl)
            });
          }
          continue;
        }

        const newNode = caps.get("new") ?? caps.get("new.member");
        if (newNode) {
          const ctor = caps.get("new.ctor") ?? caps.get("new.prop");
          const name = ctor ? lastSegment(ctor.text) : "";
          recordCall(newNode, { name, syntax: "new", receiver: "none" });
          continue;
        }

        const superCall = caps.get("super.call");
        if (superCall) {
          const prop = caps.get("super.prop") ?? caps.get("call.prop");
          recordCall(superCall, {
            name: prop?.text ?? "constructor",
            syntax: "super",
            receiver: "super"
          });
          continue;
        }

        const callNode = caps.get("call") ?? caps.get("call.member");
        if (callNode) {
          const prop = caps.get("call.prop");
          if (prop) {
            const receiver = classifyReceiver(receiverOfCallee(calleeOf(callNode)));
            recordCall(callNode, { name: prop.text, syntax: "call", receiver });
          } else {
            const ident = caps.get("call.ident") ?? caps.get("call.super");
            const name = ident?.text ?? "";
            if (name === "super") continue; // bare super() — the enclosing super.X() carries the relation
            const receiver = classifyReceiver(callNode.childForFieldName("object"));
            recordCall(callNode, { name, syntax: "call", receiver });
          }
        }
      }

      return { nodes, calls };
    }
  };
}
