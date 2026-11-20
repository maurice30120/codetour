// Vendoring for the Knowledge symbol fingerprinter (spec #233, ADR 0046):
// the web-tree-sitter runtime and the shipped grammars are copied into
// dist/vendor at build time, so every installation resolves the files
// relative to the package itself — deterministic, offline, and immune to
// the staged-copy module layout of downstream packages.
const { copyFileSync, existsSync, mkdirSync } = require('fs');
const path = require('path');

const knowledgeRoot = path.join(__dirname, '..');
const vendor = path.join(knowledgeRoot, 'dist', 'vendor');

const webTreeSitter = path.join(knowledgeRoot, 'node_modules', 'web-tree-sitter');
const grammars = path.join(knowledgeRoot, 'node_modules', 'tree-sitter-wasms', 'out');
if (!existsSync(path.join(webTreeSitter, 'tree-sitter.js'))) {
  // A detached worktree or a fresh checkout may not carry the dev tools:
  // keep the build green where the vendored sources are already present.
  console.log(`Skipping vendor copy: ${path.relative(knowledgeRoot, webTreeSitter)} is absent`);
  process.exit(0);
}

mkdirSync(path.join(vendor, 'grammars'), { recursive: true });
copyFileSync(path.join(webTreeSitter, 'tree-sitter.js'), path.join(vendor, 'tree-sitter.js'));
copyFileSync(path.join(webTreeSitter, 'tree-sitter.wasm'), path.join(vendor, 'tree-sitter.wasm'));

// Only the grammars the extension map currently resolves are vendored; the
// map grows with the supported set. Everything else stays fail-closed.
let count = 0;
for (const wasm of ['tree-sitter-typescript.wasm', 'tree-sitter-tsx.wasm', 'tree-sitter-javascript.wasm']) {
  const source = path.join(grammars, wasm);
  if (!existsSync(source)) continue;
  copyFileSync(source, path.join(vendor, 'grammars', wasm));
  count += 1;
}
console.log(`Vendored tree-sitter runtime + ${count} grammars into dist/vendor`);
