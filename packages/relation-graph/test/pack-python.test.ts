import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRelationGraph,
  createPythonPack,
  getPack,
  registerPack,
  resetLanguagePacks,
  selectDepth1,
  pythonPack,
  type RelationGraph,
  type SourceFile
} from "../src/index";

/**
 * Ticket #154 — the Python language pack of spec #149.
 *
 * Python has no static types: the ambiguity rate is high BY NATURE. The `?`
 * sites with candidates are the EXPECTED behavior, not a failure. Imports are
 * resolved when trivial (from-import aliases, module-qualified calls); every
 * other unprovable call becomes an ambiguity site with candidates — never a
 * guessed edge.
 *
 * The control fixture below (class, calls, import) carries the hand-written
 * ground truth: expected relations with status and file:line evidence, ported
 * from the validated prototype fixture (prototype-codeflow-graph/fixture/py).
 */

export const PY_CONTROL_MODELS_PATH = "models.py";
export const PY_CONTROL_UTIL_PATH = "util.py";
export const PY_CONTROL_APP_PATH = "app.py";

export const PY_CONTROL_MODELS = `class Repository:
    def find(self, item_id):
        return None


class UserService:
    def __init__(self, repository):
        self.repository = repository

    def get_user(self, item_id):
        self._validate(item_id)
        return self.repository.find(item_id)

    def _validate(self, item_id):
        if not item_id:
            raise ValueError("missing")


class AdminService(UserService):
    def __init__(self, repository):
        super().__init__(repository)

    def audit(self, item_id):
        return self.get_user(item_id)
`;

export const PY_CONTROL_UTIL = `def helper(x):
    return x - 1
`;

export const PY_CONTROL_APP = `import util
from models import Repository, UserService as US
from util import helper as h


def handle_request(item_id):
    repo = Repository()
    service = US(repo)
    util.helper(item_id)
    h(item_id)
    print(service.get_user(item_id))
    return repo.find(item_id)
`;

export const PY_CONTROL_FIXTURES: SourceFile[] = [
  { path: PY_CONTROL_MODELS_PATH, content: PY_CONTROL_MODELS },
  { path: PY_CONTROL_UTIL_PATH, content: PY_CONTROL_UTIL },
  { path: PY_CONTROL_APP_PATH, content: PY_CONTROL_APP }
];

function nodeByName(graph: RelationGraph, name: string) {
  const node = graph.nodes.find(n => n.name === name);
  assert.ok(node, `expected a node named ${name}`);
  return node;
}

function edgeBetween(graph: RelationGraph, from: string, to: string, line: number) {
  const fromNode = nodeByName(graph, from);
  const toNode = nodeByName(graph, to);
  const edge = graph.edges.find(
    e => e.from === fromNode.id && e.to === toNode.id && e.line === line
  );
  assert.ok(edge, `expected an edge ${from} -> ${to} @${line}`);
  return edge;
}

test("the registry ships the Python pack as the built-in pack for python", () => {
  assert.equal(getPack("python"), pythonPack, "python must be handled by the #154 pack, not the generic default");
  assert.equal(pythonPack.language, "python");
  assert.equal(pythonPack.grammarId, "python");
  assert.deepEqual([...pythonPack.extensions], [".py", ".pyi"]);
  // The seam stays open: a registered pack still replaces it, reset restores it.
  const custom = { ...createPythonPack(), language: "python" as const };
  registerPack(custom);
  assert.equal(getPack("python"), custom);
  resetLanguagePacks();
  assert.equal(getPack("python"), pythonPack);
});

