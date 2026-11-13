import type { Node } from "web-tree-sitter";
import { extensionsForLanguage } from "./languages";
import type {
  CallSyntax,
  LanguagePack,
  PackAnalysisInput,
  PackAnalysisResult,
  PackTypeInfo,
  RawCallSite,
  RawNode,
  ReceiverKind
} from "./pack";

/**
 * Java language pack of spec #149 / ticket #153, plugged into the registry with
 * `registerPack(createJavaPack())` (it replaces the generic default pack for
 * "java").
 *
 * Mechanisms (exactly the ticket perimeter):
 *  - explicit imports: single-type imports and qualified names normalize to
 *    simple names, `import static` members resolve as bare calls, wildcard
 *    imports grant nothing (never a guessed edge);
 *  - declared types of locals, parameters and fields (plus `var` inferred from
 *    a `new X(...)` initializer) become `receiverType` on the raw call sites;
 *  - `extends`/`implements` are reported as `types` so the ENGINE can walk the
 *    inheritance chain across files (inherited `this.x`, `super.x`, `super()`);
 *  - `this.x` calls, `new X(...)` -> X.constructor, `super` calls.
 *
 * Everything the pack cannot prove statically is emitted as a raw call without
 * a receiver type: the engine turns it into an ambiguity site with candidates
 * — never a guessed edge.
 */

const TYPE_DECL_NODES = new Set([
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "annotation_declaration"
]);


/** namedChildren may contain nulls in web-tree-sitter 0.25 typings. */
function kids(node: Node): Node[] {
  return node.namedChildren.filter((c): c is Node => c !== null);
}

/** "com.example.models.User<String>" -> "User"; "String[]" -> "String". */
export function simpleTypeName(text: string): string {
  const base = text.split("<")[0];
  const noArray = base.replace(/\[\]/g, "").trim();
  return noArray.split(".").pop() ?? "";
}

interface TypeCtx {
  name: string;
  info: PackTypeInfo;
  /** field name -> declared type (simple name), undefined when unknown. */
  fields: Map<string, string | undefined>;
}

