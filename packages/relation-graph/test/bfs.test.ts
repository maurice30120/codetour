import test from "node:test";
import assert from "node:assert/strict";
import { buildRelationGraph, selectDepth1 } from "../src/index";
import { TS_FIXTURES, TS_MAIN_PATH } from "./helpers/fixtures";

test("selectDepth1 runs a BFS of depth 1 from seed names with outgoing/incoming indexes", async () => {
  const graph = await buildRelationGraph(TS_FIXTURES, "typescript");
  const greet = graph.nodes.find(n => n.name === "Greeter.greet");
  const twice = graph.nodes.find(n => n.name === "Greeter.twice");
  assert.ok(greet && twice);

  const packet = selectDepth1(graph, ["Greeter.greet"]);
  assert.equal(packet.depth, 1);
  assert.deepEqual(packet.seeds, [greet.id]);

  // Depth 1 from Greeter.greet: the seed plus its direct neighbours only.
  const names = packet.nodes.map(n => n.name).sort();
  assert.deepEqual(names, ["Greeter.greet", "Greeter.twice"]);

  // Only edges incident to a seed are traversed at depth 1.
  assert.equal(packet.edges.length, 1);
  assert.equal(packet.edges[0].from, twice.id);
  assert.equal(packet.edges[0].to, greet.id);

  assert.deepEqual((packet.outgoing[twice.id] ?? []).map(e => e.to), [greet.id]);
  assert.deepEqual((packet.incoming[greet.id] ?? []).map(e => e.from), [twice.id]);
  assert.equal(packet.outgoing[greet.id], undefined);

  // Sites whose caller is in the packet travel with it; others stay behind.
  assert.ok(packet.sites.every(s => s.caller === "Greeter.twice" || s.caller === "Greeter.greet"));
  assert.equal(packet.truncated.nodes, false);
  assert.equal(packet.status, "resolved");
});

test("selectDepth1 from several seeds dedups shared neighbours and edges", async () => {
  const graph = await buildRelationGraph(TS_FIXTURES, "typescript");
  const packet = selectDepth1(graph, ["Greeter.twice", "top"]);
  const names = packet.nodes.map(n => n.name).sort();
  // twice + greet (via twice), top + the main.ts file-scope node (via top).
  assert.deepEqual(names, ["Greeter.greet", "Greeter.twice", TS_MAIN_PATH, "top"]);
  const keys = packet.edges.map(e => `${e.from}|${e.to}|${e.line}`);
  assert.equal(new Set(keys).size, keys.length, "edges deduplicated");
  // The main.ts -> Greeter.constructor edge joins two non-seed nodes: not depth 1.
  const ctor = graph.nodes.find(n => n.name === "Greeter.constructor");
  assert.ok(ctor);
  assert.ok(!packet.edges.some(e => e.to === ctor.id), "depth-1 packet must not include depth-2 edges");
});

test("selectDepth1 honors maxNodes/maxEdges limits and flags truncation", async () => {
  const graph = await buildRelationGraph(TS_FIXTURES, "typescript");
  const limited = selectDepth1(graph, ["Greeter.twice", "top"], { maxNodes: 2, maxEdges: 1 });
  assert.ok(limited.nodes.length <= 2);
  assert.ok(limited.edges.length <= 1);
  assert.equal(limited.truncated.nodes, true);
  assert.equal(limited.truncated.edges, true);
  // Referential integrity is preserved under truncation.
  for (const edge of limited.edges) {
    assert.ok(limited.nodes.some(n => n.id === edge.from));
    assert.ok(limited.nodes.some(n => n.id === edge.to));
  }
});

test("selectDepth1 on an unsupported graph returns an unsupported packet", () => {
  const graph = {
    language: "go",
    supported: false,
    status: "unsupported" as const,
    nodes: [],
    edges: [],
    sites: [],
    outgoing: {},
    incoming: {},
    unsupportedFiles: [{ path: "main.go", language: "go" }],
    limits: { maxNodes: 500, maxEdges: 2000, maxTokens: 8000 },
    truncated: { nodes: false, edges: false, tokens: false },
    analyzerVersion: "test"
  };
  const packet = selectDepth1(graph, ["anything"]);
  assert.equal(packet.status, "unsupported");
  assert.deepEqual(packet.nodes, []);
  assert.deepEqual(packet.edges, []);
});
