import type { Node } from "web-tree-sitter";
import { extensionsForLanguage } from "../languages";
import type {
  CallSyntax,
  LanguagePack,
  PackAnalysisResult,
  RawCallSite,
  RawEdge,
  RawNode,
  ReceiverKind
} from "../pack";

/**
 * The Python pack of ticket #154 (spec #149, ADR 0034).
 *
 * Python has no static types, so the ambiguity rate is high BY NATURE: `?`
 * sites with candidates are the expected behavior, not a failure. The pack
 * resolves what is trivial and leaves everything else to the engine, which
 * turns it into an explicit ambiguity site with candidates — never a guessed
 * edge:
 *
 *  - trivial import resolution: `from m import X [as Y]` maps the local name
 *    Y -> X, and `import m [as a]` lets a module-qualified call `a.f(...)` /
 *    `m.f(...)` be de-qualified to the plain call `f(...)` (the engine then
 *    resolves it against the local graph, or points at it with candidates);
 *  - `self.x(...)` / `cls.x(...)` are `this` receiver calls (the engine proves
 *    them against the enclosing class, inherited members become ? sites);
 *  - `super().__init__(...)` inside a class with a single explicit base class
 *    is emitted as a heuristic `super` edge toward `Base.constructor`;
 *  - everything else (attribute calls on unknown receivers, homonyms, builtins)
 *    stays a raw call site and degrades to an ambiguity/unresolved site with
 *    candidates in the engine.
 *
 * Declarations: a class yields a synthetic `Type.constructor` node (class
 * usage is an edge toward it, no bare class node — #149 contract), methods
 * yield `Type.member`, module-level functions yield the bare name.
 */

interface FromImport {
  module: string;
  name: string;
}

interface Scope {
  className?: string;
  /** Full name of the enclosing member ("Type.member"), "" at file scope. */
  fnName: string;
  /** Explicit base classes of the enclosing class (identifier texts). */
  bases: string[];
}

function lastSegment(text: string): string {
  const base = text.split(".").pop() ?? text;
  return base.trim();
}

