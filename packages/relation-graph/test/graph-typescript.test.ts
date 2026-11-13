import test from "node:test";
import assert from "node:assert/strict";
import { buildRelationGraph } from "../src/index";
import type { GraphEdge, GraphNode, RelationGraph } from "../src/index";
import { TS_FIXTURES, TS_GREETER_PATH, TS_MAIN_PATH } from "./helpers/fixtures";

const EDGE_KINDS = new Set(["call", "new", "super"]);
const CALL_TYPES = new Set(["direct", "interface", "super", "new"]);
const STATUSES = new Set(["resolved", "heuristic", "ambiguous", "unresolved", "unsupported"]);

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

test("a TypeScript fixture produces a graph in the exact #149 format, with statuses", async () => {
  const graph = await buildRelationGraph(TS_FIXTURES, "typescript");

  assert.equal(graph.status, "resolved");
  assert.equal(graph.supported, true);
  assert.equal(graph.language, "typescript");

  // Every node matches node = { id, name, filePath, startLine, endLine } (1-based lines).
  for (const node of graph.nodes) {
    assert.equal(typeof node.id, "string");
    assert.ok(node.id.length > 0);
    assert.equal(typeof node.name, "string");
    assert.equal(typeof node.filePath, "string");
    assert.ok(Number.isInteger(node.startLine) && node.startLine >= 1);
    assert.ok(Number.isInteger(node.endLine) && node.endLine >= node.startLine);
  }

  // Every edge matches edge = { from, to, line, kind, callType } + status + file:line evidence.
  for (const edge of graph.edges) {
    assert.ok(graph.nodes.some(n => n.id === edge.from), `edge.from ${edge.from} must be a node`);
    assert.ok(graph.nodes.some(n => n.id === edge.to), `edge.to ${edge.to} must be a node`);
    assert.ok(Number.isInteger(edge.line) && edge.line >= 1);
    assert.ok(EDGE_KINDS.has(edge.kind), `bad kind ${edge.kind}`);
    assert.ok(CALL_TYPES.has(edge.callType), `bad callType ${edge.callType}`);
    assert.ok(STATUSES.has(edge.status), `bad status ${edge.status}`);
    assert.equal(typeof edge.filePath, "string");
  }

  // Every site matches site = { file, line, name, caller, candidates[] }.
  for (const site of graph.sites) {
    assert.equal(typeof site.file, "string");
    assert.ok(Number.isInteger(site.line) && site.line >= 1);
    assert.equal(typeof site.name, "string");
    assert.equal(typeof site.caller, "string");
    assert.ok(Array.isArray(site.candidates));
    assert.ok(STATUSES.has(site.status), `bad site status ${site.status}`);
  }

  // Declarations: members are "Type.member", plus a "Type.constructor" node per
  // class (no bare class node), plus top-level functions by bare name.
  const greeter = nodeByName(graph, "Greeter.greet");
  assert.equal(greeter.filePath, TS_GREETER_PATH);
  assert.equal(greeter.startLine, 2);
  assert.equal(greeter.endLine, 4);
  const twice = nodeByName(graph, "Greeter.twice");
  assert.equal(twice.startLine, 5);
  assert.equal(twice.endLine, 7);
  const ctor = nodeByName(graph, "Greeter.constructor");
  assert.equal(ctor.filePath, TS_GREETER_PATH);
  assert.equal(ctor.startLine, 1);
  assert.ok(!graph.nodes.some(n => n.name === "Greeter"), "no bare class node");
  const top = nodeByName(graph, "top");
  assert.equal(top.filePath, TS_MAIN_PATH);
  assert.equal(top.startLine, 3);

  // this.greet("x") inside Greeter.twice: resolved direct call with file:line proof.
  const thisCall = edgeBetween(graph, "Greeter.twice", "Greeter.greet");
  assert.equal(thisCall.kind, "call");
  assert.equal(thisCall.callType, "direct");
  assert.equal(thisCall.status, "resolved");
  assert.equal(thisCall.line, 6);
  assert.equal(thisCall.filePath, TS_GREETER_PATH);

  // new Greeter() at top level: resolved "new" edge toward Greeter.constructor.
  const fileNode = nodeByName(graph, TS_MAIN_PATH);
  const newEdge = graph.edges.find(e => e.from === fileNode.id && e.to === ctor.id);
  assert.ok(newEdge, "expected a new edge to Greeter.constructor");
  assert.equal(newEdge.kind, "new");
  assert.equal(newEdge.callType, "new");
  assert.equal(newEdge.status, "resolved");
  assert.equal(newEdge.line, 7);
  assert.equal(newEdge.filePath, TS_MAIN_PATH);

  // top(3): plain call with exactly one same-named node in the local graph -> resolved direct.
  const topCall = graph.edges.find(e => e.from === fileNode.id && e.to === top.id);
  assert.ok(topCall, "expected a call edge to top");
  assert.equal(topCall.kind, "call");
  assert.equal(topCall.callType, "direct");
  assert.equal(topCall.status, "resolved");
  assert.equal(topCall.line, 9);

  // g.greet("bob") and console.log(...): member calls are never guessed into edges;
  // they become explicit sites with candidates (ambiguous) or without (unresolved).
  assert.ok(!graph.edges.some(e => e.line === 8), "no guessed edge for member calls");
  const ambiguous = graph.sites.find(s => s.name === "greet");
  assert.ok(ambiguous, "expected an ambiguity site for g.greet");
  assert.deepEqual(ambiguous, {
    file: TS_MAIN_PATH,
    line: 8,
    name: "greet",
    caller: TS_MAIN_PATH,
    candidates: ["Greeter.greet"],
    status: "ambiguous"
  });
  const unresolved = graph.sites.find(s => s.name === "log");
  assert.ok(unresolved, "expected an unresolved site for console.log");
  assert.equal(unresolved.status, "unresolved");
  assert.deepEqual(unresolved.candidates, []);
  assert.equal(unresolved.line, 8);

  // Outgoing/incoming indexes mirror the edge list, deduplicated.
  const outTwice = graph.outgoing[twice.id] ?? [];
  assert.deepEqual(outTwice.map(e => e.to), [greeter.id]);
  const inGreet = graph.incoming[greeter.id] ?? [];
  assert.deepEqual(inGreet.map(e => e.from), [twice.id]);
  const edgeCount = graph.edges.length;
  const indexed = Object.values(graph.outgoing).flat().length;
  assert.equal(indexed, edgeCount, "every edge appears exactly once in the outgoing index");
  assert.equal(Object.values(graph.incoming).flat().length, edgeCount);
});

test("edges are deduplicated across repeated identical call sites", async () => {
  const sources = [
    {
      path: "a.ts",
      content: "function f(): number { return 1; }\nfunction g(): number { return f(); }\n"
    }
  ];
  const graph = await buildRelationGraph(sources, "typescript");
  const f = graph.nodes.find(n => n.name === "f");
  const g = graph.nodes.find(n => n.name === "g");
  assert.ok(f && g);
  const edges = graph.edges.filter(e => e.from === g.id && e.to === f.id);
  assert.equal(edges.length, 1);
});
