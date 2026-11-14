import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRelationGraph,
  registerPack,
  resetLanguagePacks,
  selectDepth1,
  type GraphEdge,
  type RelationGraph
} from "../src/index";
// The pack under test (#152) — plugged into the registry through the #150 seam.
import { createCSharpPack } from "../src/packs/csharp";
import {
  CS_FIXTURES,
  CS_REQUEST_HANDLER_PATH,
  CS_USER_SERVICE_PATH,
  CS_ADMIN_SERVICE_PATH,
  CS_PICKERS_PATH
} from "./helpers/csharp-fixtures";

/**
 * Ticket #152 — the C# language pack, on the ground-truth fixtures ported from
 * the validated prototype (prototype-csharp-shootout, measured: packet
 * 226–370 tokens vs grep 1008–1267; incoming 4/4, 2/2, 1/1 via the `?` line).
 *
 * Three cases, same as prototype ground-truth.mjs:
 *   1. inheritance + interface dispatch + class usages (cs-user-service),
 *   2. same-name methods + `using X = Y` alias (cs-admin-service),
 *   3. dynamic dispatch -> ambiguity site, never an asserted edge
 *      (cs-picker-dispatch).
 * Every asserted relation carries kind/callType/status plus file:line evidence.
 */

registerPack(createCSharpPack());
test.after(() => resetLanguagePacks());

async function buildCSharpGraph(): Promise<RelationGraph> {
  return buildRelationGraph(CS_FIXTURES, "c#");
}

function nameOf(graph: RelationGraph, id: string): string {
  return graph.nodes.find(n => n.id === id)?.name ?? id;
}

function findEdge(
  graph: RelationGraph,
  from: string,
  to: string,
  line?: number
): GraphEdge | undefined {
  return graph.edges.find(
    e =>
      nameOf(graph, e.from) === from &&
      nameOf(graph, e.to) === to &&
      (line === undefined || e.line === line)
  );
}

function expectEdge(
  graph: RelationGraph,
  from: string,
  to: string,
  expected: { line: number; file: string; kind: string; callType: string; status: string }
): GraphEdge {
  const edge = findEdge(graph, from, to, expected.line);
  assert.ok(edge, `expected edge ${from} -> ${to} @${expected.file}:${expected.line}`);
  assert.equal(edge.kind, expected.kind, `${from} -> ${to} kind`);
  assert.equal(edge.callType, expected.callType, `${from} -> ${to} callType`);
  assert.equal(edge.status, expected.status, `${from} -> ${to} status`);
  assert.equal(edge.filePath, expected.file, `${from} -> ${to} filePath`);
  assert.equal(edge.line, expected.line, `${from} -> ${to} line`);
  return edge;
}

