// Stages the local codetour-relation-graph dependency into the MCP package,
// exactly like stage-mcp-renderer.js does for codetour-description-renderer:
// npm file: dependencies are snapshotted at install time, so the packed
// codetour-mcp tarball carries the built module under dist/node_modules.
// (The .wasm grammars are NOT staged here: the npm channel resolves them from
// node_modules/tree-sitter-wasms; the VSIX/standalone stage them as dist
// assets via scripts/prepare-tree-sitter-wasm.js.)
const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const graphRoot = path.join(packageRoot, "packages", "relation-graph");
const graphDist = path.join(graphRoot, "dist");
const stagedRoot = path.join(
  packageRoot,
  "packages",
  "mcp-server",
  "dist",
  "node_modules",
  "codetour-relation-graph"
);

if (!fs.existsSync(graphDist)) {
  throw new Error(
    "The relation graph must be built before the MCP server can be packaged."
  );
}

fs.rmSync(stagedRoot, { recursive: true, force: true });
fs.mkdirSync(stagedRoot, { recursive: true });
fs.cpSync(graphDist, path.join(stagedRoot, "dist"), { recursive: true });

const graphPackage = JSON.parse(
  fs.readFileSync(path.join(graphRoot, "package.json"), "utf8")
);
fs.writeFileSync(
  path.join(stagedRoot, "package.json"),
  `${JSON.stringify(
    {
      name: graphPackage.name,
      version: graphPackage.version,
      main: graphPackage.main,
      types: graphPackage.types
    },
    null,
    2
  )}\n`
);

console.log(`Staged ${graphPackage.name} in the MCP package.`);
