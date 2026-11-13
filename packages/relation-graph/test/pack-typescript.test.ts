import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRelationGraph,
  extractTypeScriptSymbols,
  getPack,
  registerTypeScriptPacks,
  resetLanguagePacks,
  type GraphEdge,
  type GraphNode,
  type RelationGraph
} from "../src/index";
import {
  EXPECTED_EDGES,
  EXPECTED_SITES,
  TSX_FIXTURES,
  TS_ADMIN_SERVICE_PATH,
  TS_API_PATH,
  TS_BASE_SERVICE_PATH,
  TS_PACK_FIXTURES,
  TS_REPOSITORY_PATH,
  TS_USER_SERVICE_PATH
} from "./helpers/ts-pack-fixtures";

function nodeByName(graph: RelationGraph, name: string): GraphNode {
  const node = graph.nodes.find(n => n.name === name);
  assert.ok(node, `expected a node named ${name}`);
  return node;
}

function edgeBetween(graph: RelationGraph, fromName: string, toName: string): GraphEdge {
  const from = nodeByName(graph, fromName);
  const to = nodeByName(graph, toName);
  const edge = graph.edges.find(e => e.from === from.id && e.to === to.id);
  assert.ok(edge, `expected an edge ${fromName} -> ${toName}`);
  return edge;
}

test("registerTypeScriptPacks plugs the TypeScript pack under \"typescript\" and \"tsx\"", () => {
  registerTypeScriptPacks();
  try {
    const ts = getPack("typescript");
    const tsx = getPack("tsx");
    assert.ok(ts && tsx);
    assert.equal(ts.language, "typescript");
    assert.equal(ts.grammarId, "typescript");
    assert.ok(ts.extensions.includes(".ts"));
    assert.equal(tsx.language, "tsx");
    assert.equal(tsx.grammarId, "tsx");
    assert.ok(tsx.extensions.includes(".tsx"));
  } finally {
    resetLanguagePacks();
  }
});

test("the TypeScript pack resolves the hand-written ground truth (provable edges, hard sites, never false edges)", async () => {
  registerTypeScriptPacks();
  try {
    const graph = await buildRelationGraph(TS_PACK_FIXTURES, "typescript");
    assert.equal(graph.status, "resolved");
    assert.equal(graph.supported, true);

    // --- declarations with 1-based positions --------------------------------
    const getUser = nodeByName(graph, "UserService.getUser");
    assert.equal(getUser.filePath, TS_USER_SERVICE_PATH);
    assert.equal(getUser.startLine, 9);
    assert.equal(getUser.endLine, 13);
    // one constructor node per class, spanning the explicit constructor
    const ctor = nodeByName(graph, "UserService.constructor");
    assert.equal(ctor.startLine, 5);
    assert.equal(ctor.endLine, 7);
    // interface members are nodes; an interface has no constructor node
    const find = nodeByName(graph, "Repository.find");
    assert.equal(find.filePath, TS_REPOSITORY_PATH);
    assert.equal(find.startLine, 2);
    assert.ok(!graph.nodes.some(n => n.name === "Repository.constructor"), "interfaces have no constructor node");
    assert.ok(!graph.nodes.some(n => n.name === "UserService"), "no bare class node");
    // top-level functions are bare-name nodes
    assert.ok(graph.nodes.some(n => n.name === "handleRequest" && n.filePath === TS_API_PATH));

    // --- every hand-written expected edge, with status + file:line proof ----
    for (const expected of EXPECTED_EDGES) {
      const edge = edgeBetween(graph, expected.from, expected.to);
      assert.equal(edge.kind, expected.kind, `${expected.from} -> ${expected.to} kind`);
      assert.equal(edge.callType, expected.callType, `${expected.from} -> ${expected.to} callType`);
      assert.equal(edge.status, expected.status, `${expected.from} -> ${expected.to} status (certainty ${expected.certainty})`);
      assert.equal(edge.line, expected.line, `${expected.from} -> ${expected.to} line`);
      assert.equal(edge.filePath, expected.file, `${expected.from} -> ${expected.to} file`);
    }

    // --- every hand-written expected ambiguity/unresolved site --------------
    for (const expected of EXPECTED_SITES) {
      const site = graph.sites.find(
        s => s.file === expected.file && s.line === expected.line && s.name === expected.name
      );
      assert.ok(site, `expected a site ${expected.name} @ ${expected.file}:${expected.line}`);
      assert.equal(site.caller, expected.caller);
      assert.equal(site.status, expected.status, `${expected.name} site status (certainty ${expected.certainty})`);
      assert.deepEqual([...site.candidates].sort(), [...expected.candidates].sort());
    }

    // --- never a false edge ---------------------------------------------------
    // dynamic dispatch: handleViaPicker calls picker.getUser(id) with an
    // unprovable receiver type — no edge to ANY getUser node may exist.
    const handleViaPicker = nodeByName(graph, "handleViaPicker");
    const dispatchUnknown = nodeByName(graph, "dispatchUnknown");
    for (const caller of [handleViaPicker, dispatchUnknown]) {
      const getUserTargets = graph.edges.filter(
        e => e.from === caller.id && graph.nodes.find(n => n.id === e.to)?.name.endsWith(".getUser")
      );
      assert.equal(getUserTargets.length, 0, `no guessed edge from ${caller.name} to a same-named method`);
    }
  } finally {
    resetLanguagePacks();
  }
});

