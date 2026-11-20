// The three webpack bundles (dist/cli.js, dist/extension-node.js,
// dist/mcp-server.js) inline the knowledge contract, whose symbol
// fingerprinter resolves its vendored tree-sitter runtime relative to the
// bundle directory (node.__dirname: false keeps the real path in bundles).
// Copy the vendor payload next to the bundles so the CLI, the extension and
// the bundled embedded MCP server all fingerprint symbols, like the
// codetour-mcp binary does (spec #233, ADR 0046).
const { cpSync, existsSync } = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'packages', 'knowledge', 'dist', 'vendor');
if (!existsSync(source)) {
  console.log('Skipping vendor copy: packages/knowledge/dist/vendor is absent');
  process.exit(0);
}
cpSync(source, path.join(root, 'dist', 'vendor'), { recursive: true });
console.log('Copied packages/knowledge/dist/vendor into dist/vendor');
