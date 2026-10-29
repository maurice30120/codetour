"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
test("packaged CLI reads a Tour without a globally available Node executable", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codetour-package-test-"));
  try {
    const output = path.join(tmp, "artifact");
    const pack = spawnSync(process.execPath, [path.join(root, "scripts/package-standalone.js"), "--output", output], { encoding: "utf8" });
    assert.equal(pack.status, 0, pack.stderr);
    const repo = path.join(tmp, "repo"); fs.mkdirSync(repo);
    const git = spawnSync("git", ["init", "-q", repo], { encoding: "utf8" }); assert.equal(git.status, 0, git.stderr);
    fs.mkdirSync(path.join(repo, ".tours"));
    const tour = JSON.stringify({ title: "Package fixture", steps: [{ title: "Introduction", description: "Standalone works" }] });
    fs.writeFileSync(path.join(repo, ".tours", "fixture.tour"), tour);
    const html = path.join(tmp, "rendered.html");
    const launcher = path.join(output, process.platform === "win32" ? "codetour.cmd" : "codetour");
    const env = { ...process.env, CODETOUR_TEST_HTML_OUTPUT: html };
    // Git remains available; no global Node executable is in this restricted PATH on macOS.
    if (process.platform === "darwin") env.PATH = "/usr/bin:/bin";
    const result = spawnSync(launcher, ["fixture", "--renderer", "html"], { cwd: repo, env, encoding: "utf8", shell: process.platform === "win32" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(html, "utf8"), /Standalone works/);
    assert.equal(fs.readFileSync(path.join(repo, ".tours", "fixture.tour"), "utf8"), tour);
    if (process.platform === "darwin") {
      const terminal = spawnSync("/usr/bin/python3", [path.join(root, "test/standalone-terminal-smoke.py"), launcher, path.join(repo, ".tours", "fixture.tour")], { cwd: repo, env, encoding: "utf8", timeout: 30000 });
      assert.equal(terminal.status, 0, terminal.stdout + "\n" + terminal.stderr);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("packaging rejects a modified Node archive before producing an artifact", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codetour-package-integrity-"));
  try {
    const bad = path.join(tmp, "invalid-archive"); fs.writeFileSync(bad, "invalid");
    const output = path.join(tmp, "artifact");
    const result = spawnSync(process.execPath, [path.join(root, "scripts/package-standalone.js"), "--output", output], {
      encoding: "utf8", env: { ...process.env, CODETOUR_NODE_ARCHIVE: bad }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum mismatch/);
    assert.equal(fs.existsSync(output), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