test("same-named methods surface as an ambiguity site with all candidates (#149 story 5)", async () => {
  registerTypeScriptPacks();
  try {
    const graph = await buildRelationGraph(TS_PACK_FIXTURES, "typescript");
    const site = graph.sites.find(s => s.caller === "dispatchUnknown" && s.name === "getUser");
    assert.ok(site);
    assert.equal(site.status, "ambiguous");
    // candidates = every same-named member indexed on the local graph
    for (const candidate of ["AdminService.getUser", "UserService.getUser", "FastPicker.getUser", "SlowPicker.getUser"]) {
      assert.ok(site.candidates.includes(candidate), `missing candidate ${candidate}`);
    }
    // and never an edge from the ambiguous caller
    const caller = nodeByName(graph, "dispatchUnknown");
    assert.equal(graph.edges.filter(e => e.from === caller.id).length, 0);
    // the provable callers of the same-named methods still get their exact edges
    edgeBetween(graph, "handleRequest", "UserService.getUser");
    edgeBetween(graph, "handleRequest", "AdminService.getUser");
  } finally {
    resetLanguagePacks();
  }
});

test("interface relations are asserted toward the port with heuristic status (#149 story 16)", async () => {
  registerTypeScriptPacks();
  try {
    const graph = await buildRelationGraph(TS_PACK_FIXTURES, "typescript");
    for (const [from, to] of [
      ["UserService.getUser", "Repository.find"],
      ["UserService.audit", "Repository.log"]
    ] as const) {
      const edge = edgeBetween(graph, from, to);
      assert.equal(edge.callType, "interface");
      assert.equal(edge.status, "heuristic");
      assert.equal(edge.kind, "call");
    }
  } finally {
    resetLanguagePacks();
  }
});

test("import aliases map local names to the imported symbol (Users -> UserService)", async () => {
  registerTypeScriptPacks();
  try {
    const graph = await buildRelationGraph(TS_PACK_FIXTURES, "typescript");
    // no node may carry the alias as a type name
    assert.ok(!graph.nodes.some(n => n.name.startsWith("Users.")), "alias must not leak as a node name");
    assert.ok(!graph.nodes.some(n => n.name.startsWith("Admins.")));
    // new Users(...) resolves through the alias to UserService.constructor
    const edge = edgeBetween(graph, "handleRequest", "UserService.constructor");
    assert.equal(edge.kind, "new");
    assert.equal(edge.line, 6);
    assert.equal(edge.filePath, TS_API_PATH);
  } finally {
    resetLanguagePacks();
  }
});

test("inheritance and super() resolve through the extends clause", async () => {
  registerTypeScriptPacks();
  try {
    const graph = await buildRelationGraph(TS_PACK_FIXTURES, "typescript");
    const superEdge = edgeBetween(graph, "UserService.constructor", "BaseService.constructor");
    assert.equal(superEdge.kind, "super");
    assert.equal(superEdge.callType, "super");
    assert.equal(superEdge.line, 6);
    assert.equal(superEdge.filePath, TS_USER_SERVICE_PATH);
    // this.validate is declared on the base class: edge to the declaration site
    const inherited = edgeBetween(graph, "UserService.getUser", "BaseService.validate");
    assert.equal(inherited.callType, "direct");
    assert.equal(inherited.status, "resolved");
  } finally {
    resetLanguagePacks();
  }
});

