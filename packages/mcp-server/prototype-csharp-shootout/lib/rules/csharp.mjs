// PROTOTYPE — C# rule pack (throwaway).
//
// Minimal Tree-sitter rules answering exactly the questions a Tour needs:
//   - incoming/outgoing calls of a symbol's members,
//   - class usage (object creations ->
//     Type.constructor -> Method[ -> gap line]
//     features that make C# resolvable *without* a type system:
//     declared types on fields/params/locals, alias resolution via `using X = Y`.
//
// Output shapes deliberately mirror what the first prototype
// (prototype-codeflow-graph) consumed from @codeflow-map/core, so the same
// pure payload logic (lib/payload.mjs over there) runs unchanged.

import * as Parser from "web-tree-sitter";
import fs from "node:fs/promises";
import path from "node:path";

const lastIdentifier = (text) => text.trim().split(".").pop();

export async function loadParser(wasmPath) {
  await Parser.Parser.init();
  const parser = new Parser.Parser();
  parser.setLanguage(await Parser.Language.load(wasmPath));
  return parser;
}

async function walk(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "obj" || entry.name === "bin" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith(".cs")) out.push(full);
  }
  return out;
}

const typeNameOf = (decl) => decl.name;

function readParameterTypes(parameterList) {
  const params = new Map();
  if (!parameterList) return params;
  for (const parameter of parameterList.namedChildren) {
    if (parameter.type !== "parameter") continue;
    const parts = parameter.namedChildren.filter((n) => n.type !== "modifier");
    if (parts.length < 2) continue;
    // In the tree-sitter-c-sharp grammar a parameter is (type name); both are
    // identifiers, qualified names or predefined types.
    const declared = parts[0].text.trim();
    const name = parts[parts.length - 1].text.trim();
    params.set(name, implicitness.has(declared) ? null : declared);
  }
  return params;
}

const implicitness = new Set(["var", "dynamic"]);