test("Python control fixture: declarations become nodes in the #149 format", async () => {
  const graph = await buildRelationGraph(PY_CONTROL_FIXTURES, "python");
  assert.equal(graph.status, "resolved");
  assert.equal(graph.language, "python");
  assert.equal(graph.supported, true);

  const repoCtor = nodeByName(graph, "Repository.constructor");
  assert.equal(repoCtor.filePath, PY_CONTROL_MODELS_PATH);
  assert.equal(repoCtor.startLine, 1);
  assert.equal(repoCtor.endLine, 3);
  assert.ok(nodeByName(graph, "Repository.find").startLine === 2);

  const svcCtor = nodeByName(graph, "UserService.constructor");
  assert.equal(svcCtor.startLine, 6);
  assert.equal(svcCtor.endLine, 16);
  assert.equal(nodeByName(graph, "UserService.__init__").startLine, 7);
  assert.equal(nodeByName(graph, "UserService.get_user").startLine, 10);
  assert.equal(nodeByName(graph, "UserService._validate").startLine, 14);

  const adminCtor = nodeByName(graph, "AdminService.constructor");
  assert.equal(adminCtor.startLine, 19);
  assert.equal(nodeByName(graph, "AdminService.__init__").startLine, 20);
  assert.equal(nodeByName(graph, "AdminService.audit").startLine, 23);

  const helper = nodeByName(graph, "helper");
  assert.equal(helper.filePath, PY_CONTROL_UTIL_PATH);
  assert.equal(helper.startLine, 1);

  const run = nodeByName(graph, "handle_request");
  assert.equal(run.filePath, PY_CONTROL_APP_PATH);
  assert.equal(run.startLine, 6);
  assert.equal(run.endLine, 12);
});

test("Python control fixture: provable relations become edges with status + file:line evidence", async () => {
  const graph = await buildRelationGraph(PY_CONTROL_FIXTURES, "python");

  // Repository() in app.py -> new edge toward Repository.constructor (from-import).
  const repoNew = edgeBetween(graph, "handle_request", "Repository.constructor", 7);
  assert.equal(repoNew.kind, "new");
  assert.equal(repoNew.callType, "new");
  assert.equal(repoNew.status, "resolved");
  assert.equal(repoNew.filePath, PY_CONTROL_APP_PATH);

  // US(repo) — the from-import alias US -> UserService is resolved trivially.
  const svcNew = edgeBetween(graph, "handle_request", "UserService.constructor", 8);
  assert.equal(svcNew.kind, "new");
  assert.equal(svcNew.status, "resolved");
  assert.equal(svcNew.filePath, PY_CONTROL_APP_PATH);

  // util.helper(item_id) — `import util` makes the module-qualified call trivial.
  const moduleCall = edgeBetween(graph, "handle_request", "helper", 9);
  assert.equal(moduleCall.kind, "call");
  assert.equal(moduleCall.callType, "direct");
  assert.equal(moduleCall.status, "resolved");
  assert.equal(moduleCall.filePath, PY_CONTROL_APP_PATH);

  // h(item_id) — the from-import alias h -> helper is resolved trivially.
  const aliasCall = edgeBetween(graph, "handle_request", "helper", 10);
  assert.equal(aliasCall.kind, "call");
  assert.equal(aliasCall.status, "resolved");

  // self._validate(item_id) inside UserService.get_user.
  const selfCall = edgeBetween(graph, "UserService.get_user", "UserService._validate", 11);
  assert.equal(selfCall.kind, "call");
  assert.equal(selfCall.callType, "direct");
  assert.equal(selfCall.status, "resolved");
  assert.equal(selfCall.filePath, PY_CONTROL_MODELS_PATH);

  // super().__init__(repository) in AdminService(UserService) -> heuristic super edge
  // toward the single base class constructor.
  const superEdge = edgeBetween(graph, "AdminService.__init__", "UserService.constructor", 21);
  assert.equal(superEdge.kind, "super");
  assert.equal(superEdge.callType, "super");
  assert.equal(superEdge.status, "heuristic");
  assert.equal(superEdge.filePath, PY_CONTROL_MODELS_PATH);
});

