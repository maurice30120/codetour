const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const rendererRoot = path.join(packageRoot, "packages", "description-renderer");
const rendererDist = path.join(rendererRoot, "dist");
const stagedRoot = path.join(
  packageRoot,
  "packages",
  "mcp-server",
  "dist",
  "node_modules",
  "codetour-description-renderer"
);

if (!fs.existsSync(rendererDist)) {
  throw new Error(
    "The description renderer must be built before the MCP server can be packaged."
  );
}

fs.rmSync(stagedRoot, { recursive: true, force: true });
fs.mkdirSync(stagedRoot, { recursive: true });
fs.cpSync(rendererDist, path.join(stagedRoot, "dist"), { recursive: true });

const rendererPackage = JSON.parse(
  fs.readFileSync(path.join(rendererRoot, "package.json"), "utf8")
);
fs.writeFileSync(
  path.join(stagedRoot, "package.json"),
  `${JSON.stringify({
    name: rendererPackage.name,
    version: rendererPackage.version,
    main: rendererPackage.main,
    types: rendererPackage.types
  }, null, 2)}\n`
);

console.log(`Staged ${rendererPackage.name} in the MCP package.`);
