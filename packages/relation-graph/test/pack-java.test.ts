import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRelationGraph,
  createJavaPack,
  registerPack,
  resetLanguagePacks,
  type GraphEdge,
  type RelationGraph,
  type SourceFile
} from "../src/index";
import { loadJavaFixtures } from "./helpers/java-fixtures";
import { JAVA_CASES } from "./helpers/java-ground-truth";

/**
 * Ticket #153 — the Java language pack of spec #149.
 *
 * Seams under test (external behavior, never CST internals):
 *  - the ground-truth suite: Java fixture tree (same files the measurement
 *    harness of docs/pack-java-measurements.md walks) vs the hand-written
 *    ground truth of test/helpers/java-ground-truth.ts (prototype format),
 *    through buildRelationGraph with the Java pack registered;
 *  - the individual mechanisms: explicit imports, declared types, var
 *    inference, extends/implements, this.x, new -> Type.constructor, super,
 *    and the never-guessed rule (unprovable -> ambiguity site with candidates).
 */

async function buildJava(sources: SourceFile[]): Promise<RelationGraph> {
  registerPack(createJavaPack());
  try {
    return await buildRelationGraph(sources, "java");
  } finally {
    resetLanguagePacks();
  }
}

const ownerOf = (name: string): string | null => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? null : name.slice(0, dot);
};
const shortNameOf = (name: string): string => name.slice(name.lastIndexOf(".") + 1);
const nameOf = (graph: RelationGraph, id: string): string =>
  graph.nodes.find(n => n.id === id)?.name ?? id;

function edgeBetween(graph: RelationGraph, from: string, to: string, kind?: string): GraphEdge | undefined {
  return graph.edges.find(
    e => nameOf(graph, e.from) === from && nameOf(graph, e.to) === to && (kind === undefined || e.kind === kind)
  );
}

/** Relations of depth 1 around a symbol, like the prototype payload logic. */
function relationsOf(graph: RelationGraph, symbol: string): { outgoing: GraphEdge[]; incoming: GraphEdge[] } {
  const anchors = graph.nodes.filter(n => n.name === symbol || ownerOf(n.name) === symbol);
  const anchorIds = new Set(anchors.map(n => n.id));
  const outgoing = anchors.flatMap(a => graph.outgoing[a.id] ?? []);
  const incoming = anchors.flatMap(a => (graph.incoming[a.id] ?? []).filter(e => !anchorIds.has(e.from)));
  return { outgoing, incoming };
}

// ---------------------------------------------------------------------------
// Ground-truth suite (fixtures + hand-written expected relations)
// ---------------------------------------------------------------------------

test("Java pack: the ground-truth fixture tree resolves every provable relation and points at every hard one", async () => {
  const sources = loadJavaFixtures();
  assert.ok(sources.length >= 8, "expected the 8 fixture .java files");
  const graph = await buildJava(sources);

  assert.equal(graph.status, "resolved");
  assert.equal(graph.supported, true);
  assert.equal(graph.language, "java");

  // Never-guessed invariant over the whole graph: every asserted edge carries
  // file:line evidence and a status; everything else is an explicit site.
  for (const edge of graph.edges) {
    assert.ok(edge.filePath.length > 0 && edge.line >= 1, `edge ${edge.from}->${edge.to} needs file:line evidence`);
    assert.ok(edge.status === "resolved" || edge.status === "heuristic", `unexpected edge status ${edge.status}`);
  }
  for (const site of graph.sites) {
    assert.ok(site.status === "ambiguous" || site.status === "unresolved");
    assert.ok(site.caller.length > 0 && site.line >= 1 && site.file.length > 0);
  }

  for (const testCase of JAVA_CASES) {
    const { outgoing, incoming } = relationsOf(graph, testCase.symbol);
    const observed = [...outgoing, ...incoming];
    for (const row of testCase.expected) {
      const edge = observed.find(
        e => nameOf(graph, e.from) === row.from && nameOf(graph, e.to) === row.to && e.kind === row.kind
      );
      if (row.certainty === "provable") {
        assert.ok(edge, `${testCase.id}: expected a ${row.kind} edge ${row.from} -> ${row.to}`);
        assert.equal(edge.status, "resolved", `${row.from} -> ${row.to} must be resolved, not ${edge.status}`);
        assert.ok(edge.filePath.length > 0 && edge.line >= 1, "provable edge needs file:line evidence");
      } else {
        // "hard" (interface dispatch): asserted toward the port with a
        // heuristic status, or pointed at by a "?" site with candidates.
        const portEdge = edge && edge.callType === "interface" && edge.status === "heuristic" ? edge : undefined;
        const site = graph.sites.find(
          s =>
            s.caller === row.from &&
            (s.name === shortNameOf(row.to)) &&
            s.candidates.some(c => c === row.to || c === shortNameOf(row.to))
        );
        assert.ok(
          portEdge || site,
          `${testCase.id}: hard relation ${row.from} -> ${row.to} must be a port edge (interface/heuristic) or a ? site with candidates`
        );
      }
    }
  }
});