test("cs-user-service: inheritance, interface port and usages are asserted with evidence", async () => {
  const graph = await buildCSharpGraph();
  assert.equal(graph.language, "csharp");
  assert.equal(graph.supported, true);
  assert.equal(graph.status, "resolved");

  // Class usages: new X(...) -> X.constructor (kind/callType "new", resolved).
  expectEdge(graph, "RequestHandler.HandleGetUser", "UserService.constructor", {
    line: 18, file: CS_REQUEST_HANDLER_PATH, kind: "new", callType: "new", status: "resolved"
  });
  expectEdge(graph, "RequestHandler.AuditUsers", "UserService.constructor", {
    line: 34, file: CS_REQUEST_HANDLER_PATH, kind: "new", callType: "new", status: "resolved"
  });

  // Typed-receiver calls (var inferred from new): direct, resolved.
  expectEdge(graph, "RequestHandler.HandleGetUser", "UserService.GetUser", {
    line: 19, file: CS_REQUEST_HANDLER_PATH, kind: "call", callType: "direct", status: "resolved"
  });
  expectEdge(graph, "RequestHandler.AuditUsers", "UserService.GetUser", {
    line: 35, file: CS_REQUEST_HANDLER_PATH, kind: "call", callType: "direct", status: "resolved"
  });

  // `: base()` is the super proof: ctor -> base ctor.
  expectEdge(graph, "UserService.constructor", "BaseService.constructor", {
    line: 16, file: CS_USER_SERVICE_PATH, kind: "super", callType: "super", status: "resolved"
  });

  // Bare calls inside a member resolve to the enclosing type (this.x).
  expectEdge(graph, "UserService.GetUser", "UserService.Validate", {
    line: 27, file: CS_USER_SERVICE_PATH, kind: "call", callType: "direct", status: "resolved"
  });
  expectEdge(graph, "UserService.GetUser", "UserService.Audit", {
    line: 34, file: CS_USER_SERVICE_PATH, kind: "call", callType: "direct", status: "resolved"
  });

  // Interface dispatch: asserted toward the PORT (IRepository.Find), never the
  // implementation, with callType "interface" and status "heuristic" (#149 #16).
  expectEdge(graph, "UserService.GetUser", "IRepository.Find", {
    line: 31, file: CS_USER_SERVICE_PATH, kind: "call", callType: "interface", status: "heuristic"
  });
  expectEdge(graph, "UserService.Audit", "IRepository.Log", {
    line: 76, file: CS_USER_SERVICE_PATH, kind: "call", callType: "interface", status: "heuristic"
  });
  assert.ok(
    !graph.edges.some(e => nameOf(graph, e.to) === "DatabaseRepository.Find"),
    "no edge toward the implementation of a port"
  );

  // Incoming 4/4 on the UserService symbol members through the indexes.
  const ctor = graph.nodes.find(n => n.name === "UserService.constructor");
  const getUser = graph.nodes.find(n => n.name === "UserService.GetUser");
  assert.ok(ctor && getUser);
  assert.equal(graph.incoming[ctor.id].length, 2);
  assert.equal(graph.incoming[getUser.id].length, 2);

  // Depth-1 packet around the symbol: the 4 incoming relations travel with it.
  const packet = selectDepth1(graph, ["UserService.constructor", "UserService.GetUser"]);
  assert.equal(packet.status, "resolved");
  const incomingCount = packet.edges.filter(
    e => nameOf(graph, e.to) === "UserService.constructor" || nameOf(graph, e.to) === "UserService.GetUser"
  ).length;
  assert.equal(incomingCount, 4, "IN 4/4 in the depth-1 packet");
});

test("cs-admin-service: homonym GetUser is disambiguated via the using alias, never a site", async () => {
  const graph = await buildCSharpGraph();

  // `using Admin = Fixture.Services.AdminService;` + `var admin = new Admin()`
  // -> creations and calls resolve to AdminService, not to the homonym.
  expectEdge(graph, "RequestHandler.HandleGetUser", "AdminService.constructor", {
    line: 22, file: CS_REQUEST_HANDLER_PATH, kind: "new", callType: "new", status: "resolved"
  });
  expectEdge(graph, "RequestHandler.HandleGetUser", "AdminService.constructor", {
    line: 26, file: CS_REQUEST_HANDLER_PATH, kind: "new", callType: "new", status: "resolved"
  });
  expectEdge(graph, "RequestHandler.HandleGetUser", "AdminService.GetUser", {
    line: 23, file: CS_REQUEST_HANDLER_PATH, kind: "call", callType: "direct", status: "resolved"
  });
  expectEdge(graph, "RequestHandler.HandleGetUser", "AdminService.GetUser", {
    line: 27, file: CS_REQUEST_HANDLER_PATH, kind: "call", callType: "direct", status: "resolved"
  });

  // The homonym stays provable: no ambiguity site on those call lines.
  for (const line of [19, 23, 27, 35, 42]) {
    const site = graph.sites.find(s => s.file === CS_REQUEST_HANDLER_PATH && s.line === line && s.name === "GetUser");
    if (line === 42) continue; // the dispatch case is covered by its own test
    assert.ok(!site, `no "?" site expected at ${CS_REQUEST_HANDLER_PATH}:${line}`);
  }

  expectEdge(graph, "AdminService.constructor", "BaseService.constructor", {
    line: 14, file: CS_ADMIN_SERVICE_PATH, kind: "super", callType: "super", status: "resolved"
  });
  expectEdge(graph, "AdminService.GetUser", "IRepository.Find", {
    line: 23, file: CS_ADMIN_SERVICE_PATH, kind: "call", callType: "interface", status: "heuristic"
  });
  expectEdge(graph, "AdminService.GetUser", "IRepository.Log", {
    line: 24, file: CS_ADMIN_SERVICE_PATH, kind: "call", callType: "interface", status: "heuristic"
  });

  // IN 2/2 on AdminService.GetUser: both calls come from HandleGetUser.
  const adminGetUser = graph.nodes.find(n => n.name === "AdminService.GetUser");
  assert.ok(adminGetUser);
  assert.equal(graph.incoming[adminGetUser.id].length, 2);
});

