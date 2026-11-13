import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
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
      if (error) {
        reject(error);
        return;
      }
      // Windows releases the child's working-directory handle on exit, not on
      // kill(); the caller removes that temporary directory next. Wait for the
      // exit before resolving so the cleanup cannot race the server process.
      if (child.exitCode !== null) resolve(tools!);
      else child.once("exit", () => resolve(tools!));
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
    // Windows may still hold the temp directory for a moment after the child
    // exits; retry the cleanup instead of failing the test on EPERM.
    rmSync(workspace, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
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
    // A foreign server named `codetour` that merely ends in an `mcp` token:
    // the ownership rule is the exact entry this CLI writes or the documented
    // `codetour mcp` launcher, never "any local server whose last argument is
    // mcp". Removing it would destroy another installation's registration.
    config.mcpServers!.codetour = { type: "local", command: "someone-elses-codetour", args: ["--stdio", "mcp"], tools: ["*"] };
    writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
    const untouched = readFileSync(file, "utf8");
    const removed = run(workspace, ["--uninstall", "copilot"], env);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(readFileSync(file, "utf8"), untouched, "an unowned same-named entry is preserved");

    // The documented launcher is owned even when another installation wrote
    // it: `codetour mcp` is the stable launch contract of this CLI.
    config.mcpServers!.codetour = { type: "local", command: "codetour", args: ["mcp"], tools: ["*"] };
    writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
    assert.equal(run(workspace, ["--uninstall", "copilot"], env).status, 0);
    assert.equal(mcpConfig(workspace).mcpServers!.codetour, undefined, "the documented launcher entry is removed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an install leaves a reordered registration untouched and reports it installed", () => {
  const workspace = temporaryDirectory("codetour-mcp-reordered-");
  const extensionDir = path.join(workspace, "copilot-extensions");
  try {
    const env = { CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir };
    assert.equal(run(workspace, ["--install", "copilot"], env).status, 0);
    const file = path.join(workspace, "mcp-config.json");
    const config = mcpConfig(workspace);
    const entry = config.mcpServers!.codetour as { type?: string; command: string; args: string[]; tools: string[] };
    // The same entry with its keys in another order: JSON key order is not a
    // different installation, so the file must not be rewritten.
    config.mcpServers!.codetour = { tools: entry.tools, args: entry.args, command: entry.command, type: entry.type };
    writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
    const reordered = readFileSync(file, "utf8");
    const again = run(workspace, ["--install", "copilot"], env);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /already registered/);
    assert.equal(readFileSync(file, "utf8"), reordered, "a reordered identical entry is not rewritten");
    const installed = run(workspace, ["--doctor"], env);
    assert.match(installed.stdout, /integration installed\./, "a reordered entry is current");

    // `type` may be omitted: Copilot's local default is the type this CLI
    // writes, so the entry is still identical.
    delete entry.type;
    writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
    const implicit = run(workspace, ["--install", "copilot"], env);
    assert.equal(implicit.status, 0, implicit.stderr);
    assert.match(implicit.stdout, /already registered/);
    assert.match(run(workspace, ["--doctor"], env).stdout, /integration installed\./);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an unreadable MCP configuration is reported with its path and left untouched", () => {
  const workspace = temporaryDirectory("codetour-mcp-unreadable-");
  const extensionDir = path.join(workspace, "copilot-extensions");
  try {
    // A directory where the file belongs makes the read fail with a real I/O
    // error other than ENOENT: it must never be mistaken for "no
    // configuration yet" and silently replaced.
    const configFile = path.join(workspace, "mcp-config.json");
    mkdirSync(configFile);
    const env = { CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir };
    const installed = run(workspace, ["--install", "copilot"], env);
    assert.notEqual(installed.status, 0);
    assert.match(installed.stderr, /Could not read/);
    assert.ok(installed.stderr.includes(configFile), "the error names the file to fix");
    assert.match(installed.stderr, /left untouched/);
    assert.ok(!existsSync(extensionDir), "no adapter file is installed when the configuration cannot be read");
    assert.ok(existsSync(configFile), "the unreadable path is left in place");

    // Diagnostics report the cause instead of claiming there is no
    // configuration at all.
    const agents = run(workspace, ["--agents"], env);
    assert.equal(agents.status, 0, agents.stderr);
    assert.ok(agents.stdout.includes(configFile));
    assert.match(agents.stdout, /Could not read/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an unlaunchable MCP launcher is rejected before any adapter file is written", () => {
  const workspace = temporaryDirectory("codetour-launcher-unverified-");
  const extensionDir = path.join(workspace, "copilot-extensions");
  const bundle = path.join(path.dirname(cli), `codetour-cli-unverified-${process.pid}-${process.hrtime.bigint()}`);
  try {
    // Without a `.js` extension the running CLI resolves to the documented
    // `codetour mcp` launcher; an empty PATH makes that launcher unverifiable.
    // The copy sits beside the real bundle so its runtime and module siblings
    // resolve exactly as the installed artifact does.
    copyFileSync(cli, bundle);
    const emptyBin = path.join(workspace, "empty-bin");
    mkdirSync(emptyBin);
    mkdirSync(extensionDir);
    const custom = "// a pre-existing custom installation\n";
    writeFileSync(path.join(extensionDir, "extension.mjs"), custom);
    const installed = spawnSync(process.execPath, [bundle, "--install", "copilot"], {
      cwd: workspace, encoding: "utf8",
      env: {
        ...process.env,
        PATH: emptyBin,
        CODETOUR_COPILOT_MCP_CONFIG: path.join(workspace, "mcp-config.json"),
        CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir
      }
    });
    assert.notEqual(installed.status, 0);
    assert.match(installed.stderr, /launch contract could not be verified/);
    // The launcher is verified before the first write: a failed install leaves
    // the previous adapter exactly as it was.
    assert.equal(
      readFileSync(path.join(extensionDir, "extension.mjs"), "utf8"),
      custom,
      "an existing adapter file is untouched when the launcher cannot be verified"
    );
    assert.ok(
      !existsSync(path.join(extensionDir, "adapter.mjs")),
      "no adapter file is created when the launcher cannot be verified"
    );
  } finally {
    rmSync(bundle, { force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a failed MCP registration restores the previous adapter files", () => {
  const workspace = temporaryDirectory("codetour-install-rollback-");
  const extensionDir = path.join(workspace, "copilot-extensions");
  const configFile = path.join(workspace, "mcp-config.json");
  try {
    // Root ignores the permission bits, so the write failure cannot be
    // simulated there.
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    mkdirSync(extensionDir);
    const custom = "// a pre-existing custom installation\n";
    writeFileSync(path.join(extensionDir, "extension.mjs"), custom);
    // A readable but not writable configuration: the registration is the last
    // step of the install and fails after the adapter files were written.
    writeFileSync(configFile, JSON.stringify({ mcpServers: { other: { command: "other", args: ["serve"] } } }, null, 2) + "\n");
    chmodSync(configFile, 0o444);
    const before = readFileSync(configFile, "utf8");
    const installed = run(workspace, ["--install", "copilot"], { CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir });
    assert.notEqual(installed.status, 0);
    assert.match(installed.stderr, /EACCES|permission/i);
    assert.equal(readFileSync(configFile, "utf8"), before, "the user configuration is unchanged");
    assert.equal(
      readFileSync(path.join(extensionDir, "extension.mjs"), "utf8"),
      custom,
      "the replaced adapter file is restored to its previous content"
    );
    assert.ok(
      !existsSync(path.join(extensionDir, "adapter.mjs")),
      "an adapter file created by the failed install is removed again"
    );
  } finally {
    try { chmodSync(configFile, 0o644); } catch { /* already removed or writable */ }
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
    // The user configuration is read before any adapter file is written, so a
    // refused install never leaves half an installation behind.
    assert.ok(!existsSync(extensionDir), "no adapter file is installed when the configuration is refused");
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