test("Java pack: file:line evidence pins the key relations of the fixture", async () => {
  const graph = await buildJava(loadJavaFixtures());

  const newSvc = edgeBetween(graph, "RequestHandler.handleGetUser", "UserService.constructor", "new");
  assert.ok(newSvc);
  assert.equal(newSvc.filePath, "api/RequestHandler.java");
  assert.equal(newSvc.line, 19);
  assert.equal(newSvc.callType, "new");

  const callSvc = edgeBetween(graph, "RequestHandler.handleGetUser", "UserService.getUser", "call");
  assert.ok(callSvc, "svc.getUser(id) resolves through the declared local type");
  assert.equal(callSvc.line, 20);
  assert.equal(callSvc.callType, "direct");
  assert.equal(callSvc.status, "resolved");

  const adminCall = edgeBetween(graph, "RequestHandler.handleGetUser", "AdminService.getUser", "call");
  assert.ok(adminCall, "admin.getUser(id) resolves through the declared local type (homonym)");
  assert.equal(adminCall.line, 23);

  const superCtor = edgeBetween(graph, "UserService.constructor", "BaseService.constructor", "super");
  assert.ok(superCtor, "super() must be a super edge toward the explicit base constructor");
  assert.equal(superCtor.filePath, "services/UserService.java");
  assert.equal(superCtor.line, 16);
  assert.equal(superCtor.callType, "super");

  const portFind = edgeBetween(graph, "UserService.getUser", "IRepository.find", "call");
  assert.ok(portFind, "repo.find(id) is asserted toward the port, never the implementation");
  assert.equal(portFind.callType, "interface");
  assert.equal(portFind.status, "heuristic");
  assert.equal(portFind.line, 27);

  const thisCall = edgeBetween(graph, "UserService.getUser", "UserService.validate", "call");
  assert.ok(thisCall, "bare validate(id) is an implicit this-call resolved on the enclosing type");
  assert.equal(thisCall.line, 24);
  assert.equal(thisCall.status, "resolved");

  const pickerSite = graph.sites.find(
    s => s.caller === "RequestHandler.handleViaPicker" && s.name === "getUser"
  );
  assert.ok(pickerSite, "var + ternary receiver cannot be proven: explicit ? site");
  assert.equal(pickerSite.line, 38);
  assert.equal(pickerSite.status, "ambiguous");
  assert.ok(pickerSite.candidates.includes("SlowPicker.getUser"), "candidates must include SlowPicker.getUser");
  assert.ok(pickerSite.candidates.includes("FastPicker.getUser"), "candidates must include FastPicker.getUser");
  assert.ok(
    !graph.edges.some(e => nameOf(graph, e.from) === "RequestHandler.handleViaPicker" && nameOf(graph, e.to).endsWith(".getUser")),
    "no guessed edge for the dynamic dispatch"
  );

  const portCall = edgeBetween(graph, "RequestHandler.handleViaPort", "IPicker.getUser", "call");
  assert.ok(portCall, "declared port parameter asserts the relation toward the port");
  assert.equal(portCall.line, 42);
  assert.equal(portCall.callType, "interface");
  assert.equal(portCall.status, "heuristic");

  const userNew = edgeBetween(graph, "SlowPicker.getUser", "User.constructor", "new");
  assert.ok(userNew);
  assert.equal(userNew.status, "resolved");
});

// ---------------------------------------------------------------------------
// Mechanism unit tests (inline sources)
// ---------------------------------------------------------------------------