export function createJavaPack(): LanguagePack {
  return {
    language: "java",
    grammarId: "java",
    extensions: extensionsForLanguage("java"),
    analyze(input: PackAnalysisInput): PackAnalysisResult {
      const { file, tree } = input;
      const nodes: RawNode[] = [];
      const calls: RawCallSite[] = [];
      const types: PackTypeInfo[] = [];

      const lineOf = (node: Node): number => node.startPosition.row + 1;
      const endLineOf = (node: Node): number => node.endPosition.row + 1;

      // --- imports ---------------------------------------------------------
      /** simple name -> simple name (single-type imports; identity by design: the local graph is indexed by simple names). */
      const singleImports = new Set<string>();
      /** members brought in by `import static a.b.C.member;` */
      const staticMembers = new Set<string>();
      /** packages of wildcard imports: they grant NO provable type. */
      const wildcardImports: string[] = [];
      for (const child of kids(tree.rootNode)) {
        if (child.type !== "import_declaration") continue;
        const scoped = kids(child).find(
          n => n.type === "scoped_identifier" || n.type === "identifier"
        );
        if (!scoped) continue;
        // `static` and `*` are anonymous tokens: scan ALL children, not namedChildren.
        const isStatic = child.children.some(n => n?.type === "static");
        const isWildcard = child.children.some(n => n?.type === "asterisk");
        const simple = simpleTypeName(scoped.text);
        if (!simple) continue;
        if (isWildcard) wildcardImports.push(scoped.text);
        else if (isStatic) staticMembers.add(simple);
        else singleImports.add(simple);
      }
      // Referenced type names this file can stand for: its own declarations,
      // single-type imports and same-package types all share the simple name;
      // wildcard imports are deliberately NOT in this set.
      const knownTypeRef = (simple: string): boolean =>
        singleImports.has(simple) || types.some(t => t.name === simple);

      // --- type declarations ------------------------------------------------
      const typeStack: TypeCtx[] = [];
      const enclosingType = (): TypeCtx | undefined => typeStack[typeStack.length - 1];

      const readTypeDecl = (node: Node): PackTypeInfo & { name: string } => {
        const name = node.childForFieldName("name")?.text ?? "";
        const kind: PackTypeInfo["kind"] =
          node.type === "interface_declaration"
            ? "interface"
            : node.type === "enum_declaration"
              ? "enum"
              : node.type === "annotation_declaration"
                ? "annotation"
                : "class";
        const sup = node.childForFieldName("superclass");
        const extendsName = sup ? simpleTypeName(sup.text.replace(/^extends\s+/, "")) : undefined;
        const ifaces = node.childForFieldName("interfaces");
        const typeList = ifaces ? kids(ifaces).find(n => n.type === "type_list") : undefined;
        const implementsNames = typeList
          ? kids(typeList).map(t => simpleTypeName(t.text)).filter(Boolean)
          : [];
        return {
          name,
          kind,
          ...(extendsName ? { extends: extendsName } : {}),
          ...(implementsNames.length > 0 ? { implements: implementsNames } : {})
        };
      };

      const visitType = (node: Node): void => {
        const info = readTypeDecl(node);
        if (!info.name) return;
        types.push(info);
        const ctx: TypeCtx = { name: info.name, info, fields: new Map() };
        typeStack.push(ctx);
        if (info.kind !== "interface") {
          // A class is represented by its members plus a synthetic
          // Type.constructor node (no bare class node — #149 graph format).
          nodes.push({
            name: `${info.name}.constructor`,
            filePath: file.path,
            startLine: lineOf(node),
            endLine: endLineOf(node)
          });
        }
        const body = node.childForFieldName("body");
        if (body) {
          for (const member of kids(body)) visitMember(member, ctx);
        }
        typeStack.pop();
      };

      // --- call-site collection ---------------------------------------------
      const recordInvocation = (
        node: Node,
        caller: string,
        ctx: TypeCtx,
        scope: Map<string, string | undefined>
      ): void => {
        const name = node.childForFieldName("name")?.text ?? "";
        if (!name) return;
        const object = node.childForFieldName("object");
        let receiver: ReceiverKind = "none";
        let receiverType: string | undefined;
        if (!object) {
          // Bare call: a static-imported member is a plain call; inside a class
          // member an unqualified invocation is an implicit this-call (Java).
          receiver = staticMembers.has(name) || !caller.includes(".") ? "none" : "this";
        } else if (object.type === "this") {
          receiver = "this";
        } else if (object.type === "super") {
          receiver = "super";
          receiverType = ctx.info.extends;
        } else if (object.type === "identifier") {
          receiver = "member";
          const declared = scope.get(object.text) ?? ctx.fields.get(object.text);
          if (declared && knownTypeRef(declared)) receiverType = declared;
        } else if (object.type === "field_access") {
          // this.field.method(...): the field's declared type is the receiver type.
          receiver = "member";
          const obj = object.childForFieldName("object");
          const fieldName = object.childForFieldName("field")?.text;
          if (obj?.type === "this" && fieldName) {
            const declared = ctx.fields.get(fieldName);
            if (declared && knownTypeRef(declared)) receiverType = declared;
          }
        } else {
          // Chained receiver (a.b().c(), ...): type not provable -> member
          // without receiverType, the engine will make it a "?" site.
          receiver = "member";
        }
        const call: RawCallSite = {
          file: file.path,
          line: lineOf(node),
          name,
          syntax: "call" as CallSyntax,
          receiver,
          caller
        };
        if (receiverType) call.receiverType = receiverType;
        calls.push(call);
      };

      const recordCreation = (node: Node, caller: string): void => {
        const typeNode = node.childForFieldName("type");
        const name = typeNode ? simpleTypeName(typeNode.text) : "";
        if (!name) return;
        calls.push({
          file: file.path,
          line: lineOf(node),
          name,
          syntax: "new",
          receiver: "none",
          caller
        });
      };

      const recordSuperCtor = (node: Node, caller: string, ctx: TypeCtx): void => {
        const ctor = node.childForFieldName("constructor")?.text ?? "";
        if (ctor !== "super") return; // this(...) delegates within the same class: noise
        if (!ctx.info.extends) return; // implicit super() targets java.lang.Object, outside the local graph
        calls.push({
          file: file.path,
          line: lineOf(node),
          name: "constructor",
          syntax: "super",
          receiver: "super",
          receiverType: ctx.info.extends,
          caller
        });
      };

      const collectCalls = (root: Node, caller: string, ctx: TypeCtx, memberDecl: Node | null): void => {
        // Scope: parameters, then locals in source order (later shadows earlier).
        const scope = new Map<string, string | undefined>();
        const params = memberDecl?.childForFieldName("parameters");
        if (params) {
          for (const p of kids(params)) {
            if (p.type !== "formal_parameter") continue;
            const typeText = p.childForFieldName("type")?.text ?? "";
            const paramName = p.childForFieldName("name")?.text;
            if (paramName) {
              const simple = simpleTypeName(typeText);
              scope.set(paramName, simple || undefined);
            }
          }
        }
        const localDecls: Node[] = [];
        const gatherLocals = (n: Node): void => {
          for (const c of kids(n)) {
            if (c.type === "local_variable_declaration") localDecls.push(c);
            gatherLocals(c);
          }
        };
        gatherLocals(root);
        for (const lv of localDecls) {
          const typeText = lv.childForFieldName("type")?.text ?? "";
          const declared = typeText === "var" ? undefined : simpleTypeName(typeText) || undefined;
          for (const decl of kids(lv)) {
            if (decl.type !== "variable_declarator") continue;
            const varName = decl.childForFieldName("name")?.text;
            if (!varName) continue;
            let value = declared;
            if (!value) {
              // var x = new X(...): infer X. Any other initializer (ternary,
              // cast, method call...) stays unknown -> "?" site, never a guess.
              const init = decl.childForFieldName("value");
              if (init?.type === "object_creation_expression") {
                const t = init.childForFieldName("type")?.text;
                if (t) value = simpleTypeName(t) || undefined;
              }
            }
            scope.set(varName, value);
          }
        }
        const visit = (n: Node): void => {
          for (const c of kids(n)) {
            if (c.type === "method_invocation") recordInvocation(c, caller, ctx, scope);
            else if (c.type === "object_creation_expression") recordCreation(c, caller);
            else if (c.type === "explicit_constructor_invocation") recordSuperCtor(c, caller, ctx);
            visit(c);
          }
        };
        visit(root);
      };

      const visitMember = (member: Node, ctx: TypeCtx): void => {
        if (TYPE_DECL_NODES.has(member.type)) {
          visitType(member);
          return;
        }
        if (member.type === "field_declaration") {
          const typeText = member.childForFieldName("type")?.text ?? "";
          const declared = simpleTypeName(typeText) || undefined;
          for (const decl of kids(member)) {
            if (decl.type !== "variable_declarator") continue;
            const varName = decl.childForFieldName("name")?.text;
            if (varName) ctx.fields.set(varName, declared);
            // Field initializers run in the constructor: attribute their calls
            // to Type.constructor.
            collectCalls(decl, `${ctx.name}.constructor`, ctx, null);
          }
          return;
        }
        if (member.type === "method_declaration") {
          const methodName = member.childForFieldName("name")?.text ?? "";
          if (!methodName) return;
          nodes.push({
            name: `${ctx.name}.${methodName}`,
            filePath: file.path,
            startLine: lineOf(member),
            endLine: endLineOf(member)
          });
          const body = member.childForFieldName("body");
          if (body) collectCalls(body, `${ctx.name}.${methodName}`, ctx, member);
          return;
        }
        if (member.type === "constructor_declaration") {
          const body = member.childForFieldName("body");
          if (body) collectCalls(body, `${ctx.name}.constructor`, ctx, member);
          return;
        }
      };

      for (const child of kids(tree.rootNode)) {
        if (TYPE_DECL_NODES.has(child.type)) visitType(child);
      }
      // enclosingType kept referenced for clarity of the stack discipline above.
      void enclosingType;

      return { nodes, calls, types };
    }
  };
}
