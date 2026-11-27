"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync, spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const packaging = require("../scripts/package-standalone.js");

function listFilesRecursively(rootDirectory) {
  const entries = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      // Windows path.relative joins with "\" while the expected entries are
      // forward-slash strings (issue #84).
      entries.push(path.relative(rootDirectory, entryPath).split(path.sep).join("/"));
      if (entry.isDirectory()) walk(entryPath);
    }
  };
  walk(rootDirectory);
  return entries.sort();
}

// Git stays available; no global Node executable is in this restricted PATH
// on macOS, so every launch below uses the artifact's bundled runtime only.
function restrictedEnv() {
  if (process.platform === "darwin") {
    return { PATH: "/usr/bin:/bin", HOME: os.homedir() };
  }
  return process.env;
}

function packagedLaunchSpec(args) {
  if (process.platform === "win32") {
    // cmd.exe splits an unquoted launcher path or argument at spaces. Quote
    // each known fixture value before passing it through the shell.
    return {
      command: `"${shared.launcher}"`,
      args: args.map(argument => `"${argument}"`),
      shell: true,
    };
  }
  return { command: shared.launcher, args, shell: false };
}

function spawnPackagedSync(args, options = {}) {
  const launch = packagedLaunchSpec(args);
  return spawnSync(launch.command, launch.args, { ...options, shell: launch.shell });
}

function spawnPackaged(args, options = {}) {
  const launch = packagedLaunchSpec(args);
  return spawn(launch.command, launch.args, { ...options, shell: launch.shell });
}

// One real artifact for the running host, shared by every test in this file.
let shared;
before(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codetour-package-suite-"));
  // The parent directory contains a space on purpose: launchers and clients
  // must cope with spaced paths (Windows and macOS smoke coverage).
  const output = path.join(tmp, "codetour distribution", "artifact");
  const pack = spawnSync(
    process.execPath,
    [path.join(root, "scripts/package-standalone.js"), "--output", output],
    { encoding: "utf8" }
  );
  assert.equal(pack.status, 0, pack.stderr);
  shared = {
    tmp,
    artifact: output,
    launcher: path.join(output, process.platform === "win32" ? "codetour.cmd" : "codetour"),
  };
});

after(() => {
  if (shared) fs.rmSync(shared.tmp, { recursive: true, force: true });
});

