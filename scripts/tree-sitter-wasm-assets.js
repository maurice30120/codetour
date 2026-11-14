// Shared staging of the prebuilt tree-sitter .wasm files (ADR 0034, ticket
// #155). The VSIX and the standalone CLI cannot inline .wasm in their webpack
// bundles, so the five grammar wasms (c_sharp, java, typescript, tsx, python)
// plus the web-tree-sitter runtime tree-sitter.wasm are emitted as asset files
// under dist/tree-sitter-wasm/ next to the bundles (resvg-runtime precedent).
// The npm codetour-mcp channel does not need them: there the grammars resolve
// from node_modules/tree-sitter-wasms (configureWasmAssets stays unset).
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const GRAMMAR_WASM_FILES = Object.freeze([
  "tree-sitter-c_sharp.wasm",
  "tree-sitter-java.wasm",
  "tree-sitter-typescript.wasm",
  "tree-sitter-tsx.wasm",
  "tree-sitter-python.wasm"
]);

const RUNTIME_WASM_FILE = "tree-sitter.wasm";

function dependencyRoot() {
  const candidates = [
    path.join(root, "packages", "relation-graph", "node_modules"),
    path.join(root, "packages", "mcp-server", "node_modules"),
    path.join(root, "node_modules")
  ];
  return candidates.find(
    candidate =>
      fs.existsSync(
        path.join(candidate, "tree-sitter-wasms", "out", GRAMMAR_WASM_FILES[0])
      ) && fs.existsSync(path.join(candidate, "web-tree-sitter", RUNTIME_WASM_FILE))
  );
}

/** The wasm asset files to ship: { name, source } with on-disk sources. */
function collectWasmAssets() {
  const depRoot = dependencyRoot();
  if (!depRoot) {
    throw new Error(
      "Unable to find tree-sitter-wasms and web-tree-sitter. " +
        "Install the packages/relation-graph dependencies first."
    );
  }
  const assets = GRAMMAR_WASM_FILES.map(name => ({
    name,
    source: path.join(depRoot, "tree-sitter-wasms", "out", name)
  }));
  assets.push({
    name: RUNTIME_WASM_FILE,
    source: path.join(depRoot, "web-tree-sitter", RUNTIME_WASM_FILE)
  });
  for (const asset of assets) {
    if (!fs.existsSync(asset.source)) {
      throw new Error(`Missing wasm asset: ${asset.source}`);
    }
  }
  return assets;
}

/** Copy the wasm assets into destDir (recreated). Returns destDir. */
function stageWasmAssets(destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  for (const asset of collectWasmAssets()) {
    fs.copyFileSync(asset.source, path.join(destDir, asset.name));
  }
  return destDir;
}

module.exports = {
  GRAMMAR_WASM_FILES,
  RUNTIME_WASM_FILE,
  collectWasmAssets,
  stageWasmAssets
};