async function collectFile(parser, file, rootDir) {
  const relative = path.relative(rootDir, file).split(path.sep).join("/");
  const source = await fs.readFile(file, "utf8");
  const tree = parser.parse(source);
  const model = {
    filePath: relative,
    aliases: new Map(),
    types: [],
    calls: [],
    creations: [],
    superCtors: [],
  };

  // using Admin = Fixture.Services.AdminService;
  for (const node of tree.rootNode.namedChildren) {
    if (node.type !== "using_directive" || node.namedChildren.length === 0) continue;
    const head = node.namedChildren[0];
    if (head.type !== "name_equals") continue;
    const alias = head.namedChildren[0].text.trim();
    const targetNode = node.namedChildren.find((n) => n.type === "qualified_name" || n.type === "identifier");
    if (targetNode) model.aliases.set(alias, lastIdentifier(targetNode.text));
  }

  const visitType = (node, typeName, kind) => {
    const bases = [];
    const baseList = node.namedChildren.find((n) => n.type === "base_list");
    if (baseList) {
      for (const base of baseList.namedChildren) bases.push(lastIdentifier(base.text));
    }
    const body = node.namedChildren.find((n) => n.type === "declaration_list");
    const fields = new Map();
    const methods = new Map();
    const ctors = [];
    const decl = {
      typeName, kind, bases, fields, methods, ctors,
      filePath: relative,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
    };
    model.types.push(decl);
    if (!body) return;

    const localsOf = new Map();
    let member = null;

    const declareLocals = (statement) => {
      const variableDeclaration = statement.namedChildren.find((n) => n.type === "variable_declaration");
      if (!variableDeclaration) return;
      const typeChild = variableDeclaration.namedChildren.find(
        (n) => n.type !== "variable_declarator",
      );
      const explicitType = typeChild && !implicitness.has(typeChild.text.trim()) && typeChild.type !== "implicit_type"
        ? lastIdentifier(typeChild.text)
        : null;
      for (const declarator of variableDeclaration.namedChildren) {
        if (declarator.type !== "variable_declarator") continue;
        const varName = declarator.namedChildren.find((n) => n.type === "identifier");
        if (!varName) continue;
        let inferred = explicitType;
        if (!inferred) {
          const value = declarator.namedChildren.find((n) => n.type === "equals_value_clause");
          const creation = value?.namedChildren.find((n) => n.type === "object_creation_expression");
          const typeNode = creation?.namedChildren.find(
            (n) => n.type === "identifier" || n.type === "qualified_name",
          );
          if (typeNode) inferred = lastIdentifier(typeNode.text);
        }
        localsOf.set(varName.text, inferred ?? null);
      }
    };

    const visitMemberBody = (memberDecl, ownerLabel) => {
      member = { ...ownerLabel };
      const bodyNode = memberDecl.namedChildren.find((n) => n.type === "block");
      const parameters = memberDecl.namedChildren.find((n) => n.type === "parameter_list");
      const params = readParameterTypes(parameters);
      localsOf.clear();
      const visitStatement = (statement) => {
        if (statement.type === "local_declaration_statement") declareLocals(statement);
        for (const child of statement.namedChildren) visitStatement(child);
      };
      if (bodyNode) for (const statement of bodyNode.namedChildren) visitStatement(statement);

      const visitExpression = (expr) => {
        if (expr.type === "invocation_expression") {
          const fn = expr.namedChildren.find((n) => n.type !== "argument_list");
          let receiver = null;
          let name = null;
          if (fn?.type === "member_access_expression") {
            const [target, lbl] = fn.namedChildren;
            name = lbl?.text.trim() ?? null;
            receiver = target?.type === "identifier" ? target.text.trim() : null;
          } else if (fn?.type === "identifier") {
            name = fn.text.trim();
          }
          if (name) {
            model.calls.push({
              line: expr.startPosition.row,
              callerMember: member.name,
              receiver: receiver || (fn?.type === "member_access_expression" ? "#chain" : "this"),
              receiverType: receiver ? localsOf.get(receiver) ?? params.get(receiver) ?? fields.get(receiver) ?? null : "this",
              name,
            });
          }
        }
        if (expr.type === "object_creation_expression") {
          const typeNode = expr.namedChildren.find(
            (n) => n.type === "identifier" || n.type === "qualified_name",
          );
          const explicitCast = expr.namedChildren.find((n) => n.type === "type");
          const typeText = typeNode?.text ?? explicitCast?.text;
          if (typeText) {
            model.creations.push({
              line: expr.startPosition.row,
              callerMember: member.name,
              typeName: lastIdentifier(typeText),
            });
          }
        }
        for (const child of expr.namedChildren) visitExpression(child);
      };
      if (bodyNode) for (const statement of bodyNode.namedChildren) {
        visitStatement(statement);
        for (const child of statement.namedChildren) visitExpression(child);
      }

      // : base(...) — the explicit super-constructor proof.
      const initializer = memberDecl.namedChildren.find((n) => n.type === "constructor_initializer");
      if (initializer && initializer.text.includes("base")) {
        model.superCtors.push({ line: initializer.startPosition.row, callerMember: member.name });
      }
    };

    for (const memberNode of body.namedChildren) {
      if (memberNode.type === "method_declaration") {
        const name = memberNode.childForFieldName("name")?.text.trim();
        if (!name) continue;
        methods.set(name, {
          filePath: relative,
          startLine: memberNode.startPosition.row,
          endLine: memberNode.endPosition.row,
        });
        visitMemberBody(memberNode, { name: `${typeName}.${name}` });
      } else if (memberNode.type === "constructor_declaration") {
        const ctor = {
          filePath: relative,
          startLine: memberNode.startPosition.row,
          endLine: memberNode.endPosition.row,
        };
        ctors.push(ctor);
        visitMemberBody(memberNode, { name: `${typeName}.constructor` });
      } else if (memberNode.type === "field_declaration") {
        const variableDeclaration = memberNode.namedChildren.find((n) => n.type === "variable_declaration");
        const typeChild = variableDeclaration?.namedChildren.find((n) => n.type !== "variable_declarator");
        const explicitType = typeChild && typeChild.type !== "implicit_type" ? lastIdentifier(typeChild.text) : null;
        for (const declarator of variableDeclaration?.namedChildren ?? []) {
          if (declarator.type !== "variable_declarator") continue;
          const varName = declarator.namedChildren.find((n) => n.type === "identifier");
          if (varName) fields.set(varName.text, explicitType);
        }
      } else if (memberNode.type === "property_declaration") {
        const name = memberNode.childForFieldName("name")?.text.trim();
        const typeNode = memberNode.namedChildren.find((n) => n.type === "identifier" || n.type === "predefined_type" || n.type === "nullable_type");
        if (name && typeNode) methods.set(`get:${name}`, { filePath: relative, startLine: memberNode.startPosition.row, endLine: memberNode.endPosition.row });
      } else if (memberNode.type === "class_declaration" || memberNode.type === "interface_declaration") {
        const nestedName = memberNode.childForFieldName("name")?.text.trim();
        if (nestedName) visitType(memberNode, `${typeName}.${nestedName}`, memberNode.type.replace("_declaration", ""));
      }
    }
  };

  const visitRoot = (node) => {
    for (const child of node.namedChildren) {
      if (child.type === "class_declaration" || child.type === "interface_declaration" || child.type === "struct_declaration" || child.type === "record_declaration") {
        const name = child.childForFieldName("name")?.text.trim() ?? typeNameOf(child);
        visitType(child, name, child.type.replace("_declaration", ""));
      } else if (child.type === "file_scoped_namespace_declaration" || child.type === "namespace_declaration") {
        visitRoot(child);
      }
    }
  };
  visitRoot(tree.rootNode);
  return model;
}

