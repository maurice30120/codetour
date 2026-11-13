import type { Node } from "web-tree-sitter";
import type {
  LanguagePack,
  PackAnalysisInput,
  PackAnalysisResult,
  RawCallSite,
  RawEdge,
  RawNode
} from "../pack";

/**
 * C# language pack — ticket #152 of spec #149, lifted from the validated
 * prototype (packages/mcp-server/prototype-csharp-shootout/lib/rules/csharp.mjs;
 * measured: relations packet 226–370 tokens vs grep+whole-file 1008–1267 on the
 * three ground-truth cases, incoming 4/4, 2/2 and 1/1 covered by a `?` line).
 *
 * Light rules, no type system — exactly the mechanisms of the ticket:
 *  - declared types on fields, parameters and locals (`IRepository _repo`),
 *  - `var` inferred from `new X(...)` (anything else, e.g. a polymorphic
 *    ternary, stays unknown and becomes a `?` site),
 *  - `using X = Y;` aliases,
 *  - `this.x` toward the enclosing type (raw call; the engine resolves it and
 *    turns an inherited member into an ambiguity site — inheritance of members
 *    is never guessed),
 *  - `base.X(...)` as a raw super call (heuristic super edge in the engine),
 *  - `: base()` constructor initializer as the super proof: a pre-resolved
 *    `Type.constructor -> Base.constructor` edge with status "resolved",
 *  - `new X(...)` as a raw "new" call, i.e. an edge toward `Type.constructor`,
 *  - base lists (inheritance / interfaces) feed the super edge; a receiver
 *    whose type is an interface is asserted toward the PORT
 *    (`IRepository.Find`, callType "interface", status "heuristic") — interface
 *    dispatch itself is never asserted, it stays a `?` site with candidates.
 *
 * Grammar: tree-sitter-c_sharp (tree-sitter-wasms@0.1.13, ABI 13) via the
 * shared in-process parser; this module only walks the tree it is given.
 */

const TYPE_DECL_TYPES = new Set([
  "class_declaration",
  "interface_declaration",
  "struct_declaration",
  "record_declaration"
]);

/** Types that never carry static type information. */
const IMPLICIT_TYPES = new Set(["var", "dynamic"]);

/** Short type name: strip generic arguments, qualification, nullable/array markers. */
function shortTypeName(text: string): string {
  const withoutGenerics = text.trim().replace(/<[^>]*>/g, "");
  const last = withoutGenerics.split(".").pop() ?? withoutGenerics;
  return last.replace(/[?[\]]/g, "").trim();
}

/** web-tree-sitter 0.25 types namedChildren as (Node | null)[] — filter the nulls. */
function kids(node: Node): Node[] {
  return node.namedChildren.filter((c): c is Node => c !== null);
}