test("Python control fixture: unprovable calls become ? sites with candidates, never guessed edges", async () => {
  const graph = await buildRelationGraph(PY_CONTROL_FIXTURES, "python");

  // service.get_user(item_id) — receiver type unknown (no static types): ? site.
  const serviceCall = graph.sites.find(
    s => s.file === PY_CONTROL_APP_PATH && s.line === 11 && s.name === "get_user"
  );
  assert.ok(serviceCall, "expected a ? site for service.get_user");
  assert.equal(serviceCall.status, "ambiguous");
  assert.deepEqual(serviceCall.candidates, ["UserService.get_user"]);
  assert.equal(serviceCall.caller, "handle_request");

  // repo.find(item_id) — local variable of unknown type: ? site with candidates.
  const repoFind = graph.sites.find(
    s => s.file === PY_CONTROL_APP_PATH && s.line === 12 && s.name === "find"
  );
  assert.ok(repoFind, "expected a ? site for repo.find");
  assert.equal(repoFind.status, "ambiguous");
  assert.deepEqual(repoFind.candidates, ["Repository.find"]);
  assert.equal(repoFind.caller, "handle_request");

  // self.repository.find(item_id) — attribute chain, no static type: ? site.
  const chained = graph.sites.find(
    s => s.file === PY_CONTROL_MODELS_PATH && s.line === 12 && s.name === "find"
  );
  assert.ok(chained, "expected a ? site for self.repository.find");
  assert.equal(chained.status, "ambiguous");
  assert.deepEqual(chained.candidates, ["Repository.find"]);
  assert.equal(chained.caller, "UserService.get_user");

  // self.get_user(item_id) in AdminService — inherited member, not provable on the
  // enclosing type: ? site pointing at the same-named member, never a guessed edge.
  const inherited = graph.sites.find(
    s => s.file === PY_CONTROL_MODELS_PATH && s.line === 24 && s.name === "get_user"
  );
  assert.ok(inherited, "expected a ? site for the inherited self.get_user");
  assert.equal(inherited.status, "ambiguous");
  assert.deepEqual(inherited.candidates, ["UserService.get_user"]);
  assert.equal(inherited.caller, "AdminService.audit");

  // Builtins are unknown to the local graph: explicit unresolved, not silence.
  const printSite = graph.sites.find(
    s => s.file === PY_CONTROL_APP_PATH && s.line === 11 && s.name === "print"
  );
  assert.ok(printSite, "expected an unresolved site for print");
  assert.equal(printSite.status, "unresolved");
  assert.deepEqual(printSite.candidates, []);

  const valueError = graph.sites.find(
    s => s.file === PY_CONTROL_MODELS_PATH && s.line === 16 && s.name === "ValueError"
  );
  assert.ok(valueError, "expected an unresolved site for ValueError");
  assert.equal(valueError.status, "unresolved");

  // No guessed edges on any of the ? lines.
  for (const line of [11, 12]) {
    assert.ok(
      !graph.edges.some(e => e.filePath === PY_CONTROL_APP_PATH && e.line === line),
      `no edge may be asserted on the ? line ${line} of app.py`
    );
  }
  assert.ok(
    !graph.edges.some(e => e.filePath === PY_CONTROL_MODELS_PATH && (e.line === 12 || e.line === 24)),
    "no edge may be asserted on the ? lines of models.py"
  );
});

test("Python pack: homonymous members across modules degrade to ? sites with all candidates", async () => {
  const sources: SourceFile[] = [
    { path: "a.py", content: "def render(x):\n    return x\n" },
    { path: "b.py", content: "def render(x):\n    return -x\n" },
    {
      path: "main.py",
      content: "from a import render\n\n\ndef run():\n    return render(1)\n"
    }
  ];
  const graph = await buildRelationGraph(sources, "python");
  // `render` exists twice in the local graph: the engine must not pick one silently.
  const site = graph.sites.find(s => s.name === "render");
  assert.ok(site, "expected a ? site for the homonymous render");
  assert.equal(site.status, "ambiguous");
  assert.deepEqual(site.candidates.sort(), ["render", "render"]);
  const renderIds = graph.nodes.filter(n => n.name === "render").map(n => n.id);
  assert.equal(renderIds.length, 2);
  assert.ok(
    !graph.edges.some(e => renderIds.includes(e.to)),
    "no edge may be asserted toward a homonymous target"
  );
});

test("Python pack: the depth-1 packet around a seed carries the ? sites too", async () => {
  const graph = await buildRelationGraph(PY_CONTROL_FIXTURES, "python");
  const packet = selectDepth1(graph, ["UserService.get_user"]);
  assert.equal(packet.status, "resolved");
  assert.equal(packet.depth, 1);
  const seed = nodeByName(graph, "UserService.get_user");
  assert.ok(packet.seeds.includes(seed.id));
  // outgoing: self._validate resolved edge is in the packet…
  const out = packet.outgoing[seed.id] ?? [];
  assert.ok(out.some(e => e.to === nodeByName(graph, "UserService._validate").id));
  // …and the self.repository.find ? site is carried with its candidates.
  assert.ok(
    packet.sites.some(s => s.name === "find" && s.caller === "UserService.get_user"),
    "ambiguity sites of the seed must be part of the depth-1 packet"
  );
});