test("Java pack: explicit imports — qualified declared types normalize to simple names, static imports resolve bare calls", async () => {
  const graph = await buildJava([
    {
      path: "a/Service.java",
      content: `package a;

import a.Repo;
import static a.Util.assist;

public class Service {
  public String load(int id) {
    a.Repo local = null;
    String v = local.find(id);
    assist();
    return v;
  }
}
`
    },
    {
      path: "a/Repo.java",
      content: `package a;

public interface Repo {
  String find(int id);
}
`
    },
    {
      path: "a/Util.java",
      content: `package a;

public class Util {
  public static void assist() {
  }
}
`
    }
  ]);

  const find = edgeBetween(graph, "Service.load", "Repo.find", "call");
  assert.ok(find, "a.Repo declared type must resolve to the port Repo.find");
  assert.equal(find.callType, "interface");
  assert.equal(find.status, "heuristic");

  const assist = edgeBetween(graph, "Service.load", "Util.assist", "call");
  assert.ok(assist, "static-imported bare call resolves by short name when unique");
  assert.equal(assist.status, "resolved");
});

test("Java pack: declared types of locals, parameters and fields resolve receiver calls", async () => {
  const graph = await buildJava([
    {
      path: "Service.java",
      content: `class Repo {
  public String find(int id) { return "x"; }
}

class Service {
  private final Repo field;

  public Service(Repo repo) {
    this.field = repo;
  }

  public String load(Repo param, int id) {
    Repo local = field;
    String a = local.find(id);
    String b = param.find(id);
    String c = field.find(id);
    return a + b + c;
  }
}
`
    }
  ]);
  const edges = graph.edges.filter(
    e => nameOf(graph, e.from) === "Service.load" && nameOf(graph, e.to) === "Repo.find"
  );
  assert.equal(edges.length, 3, "local, parameter and field declared types all resolve");
  for (const e of edges) {
    assert.equal(e.callType, "direct");
    assert.equal(e.status, "resolved");
  }
  assert.ok(!graph.sites.some(s => s.name === "find"), "no ambiguity site for provable receiver calls");
});

test("Java pack: var infers its type from a new expression; a ternary does not", async () => {
  const graph = await buildJava([
    {
      path: "A.java",
      content: `class A {
  public void run() {
  }
}

class B {
  public void go(boolean flag) {
    var a = new A();
    a.run();
    var other = flag ? new A() : null;
    other.run();
  }
}
`
    }
  ]);
  const resolved = edgeBetween(graph, "B.go", "A.run", "call");
  assert.ok(resolved, "var a = new A() infers A, so a.run() resolves");
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.line, 9);

  const newEdge = edgeBetween(graph, "B.go", "A.constructor", "new");
  assert.ok(newEdge, "new A() is a new edge toward A.constructor");
  assert.equal(newEdge.callType, "new");
  assert.equal(newEdge.status, "resolved");

  const ternarySite = graph.sites.find(s => s.caller === "B.go" && s.name === "run" && s.line === 11);
  assert.ok(ternarySite, "var + ternary initializer cannot be inferred: ? site, never a guess");
  assert.equal(ternarySite.status, "ambiguous");
  assert.deepEqual(ternarySite.candidates, ["A.run"]);
});

test("Java pack: extends resolves inherited this.x, super.method() and super()", async () => {
  const graph = await buildJava([
    {
      path: "Base.java",
      content: `class Base {
  protected Base() {
  }

  public void flush() {
  }
}

class Sub extends Base {
  public Sub() {
    super();
  }

  public void clean() {
    super.flush();
    this.flush();
  }
}
`
    }
  ]);

  const superCtor = edgeBetween(graph, "Sub.constructor", "Base.constructor", "super");
  assert.ok(superCtor, "super() -> super edge to the explicit base constructor");
  assert.equal(superCtor.line, 11);
  assert.equal(superCtor.callType, "super");

  const superCall = graph.edges.find(
    e => nameOf(graph, e.from) === "Sub.clean" && nameOf(graph, e.to) === "Base.flush" && e.kind === "super"
  );
  assert.ok(superCall, "super.flush() -> super edge toward Base.flush");
  assert.equal(superCall.line, 15);
  assert.equal(superCall.callType, "super");
  assert.equal(superCall.status, "resolved", "explicit extends target makes the super relation provable");

  const thisCall = graph.edges.find(
    e => nameOf(graph, e.from) === "Sub.clean" && nameOf(graph, e.to) === "Base.flush" && e.kind === "call"
  );
  assert.ok(thisCall, "this.flush() resolves through extends to Base.flush");
  assert.equal(thisCall.line, 16);
  assert.equal(thisCall.callType, "direct");
  assert.equal(thisCall.status, "resolved");
});

