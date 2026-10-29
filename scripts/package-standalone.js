#!/usr/bin/env node
"use strict";
// Build on the target OS/architecture so the rasterizer matches the artifact.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const version = "24.18.0";
const targets = {
  "darwin-arm64": ["tar.gz", "e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1"],
  "darwin-x64": ["tar.gz", "dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080"],
  "win32-x64": ["zip", "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821"]
};
function command(bin, args) {
  const result = spawnSync(bin, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`${bin} failed: ${result.error || result.stderr}`);
}
function main() {
  const target = `${process.platform}-${process.arch}`;
  const spec = targets[target];
  if (!spec) throw new Error(`Unsupported standalone build host ${target}`);
  const index = process.argv.indexOf("--output");
  if (index < 0 || !process.argv[index + 1]) throw new Error("Usage: node scripts/package-standalone.js --output <new-directory>");
  const output = path.resolve(process.argv[index + 1]);
  if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}`);
  const build = path.join(root, "dist");
  const manifest = JSON.parse(fs.readFileSync(path.join(build, "resvg-runtime", "manifest.json"), "utf8"));
  if (manifest.target !== target) throw new Error(`Rasterizer target ${manifest.target} does not match ${target}`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codetour-distribution-"));
  try {
    const nodePlatform = process.platform === "win32" ? "win" : process.platform;
    const archiveName = `node-v${version}-${nodePlatform}-${process.arch}.${spec[0]}`;
    const archive = process.env.CODETOUR_NODE_ARCHIVE || path.join(temp, archiveName);
    if (!process.env.CODETOUR_NODE_ARCHIVE) command("curl", ["-fsSL", `https://nodejs.org/dist/v${version}/${archiveName}`, "-o", archive]);
    const hash = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    if (hash !== spec[1]) throw new Error(`Node archive checksum mismatch for ${target}`);
    command("tar", ["-xf", archive, "-C", temp]);
    const runtime = path.join(temp, `node-v${version}-${nodePlatform}-${process.arch}`);
    fs.mkdirSync(output, { recursive: true });
    const exeName = process.platform === "win32" ? "node.exe" : "node";
    fs.copyFileSync(path.join(runtime, process.platform === "win32" ? "node.exe" : "bin/node"), path.join(output, exeName));
    fs.copyFileSync(path.join(runtime, "LICENSE"), path.join(output, "NODE-LICENSE"));
    if (process.platform !== "win32") fs.chmodSync(path.join(output, exeName), 0o755);
    fs.mkdirSync(path.join(output, "dist"));
    fs.copyFileSync(path.join(build, "cli.js"), path.join(output, "dist", "cli.js"));
    fs.copyFileSync(path.join(build, "cli.js.LICENSE.txt"), path.join(output, "dist", "cli.js.LICENSE.txt"));
    fs.copyFileSync(path.join(root, "node_modules", "@resvg", "resvg-js", "LICENSE"), path.join(output, "RESVG-LICENSE"));
    fs.cpSync(path.join(build, "resvg-runtime"), path.join(output, "dist", "resvg-runtime"), { recursive: true });
    // Copy only the external TermDOM dependency closure, preserving npm's nested resolution.
    const modules = fs.realpathSync(path.join(root, "node_modules"));
    const visited = new Set();
    function copyDependency(name, from) {
      const requireFrom = createRequire(path.join(from, "package.json"));
      let folder = path.dirname(requireFrom.resolve(name));
      while (folder !== path.dirname(folder)) {
        const file = path.join(folder, "package.json");
        if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).name === name) break;
        folder = path.dirname(folder);
      }
      folder = fs.realpathSync(folder);
      const relative = path.relative(modules, folder);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Dependency outside node_modules: ${folder}`);
      if (visited.has(folder)) return;
      visited.add(folder);
      fs.cpSync(folder, path.join(output, "dist", "node_modules", relative), {
        recursive: true, filter: source => path.basename(source) !== "node_modules"
      });
      const pkg = JSON.parse(fs.readFileSync(path.join(folder, "package.json"), "utf8"));
      for (const child of Object.keys(pkg.dependencies || {})) copyDependency(child, folder);
    }
    copyDependency("@b9g/termdom", root);
    if (process.platform === "win32") {
      fs.writeFileSync(path.join(output, "codetour.cmd"), '@echo off\r\n"%~dp0node.exe" "%~dp0dist\\cli.js" %*\r\nexit /b %errorlevel%\r\n');
    } else {
      fs.writeFileSync(path.join(output, "codetour"), '#!/bin/sh\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$DIR/node" "$DIR/dist/cli.js" "$@"\n', { mode: 0o755 });
    }
    console.log(`Standalone ${target} distribution created at ${output}`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
