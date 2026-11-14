import test from "node:test";
import assert from "node:assert/strict";
import { buildRelationGraph } from "../src/index";

test("a language without a pack yields an explicit unsupported graph, never a silent empty one", async () => {
  const graph = await buildRelationGraph(
    [{ path: "main.go", content: "package main\n\nfunc main() {}\n" }],
    "go"
  );
  assert.equal(graph.status, "unsupported");
  assert.equal(graph.supported, false);
  assert.equal(graph.language, "go");
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);
  assert.deepEqual(graph.sites, []);
  assert.deepEqual(graph.outgoing, {});
  assert.deepEqual(graph.incoming, {});
  assert.deepEqual(graph.unsupportedFiles, [{ path: "main.go", language: "go" }]);
  assert.equal(graph.truncated.nodes, false);
  assert.equal(graph.truncated.edges, false);
  assert.equal(graph.truncated.tokens, false);
});

test("per-file language overrides that lack a pack are reported as unsupported files", async () => {
  const graph = await buildRelationGraph(
    [
      { path: "a.ts", content: "function a(): number { return 1; }\n" },
      { path: "b.rb", content: "def b; end\n", language: "ruby" }
    ],
    "typescript"
  );
  assert.equal(graph.status, "resolved");
  assert.equal(graph.supported, true);
  assert.ok(graph.nodes.some(n => n.name === "a"));
  assert.deepEqual(graph.unsupportedFiles, [{ path: "b.rb", language: "ruby" }]);
});