export function createCSharpPack(): LanguagePack {
  return {
    language: "csharp",
    grammarId: "c_sharp",
    extensions: [".cs"],
    analyze(input: PackAnalysisInput): PackAnalysisResult {
      const { tree, file } = input;
      const root = tree.rootNode;
      const nodes: RawNode[] = [];
      const calls: RawCallSite[] = [];
      const edges: RawEdge[] = [];

      // `using X = Y;` aliases (file-scoped in C#).
      const aliases = new Map<string, string>();
      const collectAliases = (node: Node): void => {
        if (node.type === "using_directive") {
          const head = kids(node)[0];
          if (head?.type === "name_equals") {
            const alias = kids(head)[0]?.text.trim();
            const target = kids(node).find(
              n => n.type === "qualified_name" || n.type === "identifier"
            );
            if (alias && target) aliases.set(alias, shortTypeName(target.text));
          }
        }
        for (const child of kids(node)) collectAliases(child);
      };
      collectAliases(root);
      const aliasOf = (name: string): string => aliases.get(name) ?? name;

      const lineOf = (node: Node): number => node.startPosition.row + 1;
      const endLineOf = (node: Node): number => node.endPosition.row + 1;

      /** Short name -> kind of the types declared in THIS file (for base lists). */
      const fileTypeKinds = new Map<string, string>();
      /** Type name -> picked base class for the `: base()` super proof. */
      const superBaseOf = new Map<string, string>();

      const readParameterTypes = (memberNode: Node): Map<string, string | null> => {
        const params = new Map<string, string | null>();
        const list = kids(memberNode).find(n => n.type === "parameter_list");
        for (const p of list ? kids(list) : []) {
          if (p.type !== "parameter") continue;
          const typeNode = p.childForFieldName("type");
          const nameNode = p.childForFieldName("name");
          if (!typeNode || !nameNode) continue;
          const declared = typeNode.text.trim();
          params.set(
            nameNode.text,
            IMPLICIT_TYPES.has(declared) ? null : aliasOf(shortTypeName(typeNode.text))
          );
        }
        return params;
      };

      const declareLocals = (statement: Node, locals: Map<string, string | null>): void => {
        const variableDeclaration = kids(statement).find(
          n => n.type === "variable_declaration"
        );
        if (!variableDeclaration) return;
        const typeNode = variableDeclaration.childForFieldName("type");
        const declared =
          typeNode &&
          typeNode.type !== "implicit_type" &&
          !IMPLICIT_TYPES.has(typeNode.text.trim())
            ? aliasOf(shortTypeName(typeNode.text))
            : null;
        for (const declarator of kids(variableDeclaration)) {
          if (declarator.type !== "variable_declarator") continue;
          const id = kids(declarator).find(n => n.type === "identifier");
          if (!id) continue;
          let inferred = declared;
          if (!inferred) {
            // `var x = new X(...)` infers X; a ternary / cast / call / literal
            // initializer leaves the type unknown -> the later call on x is a
            // "?" site (dynamic dispatch is never asserted).
            const eq = kids(declarator).find(n => n.type === "equals_value_clause");
            const creation = eq ? kids(eq).find(n => n.type === "object_creation_expression") : undefined;
            const typeField = creation?.childForFieldName("type");
            if (typeField) inferred = aliasOf(shortTypeName(typeField.text));
          }
          locals.set(id.text, inferred);
        }
      };

      const recordInvocation = (
        expr: Node,
        caller: string,
        inType: boolean,
        locals: Map<string, string | null>,
        params: Map<string, string | null>,
        fields: Map<string, string | null>
      ): void => {
        const fn = expr.childForFieldName("function");
        if (!fn) return;
        const line = lineOf(expr);
        if (fn.type === "identifier") {
          // Bare call: the receiver is the enclosing type (or file scope).
          calls.push({
            file: file.path,
            line,
            name: fn.text.trim(),
            syntax: "call",
            receiver: inType ? "this" : "none",
            caller
          });
          return;
        }
        if (fn.type === "member_access_expression") {
          const receiver = fn.childForFieldName("expression");
          const name = fn.childForFieldName("name")?.text.trim() ?? shortTypeName(fn.text);
          if (!name) return;
          if (receiver?.type === "this_expression") {
            calls.push({ file: file.path, line, name, syntax: "call", receiver: "this", caller });
          } else if (receiver?.type === "base_expression") {
            calls.push({ file: file.path, line, name, syntax: "super", receiver: "super", caller });
          } else if (receiver?.type === "identifier") {
            const receiverType =
              locals.get(receiver.text) ??
              params.get(receiver.text) ??
              fields.get(receiver.text) ??
              null;
            const call: RawCallSite = {
              file: file.path,
              line,
              name,
              syntax: "call",
              receiver: "member",
              caller
            };
            if (receiverType) call.receiverType = receiverType;
            calls.push(call);
          } else {
            // Chained receiver (a.b.C(), foo().Bar(), …): type unknown -> "?".
            calls.push({ file: file.path, line, name, syntax: "call", receiver: "member", caller });
          }
        }
      };

      const recordCreation = (expr: Node, caller: string): void => {
        const typeNode = expr.childForFieldName("type");
        if (!typeNode) return; // target-typed `new()`: no static type at the site
        calls.push({
          file: file.path,
          line: lineOf(expr),
          name: aliasOf(shortTypeName(typeNode.text)),
          syntax: "new",
          receiver: "none",
          caller
        });
      };

      /** Scan a member body (or a top-level statement) for locals, calls, creations. */
      const scanBody = (
        container: Node,
        memberNode: Node | null,
        caller: string,
        inType: boolean,
        fields: Map<string, string | null>
      ): void => {
        const params = memberNode
          ? readParameterTypes(memberNode)
          : new Map<string, string | null>();
        const locals = new Map<string, string | null>();
        // Pass 1: local declarations of the whole body (light rules: one flat
        // scope per member, same as the validated prototype).
        const collectLocals = (node: Node): void => {
          if (node.type === "local_declaration_statement") declareLocals(node, locals);
          for (const child of kids(node)) collectLocals(child);
        };
        collectLocals(container);

        // `: base(...)` — the explicit super-constructor proof.
        if (memberNode && caller.endsWith(".constructor")) {
          const initializer = kids(memberNode).find(
            n => n.type === "constructor_initializer"
          );
          if (initializer && /:\s*base\b/.test(initializer.text)) {
            const owner = caller.slice(0, caller.lastIndexOf("."));
            const base = superBaseOf.get(owner);
            if (base) {
              edges.push({
                from: caller,
                to: `${base}.constructor`,
                line: lineOf(initializer),
                kind: "super",
                callType: "super",
                status: "resolved",
                filePath: file.path
              });
            }
          }
        }

        // Pass 2: invocations and object creations anywhere in the body.
        const visitExpr = (node: Node): void => {
          if (node.type === "invocation_expression") {
            recordInvocation(node, caller, inType, locals, params, fields);
          } else if (node.type === "object_creation_expression") {
            recordCreation(node, caller);
          }
          for (const child of kids(node)) visitExpr(child);
        };
        visitExpr(container);
      };

      const visitType = (node: Node, typeName: string, kind: string): void => {
        fileTypeKinds.set(typeName, kind);
        fileTypeKinds.set(shortTypeName(typeName), kind);
        const baseList = kids(node).find(n => n.type === "base_list");
        const bases = (baseList ? kids(baseList) : []).map(b => aliasOf(shortTypeName(b.text)));
        // C#: the first base-list entry that is not an interface is the base class.
        const superBase = bases.find(b => fileTypeKinds.get(b) !== "interface") ?? bases[0];
        if (superBase) superBaseOf.set(typeName, superBase);

        const body = kids(node).find(n => n.type === "declaration_list");
        const fields = new Map<string, string | null>();
        const ctors: Node[] = [];
        const members: { node: Node; fullName: string }[] = [];

        if (body) {
          for (const member of kids(body)) {
            if (member.type === "method_declaration") {
              const name = member.childForFieldName("name")?.text.trim();
              if (!name) continue;
              nodes.push({
                name: `${typeName}.${name}`,
                filePath: file.path,
                startLine: lineOf(member),
                endLine: endLineOf(member),
                ownerKind: kind
              });
              members.push({ node: member, fullName: `${typeName}.${name}` });
            } else if (member.type === "constructor_declaration") {
              ctors.push(member);
              members.push({ node: member, fullName: `${typeName}.constructor` });
            } else if (member.type === "field_declaration") {
              const variableDeclaration = kids(member).find(
                n => n.type === "variable_declaration"
              );
              const typeNode = variableDeclaration?.childForFieldName("type");
              const declared =
                typeNode && typeNode.type !== "implicit_type"
                  ? aliasOf(shortTypeName(typeNode.text))
                  : null;
              for (const declarator of variableDeclaration ? kids(variableDeclaration) : []) {
                if (declarator.type !== "variable_declarator") continue;
                const id = kids(declarator).find(n => n.type === "identifier");
                if (id) fields.set(id.text, declared);
              }
            } else if (member.type === "property_declaration") {
              const name = member.childForFieldName("name")?.text.trim();
              if (name) {
                nodes.push({
                  name: `${typeName}.${name}`,
                  filePath: file.path,
                  startLine: lineOf(member),
                  endLine: endLineOf(member),
                  ownerKind: kind
                });
              }
            } else if (TYPE_DECL_TYPES.has(member.type)) {
              const nested = member.childForFieldName("name")?.text.trim();
              if (nested) {
                visitType(member, `${typeName}.${nested}`, member.type.replace("_declaration", ""));
              }
            }
          }
        }

        // Exactly one constructor node per non-interface type: the explicit
        // ctor if any, else the type declaration itself (edge target for
        // class usage). No bare class node — the #149 graph format.
        if (kind !== "interface") {
          const ctorNode = ctors[0] ?? node;
          nodes.push({
            name: `${typeName}.constructor`,
            filePath: file.path,
            startLine: lineOf(ctorNode),
            endLine: endLineOf(ctorNode),
            ownerKind: kind
          });
        }

        for (const member of members) {
          const block = kids(member.node).find(n => n.type === "block");
          if (block) scanBody(block, member.node, member.fullName, true, fields);
        }
      };

      const visitContainer = (node: Node): void => {
        for (const child of kids(node)) {
          if (TYPE_DECL_TYPES.has(child.type)) {
            const name = child.childForFieldName("name")?.text.trim();
            if (name) visitType(child, name, child.type.replace("_declaration", ""));
          } else if (
            child.type === "namespace_declaration" ||
            child.type === "file_scoped_namespace_declaration" ||
            child.type === "declaration_list"
          ) {
            visitContainer(child);
          } else if (
            child.type === "local_declaration_statement" ||
            child.type === "expression_statement"
          ) {
            // Top-level statements (C# top-level programs): file scope.
            scanBody(child, null, "", false, new Map());
          }
        }
      };
      visitContainer(root);

      return { nodes, calls, edges };
    }
  };
}

/** Shared instance: analyze() keeps no state between calls, safe to register once. */
export const csharpPack: LanguagePack = createCSharpPack();