test("cs-picker-dispatch: dynamic dispatch is NEVER asserted — a '?' site with candidates", async () => {
  const graph = await buildCSharpGraph();

  // `var picker = fast ? (IPicker)new FastPicker() : new SlowPicker();` — the
  // ternary defeats var inference, so `picker.GetUser(id)` cannot be attributed.
  const site = graph.sites.find(
    s => s.file === CS_REQUEST_HANDLER_PATH && s.line === 42 && s.name === "GetUser"
  );
  assert.ok(site, "expected a '?' site at Api/RequestHandler.cs:42 for GetUser");
  assert.equal(site.status, "ambiguous");
  assert.equal(site.caller, "RequestHandler.HandleViaPicker");
  assert.deepEqual(
    [...site.candidates].sort(),
    ["AdminService.GetUser", "FastPicker.GetUser", "IPicker.GetUser", "SlowPicker.GetUser", "UserService.GetUser"],
    "candidates are the same-named members indexed on the local graph (5)"
  );

  // Interface dispatch is never an asserted edge from the dynamic caller.
  const handleViaPicker = graph.nodes.find(n => n.name === "RequestHandler.HandleViaPicker");
  assert.ok(handleViaPicker);
  assert.ok(
    !graph.edges.some(e => e.from === handleViaPicker.id && nameOf(graph, e.to).endsWith(".GetUser")),
    "no guessed edge from HandleViaPicker to any GetUser"
  );

  // The provable part of the case: SlowPicker.GetUser -> User.constructor.
  expectEdge(graph, "SlowPicker.GetUser", "User.constructor", {
    line: 31, file: CS_PICKERS_PATH, kind: "new", callType: "new", status: "resolved"
  });
  expectEdge(graph, "FastPicker.GetUser", "User.constructor", {
    line: 19, file: CS_PICKERS_PATH, kind: "new", callType: "new", status: "resolved"
  });
});

test("this.x resolves to the enclosing type; base.X is a heuristic super edge; inherited this.x is a '?' site", async () => {
  const graph = await buildRelationGraph(
    [
      {
        path: "Program.cs",
        content: `class Greeter {
  public string Greet(string name) { return "hi " + name; }
  public string Twice() { return this.Greet("x"); }
}
class Sub : Greeter {
  public string Hello() { return base.Greet("s"); }
  public string Again() { return this.Greet("y"); }
}
class Program {
  static void Main() {
    var g = new Greeter();
  }
}
`
      }
    ],
    "c#"
  );
  assert.equal(graph.status, "resolved");

  // this.Greet on the enclosing type: direct, resolved.
  expectEdge(graph, "Greeter.Twice", "Greeter.Greet", {
    line: 3, file: "Program.cs", kind: "call", callType: "direct", status: "resolved"
  });

  // base.Greet("s"): super edge, heuristic (the base member is name-matched).
  expectEdge(graph, "Sub.Hello", "Greeter.Greet", {
    line: 6, file: "Program.cs", kind: "super", callType: "super", status: "heuristic"
  });

  // this.Greet in Sub: Greet is inherited, not declared on Sub — inheritance is
  // never guessed: ambiguity site with the same-named candidate.
  const sub = graph.nodes.find(n => n.name === "Sub.Again");
  assert.ok(sub);
  assert.ok(!graph.edges.some(e => e.from === sub.id), "no guessed edge for inherited this.Greet");
  const site = graph.sites.find(s => s.file === "Program.cs" && s.line === 7 && s.name === "Greet");
  assert.ok(site, "expected a '?' site for this.Greet in Sub");
  assert.equal(site.status, "ambiguous");
  assert.deepEqual(site.candidates, ["Greeter.Greet"]);
  assert.equal(site.caller, "Sub.Again");

  // new Greeter() -> Greeter.constructor.
  expectEdge(graph, "Program.Main", "Greeter.constructor", {
    line: 11, file: "Program.cs", kind: "new", callType: "new", status: "resolved"
  });
});
