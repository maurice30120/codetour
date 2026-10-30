"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, spawn } = require("node:child_process");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const packaging = require("../scripts/package-standalone.js");

// The MCP SDK client comes from the MCP server package's installed
// dependencies; the standalone tests are its consumer-side counterpart.
const mcpRequire = createRequire(path.join(root, "packages", "mcp-server", "package.json"));
const { Client } = mcpRequire("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = mcpRequire("@modelcontextprotocol/sdk/client/stdio.js");

const mcpVersion = JSON.parse(
  fs.readFileSync(path.join(root, "packages", "mcp-server", "package.json"), "utf8")
).version;

function listFilesRecursively(rootDirectory) {
  const entries = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      entries.push(path.relative(rootDirectory, entryPath));
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

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  return {
    isError: result.isError ?? false,
    text: (result.content ?? [])
      .filter(item => item.type === "text")
      .map(item => item.text)
      .join("\n"),
    structured: result.structuredContent ?? {},
  };
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
  const result = spawnSync(shared.launcher, ["fixture", "--renderer", "html"], {
    cwd: repo, env, encoding: "utf8", shell: process.platform === "win32"
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

test("packaged codetour mcp creates a Project Tour in a non-Git workspace without global Node", async () => {
  const workspace = path.join(shared.tmp, "tour workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "hello.txt"), "hello standalone\n");
  const before = listFilesRecursively(workspace);
  const client = new Client(
    { name: "standalone-mcp-test-client", version: "0.0.0" },
    { capabilities: {} }
  );
  const transport = new StdioClientTransport({
    command: shared.launcher,
    args: ["mcp"],
    cwd: workspace,
    env: restrictedEnv(),
    stderr: "pipe",
  });
  const stderrChunks = [];
  await client.connect(transport);
  transport.stderr?.on("data", chunk => stderrChunks.push(String(chunk)));
  try {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map(tool => tool.name).sort(),
      ["create_changes_tour", "create_project_tour"]
    );
    const response = await callTool(client, "create_project_tour", {
      title: "Standalone Tour",
      steps: [{ file: "hello.txt", description: "Created by the packaged MCP server." }],
    });
    assert.equal(response.isError, false, response.text);
    assert.equal(response.structured.status, "created");
    const tour = JSON.parse(fs.readFileSync(path.join(workspace, ".tours", "project.tour"), "utf8"));
    assert.equal(tour.title, "Standalone Tour");
    // The session wrote exactly the reserved Tour file and nothing else.
    const after = listFilesRecursively(workspace);
    assert.deepEqual(
      after.filter(entry => !before.includes(entry)),
      [".tours", ".tours/project.tour"]
    );
    assert.equal(stderrChunks.join(""), "");
  } finally {
    await client.close();
  }
});

test("packaged codetour mcp serves --workspace-root from a different working directory", async () => {
  const workspace = path.join(shared.tmp, "remote workspace");
  const elsewhere = path.join(shared.tmp, "unrelated cwd");
  fs.mkdirSync(workspace);
  fs.mkdirSync(elsewhere);
  fs.writeFileSync(path.join(workspace, "hello.txt"), "hello remote\n");
  const client = new Client(
    { name: "standalone-mcp-test-client", version: "0.0.0" },
    { capabilities: {} }
  );
  const transport = new StdioClientTransport({
    command: shared.launcher,
    args: ["mcp", "--workspace-root", workspace],
    cwd: elsewhere,
    env: restrictedEnv(),
  });
  await client.connect(transport);
  try {
    const response = await callTool(client, "create_project_tour", {
      steps: [{ file: "hello.txt", description: "Anchored inside the workspace passed to --workspace-root." }],
    });
    assert.equal(response.isError, false, response.text);
    assert.ok(fs.existsSync(path.join(workspace, ".tours", "project.tour")));
    assert.equal(fs.existsSync(path.join(elsewhere, ".tours")), false);
  } finally {
    await client.close();
  }
});

test("packaged codetour mcp help, version and argument diagnostics match codetour-mcp", () => {
  const workspace = path.join(shared.tmp, "diagnostics workspace");
  fs.mkdirSync(workspace);
  const env = { ...restrictedEnv() };
  const run = args => spawnSync(shared.launcher, args, {
    cwd: workspace, env, encoding: "utf8", shell: process.platform === "win32"
  });

  const help = run(["mcp", "--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: codetour-mcp/);
  assert.match(help.stdout, /--workspace-root <dir>/);

  const version = run(["mcp", "--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), mcpVersion);
  assert.equal(version.stderr, "");

  const unknown = run(["mcp", "--bogus"]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown argument: --bogus/);
  assert.equal(unknown.stdout, "");

  const missing = run(["mcp", "--workspace-root"]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Missing value for --workspace-root/);
  assert.equal(missing.stdout, "");

  const inaccessible = run(["mcp", "--workspace-root", path.join(workspace, "missing")]);
  assert.notEqual(inaccessible.status, 0);
  assert.match(inaccessible.stderr, /not an accessible directory/);
  assert.equal(inaccessible.stdout, "");
});

test("packaged codetour mcp keeps stdout protocol-only and exits when stdin closes", async () => {
  const workspace = path.join(shared.tmp, "protocol workspace");
  fs.mkdirSync(workspace);
  const child = spawn(shared.launcher, ["mcp"], {
    cwd: workspace,
    env: restrictedEnv(),
    shell: process.platform === "win32",
  });
  let stdout = "";
  let stderrText = "";
  child.stdout.on("data", chunk => (stdout += String(chunk)));
  child.stderr.on("data", chunk => (stderrText += String(chunk)));
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not exit after stdin close: ${stdout}`)), 10000);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once("error", error => { clearTimeout(timer); reject(error); });
  });
  // Raw JSON-RPC handshake: any banner or reader output on stdout would make
  // a line fail to parse as a protocol message.
  const request = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "raw-client", version: "0.0.0" },
    },
  }) + "\n";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no initialize response: ${stdout}`)), 15000);
    child.stdout.on("data", chunk => {
      if (String(chunk).includes('"result"')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stdin.write(request);
  });
  child.stdin.end();
  const { code } = await exited;
  assert.equal(code, 0);
  assert.equal(stderrText, "");
  const lines = stdout.split("\n").filter(line => line.trim() !== "");
  assert.ok(lines.length >= 1);
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line), `non-protocol stdout: ${line}`);
  }
});

test("the artifact contains the MCP server exactly once and preserves permissions and licenses", () => {
  // Single-server invariant on the real artifact.
  assert.doesNotThrow(() => packaging.assertSingleMcpServer(shared.artifact));
  assert.equal(fs.existsSync(path.join(shared.artifact, "dist", "mcp-server.js")), false);
  // Licenses travel with the distribution.
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

test("the packager rejects an artifact that contains a second MCP server entry", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codetour-package-duplicate-"));
  try {
    const fake = path.join(tmp, "artifact");
    fs.mkdirSync(path.join(fake, "dist"), { recursive: true });
    const marker = 'console.log("Usage: codetour-mcp");\n';
    // A single embedded server passes.
    fs.writeFileSync(path.join(fake, "dist", "cli.js"), marker);
    assert.doesNotThrow(() => packaging.assertSingleMcpServer(fake));
    // A second standalone server entry is rejected.
    fs.writeFileSync(path.join(fake, "dist", "mcp-server.js"), marker);
    assert.throws(() => packaging.assertSingleMcpServer(fake), /second MCP server entry/);
    fs.rmSync(path.join(fake, "dist", "mcp-server.js"));
    // A second embedded copy in the bundle is rejected too.
    fs.writeFileSync(path.join(fake, "dist", "cli.js"), marker + marker);
    assert.throws(() => packaging.assertSingleMcpServer(fake), /exactly once/);
    // A server marker outside dist/cli.js is rejected.
    fs.mkdirSync(path.join(fake, "dist", "node_modules", "evil"), { recursive: true });
    fs.writeFileSync(path.join(fake, "dist", "node_modules", "evil", "evil.js"), marker);
    fs.rmSync(path.join(fake, "dist", "node_modules", "evil"), { recursive: true, force: true });
    fs.writeFileSync(path.join(fake, "dist", "cli.js"), marker);
    fs.mkdirSync(path.join(fake, "dist", "node_modules", "server"), { recursive: true });
    fs.writeFileSync(path.join(fake, "dist", "node_modules", "server", "server.js"), marker);
    assert.throws(() => packaging.assertSingleMcpServer(fake), /exactly once/);
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
