import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import * as os from "os";
import * as path from "path";
import { COPILOT_EXTENSION_FILES } from "./copilot-extension.generated";

const cli = path.resolve(__dirname, "../../cli.js");

function temporaryDirectory(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Agent commands are machine-level actions: they must work outside any Git
// worktree, so every run uses an empty temporary directory as its workspace.
function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: "utf8",
    // The Copilot user configuration is machine state: every run redirects it
    // into the temporary workspace so a test never reads or writes the real
    // ~/.copilot/mcp-config.json.
    env: { ...process.env, CODETOUR_COPILOT_MCP_CONFIG: path.join(cwd, "mcp-config.json"), ...env }
  });
}

function mcpConfig(workspace: string): { mcpServers?: Record<string, Record<string, unknown>> } {
  return JSON.parse(readFileSync(path.join(workspace, "mcp-config.json"), "utf8"));
}

// Play the Copilot host against the registered launch contract: initialize a
// stdio session and list its tools. This is the external seam that proves the
// registration exposes the creation tools, not merely that JSON was written.
function listRegisteredTools(
  entry: { command: string; args: string[] },
  cwd: string
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(entry.command, entry.args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const lines = createInterface({ input: child.stdout });
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, tools?: string[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      child.kill();
      if (error) reject(error); else resolve(tools!);
    };
    const timer = setTimeout(() => finish(new Error(`MCP handshake timed out. ${stderr}`)), 15000);
    const send = (message: object) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
    child.on("error", error => finish(error));
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-4096); });
    child.once("close", () => finish(new Error(stderr.trim() || "CodeTour MCP closed before listing tools.")));
    lines.on("line", line => {
      const message = JSON.parse(line);
      if (message.error) {
        finish(new Error(message.error.message));
      } else if (message.id === 1) {
        send({ method: "notifications/initialized" });
        send({ id: 2, method: "tools/list" });
      } else if (message.id === 2) {
        finish(undefined, (message.result?.tools ?? []).map((tool: { name: string }) => tool.name));
      }
    });
    send({
      id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "codetour-test", version: "1.0.0" } }
    });
  });
}

test("the embedded Copilot adapter matches the repository sources", () => {
  // The generated module travels inside the CLI bundle; the .mjs files are
  // the readable source of truth and must never diverge from it.
  const sourceDir = path.resolve(__dirname, "../../../.github/extensions/codetour");
  for (const [name, content] of Object.entries(COPILOT_EXTENSION_FILES)) {
    assert.equal(
      readFileSync(path.join(sourceDir, name), "utf8"),
      content,
      `${name} in the bundle diverges from .github/extensions/codetour; run node scripts/embed-copilot-extension.js`
    );
  }
});

