import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Real verifications of `codetour --install pi`: the package is written into a
// temporary PI_CODING_AGENT_DIR (a path with spaces on purpose) and declared in
// that directory's settings.json. The developer's own Pi configuration is never
// touched.

const cli = path.resolve("dist", "cli.js");

function agentDirWithSpaces(root) {
  return path.join(root, "pi agent dir");
}

function run(home, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, PI_CODING_AGENT_DIR: home },
  });
  return result;
}

function pluginDir(home) {
  return path.join(home, "packages", "codetour-plugin");
}

function settingsFile(home) {
  return path.join(home, "settings.json");
}

function readSettings(home) {
  return JSON.parse(readFileSync(settingsFile(home), "utf8"));
}

function packageSources(settings) {
  return (settings.packages || []).map(entry =>
    typeof entry === "string" ? entry : entry.source
  );
}

test("--install pi writes the package, the launcher and one declaration", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-pi-install-"));
  const home = agentDirWithSpaces(root);
  try {
    const result = run(home, ["--install", "pi"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    for (const file of [
      "package.json",
      "extensions/codetour.ts",
      "lib/guard.mjs",
      "lib/run-log.mjs",
      "skills/codetour-generate/SKILL.md",
      "launcher.json",
    ]) {
      assert.ok(
        existsSync(path.join(pluginDir(home), ...file.split("/"))),
        `${file} must be installed`
      );
    }

    const manifest = JSON.parse(readFileSync(path.join(pluginDir(home), "package.json"), "utf8"));
    assert.deepEqual(manifest.pi.extensions, ["./extensions/codetour.ts"]);

    // The launcher records the CLI that performed the install, so a stale
    // `codetour` on PATH cannot serve the session.
    const launcher = JSON.parse(readFileSync(path.join(pluginDir(home), "launcher.json"), "utf8"));
    assert.equal(launcher.command, process.execPath);
    assert.equal(launcher.args[launcher.args.length - 1], "mcp");
    assert.ok(path.isAbsolute(launcher.args[0]));

    const settings = readSettings(home);
    assert.deepEqual(packageSources(settings), [path.resolve(pluginDir(home))]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a second --install pi is idempotent and preserves other packages", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-pi-install-"));
  const home = agentDirWithSpaces(root);
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(
      settingsFile(home),
      `${JSON.stringify({ packages: ["npm:someone-else@"], theme: "dark" }, null, 2)}\n`,
      "utf8"
    );
    assert.equal(run(home, ["--install", "pi"]).status, 0);
    assert.equal(run(home, ["--install", "pi"]).status, 0);

    const settings = readSettings(home);
    const sources = packageSources(settings);
    assert.equal(sources.filter(source => source === path.resolve(pluginDir(home))).length, 1);
    assert.deepEqual(sources, ["npm:someone-else@", path.resolve(pluginDir(home))]);
    // Unrelated settings are preserved byte for byte in value.
    assert.equal(settings.theme, "dark");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--uninstall pi removes the declaration first and only the files it wrote", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-pi-install-"));
  const home = agentDirWithSpaces(root);
  try {
    assert.equal(run(home, ["--install", "pi"]).status, 0);
    const foreign = path.join(pluginDir(home), "notes.md");
    writeFileSync(foreign, "kept\n", "utf8");

    // A foreign file makes the uninstall refuse instead of deleting it.
    const refused = run(home, ["--uninstall", "pi"]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr || refused.stdout, /notes\.md/);
    assert.ok(existsSync(foreign));
    assert.ok(existsSync(path.join(pluginDir(home), "package.json")));

    rmSync(foreign);
    const removed = run(home, ["--uninstall", "pi"]);
    assert.equal(removed.status, 0, removed.stderr || removed.stdout);
    assert.equal(existsSync(path.join(pluginDir(home), "package.json")), false);
    assert.deepEqual(packageSources(readSettings(home)), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unreadable settings file blocks the install instead of being overwritten", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-pi-install-"));
  const home = agentDirWithSpaces(root);
  try {
    mkdirSync(home, { recursive: true });
    const broken = '{ "packages": [ "npm:kept" ], }\n';
    writeFileSync(settingsFile(home), broken, "utf8");

    const result = run(home, ["--install", "pi"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /not a JSON object/);
    // Nothing was written: the breakage is reported, never repaired by force.
    assert.equal(readFileSync(settingsFile(home), "utf8"), broken);
    assert.equal(existsSync(path.join(pluginDir(home), "package.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--agents reports the pi integration alongside the others", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-pi-install-"));
  const home = agentDirWithSpaces(root);
  try {
    const result = run(home, ["--agents"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^pi\tPi coding agent$/m);
    assert.match(result.stdout, /not-installed/);
    assert.equal(run(home, ["--install", "pi"]).status, 0);
    const after = run(home, ["--agents"]);
    assert.match(after.stdout, /^pi\tPi coding agent$/m);
    assert.match(after.stdout, /installed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
