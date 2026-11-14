// Emits the prebuilt tree-sitter .wasm grammars (the four relation packs of
// spec #149 plus TSX) and the web-tree-sitter runtime wasm as asset files
// under dist/tree-sitter-wasm/, next to the webpack bundles that load them
// through Parser.init({ locateFile }) + Language.load(absolutePath).
// The VSIX ships only dist/ (.vscodeignore), and the standalone packager
// copies dist/tree-sitter-wasm next to dist/cli.js — same pattern as
// prepare-resvg-runtime.js staging dist/resvg-runtime/.
const path = require("node:path");
const { stageWasmAssets } = require("./tree-sitter-wasm-assets");

const root = path.resolve(__dirname, "..");
const dest = stageWasmAssets(path.join(root, "dist", "tree-sitter-wasm"));
console.log(`Staged tree-sitter wasm assets in ${path.relative(root, dest)}.`);
