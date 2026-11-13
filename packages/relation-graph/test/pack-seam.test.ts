import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRelationGraph,
  registerPack,
  resetLanguagePacks,
  type LanguagePack
} from "../src/index";

/**
 * Pins the pack seam that tickets #151–#154 plug into: a registered pack may
 * emit pre-resolved edges (e.g. interface relations toward the port with
 * heuristic status) and its raw call sites are resolved by the engine.
 */
test("a registered pack's pre-resolved interface edge passes through with its status", async () => {
  const pack: LanguagePack = {
    language: "typescript",
    grammarId: "typescript",
    extensions: [".ts"],
    analyze: ({ file }) => ({
      nodes: [
        { name: "IRepository.Find", filePath: file.path, startLine: 1, endLine: 1 },
        { name: "App.Run", filePath: file.path, startLine: 3, endLine: 5 }
      ],
      calls: [],
      edges: [
        {
          from: "App.Run",
          to: "IRepository.Find",
          line: 4,
          kind: "call",
          callType: "interface",
          status: "heuristic",
          filePath: file.path
        }
      ]
    })
  };
  registerPack(pack);
  try {
    const graph = await buildRelationGraph(
      [{ path: "app.ts", content: "// pack-driven fixture\n" }],
      "typescript"
    );
    assert.equal(graph.status, "resolved");
    const run = graph.nodes.find(n => n.name === "App.Run");
    const port = graph.nodes.find(n => n.name === "IRepository.Find");
    assert.ok(run && port);
    const edge = graph.edges.find(e => e.from === run.id && e.to === port.id);
    assert.ok(edge, "pack edge must be mapped to node ids");
    assert.equal(edge.callType, "interface");
    assert.equal(edge.status, "heuristic");
    assert.equal(edge.kind, "call");
    assert.equal(edge.line, 4);
    assert.deepEqual(graph.outgoing[run.id].map(e => e.to), [port.id]);
    assert.deepEqual(graph.incoming[port.id].map(e => e.from), [run.id]);
  } finally {
    resetLanguagePacks();
  }
});

test("a pack edge toward an unknown target degrades to an unresolved site, not a guessed edge", async () => {
  registerPack({
    language: "typescript",
    grammarId: "typescript",
    extensions: [".ts"],
    analyze: ({ file }) => ({
      nodes: [{ name: "App.Run", filePath: file.path, startLine: 1, endLine: 3 }],
      calls: [],
      edges: [
        {
          from: "App.Run",
          to: "Ghost.Missing",
          line: 2,
          kind: "call",
          callType: "direct",
          status: "resolved",
          filePath: file.path
        }
      ]
    })
  });
  try {
    const graph = await buildRelationGraph(
      [{ path: "app.ts", content: "// pack-driven fixture\n" }],
      "typescript"
    );
    assert.equal(graph.edges.length, 0, "no edge to a non-existent node");
    const site = graph.sites.find(s => s.name === "Missing");
    assert.ok(site, "expected an unresolved site for the unknown target");
    assert.equal(site.status, "unresolved");
    assert.equal(site.caller, "App.Run");
  } finally {
    resetLanguagePacks();
  }
});
