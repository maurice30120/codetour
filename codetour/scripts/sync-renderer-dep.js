const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const rendererRoot = path.join(packageRoot, "packages", "description-renderer");
const rendererDist = path.join(rendererRoot, "dist");
const installedRoot = path.join(
  packageRoot,
  "node_modules",
  "codetour-description-renderer"
);

if (!fs.existsSync(rendererDist)) {
  throw new Error(
    "The description renderer must be built before local dependencies can be synced."
  );
}

// npm links local directory dependencies directly to the source package.
if (fs.realpathSync(installedRoot) === fs.realpathSync(rendererRoot)) {
  console.log("The installed description renderer already links to the source.");
  return;
}

// The file: dependency is a snapshot taken at install time: rebuilding the
// renderer does not refresh it, so compiled artifacts that resolve the
// package by name (the extension test suite) would keep exercising a stale
// renderer. Refresh the installed copy from the freshly built dist, the same
// way the MCP server stages its own copy.
fs.rmSync(path.join(installedRoot, "dist"), { recursive: true, force: true });
fs.cpSync(rendererDist, path.join(installedRoot, "dist"), { recursive: true });

console.log("Synced the built description renderer into node_modules.");
