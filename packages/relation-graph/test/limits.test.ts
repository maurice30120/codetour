import test from "node:test";
import assert from "node:assert/strict";
import { buildRelationGraph, estimateTokens, DEFAULT_LIMITS } from "../src/index";
import { TS_FIXTURES } from "./helpers/fixtures";

test("DEFAULT_LIMITS exposes maxNodes/maxEdges/maxTokens", () => {
  assert.ok(DEFAULT_LIMITS.maxNodes > 0);
  assert.ok(DEFAULT_LIMITS.maxEdges > 0);
  assert.ok(DEFAULT_LIMITS.maxTokens > 0);
});

test("estimateTokens is a deterministic char/4 estimate", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
});

test("maxNodes caps the node list and flags truncation, keeping referential integrity", async () => {
  const graph = await buildRelationGraph(TS_FIXTURES, "typescript", {
    limits: { maxNodes: 2 }
  });
  assert.ok(graph.nodes.length <= 2);
  assert.equal(graph.truncated.nodes, true);
  for (const edge of graph.edges) {
    assert.ok(graph.nodes.some(n => n.id === edge.from), "edge.from must survive truncation");
    assert.ok(graph.nodes.some(n => n.id === edge.to), "edge.to must survive truncation");
  }
});

test("maxEdges caps the edge list and flags truncation", async () => {
  const graph = await buildRelationGraph(TS_FIXTURES, "typescript", {
    limits: { maxEdges: 1 }
  });
  assert.ok(graph.edges.length <= 1);
  assert.equal(graph.truncated.edges, true);
  const indexed = Object.values(graph.outgoing).flat();
  assert.equal(indexed.length, graph.edges.length);
});

test("maxTokens caps the serialized size of the graph and flags truncation", async () => {
  const graph = await buildRelationGraph(TS_FIXTURES, "typescript", {
    limits: { maxTokens: 50 }
  });
  const serialized = JSON.stringify({
    nodes: graph.nodes,
    edges: graph.edges,
    sites: graph.sites
  });
  assert.ok(
    estimateTokens(serialized) <= 50,
    `expected <= 50 tokens, got ${estimateTokens(serialized)}`
  );
  assert.equal(graph.truncated.tokens, true);
});

test("defaults leave a small fixture untruncated", async () => {
  const graph = await buildRelationGraph(TS_FIXTURES, "typescript");
  assert.deepEqual(graph.truncated, { nodes: false, edges: false, tokens: false });
  assert.deepEqual(graph.limits, DEFAULT_LIMITS);
});
