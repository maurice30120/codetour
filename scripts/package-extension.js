const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32",
    encoding: "utf8"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
  return options.capture ? `${result.stdout || ""}${result.stderr || ""}` : "";
}

function main() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const vsce = path.join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vsce.cmd" : "vsce"
  );

  fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
  run(npm, ["run", "build"]);
  for (const file of ["extension-web.js", "extension-web.js.map", "extension-web.js.LICENSE.txt"]) {
    fs.rmSync(path.join(root, "dist", file), { force: true });
  }
  const listing = run(vsce, ["ls"], { capture: true });
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8")
  );
  if (packageJson.browser) {
    throw new Error("The packaged extension must not contain a browser entry point.");
  }

  const files = listing
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean);
  if (!files.some(file => file === "dist/mcp-server.js" || file.endsWith("/dist/mcp-server.js"))) {
    throw new Error("VSIX file list does not contain the bundled MCP server.");
  }
  if (files.some(file => file.includes("extension-web"))) {
    throw new Error("The packaged extension contains the removed Web artifact.");
  }
  if (files.length > 2000) {
    throw new Error(`VSIX contains ${files.length} files; the packaging budget is 2000.`);
  }

  run(vsce, ["package"]);
  const version = packageJson.version;
  const artifact = path.join(root, `${packageJson.name}-${version}.vsix`);
  if (!fs.existsSync(artifact)) {
    throw new Error(`vsce did not create the ${version} artifact.`);
  }
  const size = fs.statSync(artifact).size;
  if (size >= 38 * 1024 * 1024) {
    throw new Error(`VSIX is ${size} bytes; it exceeds the 38 MiB packaging budget.`);
  }
  run(process.execPath, [path.join(root, "scripts", "verify-vsix.js"), artifact]);
  console.log(`Packaged ${path.basename(artifact)}: ${size} bytes.`);
}

main();
