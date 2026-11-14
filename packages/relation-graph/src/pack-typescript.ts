import { Query, type Language, type Node } from "web-tree-sitter";
import { getParser, loadGrammar } from "./grammars";
import { extensionsForLanguage, GRAMMAR_BY_LANGUAGE, lastSegment, normalizeLanguage } from "./languages";
import type {
  LanguagePack,
  PackAnalysisInput,
  PackAnalysisResult,
  RawCallSite,
  RawNode,
  ReceiverKind
} from "./pack";
import { registerPack } from "./registry";
import type { SourceFile } from "./types";

/**
 * The TypeScript/TSX language pack of spec #149 (ticket #151).
 *
 * It replaces the regex spike of ticket #114 for TypeScript sources: symbol
 * extraction is now driven by tree-sitter queries over the prebuilt
 * `typescript`/`tsx` grammars, with 1-based positions. Two extraction
 * surfaces share one analysis pass:
 *
 *  - the graph pack (`createTypeScriptPack`, plugged with
 *    `registerPack` under "typescript"/"tsx" via `registerTypeScriptPacks`):
 *    declarations as graph nodes + raw call sites annotated with the
 *    pack-resolved receiver type, which the ENGINE resolves against the
 *    whole local graph — provable relations become edges, everything else
 *    becomes an explicit ambiguity site with candidates, never a guessed
 *    edge;
 *  - `extractTypeScriptSymbols`: declaration extraction (classes, methods,
 *    constructors, functions, properties, imports, type aliases) with
 *    positions — the symbol source ticket #155 wires into the
 *    `extractSymbols` contract of `codetour-mcp`'s parsing module so its
 *    existing consumers keep compiling.
 *
 * Resolution covered here (per #151): declared types (params, fields,
 * variables), local `var` inference from `new X(...)`, import aliases
 * (`import { UserService as Users }`, `import A = NS.B`), `this.x` toward
 * the enclosing type (or its superclass via the extends clause), `super()` /
 * `super.x()` toward the base class, and interface members asserted toward
 * the port by the engine (callType "interface", heuristic).
 */

export type TypeScriptPackLanguage = "typescript" | "tsx";

/** A declaration extracted from a TypeScript/TSX source — the #114 symbol source. */
export interface ExtractedSymbol {
  /** "Type.member" for members, bare name for file-scope symbols. */
  name: string;
  kind: "class" | "interface" | "method" | "constructor" | "function" | "property" | "import" | "type-alias" | "enum";
  filePath: string;
  /** 1-based. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
  /** 1-based column of the declaration start (the CodeSymbol location contract of #155). */
  startColumn?: number;
  /** 1-based column just past the declaration end. */
  endColumn?: number;
  /** Imports only: the name imported from the module ("UserService" for `import { UserService as Users }`). */
  importedName?: string;
  /** Imports only: the module specifier (./user-service"). */
  source?: string;
}

/**
 * Extraction query over the tree-sitter-typescript grammar (valid for both
 * the `typescript` and `tsx` grammars of tree-sitter-wasms@0.1.13, ABI 14).
 * Capture vocabulary:
 *   @class.decl/@class.name   class (or abstract class) declaration + name
 *   @iface.decl/@iface.name   interface declaration + name
 *   @method.def               method_definition (class or object literal)
 *   @sig.def/@prop.sig        interface method_signature / property_signature
 *   @fn.decl/@fn.name         function_declaration
 *   @alias.decl/@alias.name   type_alias_declaration
 *   @enum.decl/@enum.name     enum_declaration
 *   @imp.stmt/@imp.source     import_statement + module source
 *   @imp.eq/@imp.eq.name      import A = NS.B (import_alias)
 *   @var.decl/@var.name       variable_declarator
 *   @param/@param.name        required/optional parameter
 *   @field.def/@field.name    (public_)field_definition
 *   @call/@call.ident         call with a plain identifier callee
 *   @call.member/@call.prop   call on a receiver (member_expression)
 *   @super.call               super(...) call
 *   @new/@new.ctor            new expression + constructor
 */