test("this.x resolves to the enclosing type (local and inherited members)", async () => {
  registerTypeScriptPacks();
  try {
    const graph = await buildRelationGraph(TS_PACK_FIXTURES, "typescript");
    const local = edgeBetween(graph, "UserService.getUser", "UserService.audit");
    assert.equal(local.callType, "direct");
    assert.equal(local.status, "resolved");
    assert.equal(local.line, 11);
  } finally {
    resetLanguagePacks();
  }
});

test("the tsx pack analyzes TSX sources with the tsx grammar", async () => {
  registerTypeScriptPacks();
  try {
    const graph = await buildRelationGraph(TSX_FIXTURES, "tsx");
    assert.equal(graph.status, "resolved");
    assert.equal(graph.language, "tsx");
    const render = nodeByName(graph, "App.render");
    assert.equal(render.startLine, 10);
    // this.store.label(): field initializer `new Store()` infers the field type
    const label = edgeBetween(graph, "App.render", "Store.label");
    assert.equal(label.callType, "direct");
    assert.equal(label.status, "resolved");
    assert.equal(label.line, 11);
    // class field initializer runs in the constructor: App.constructor -> Store.constructor
    const fieldInit = edgeBetween(graph, "App.constructor", "Store.constructor");
    assert.equal(fieldInit.kind, "new");
    assert.equal(fieldInit.line, 8);
    // local var inference in a plain function
    const appCtor = edgeBetween(graph, "mount", "App.constructor");
    assert.equal(appCtor.kind, "new");
    assert.equal(appCtor.line, 16);
    const renderCall = edgeBetween(graph, "mount", "App.render");
    assert.equal(renderCall.line, 17);
  } finally {
    resetLanguagePacks();
  }
});

test("extractTypeScriptSymbols exposes declaration extraction with positions (the #114 symbol source)", async () => {
  const symbols = await extractTypeScriptSymbols(TS_PACK_FIXTURES);
  const byName = (name: string) => symbols.filter(s => s.name === name);

  const userService = byName("UserService");
  assert.ok(userService.some(s => s.kind === "class" && s.filePath === TS_USER_SERVICE_PATH && s.startLine === 4));

  const getUser = byName("UserService.getUser");
  assert.equal(getUser.length, 1);
  assert.equal(getUser[0].kind, "method");
  assert.equal(getUser[0].startLine, 9);
  assert.equal(getUser[0].endLine, 13);

  const ctor = byName("UserService.constructor");
  assert.equal(ctor.length, 1);
  assert.equal(ctor[0].kind, "constructor");
  assert.equal(ctor[0].startLine, 5);

  // interface + its members
  assert.ok(byName("Repository").some(s => s.kind === "interface" && s.filePath === TS_REPOSITORY_PATH));
  const find = byName("Repository.find");
  assert.equal(find.length, 1);
  assert.equal(find[0].kind, "method");
  assert.equal(find[0].startLine, 2);

  // top-level functions
  const handle = byName("handleRequest");
  assert.equal(handle.length, 1);
  assert.equal(handle[0].kind, "function");
  assert.equal(handle[0].filePath, TS_API_PATH);
  assert.equal(handle[0].startLine, 5);

  // imports are extracted with local name, imported name and module source
  const usersImport = symbols.find(s => s.kind === "import" && s.name === "Users");
  assert.ok(usersImport, "expected an import symbol for the alias Users");
  assert.equal(usersImport.importedName, "UserService");
  assert.equal(usersImport.source, "./user-service");
  assert.equal(usersImport.filePath, TS_API_PATH);

  // class fields / parameter properties are property symbols
  assert.ok(byName("UserService.repository").some(s => s.kind === "property"));
  assert.ok(byName("BaseService.validate").some(s => s.kind === "method" && s.filePath === TS_BASE_SERVICE_PATH));
  assert.ok(byName("AdminService.getUser").some(s => s.kind === "method" && s.filePath === TS_ADMIN_SERVICE_PATH));

  // every symbol carries 1-based positions and its file
  for (const s of symbols) {
    assert.ok(Number.isInteger(s.startLine) && s.startLine >= 1, `${s.name} startLine`);
    assert.ok(s.endLine >= s.startLine, `${s.name} endLine`);
    assert.equal(typeof s.filePath, "string");
    assert.ok(s.filePath.length > 0);
  }
});