test("packaged CLI reads a Tour without a globally available Node executable", () => {
  const repo = path.join(shared.tmp, "reader-repo");
  fs.mkdirSync(repo);
  const git = spawnSync("git", ["init", "-q", repo], { encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  fs.mkdirSync(path.join(repo, ".tours"));
  const tour = JSON.stringify({ title: "Package fixture", steps: [{ title: "Introduction", description: "Standalone works" }] });
  fs.writeFileSync(path.join(repo, ".tours", "fixture.tour"), tour);
  const html = path.join(shared.tmp, "rendered.html");
  const env = { ...process.env, CODETOUR_TEST_HTML_OUTPUT: html };
  if (process.platform === "darwin") env.PATH = "/usr/bin:/bin";
  const result = spawnPackagedSync(["fixture", "--renderer", "html"], {
    cwd: repo, env, encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(html, "utf8"), /Standalone works/);
  assert.equal(fs.readFileSync(path.join(repo, ".tours", "fixture.tour"), "utf8"), tour);
  if (process.platform === "darwin") {
    const terminal = spawnSync("/usr/bin/python3", [
      path.join(root, "test/standalone-terminal-smoke.py"),
      shared.launcher,
      path.join(repo, ".tours", "fixture.tour")
    ], { cwd: repo, env, encoding: "utf8", timeout: 30000 });
    assert.equal(terminal.status, 0, terminal.stdout + "\n" + terminal.stderr);
  }
});

test("packaged codetour removes a leftover Knowledge skill offline, never installs one", () => {
  const workspace = path.join(shared.tmp, "skill workspace");
  fs.mkdirSync(workspace);
  const env = {
    ...restrictedEnv(),
    COPILOT_HOME: path.join(workspace, "copilot home"),
    CODETOUR_COPILOT_MCP_CONFIG: path.join(workspace, "mcp-config.json"),
    CODETOUR_COPILOT_EXTENSIONS_DIR: path.join(workspace, "copilot-extensions"),
    CODETOUR_COPILOT_PLUGIN_DIR: path.join(workspace, "copilot plugin"),
  };
  // A copy an older CLI wrote before the skill was retired. The plugin is the
  // only guidance now: the install travels inside the standalone artifact with
  // no checkout and no network, and must retire the old skill, not ship one.
  const skillDirectory = path.join(workspace, "copilot home", "skills", "codetour-knowledge");
  fs.mkdirSync(skillDirectory, { recursive: true });
  fs.writeFileSync(path.join(skillDirectory, "SKILL.md"), "---\nname: codetour-knowledge\n---\nan older installment\n");
  const installed = spawnPackagedSync(["--install", "copilot"], { cwd: workspace, env, encoding: "utf8" });
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /Removed the retired standalone Knowledge skill/);
  assert.equal(fs.existsSync(skillDirectory), false);

  const removed = spawnPackagedSync(["--uninstall", "copilot"], { cwd: workspace, env, encoding: "utf8" });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(skillDirectory), false);
});

test("packaged codetour creates a Tour with no MCP server running", () => {
  const workspace = path.join(shared.tmp, "cli creation workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "hello.txt"), "hello standalone\n");
  const proposal = path.join(shared.tmp, "cli proposal.json");
  fs.writeFileSync(
    proposal,
    JSON.stringify({
      title: "Standalone CLI Tour",
      steps: [
        { title: "Introduction", description: "Created by the packaged CLI.", file: "hello.txt", line: 1 }
      ]
    })
  );

  const result = spawnPackagedSync(
    ["create-project-tour", "--workspace", workspace, "--proposal", proposal],
    { cwd: shared.tmp, env: restrictedEnv(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const created = JSON.parse(result.stdout);
  assert.equal(created.ok, true);
  assert.equal(created.kind, "project");
  assert.equal(created.title, "Standalone CLI Tour");
  const tour = JSON.parse(fs.readFileSync(path.join(workspace, ".tours", "project.tour"), "utf8"));
  assert.equal(tour.title, "Standalone CLI Tour");
  assert.equal(tour.steps[0].file, "hello.txt");
  // The creation wrote the Tour and its journal record only: no MCP server was
  // started, and no other file appeared in the workspace.
  const created_files = listFilesRecursively(workspace).filter(entry => entry.startsWith(".tours"));
  assert.ok(created_files.includes(".tours/project.tour"), created_files.join(", "));
  assert.ok(
    created_files.some(entry => /^\.tours\/\.log\/creations\/\d+-\d+-[0-9a-f]+\.json$/.test(entry)),
    created_files.join(", ")
  );
});

test("packaged creation and both readers preserve Project and neutral or critical Changes Tours", () => {
  const workspace = path.join(shared.tmp, "generation playback");
  fs.mkdirSync(workspace);
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: workspace, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  fs.writeFileSync(path.join(workspace, "code.ts"), "export const baseline = 1;\n");
  git("add", "code.ts");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base");
  const baseRef = git("rev-parse", "HEAD");
  fs.writeFileSync(path.join(workspace, "code.ts"), "export const delivered = 2;\n");
  git("add", "code.ts");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "feature");
  let headRef = git("rev-parse", "HEAD");
  const cases = [
    { fileName: "project", command: "create-project-tour" },
    { fileName: "neutral", command: "create-changes-tour", reviewMode: "neutral" },
    {
      fileName: "critical-no-spec", command: "create-changes-tour", reviewMode: "critical",
      description: "Spec axis not evaluated: no spec source was found."
    },
    {
      fileName: "critical-with-spec", command: "create-changes-tour", reviewMode: "critical",
      description: "Spec source: docs/spec.md. No defect established."
    }
  ];
  for (const scenario of cases) {
    if (scenario.fileName === "critical-with-spec") {
      fs.mkdirSync(path.join(workspace, "docs"));
      fs.writeFileSync(path.join(workspace, "docs", "spec.md"), "# Requirement\n\nThe delivered constant is 2.\n");
      git("add", "docs/spec.md");
      git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "record docs/spec.md");
      headRef = git("rev-parse", "HEAD");
    }
    const proposal = path.join(shared.tmp, `${scenario.fileName} proposal.json`);
    fs.writeFileSync(proposal, JSON.stringify({
      title: scenario.fileName,
      fileName: scenario.fileName,
      ...(scenario.reviewMode ? { baseRef, headRef, reviewMode: scenario.reviewMode } : {}),
      ...(scenario.description ? { description: scenario.description } : {}),
      steps: [{ title: "Introduction", file: "code.ts", line: 1, description: "The delivered constant is 2." }]
    }));
    // The creation is the CLI's work alone: no server is started, so the only
    // thing the proposal meets is the packaged bundle.
    const created = spawnPackagedSync(
      [scenario.command, "--workspace", workspace, "--proposal", proposal],
      { cwd: shared.tmp, env: restrictedEnv(), encoding: "utf8" }
    );
    assert.equal(created.status, 0, created.stderr);
    assert.equal(created.stderr, "");
    const result = JSON.parse(created.stdout);
    assert.equal(result.ok, true, created.stdout);
    assert.equal(result.kind, scenario.command === "create-project-tour" ? "project" : "changes");
    scenario.headRef = headRef;
  }
  // Readers must resolve committed diff snapshots despite a later dirty edit.
  fs.writeFileSync(path.join(workspace, "code.ts"), "export const dirty = 99;\n");
  for (const scenario of cases) {
    const tourPath = path.join(workspace, ".tours", `${scenario.fileName}.tour`);
    const original = fs.readFileSync(tourPath, "utf8");
    const tour = JSON.parse(original);
    assert.equal("reviewMode" in tour, false);
    const html = path.join(shared.tmp, `${scenario.fileName}.html`);
    const result = spawnPackagedSync([scenario.fileName, "--renderer", "html"], {
      cwd: workspace, env: { ...process.env, ...restrictedEnv(), CODETOUR_TEST_HTML_OUTPUT: html },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    const rendered = fs.readFileSync(html, "utf8");
    assert.match(rendered, /The delivered constant is 2/);
    if (scenario.reviewMode) {
      assert.equal(tour.ref, scenario.headRef);
      assert.equal(tour.baseRef, baseRef);
      assert.equal(tour.steps[0].display, "diff");
      assert.match(rendered, /baseline = 1/);
      assert.match(rendered, /delivered = 2/);
      assert.doesNotMatch(rendered, /dirty = 99/);
    }
    if (process.platform === "darwin") {
      const terminal = spawnSync("/usr/bin/python3", [path.join(root, "test/standalone-terminal-smoke.py"), shared.launcher, tourPath,
        ...(scenario.reviewMode ? ["baseline", "delivered"] : [])], {
        cwd: workspace, env: { ...process.env, ...restrictedEnv() }, encoding: "utf8", timeout: 30000
      });
      assert.equal(terminal.status, 0, terminal.stdout + "\n" + terminal.stderr);
    }
    assert.equal(fs.readFileSync(tourPath, "utf8"), original);
  }
});

test("the artifact ships no MCP server and no declaration of one", () => {
  // The invariant that replaces the retired single-server check: the artifact
  // carries the reader, the creation commands and the plugin files, and no
  // server bundle, marker or launch declaration.
  assert.equal(fs.existsSync(path.join(shared.artifact, "dist", "mcp-server.js")), false);
  for (const file of listFilesRecursively(shared.artifact)) {
    if (!file.endsWith(".js")) continue;
    const content = fs.readFileSync(path.join(shared.artifact, file), "utf8");
    assert.doesNotMatch(content, /Usage: codetour-mcp/, `${file} carries an MCP server entry`);
  }
  // The critical-review pack travels inside the bundle, so a created critical
  // Changes Tour has its method offline.
  const bundle = fs.readFileSync(path.join(shared.artifact, "dist", "cli.js"), "utf8");
  assert.match(bundle, /\*\*Standards:\*\*/);
  assert.match(bundle, /Matt Pocock/);
});

test("the artifact preserves permissions and licenses", () => {
  for (const license of ["NODE-LICENSE", "RESVG-LICENSE", path.join("dist", "cli.js.LICENSE.txt")]) {
    assert.ok(fs.existsSync(path.join(shared.artifact, license)), `missing ${license}`);
  }
  // The launchers and the bundled runtime stay executable on POSIX.
  if (process.platform !== "win32") {
    for (const executable of [
      path.join(shared.artifact, "codetour"),
      path.join(shared.artifact, "node"),
    ]) {
      const mode = fs.statSync(executable).mode;
      assert.equal(mode & 0o111, 0o111, `${executable} must be executable`);
    }
  }
  // The Windows launcher, when present, forwards every argument.
  const cmdPath = path.join(shared.artifact, "codetour.cmd");
  if (process.platform === "win32") {
    const cmd = fs.readFileSync(cmdPath, "utf8");
    assert.match(cmd, /node\.exe/);
    assert.match(cmd, /dist\\cli\.js/);
    assert.match(cmd, /%\*/);
  }
});

test("the Windows launcher template forwards every argument to the CLI", () => {
  const cmd = packaging.launcherScript("win32");
  assert.match(cmd, /node\.exe/);
  assert.match(cmd, /dist\\cli\.js/);
  assert.match(cmd, /%\*/);
  const sh = packaging.launcherScript("darwin");
  assert.match(sh, /"\$DIR\/node"/);
  assert.match(sh, /dist\/cli\.js/);
  assert.match(sh, /"\$@"/);
});

test("the packager rejects a CLI bundle over the measured size budget", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codetour-package-budget-"));
  try {
    // Guard level: an oversized bundle is rejected with the budget message.
    const oversized = path.join(tmp, "oversized.js");
    fs.writeFileSync(oversized, "x".repeat(64));
    assert.throws(() => packaging.assertWithinBudget(oversized, 32), /budget/);
    const fits = path.join(tmp, "fits.js");
    fs.writeFileSync(fits, "x".repeat(16));
    assert.doesNotThrow(() => packaging.assertWithinBudget(fits, 32));
    // Packaging level: the budget fails before any download or output.
    const badArchive = path.join(tmp, "invalid-archive");
    fs.writeFileSync(badArchive, "invalid");
    const output = path.join(tmp, "artifact");
    const result = spawnSync(
      process.execPath,
      [path.join(root, "scripts/package-standalone.js"), "--output", output],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CODETOUR_NODE_ARCHIVE: badArchive,
          CODETOUR_CLI_BUDGET_BYTES: "1000",
        },
      }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /budget/);
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