const TYPESCRIPT_QUERY = `
  (class_declaration name: (type_identifier) @class.name) @class.decl
  (abstract_class_declaration name: (type_identifier) @class.name) @class.decl
  (interface_declaration name: (type_identifier) @iface.name) @iface.decl
  (method_definition name: (property_identifier) @member.name) @method.def
  (method_signature name: (property_identifier) @member.name) @sig.def
  (property_signature name: (property_identifier) @member.name) @prop.sig
  (function_declaration name: (identifier) @fn.name) @fn.decl
  (type_alias_declaration name: (type_identifier) @alias.name) @alias.decl
  (enum_declaration name: (identifier) @enum.name) @enum.decl
  (import_statement source: (string) @imp.source) @imp.stmt
  (import_alias (identifier) @imp.eq.name) @imp.eq
  (variable_declarator name: (identifier) @var.name) @var.decl
  (required_parameter pattern: (identifier) @param.name) @param
  (optional_parameter pattern: (identifier) @param.name) @param
  (public_field_definition name: (property_identifier) @field.name) @field.def
  (public_field_definition name: (private_property_identifier) @field.name) @field.def
  (call_expression function: (identifier) @call.ident) @call
  (call_expression function: (member_expression property: (property_identifier) @call.prop)) @call.member
  (call_expression function: (super)) @super.call
  (new_expression constructor: (_) @new.ctor) @new
`;

const CLASS_NODE_TYPES = new Set(["class_declaration", "abstract_class_declaration"]);
const FUNCTION_LIKE = new Set([
  "function_declaration",
  "method_definition",
  "arrow_function",
  "function_expression"
]);
const FIELD_NODE_TYPES = new Set(["field_definition", "public_field_definition"]);

interface ClassInfo {
  name: string;
  superclass?: string;
  interfaces: string[];
  /** member name -> declared/inferred type (methods have no type). */
  members: Map<string, { type?: string; kind: "method" | "property" }>;
  ctorNode?: Node;
}

interface FileAnalysis {
  nodes: RawNode[];
  calls: RawCallSite[];
  interfaces: string[];
  symbols: ExtractedSymbol[];
}

