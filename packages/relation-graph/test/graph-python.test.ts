import test from "node:test";
import assert from "node:assert/strict";
import { buildRelationGraph } from "../src/index";
import type { RelationGraph } from "../src/index";
import {
  PY_FIXTURES,
  PY_CALCULATOR_PATH,
  PY_MAIN_PATH,
  PY_UTIL_PATH
} from "./helpers/fixtures";

function nodeByName(graph: RelationGraph, name: string) {
  const node = graph.nodes.find(n => n.name === name);
  assert.ok(node, `expected a node named ${name}`);
  return node;
}

test("a Python fixture produces a graph in the #149 format, with statuses", async () => {
  const graph = await buildRelationGraph(PY_FIXTURES, "python");

  assert.equal(graph.status, "resolved");
  assert.equal(graph.language, "python");

  const add = nodeByName(graph, "Calculator.add");
  assert.equal(add.filePath, PY_CALCULATOR_PATH);
  assert.equal(add.startLine, 2);
  const twice = nodeByName(graph, "Calculator.twice");
  assert.equal(twice.startLine, 5);
  const ctor = nodeByName(graph, "Calculator.constructor");
  assert.equal(ctor.filePath, PY_CALCULATOR_PATH);
  const helper = nodeByName(graph, "helper");
  assert.equal(helper.filePath, PY_UTIL_PATH);
  const run = nodeByName(graph, "run");
  assert.equal(run.filePath, PY_MAIN_PATH);
  assert.equal(run.startLine, 3);
  assert.equal(run.endLine, 6);

  // self.add(x, x) inside Calculator.twice -> resolved direct call.
  const selfCall = graph.edges.find(e => e.from === twice.id && e.to === add.id);
  assert.ok(selfCall, "expected self.add to resolve to Calculator.add");
  assert.equal(selfCall.kind, "call");
  assert.equal(selfCall.callType, "direct");
  assert.equal(selfCall.status, "resolved");
  assert.equal(selfCall.line, 6);
  assert.equal(selfCall.filePath, PY_CALCULATOR_PATH);

  // Calculator() in main.py -> "new" edge toward Calculator.constructor (cross-file).
  const newEdge = graph.edges.find(e => e.from === run.id && e.to === ctor.id);
  assert.ok(newEdge, "expected Calculator() to be a new edge to Calculator.constructor");
  assert.equal(newEdge.kind, "new");
  assert.equal(newEdge.callType, "new");
  assert.equal(newEdge.status, "resolved");
  assert.equal(newEdge.line, 4);
  assert.equal(newEdge.filePath, PY_MAIN_PATH);

  // helper(3) -> resolved direct call.
  const helperCall = graph.edges.find(e => e.from === run.id && e.to === helper.id);
  assert.ok(helperCall, "expected helper(3) to resolve to helper");
  assert.equal(helperCall.status, "resolved");
  assert.equal(helperCall.line, 6);

  // calc.add(1, 2) -> ambiguity site with candidates; print(...) -> unresolved site.
  const ambiguous = graph.sites.find(s => s.name === "add");
  assert.ok(ambiguous, "expected an ambiguity site for calc.add");
  assert.equal(ambiguous.status, "ambiguous");
  assert.deepEqual(ambiguous.candidates, ["Calculator.add"]);
  assert.equal(ambiguous.caller, "run");
  assert.equal(ambiguous.line, 5);
  assert.equal(ambiguous.file, PY_MAIN_PATH);

  const unresolved = graph.sites.find(s => s.name === "print");
  assert.ok(unresolved, "expected an unresolved site for print");
  assert.equal(unresolved.status, "unresolved");
  assert.deepEqual(unresolved.candidates, []);

  assert.ok(!graph.edges.some(e => e.line === 5), "member calls are never guessed into edges");
});