test("Java pack: implements asserts interface relations toward the port with heuristic status", async () => {
  const graph = await buildJava([
    {
      path: "Port.java",
      content: `interface Port {
  void send(String message);
}

class Impl implements Port {
  public void send(String message) {
  }
}

class Worker {
  public void dispatch(Port port, String message) {
    port.send(message);
  }
}
`
    }
  ]);
  const port = edgeBetween(graph, "Worker.dispatch", "Port.send", "call");
  assert.ok(port, "declared interface parameter -> edge toward the port");
  assert.equal(port.callType, "interface");
  assert.equal(port.status, "heuristic");
  assert.ok(
    !graph.edges.some(e => nameOf(graph, e.to) === "Impl.send" && nameOf(graph, e.from) === "Worker.dispatch"),
    "never toward the implementation when the declared type is the port"
  );
});

test("Java pack: homonym members — a bare call inside a class resolves on the enclosing type, unknown receivers become ? sites", async () => {
  const graph = await buildJava([
    {
      path: "Homonyms.java",
      content: `class A {
  public void run() {
  }
}

class B {
  public void run() {
  }

  public void go() {
    run();
  }
}

class Driver {
  public void helper() {
  }

  public void drive(boolean fast) {
    A a = new A();
    a.run();
    this.helper();
    ghost();
  }
}
`
    }
  ]);
  const own = edgeBetween(graph, "B.go", "B.run", "call");
  assert.ok(own, "bare run() in B is an implicit this-call on B, not the homonym A.run");
  assert.equal(own.status, "resolved");

  const aRun = edgeBetween(graph, "Driver.drive", "A.run", "call");
  assert.ok(aRun, "declared local type A resolves a.run()");
  assert.equal(aRun.line, 21);

  const thisHelper = edgeBetween(graph, "Driver.drive", "Driver.helper", "call");
  assert.ok(thisHelper, "this.helper() resolves on the enclosing type");
  assert.equal(thisHelper.line, 22);

  const ghost = graph.sites.find(s => s.caller === "Driver.drive" && s.name === "ghost");
  assert.ok(ghost, "unknown bare call -> explicit site, never a guessed edge");
  assert.equal(ghost.status, "unresolved");
  assert.deepEqual(ghost.candidates, []);
});

test("Java pack: wildcard imports never produce a guessed edge — unknown types become unresolved sites", async () => {
  const graph = await buildJava([
    {
      path: "D.java",
      content: `import external.*;

class D {
  public void go() {
    Thing t = new Thing();
    t.use();
  }
}
`
    }
  ]);
  assert.ok(!graph.edges.some(e => nameOf(graph, e.from) === "D.go"), "no edge may be guessed from a wildcard import");
  const newSite = graph.sites.find(s => s.caller === "D.go" && s.name === "Thing");
  assert.ok(newSite, "new Thing() with no local Thing -> unresolved site");
  assert.equal(newSite.status, "unresolved");
  const useSite = graph.sites.find(s => s.caller === "D.go" && s.name === "use");
  assert.ok(useSite, "t.use() with an unresolvable receiver type -> unresolved site");
  assert.equal(useSite.status, "unresolved");
});

test("Java pack: chained receiver calls (a.b.c()) degrade to ambiguity sites with candidates, never guessed", async () => {
  const graph = await buildJava([
    {
      path: "Chain.java",
      content: `class Inner {
  public void tick() {
  }
}

class Outer {
  public Inner inner() {
    return new Inner();
  }
}

class Caller {
  public void go(Outer outer) {
    outer.inner().tick();
  }
}
`
    }
  ]);
  assert.ok(!graph.edges.some(e => nameOf(graph, e.from) === "Caller.go" && nameOf(graph, e.to) === "Inner.tick"));
  const site = graph.sites.find(s => s.caller === "Caller.go" && s.name === "tick");
  assert.ok(site, "chained call -> ? site");
  assert.equal(site.status, "ambiguous");
  assert.deepEqual(site.candidates, ["Inner.tick"]);
});