test("an install writes the adapter files and repeats without changing anything", () => {
  const workspace = temporaryDirectory("codetour-install-");
  const extensionDir = path.join(workspace, "copilot-extensions");
  try {
    const env = { CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir };
    const first = run(workspace, ["--install", "copilot"], env);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Installed the CodeTour adapter/);
    for (const [name, content] of Object.entries(COPILOT_EXTENSION_FILES)) {
      assert.equal(readFileSync(path.join(extensionDir, name), "utf8"), content);
    }
    const second = run(workspace, ["--install", "copilot"], env);
    assert.equal(second.status, 0, second.stderr);
    for (const [name, content] of Object.entries(COPILOT_EXTENSION_FILES)) {
      assert.equal(readFileSync(path.join(extensionDir, name), "utf8"), content);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an install registers a launchable CodeTour MCP server and keeps foreign servers", () => {
  const workspace = temporaryDirectory("codetour-mcp-register-");
  const extensionDir = path.join(workspace, "copilot-extensions");
  try {
    // A configuration the user already owns: its servers must survive as is.
    writeFileSync(
      path.join(workspace, "mcp-config.json"),
      JSON.stringify({ mcpServers: { other: { command: "other", args: ["serve"] } } }, null, 2) + "\n"
    );
    const env = { CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir };
    const install = run(workspace, ["--install", "copilot"], env);
    assert.equal(install.status, 0, install.stderr);
    assert.match(install.stdout, /Registered the 'codetour' MCP server/);

    const servers = mcpConfig(workspace).mcpServers!;
    assert.deepEqual(servers.other, { command: "other", args: ["serve"] });
    const codetour = servers.codetour as { type?: string; command?: string; args?: string[]; tools?: string[] };
    assert.equal(codetour.type, "local");
    assert.deepEqual(codetour.tools, ["*"]);
    assert.ok(path.isAbsolute(codetour.command!), "the registered command must not depend on PATH");
    assert.equal(codetour.args![codetour.args!.length - 1], "mcp");
    // The entry is a real launch contract, not just a JSON shape.
    const version = spawnSync(codetour.command!, [...codetour.args!, "--version"], {
      cwd: workspace, encoding: "utf8"
    });
    assert.equal(version.status, 0, version.stderr);

    // A correct installation is not rewritten.
    const registered = readFileSync(path.join(workspace, "mcp-config.json"), "utf8");
    assert.equal(run(workspace, ["--install", "copilot"], env).status, 0);
    assert.equal(readFileSync(path.join(workspace, "mcp-config.json"), "utf8"), registered);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("the registered server exposes the creation tools Copilot prefixes with its name", async () => {
  const workspace = temporaryDirectory("codetour-mcp-tools-");
  const extensionDir = path.join(workspace, "copilot-extensions");
  try {
    const installed = run(workspace, ["--install", "copilot"], { CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir });
    assert.equal(installed.status, 0, installed.stderr);
    const codetour = mcpConfig(workspace).mcpServers!.codetour as { command: string; args: string[] };
    const tools = await listRegisteredTools(codetour, workspace);
    // Copilot registers MCP tools as `<server>-<tool>`.
    assert.ok(tools.includes("create_changes_tour"), `tools: ${tools.join(", ")}`);
    assert.ok(tools.includes("create_project_tour"), `tools: ${tools.join(", ")}`);
    // The server key registered above is `codetour`; Copilot prefixes tool
    // names with it, yielding the names the served prompt tells the agent to
    // search. A rename of the server key would silently break that discovery.
    const server = Object.keys(mcpConfig(workspace).mcpServers!).find(name => name === "codetour");
    assert.equal(server, "codetour");
    assert.deepEqual(
      tools.filter(tool => tool.startsWith("create_")).map(tool => `codetour-${tool}`).sort(),
      ["codetour-create_changes_tour", "codetour-create_project_tour"]
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an uninstall leaves a same-named server it did not configure", () => {
  const workspace = temporaryDirectory("codetour-mcp-foreign-entry-");
  const extensionDir = path.join(workspace, "copilot-extensions");
  try {
    const env = { CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir };
    assert.equal(run(workspace, ["--install", "copilot"], env).status, 0);
    const file = path.join(workspace, "mcp-config.json");
    const config = mcpConfig(workspace);
    config.mcpServers!.codetour = { command: "someone-elses-codetour", args: ["--stdio"] };
    writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
    const untouched = readFileSync(file, "utf8");
    const removed = run(workspace, ["--uninstall", "copilot"], env);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(readFileSync(file, "utf8"), untouched, "an unowned same-named entry is preserved");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an install refuses an unreadable MCP configuration instead of losing servers", () => {
  const workspace = temporaryDirectory("codetour-mcp-invalid-");
  const extensionDir = path.join(workspace, "copilot-extensions");
  try {
    const invalid = '{ "mcpServers": { "other": ';
    writeFileSync(path.join(workspace, "mcp-config.json"), invalid);
    const installed = run(workspace, ["--install", "copilot"], { CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir });
    assert.notEqual(installed.status, 0);
    assert.match(installed.stderr, /not valid JSON/);
    assert.equal(
      readFileSync(path.join(workspace, "mcp-config.json"), "utf8"),
      invalid,
      "the unreadable file is left exactly as it was"
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("the agent diagnostics report a missing MCP registration", () => {
  const workspace = temporaryDirectory("codetour-mcp-status-");
  const extensionDir = path.join(workspace, "copilot-extensions");
  try {
    const env = { CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir };
    assert.equal(run(workspace, ["--install", "copilot"], env).status, 0);
    const file = path.join(workspace, "mcp-config.json");
    const config = mcpConfig(workspace);
    delete config.mcpServers!.codetour;
    writeFileSync(file, JSON.stringify(config) + "\n");

    const agents = run(workspace, ["--agents"], env);
    assert.equal(agents.status, 0, agents.stderr);
    assert.match(agents.stdout, /copilot\tGitHub Copilot CLI/);
    assert.match(agents.stdout, /incomplete/);
    assert.match(agents.stdout, /codetour --install copilot/);

    const doctor = run(workspace, ["--doctor"], env);
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.match(doctor.stdout, /copilot: .*integration incomplete/);

    // A registration that depends on PATH is not the launcher this install
    // verified: it is reported so the user re-runs the install rather than
    // discovering a stale or missing CLI at generation time.
    const installed = mcpConfig(workspace);
    installed.mcpServers!.codetour = { type: "local", command: "codetour", args: ["mcp"], tools: ["*"] };
    writeFileSync(file, JSON.stringify(installed, null, 2) + "\n");
    const drifted = run(workspace, ["--agents"], env);
    assert.equal(drifted.status, 0, drifted.stderr);
    assert.match(drifted.stdout, /outdated/);
    assert.match(drifted.stdout, /codetour --install copilot/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a differing adapter is replaced on install", () => {
  const workspace = temporaryDirectory("codetour-conflict-");
  const extensionDir = path.join(workspace, "copilot-extensions");
  try {
    const env = { CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir };
    assert.equal(run(workspace, ["--install", "copilot"], env).status, 0);
    writeFileSync(path.join(extensionDir, "extension.mjs"), "// a pre-existing custom installation\n");
    const replaced = run(workspace, ["--install", "copilot"], env);
    assert.equal(replaced.status, 0, replaced.stderr);
    assert.match(replaced.stdout, /Replaced differing adapter files/);
    assert.equal(
      readFileSync(path.join(extensionDir, "extension.mjs"), "utf8"),
      COPILOT_EXTENSION_FILES["extension.mjs"],
      "install restored the adapter of this CLI"
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an uninstall removes only the files this installation owns", () => {
  const workspace = temporaryDirectory("codetour-uninstall-");
  const extensionDir = path.join(workspace, "copilot-extensions");
  try {
    const env = { CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir };
    assert.equal(run(workspace, ["--install", "copilot"], env).status, 0);
    writeFileSync(path.join(extensionDir, "other.mjs"), "// a foreign file this CLI never installed\n");
    const removed = run(workspace, ["--uninstall", "copilot"], env);
    assert.equal(removed.status, 0, removed.stderr);
    assert.ok(!existsSync(path.join(extensionDir, "adapter.mjs")));
    assert.ok(!existsSync(path.join(extensionDir, "extension.mjs")));
    assert.equal(
      readFileSync(path.join(extensionDir, "other.mjs"), "utf8"),
      "// a foreign file this CLI never installed\n",
      "files outside this installation were left untouched"
    );
    // A modified managed file blocks the uninstall instead of deleting user work.
    assert.equal(run(workspace, ["--install", "copilot"], env).status, 0);
    writeFileSync(path.join(extensionDir, "adapter.mjs"), "// edited by the user\n");
    const blocked = run(workspace, ["--uninstall", "copilot"], env);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /left untouched/);
    assert.equal(readFileSync(path.join(extensionDir, "adapter.mjs"), "utf8"), "// edited by the user\n");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an unsupported agent is explicit and an install works outside a Git worktree", () => {
  const workspace = temporaryDirectory("codetour-agents-");
  try {
    const unsupported = run(workspace, ["--install", "xxxxx"]);
    assert.notEqual(unsupported.status, 0);
    assert.match(unsupported.stderr, /Unsupported agent: xxxxx/);
    assert.match(unsupported.stderr, /Available agents: copilot, vscode/);
    // --agents reports every registered agent without failing on machines
    // where an agent CLI is missing.
    const agents = run(workspace, ["--agents"]);
    assert.equal(agents.status, 0, agents.stderr);
    assert.match(agents.stdout, /copilot\tGitHub Copilot CLI/);
    assert.match(agents.stdout, /vscode\tVisual Studio Code/);
    const doctor = run(workspace, ["--doctor"]);
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.match(doctor.stdout, /git/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
