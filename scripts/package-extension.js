const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { TARGETS, hostTarget } = require("./prepare-resvg-runtime");

const root = path.resolve(__dirname, "..");
const target = process.env.CODETOUR_TARGET || hostTarget();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, CODETOUR_TARGET: target },
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
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
  if (!TARGETS[target]) {
    throw new Error(`Unsupported CodeTour packaging target: ${target}`);
  }

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const vsce = path.join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vsce.cmd" : "vsce"
  );

  run(npm, ["run", "build"]);
  const listing = run(vsce, ["ls"], { capture: true });
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8")
  );
  if (packageJson.browser) {
    throw new Error("The packaged extension must not contain a browser entry point.");
  }

  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "dist", "resvg-runtime", "manifest.json"), "utf8")
  );
  if (manifest.target !== target || manifest.binary !== TARGETS[target].binary) {
    throw new Error("The staged rasterizer runtime does not match the requested VSIX target.");
  }
  const files = listing
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const expectedBinary = `dist/resvg-runtime/resvg-js/${manifest.binary}`;
  if (!files.some((file) => file === expectedBinary || file.endsWith(`/${expectedBinary}`))) {
    throw new Error(`VSIX file list does not contain ${expectedBinary}.`);
  }
  if (files.some((file) => file.includes("extension-web"))) {
    throw new Error("The packaged extension contains the removed Web artifact.");
  }
  if (files.length > 2000) {
    throw new Error(`VSIX contains ${files.length} files; the packaging budget is 2000.`);
  }

  run(vsce, ["package", "--target", target]);
  const version = packageJson.version;
  const artifact = fs
    .readdirSync(root)
    .filter((file) => file.endsWith(`-${target}-${version}.vsix`))
    .map((file) => path.join(root, file))
    .find((file) => fs.statSync(file).isFile());
  if (!artifact) {
    throw new Error(`vsce did not create the ${version}-${target} artifact.`);
  }
  const size = fs.statSync(artifact).size;
  if (size >= 38 * 1024 * 1024) {
    throw new Error(`VSIX is ${size} bytes; it exceeds the 38 MiB packaging budget.`);
  }
  run(process.execPath, [path.join(root, "scripts", "verify-vsix.js"), artifact, target]);
  console.log(
    `Packaged ${path.basename(artifact)} for ${target}: ${size} bytes.`
  );
}

main();