/** Second pass: cross-file resolution of everything collected in pass one. */
function resolve(modelByFile) {
  const types = new Map();
  for (const model of modelByFile) {
    for (const decl of model.types) {
      types.set(decl.typeName, decl);
      for (const [methodName, loc] of decl.methods) {
        types.set(`${decl.typeName}.${methodName.replace(/^get:/, "")}`, { ...loc, typeName: decl.typeName, memberName: methodName.replace(/^get:/, "") });
      }
      for (const ctor of decl.ctors) {
        types.set(`${decl.typeName}.constructor`, { ...ctor, typeName: decl.typeName, memberName: "constructor" });
      }
    }
  }
  const aliasOf = (model, name) => model.aliases.get(name) ?? name;

  const nodes = new Map();
  const pushNode = (id, extra) => {
    if (!nodes.has(id)) nodes.set(id, { id, name: id, ...extra });
    return nodes.get(id);
  };
  const edges = [];
  const rawCalls = [];
  const unresolved = [];

  // every type member gets a node so evidence rendering works; type
  // declarations themselves stay out of the graph (same shape as the first
  // prototype: a class is represented by its members, usage by .constructor)
  for (const [id, info] of types) {
    if (info.filePath && info.memberName) pushNode(id, { filePath: info.filePath, startLine: info.startLine, endLine: info.endLine });
  }

  for (const model of modelByFile) {
    for (const call of model.calls) {
      rawCalls.push({ callerFilePath: model.filePath, calleeName: call.name, line: call.line });
      const owner = call.callerMember?.split(".")[0] ?? null;
      let receiverType = call.receiverType;
      if (receiverType === "this") {
        receiverType = owner;
      } else if (receiverType && call.receiver !== "#chain") {
        receiverType = aliasOf(model, receiverType);
      } else {
        receiverType = null;
      }
      if (receiverType && types.has(`${receiverType}.${call.name}`)) {
        pushNode(call.callerMember, {});
        pushNode(`${receiverType}.${call.name}`, {});
        edges.push({
          from: call.callerMember,
          to: `${receiverType}.${call.name}`,
          line: call.line,
          callType: types.get(receiverType)?.kind === "interface" ? "interface" : "direct",
        });
        continue;
      }
      unresolved.push({
        file: model.filePath,
        line: call.line,
        name: call.name,
        caller: call.callerMember,
        receiver: call.receiver,
      });
    }

    for (const creation of model.creations) {
      const typeName = aliasOf(model, creation.typeName);
      rawCalls.push({ callerFilePath: model.filePath, calleeName: "new", line: creation.line, typeName });
      if (types.has(typeName)) {
        pushNode(creation.callerMember, {});
        pushNode(`${typeName}.constructor`, {});
        edges.push({ from: creation.callerMember, to: `${typeName}.constructor`, line: creation.line, callType: "new" });
      } else {
        unresolved.push({
          file: model.filePath,
          line: creation.line,
          name: `new ${typeName}`,
          caller: creation.callerMember,
          receiver: null,
          candidates: null,
        });
      }
    }

    for (const superCtor of model.superCtors) {
      const owner = superCtor.callerMember?.split(".")[0];
      const decl = model.types.find((t) => t.typeName === owner);
      const baseClass = decl?.bases.find((b) => types.get(`${b}.constructor`));
      if (baseClass) {
        edges.push({
          from: `${owner}.constructor`,
          to: `${baseClass}.constructor`,
          line: superCtor.line,
          callType: "super",
        });
      }
    }
  }

  return { nodes: [...nodes.values()], edges, rawCalls, unresolved };
}

/** Build the whole fixture graph. */
export async function buildGraph(rootDir, wasmPath) {
  const started = Date.now();
  const parser = await loadParser(wasmPath);
  const files = await walk(rootDir);
  const modelByFile = [];
  for (const file of files) modelByFile.push(await collectFile(parser, file, rootDir));
  const { nodes, edges, rawCalls, unresolved } = resolve(modelByFile);
  return {
    graph: {
      nodes,
      edges,
      rawCalls,
      unresolved,
      scannedFiles: files.length,
      durationMs: Date.now() - started,
    },
  };
}
