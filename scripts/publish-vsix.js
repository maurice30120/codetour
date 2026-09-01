const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const artifacts = fs
  .readdirSync(root)
  .filter((file) => file.endsWith(".vsix"))
  .map((file) => path.join(root, file))
  .filter((file) => fs.statSync(file).isFile());

if (artifacts.length !== 1) {
  throw new Error(`Expected exactly one VSIX to publish, found ${artifacts.length}.`);
}

const vsce = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vsce.cmd" : "vsce"
);
const result = spawnSync(vsce, ["publish", "--packagePath", artifacts[0]], {
  cwd: root,
  stdio: "inherit"
});
if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log(`Published ${path.basename(artifacts[0])}.`);
