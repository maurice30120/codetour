import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildRelationGraph,
  configureWasmAssets,
  getConfiguredWasmDirectory,
  GRAMMAR_IDS,
  resolveGrammarPath
} from "../src/index";

// The VSIX and standalone bundles ship the prebuilt grammars plus the
// web-tree-sitter runtime wasm as asset files under a directory next to the
// bundle (note 02, resvg-runtime precedent). configureWasmAssets points both
// Parser.init's locateFile and the grammar resolution at that directory, so
// the bundled server never needs node_modules for the wasm files.

const RUNTIME_WASM = "tree-sitter.wasm";

// Captured at module load, before any test calls configureWasmAssets: the
// node_modules locations of the wasm files (the npm channel resolution).
const GRAMMAR_SOURCES: Record<string, string> = Object.fromEntries(
  GRAMMAR_IDS.map(grammarId => [grammarId, resolveGrammarPath(grammarId)])
);
const RUNTIME_SOURCE = require.resolve("web-tree-sitter/tree-sitter.wasm");

function grammarWasmFile(grammarId: string): string {
  return `tree-sitter-${grammarId}.wasm`;
}

function stageAssetDirectory(withRuntime: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relation-graph-wasm-assets-"));
  for (const grammarId of GRAMMAR_IDS) {
    fs.copyFileSync(GRAMMAR_SOURCES[grammarId], path.join(dir, grammarWasmFile(grammarId)));
  }
  if (withRuntime) {
    fs.copyFileSync(RUNTIME_SOURCE, path.join(dir, RUNTIME_WASM));
  }
  return dir;
}

test("by default grammars resolve from node_modules (npm channel)", () => {
  assert.equal(getConfiguredWasmDirectory(), undefined);
  for (const grammarId of GRAMMAR_IDS) {
    const resolved = resolveGrammarPath(grammarId);
    assert.ok(resolved.includes("tree-sitter-wasms"), `${grammarId} resolves into tree-sitter-wasms`);
    assert.ok(fs.existsSync(resolved), `${grammarId} wasm exists on disk`);
  }
});

test("configureWasmAssets redirects grammar resolution to the asset directory", () => {
  const dir = stageAssetDirectory(true);
  try {
    configureWasmAssets({ wasmDirectory: dir });
    assert.equal(getConfiguredWasmDirectory(), dir);
    for (const grammarId of GRAMMAR_IDS) {
      assert.equal(
        resolveGrammarPath(grammarId),
        path.join(dir, grammarWasmFile(grammarId))
      );
    }
    // An explicit per-call directory still wins over the configured default.
    assert.notEqual(resolveGrammarPath("python", "/somewhere/else"), path.join(dir, "tree-sitter-python.wasm"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a graph builds end-to-end from the staged asset directory (Parser.init locateFile + grammars)", async () => {
  const dir = stageAssetDirectory(true);
  try {
    configureWasmAssets({ wasmDirectory: dir });
    const graph = await buildRelationGraph(
      [
        {
          path: "service.ts",
          content:
            "export class UserService {\n  getUser(): number { return this.validate(); }\n  validate(): number { return 1; }\n}\n" +
            "export function handleRequest(): number {\n  const service = new UserService();\n  return service.getUser();\n}\n"
        }
      ],
      "typescript"
    );
    assert.equal(graph.status, "resolved");
    assert.ok(graph.nodes.length > 0, "nodes extracted from the staged grammars");
    assert.ok(graph.edges.length > 0, "relations extracted from the staged grammars");
    const names = graph.edges.map(edge => `${edge.from}->${edge.to}`);
    assert.ok(
      names.some(line => line.includes("UserService.constructor")),
      `expected a class-usage edge toward UserService.constructor, got ${names.join(", ")}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