function analyzeFile(input: PackAnalysisInput): FileAnalysis {
  const { tree, createQuery, file } = input;
  const query = createQuery(TYPESCRIPT_QUERY);

  const nodes: RawNode[] = [];
  const calls: RawCallSite[] = [];
  const interfaces: string[] = [];
  const symbols: ExtractedSymbol[] = [];

  const classes = new Map<string, ClassInfo>();
  /** local name -> imported name (import aliases). */
  const importAliases = new Map<string, string>();
  /**
   * Scope bindings keyed by the scope node's startIndex (web-tree-sitter Node
   * wrappers are not identity-stable): scope start byte -> name -> type name.
   */
  const scopes = new Map<number, Map<string, string | undefined>>();

  const lineOf = (node: Node): number => node.startPosition.row + 1;
  const endLineOf = (node: Node): number => node.endPosition.row + 1;
  const spanOf = (node: Node): { startLine: number; endLine: number } => ({
    startLine: lineOf(node),
    endLine: endLineOf(node)
  });
  const pushNode = (name: string, node: Node): void => {
    if (!name) return;
    nodes.push({ name, filePath: file.path, ...spanOf(node) });
  };
  const pushSymbol = (
    name: string,
    kind: ExtractedSymbol["kind"],
    node: Node,
    extra?: { importedName?: string; source?: string }
  ): void => {
    if (!name) return;
    symbols.push({
      name,
      kind,
      filePath: file.path,
      ...spanOf(node),
      // 1-based columns, so the CodeSymbol location contract of #155 maps 1:1.
      startColumn: node.startPosition.column + 1,
      endColumn: node.endPosition.column + 1,
      ...extra
    });
  };

  /** Strip the type_annotation wrapper and read a usable type name, or undefined. */
  const typeNameOf = (node: Node | null): string | undefined => {
    if (!node) return undefined;
    // type_annotation's inner type carries no field name in this grammar
    const t =
      node.type === "type_annotation"
        ? node.childForFieldName("type") ?? node.namedChildren[0] ?? null
        : node;
    if (!t) return undefined;
    switch (t.type) {
      case "type_identifier":
        return t.text;
      case "generic_type":
        return t.childForFieldName("name")?.text ?? lastSegment(t.text);
      case "nested_type_identifier":
        return lastSegment(t.text);
      case "parenthesized_type":
        return typeNameOf(t.childForFieldName("value") ?? t.children[1] ?? null);
      default:
        // predefined_type (string/any/unknown…), union_type, array_type,
        // function types… — not a resolvable named type.
        return undefined;
    }
  };
  const applyAlias = (name: string | undefined): string | undefined =>
    name === undefined ? undefined : (importAliases.get(name) ?? name);
  const ctorNameOf = (newExpr: Node): string => {
    const ctor = newExpr.childForFieldName("constructor");
    return ctor ? lastSegment(ctor.text) : "";
  };

  const enclosingClassName = (node: Node): string | undefined => {
    let p = node.parent;
    while (p) {
      if (CLASS_NODE_TYPES.has(p.type)) return p.childForFieldName("name")?.text ?? undefined;
      p = p.parent;
    }
    return undefined;
  };
  const enclosingInterfaceName = (node: Node): string | undefined => {
    let p = node.parent;
    while (p) {
      if (p.type === "interface_declaration") return p.childForFieldName("name")?.text ?? undefined;
      p = p.parent;
    }
    return undefined;
  };

  /** Full name of the member enclosing `node` ("Type.member", bare name, or ""). */
  const callerNameOf = (node: Node): string => {
    let p: Node | null = node.parent;
    while (p) {
      if (FUNCTION_LIKE.has(p.type)) {
        const name = p.childForFieldName("name")?.text;
        if (p.type === "method_definition" || p.type === "function_declaration") {
          if (!name) return "";
          const cls = enclosingClassName(p);
          return cls ? `${cls}.${name}` : name;
        }
        return name ?? "";
      }
      if (p.type === "variable_declarator") {
        const value = p.childForFieldName("value");
        if (value && (value.type === "arrow_function" || value.type === "function")) {
          return p.childForFieldName("name")?.text ?? "";
        }
      }
      if (FIELD_NODE_TYPES.has(p.type)) {
        // a field initializer runs in the constructor
        const cls = enclosingClassName(p);
        return cls ? `${cls}.constructor` : "";
      }
      p = p.parent;
    }
    return "";
  };

  /** Bindings of one scope: parameters + variable declarators (not nested scopes). */
  const collectBindings = (scopeNode: Node): Map<string, string | undefined> => {
    const bindings = new Map<string, string | undefined>();
    const params = scopeNode.childForFieldName("parameters");
    if (params) {
      for (const p of params.namedChildren) {
        if (!p) continue;
        if (p.type === "required_parameter" || p.type === "optional_parameter") {
          const pattern = p.childForFieldName("pattern");
          if (pattern?.type === "identifier") {
            bindings.set(pattern.text, applyAlias(typeNameOf(p.childForFieldName("type"))));
          }
        }
      }
    }
    const walk = (node: Node): void => {
      for (const child of node.children) {
        if (!child) continue;
        if (child !== scopeNode && FUNCTION_LIKE.has(child.type)) continue; // nested scope
        if (child.type === "variable_declarator") {
          const name = child.childForFieldName("name");
          if (name?.type === "identifier") {
            const declared = applyAlias(typeNameOf(child.childForFieldName("type")));
            const value = child.childForFieldName("value");
            // local var inference from `new X(...)`
            const inferred =
              declared ?? (value?.type === "new_expression" ? applyAlias(ctorNameOf(value)) : undefined);
            bindings.set(name.text, inferred);
          }
        }
        walk(child);
      }
    };
    walk(scopeNode);
    return bindings;
  };

  const buildScopes = (root: Node): void => {
    scopes.set(root.startIndex, collectBindings(root));
    const visit = (node: Node): void => {
      if (node !== root && FUNCTION_LIKE.has(node.type)) {
        scopes.set(node.startIndex, collectBindings(node));
      }
      for (const child of node.children) if (child) visit(child);
    };
    visit(root);
  };

  /** Type of a local identifier at a call site (nearest scope wins). */
  const typeOfIdentifier = (name: string, from: Node): string | undefined => {
    let p: Node | null = from.parent;
    while (p) {
      const scope = scopes.get(p.startIndex);
      if (scope && scope.has(name)) return scope.get(name);
      p = p.parent;
    }
    return undefined;
  };

  // ---- pass 1: declarations, imports, class shapes -------------------------
  const declMatches: Map<string, Node>[] = [];
  const callMatches: Map<string, Node>[] = [];
  for (const match of query.matches(tree.rootNode)) {
    const caps = new Map<string, Node>();
    for (const capture of match.captures) {
      if (!caps.has(capture.name)) caps.set(capture.name, capture.node);
    }
    if (caps.has("call") || caps.has("call.member") || caps.has("super.call") || caps.has("new")) {
      callMatches.push(caps);
    } else {
      declMatches.push(caps);
    }
  }

  for (const caps of declMatches) {
    const classDecl = caps.get("class.decl");
    if (classDecl) {
      const name = caps.get("class.name")?.text ?? "";
      if (!name) continue;
      const info: ClassInfo = { name, interfaces: [], members: new Map() };
      classes.set(name, info);
      const heritage = classDecl.children.find(c => c?.type === "class_heritage");
      if (heritage) {
        for (const h of heritage.children) {
          if (!h) continue;
          if (h.type === "extends_clause") {
            const value = h.childForFieldName("value");
            info.superclass = value ? lastSegment(value.text) : undefined;
          } else if (h.type === "implements_clause") {
            for (const t of h.children) {
              if (t && t.type !== "implements") info.interfaces.push(lastSegment(t.text));
            }
          }
        }
      }
      const body = classDecl.childForFieldName("body");
      for (const member of body?.namedChildren ?? []) {
        if (member?.type === "method_definition" && member.childForFieldName("name")?.text === "constructor") {
          info.ctorNode = member;
        }
      }
      // exactly one constructor node per class (no bare class node, #149 format)
      pushNode(`${name}.constructor`, info.ctorNode ?? classDecl);
      pushSymbol(name, "class", classDecl);
      continue;
    }

    const ifaceDecl = caps.get("iface.decl");
    if (ifaceDecl) {
      const name = caps.get("iface.name")?.text ?? "";
      if (name) {
        interfaces.push(name);
        pushSymbol(name, "interface", ifaceDecl);
      }
      continue;
    }

    const methodDef = caps.get("method.def");
    if (methodDef) {
      const name = methodDef.childForFieldName("name")?.text ?? "";
      const cls = enclosingClassName(methodDef);
      const fullName = cls ? `${cls}.${name}` : name;
      if (name === "constructor" && cls) {
        pushSymbol(fullName, "constructor", methodDef);
        // constructor parameter properties are class members ("Class.field")
        const params = methodDef.childForFieldName("parameters");
        for (const p of params?.namedChildren ?? []) {
          if (!p) continue;
          if (p.type !== "required_parameter" && p.type !== "optional_parameter") continue;
          const hasModifier = p.children.some(
            c => c?.type === "accessibility_modifier" || c?.type === "readonly_modifier"
          );
          const pattern = p.childForFieldName("pattern");
          if (!hasModifier || pattern?.type !== "identifier") continue;
          const propType = applyAlias(typeNameOf(p.childForFieldName("type")));
          classes.get(cls)?.members.set(pattern.text, { type: propType, kind: "property" });
          pushNode(`${cls}.${pattern.text}`, p);
          pushSymbol(`${cls}.${pattern.text}`, "property", p);
        }
      } else if (name) {
        if (cls) classes.get(cls)?.members.set(name, { kind: "method" });
        pushNode(fullName, methodDef);
        pushSymbol(fullName, "method", methodDef);
      }
      continue;
    }

    const sig = caps.get("sig.def") ?? caps.get("prop.sig");
    if (sig) {
      const name = sig.childForFieldName("name")?.text ?? "";
      const iface = enclosingInterfaceName(sig);
      const fullName = iface ? `${iface}.${name}` : name;
      pushNode(fullName, sig);
      pushSymbol(fullName, caps.has("prop.sig") ? "property" : "method", sig);
      continue;
    }

    const fnDecl = caps.get("fn.decl");
    if (fnDecl) {
      const name = caps.get("fn.name")?.text ?? "";
      pushNode(name, fnDecl);
      pushSymbol(name, "function", fnDecl);
      continue;
    }

    const aliasDecl = caps.get("alias.decl");
    if (aliasDecl) {
      pushSymbol(caps.get("alias.name")?.text ?? "", "type-alias", aliasDecl);
      continue;
    }

    const enumDecl = caps.get("enum.decl");
    if (enumDecl) {
      // Symbols only (the #114 contract surfaces enums); enums are not
      // relation-graph nodes, so the graph shape of #149 is unchanged.
      pushSymbol(caps.get("enum.name")?.text ?? "", "enum", enumDecl);
      continue;
    }

    const impStmt = caps.get("imp.stmt");
    if (impStmt) {
      const rawSource = caps.get("imp.source")?.text ?? "";
      const source = rawSource.replace(/^["'`]|["'`]$/g, "");
      const clause = impStmt.children.find(c => c?.type === "import_clause");
      for (const child of clause?.namedChildren ?? []) {
        if (!child) continue;
        if (child.type === "named_imports") {
          for (const spec of child.namedChildren) {
            if (spec?.type !== "import_specifier") continue;
            const imported = spec.childForFieldName("name")?.text ?? "";
            const alias = spec.childForFieldName("alias")?.text;
            const local = alias ?? imported;
            if (local && imported) importAliases.set(local, imported);
            pushSymbol(local, "import", spec, { importedName: imported, source });
          }
        } else if (child.type === "identifier") {
          // default import: local name stands for the module's default export
          importAliases.set(child.text, child.text);
          pushSymbol(child.text, "import", child, { source });
        } else if (child.type === "namespace_import") {
          const id = child.childForFieldName("name") ?? child.namedChildren[0] ?? null;
          if (id) pushSymbol(id.text, "import", child, { source });
        }
      }
      continue;
    }

    const impEq = caps.get("imp.eq");
    if (impEq) {
      const local = caps.get("imp.eq.name")?.text ?? "";
      const target = lastSegment(impEq.namedChildren[1]?.text ?? "");
      if (local && target) importAliases.set(local, target);
      pushSymbol(local, "import", impEq, { importedName: target || undefined });
      continue;
    }

    const fieldDef = caps.get("field.def");
    if (fieldDef) {
      const name = caps.get("field.name")?.text ?? "";
      const cls = enclosingClassName(fieldDef);
      if (cls && name) {
        const declared = applyAlias(typeNameOf(fieldDef.childForFieldName("type")));
        const value = fieldDef.childForFieldName("value");
        const inferred =
          declared ?? (value?.type === "new_expression" ? applyAlias(ctorNameOf(value)) : undefined);
        classes.get(cls)?.members.set(name, { type: inferred, kind: "property" });
        pushNode(`${cls}.${name}`, fieldDef);
        pushSymbol(`${cls}.${name}`, "property", fieldDef);
      }
      continue;
    }

    const varDecl = caps.get("var.decl");
    if (varDecl) {
      // arrow/function-valued variables are function declarations
      const value = varDecl.childForFieldName("value");
      if (value && (value.type === "arrow_function" || value.type === "function")) {
        const name = caps.get("var.name")?.text ?? "";
        pushNode(name, varDecl);
        pushSymbol(name, "function", varDecl);
      }
      continue;
    }
    // @param captures feed the scope bindings built above; nothing to emit.
  }

  // Scopes are built AFTER pass 1 so import aliases are already known when
  // parameter/variable types are mapped to their imported names.
  buildScopes(tree.rootNode);

  // ---- pass 2: call sites, with pack-resolved receiver types ----------------
  for (const caps of callMatches) {
    const superCall = caps.get("super.call");
    if (superCall) {
      const cls = enclosingClassName(superCall);
      const sup = cls ? classes.get(cls)?.superclass : undefined;
      calls.push({
        file: file.path,
        line: lineOf(superCall),
        name: "constructor",
        syntax: "super",
        receiver: "super",
        caller: callerNameOf(superCall),
        receiverType: applyAlias(sup)
      });
      continue;
    }

    const newNode = caps.get("new");
    if (newNode) {
      const name = applyAlias(ctorNameOf(newNode));
      if (name) {
        calls.push({
          file: file.path,
          line: lineOf(newNode),
          name,
          syntax: "new",
          receiver: "none",
          caller: callerNameOf(newNode)
        });
      }
      continue;
    }

    const callNode = caps.get("call") ?? caps.get("call.member");
    if (!callNode) continue;
    const prop = caps.get("call.prop");
    if (prop) {
      const callee = callNode.childForFieldName("function");
      const object = callee?.childForFieldName("object") ?? null;
      const name = prop.text;
      let receiver: ReceiverKind = "member";
      let receiverType: string | undefined;
      if (object?.type === "this") {
        // this.x -> the enclosing type; inherited members -> the superclass
        receiver = "this";
        const cls = enclosingClassName(callNode);
        const info = cls ? classes.get(cls) : undefined;
        if (info) {
          receiverType = info.members.has(name) ? cls : applyAlias(info.superclass) ?? cls;
        }
      } else if (object?.type === "super") {
        receiver = "super";
        const cls = enclosingClassName(callNode);
        receiverType = applyAlias(cls ? classes.get(cls)?.superclass : undefined);
      } else if (object?.type === "member_expression") {
        // this.field.method() — one level: the declared/inferred type of the field
        const innerObj = object.childForFieldName("object");
        const innerProp = object.childForFieldName("property");
        if (innerObj?.type === "this" && innerProp) {
          const cls = enclosingClassName(callNode);
          const info = cls ? classes.get(cls) : undefined;
          let fieldType = info?.members.get(innerProp.text)?.type;
          if (!fieldType && info?.superclass) {
            fieldType = classes.get(applyAlias(info.superclass) ?? "")?.members.get(innerProp.text)?.type;
          }
          receiverType = fieldType;
        }
      } else if (object?.type === "identifier") {
        // local var / parameter: declared type or inference from `new X(...)`
        receiverType = typeOfIdentifier(object.text, callNode);
      }
      calls.push({
        file: file.path,
        line: lineOf(callNode),
        name,
        syntax: "call",
        receiver,
        caller: callerNameOf(callNode),
        receiverType
      });
    } else {
      const ident = caps.get("call.ident");
      const name = ident?.text ?? "";
      if (!name || name === "super") continue;
      calls.push({
        file: file.path,
        line: lineOf(callNode),
        name,
        syntax: "call",
        receiver: "none",
        caller: callerNameOf(callNode)
      });
    }
  }

  return { nodes, calls, interfaces, symbols };
}

/** Create the TypeScript (or TSX) language pack of #151. */
export function createTypeScriptPack(language: TypeScriptPackLanguage = "typescript"): LanguagePack {
  const grammarId = GRAMMAR_BY_LANGUAGE[language];
  return {
    language,
    grammarId,
    extensions: extensionsForLanguage(language),
    analyze(input: PackAnalysisInput): PackAnalysisResult {
      const analysis = analyzeFile(input);
      return {
        nodes: analysis.nodes,
        calls: analysis.calls,
        interfaces: analysis.interfaces
      };
    }
  };
}

/**
 * Plug the TypeScript pack into the registry under its canonical ids:
 * `registerPack` for "typescript" (grammar `typescript`) and "tsx"
 * (grammar `tsx`). Ticket #155 calls this from the MCP seam.
 */
export function registerTypeScriptPacks(): void {
  registerPack(createTypeScriptPack("typescript"));
  registerPack(createTypeScriptPack("tsx"));
}

export interface ExtractSymbolsOptions {
  /** Default pack language when a source carries no `language` override. */
  language?: TypeScriptPackLanguage;
  /** Override directory for the prebuilt grammar .wasm files. */
  wasmDirectory?: string;
}

/**
 * Declaration extraction usable as the symbol source that replaces the #114
 * regex spike: parses each source with the prebuilt tree-sitter grammar and
 * returns every declaration (classes, interfaces, methods, constructors,
 * functions, properties, imports, type aliases) with 1-based positions.
 * Ticket #155 maps `ExtractedSymbol` onto the existing `extractSymbols`
 * contract of `codetour-mcp`'s parsing module; consumers keep compiling.
 */
export async function extractTypeScriptSymbols(
  sources: SourceFile | SourceFile[],
  options: ExtractSymbolsOptions = {}
): Promise<ExtractedSymbol[]> {
  const list = Array.isArray(sources) ? sources : [sources];
  const parser = await getParser();
  const grammars = new Map<TypeScriptPackLanguage, Promise<Language>>();
  const grammarFor = async (language: TypeScriptPackLanguage) => {
    let pending = grammars.get(language);
    if (!pending) {
      pending = loadGrammar(GRAMMAR_BY_LANGUAGE[language], options.wasmDirectory);
      grammars.set(language, pending);
    }
    return pending;
  };

  const out: ExtractedSymbol[] = [];
  for (const source of list) {
    const normalized = normalizeLanguage(source.language ?? options.language ?? "typescript");
    const language: TypeScriptPackLanguage = normalized === "tsx" ? "tsx" : "typescript";
    const wasmLanguage = await grammarFor(language);
    parser.setLanguage(wasmLanguage);
    const tree = parser.parse(source.content);
    if (!tree) throw new Error(`tree-sitter failed to parse ${source.path}`);
    const analysis = analyzeFile({
      file: source,
      language,
      grammarId: GRAMMAR_BY_LANGUAGE[language],
      parser,
      tree,
      createQuery: source => new Query(wasmLanguage, source)
    });
    out.push(...analysis.symbols);
  }
  return out;
}