export function createPythonPack(): LanguagePack {
  return {
    language: "python",
    grammarId: "python",
    extensions: extensionsForLanguage("python"),
    analyze(input): PackAnalysisResult {
      const { tree, file } = input;
      const nodes: RawNode[] = [];
      const calls: RawCallSite[] = [];
      const edges: RawEdge[] = [];

      // Trivial import tables of THIS file (the engine resolves names against
      // the whole local graph; the pack only de-aliases/de-qualifies).
      const moduleAliases = new Map<string, string>(); // local name -> module dotted name
      const fromImports = new Map<string, FromImport>(); // local name -> { module, name }

      const lineOf = (node: Node): number => node.startPosition.row + 1;
      const endLineOf = (node: Node): number => node.endPosition.row + 1;

      const recordImports = (node: Node): void => {
        if (node.type === "import_statement") {
          for (let i = 0; i < node.childCount; i++) {
            if (node.fieldNameForChild(i) !== "name") continue;
            const child = node.child(i);
            if (!child) continue;
            if (child.type === "dotted_name") {
              // `import a.b.c` binds the last segment `c` to module `a.b.c`.
              moduleAliases.set(lastSegment(child.text), child.text);
            } else if (child.type === "aliased_import") {
              const name = child.childForFieldName("name")?.text ?? "";
              const alias = child.childForFieldName("alias")?.text ?? "";
              if (name && alias) moduleAliases.set(alias, name);
            }
          }
          return;
        }
        if (node.type === "import_from_statement") {
          const module = node.childForFieldName("module_name")?.text ?? "";
          for (let i = 0; i < node.childCount; i++) {
            if (node.fieldNameForChild(i) !== "name") continue;
            const child = node.child(i);
            if (!child) continue;
            if (child.type === "dotted_name") {
              fromImports.set(child.text, { module, name: child.text });
            } else if (child.type === "aliased_import") {
              const name = child.childForFieldName("name")?.text ?? "";
              const alias = child.childForFieldName("alias")?.text ?? "";
              if (name && alias) fromImports.set(alias, { module, name });
            }
            // wildcard_import (`from m import *`) is not trivially resolvable.
          }
        }
      };

      const recordCall = (
        callNode: Node,
        info: { name: string; syntax: CallSyntax; receiver: ReceiverKind },
        scope: Scope
      ): void => {
        if (!info.name) return;
        calls.push({
          file: file.path,
          line: lineOf(callNode),
          name: info.name,
          syntax: info.syntax,
          receiver: info.receiver,
          caller: scope.fnName
        });
      };

      const classifyCall = (callNode: Node, scope: Scope): void => {
        const fn = callNode.childForFieldName("function");
        if (!fn) return;

        if (fn.type === "identifier") {
          const rawName = fn.text;
          if (rawName === "super") return; // bare super(): the outer super.X() carries the relation
          // Trivial from-import alias: `from util import helper as h` -> h(...) is helper(...).
          const imported = fromImports.get(rawName);
          recordCall(
            callNode,
            { name: imported?.name ?? rawName, syntax: "call", receiver: "none" },
            scope
          );
          return;
        }

        if (fn.type === "attribute") {
          const attr = fn.childForFieldName("attribute")?.text ?? "";
          const obj = fn.childForFieldName("object");

          if (obj && obj.type === "call" && obj.childForFieldName("function")?.text === "super") {
            // super().method(...) — heuristic super edge toward the single explicit base.
            const name = attr || "constructor";
            if (scope.className && scope.fnName && scope.bases.length === 1) {
              edges.push({
                from: scope.fnName,
                to: `${scope.bases[0]}.constructor`,
                line: lineOf(callNode),
                kind: "super",
                callType: "super",
                status: "heuristic",
                filePath: file.path
              });
            } else {
              recordCall(callNode, { name, syntax: "super", receiver: "super" }, scope);
            }
            return;
          }

          if (obj && obj.type === "identifier" && (obj.text === "self" || obj.text === "cls")) {
            recordCall(callNode, { name: attr, syntax: "call", receiver: "this" }, scope);
            return;
          }

          if (obj && obj.type === "identifier" && moduleAliases.has(obj.text)) {
            // Trivial module-qualified call: `import util` + `util.helper(...)` -> helper(...).
            // `util.Calculator()` likewise de-qualifies and lets the engine prove the `new`.
            recordCall(callNode, { name: attr, syntax: "call", receiver: "none" }, scope);
            return;
          }

          // Unknown receiver (local variable, attribute chain, imported class
          // used as a value…): no static type in Python -> member call, the
          // engine turns it into a ? site with candidates.
          recordCall(callNode, { name: attr, syntax: "call", receiver: "member" }, scope);
          return;
        }

        // Callee is itself an expression (get_x()(...), a[0](...)): point at the
        // last segment, member receiver — never guessed.
        const name = lastSegment(fn.text);
        if (name) recordCall(callNode, { name, syntax: "call", receiver: "member" }, scope);
      };

      const visit = (node: Node, scope: Scope): void => {
        switch (node.type) {
          case "import_statement":
          case "import_from_statement":
            recordImports(node);
            return; // imports contain no declarations or call sites

          case "class_definition": {
            const name = node.childForFieldName("name")?.text ?? "";
            if (name) {
              nodes.push({
                name: `${name}.constructor`,
                filePath: file.path,
                startLine: lineOf(node),
                endLine: endLineOf(node)
              });
            }
            const bases: string[] = [];
            const superclasses = node.childForFieldName("superclasses");
            if (superclasses) {
              for (let i = 0; i < superclasses.namedChildCount; i++) {
                const base = superclasses.namedChild(i);
                if (base && base.type === "identifier") bases.push(base.text);
              }
            }
            const childScope: Scope = { className: name || scope.className, fnName: "", bases };
            for (let i = 0; i < node.namedChildCount; i++) {
              const child = node.namedChild(i);
              if (child) visit(child, childScope);
            }
            return;
          }

          case "function_definition": {
            const name = node.childForFieldName("name")?.text ?? "";
            const fullName = name
              ? scope.className
                ? `${scope.className}.${name}`
                : name
              : "";
            if (fullName) {
              nodes.push({
                name: fullName,
                filePath: file.path,
                startLine: lineOf(node),
                endLine: endLineOf(node)
              });
            }
            const childScope: Scope = { className: scope.className, fnName: fullName, bases: scope.bases };
            for (let i = 0; i < node.namedChildCount; i++) {
              const child = node.namedChild(i);
              if (child) visit(child, childScope);
            }
            return;
          }

          case "call":
            classifyCall(node, scope);
            break; // fall through to generic recursion: nested calls live in the arguments
        }

        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) visit(child, scope);
        }
      };

      visit(tree.rootNode, { fnName: "", bases: [] });
      return { nodes, calls, edges };
    }
  };
}

/** The built-in Python pack instance registered for "python" in the registry. */
export const pythonPack: LanguagePack = createPythonPack();
