import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync,
  statSync, writeFileSync
} from "node:fs";
import * as os from "os";
import * as path from "path";
import { COPILOT_EXTENSION_FILES } from "./copilot-extension.generated";
import { COPILOT_PLUGIN_FILES } from "./copilot-plugin.generated";

const cli = path.resolve(__dirname, "../../cli.js");

function temporaryDirectory(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Agent commands are machine-level actions: they must work outside any Git
// worktree, so every run uses an empty temporary directory as its workspace.
function agentEnvironment(cwd: string, overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // COPILOT_HOME redirects the user directory itself, so the retired-skill
    // removal never reads or deletes the real ~/.copilot/skills directory.
    COPILOT_HOME: path.join(cwd, "copilot-home"),
    CODETOUR_COPILOT_MCP_CONFIG: path.join(cwd, "mcp-config.json"),
    CODETOUR_COPILOT_EXTENSIONS_DIR: path.join(cwd, "copilot-extensions"),
    // The Agent Plugins 1.0 directory is installed directly in tests: the
    // real `copilot plugin install` is exercised by
    // test/copilot-plugin-install.test.mjs against the installed CLI.
    CODETOUR_COPILOT_PLUGIN_DIR: path.join(cwd, "copilot-plugin"),
    // Same for Pi: the package and its declaration stay in the workspace.
    PI_CODING_AGENT_DIR: path.join(cwd, "pi-agent"),
    ...overrides
  };
}

function run(cwd: string, args: string[], overrides: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: "utf8", env: agentEnvironment(cwd, overrides)
  });
}

// The picker only runs on a terminal, which no test runner provides. The
// repository already drives its terminal surfaces through a Python
// pseudo-terminal (`test/standalone-terminal-smoke.py`); the same helper
// answers the picker. A host without `python3` skips the run.
const ptyDriver = path.resolve(__dirname, "../../../test/agent-picker-pty.py");
const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
const ptySkip = python.status === 0 ? false : "python3 is not available for a pseudo-terminal run";

// Answer the picker at a real terminal: the transcript carries both the
// offered list and the outcome of the install.
function answerPicker(cwd: string, answer: string) {
  return spawnSync("python3", [ptyDriver, process.execPath, cli, answer], {
    cwd, encoding: "utf8", timeout: 180000, env: agentEnvironment(cwd)
  });
}

function pluginDirectory(workspace: string): string {
  return path.join(workspace, "copilot-plugin");
}

function extensionDirectory(workspace: string): string {
  return path.join(workspace, "copilot-extensions");
}

// Every file under a managed directory: an install that leaves a current
// installation alone changes neither the list nor the timestamps.
function managedFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? managedFiles(entryPath) : [entryPath];
  }).sort();
}

function skillFile(workspace: string): string {
  return path.join(workspace, "copilot-home", "skills", "codetour-knowledge", "SKILL.md");
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

test("an install removes a leftover standalone Knowledge skill and preserves foreign skills", () => {
  const workspace = temporaryDirectory("codetour-skill-retired-");
  try {
    // A copy an older CLI wrote before the skill was retired, next to a skill
    // the plugin knows nothing about.
    mkdirSync(path.dirname(skillFile(workspace)), { recursive: true });
    writeFileSync(skillFile(workspace), "---\nname: codetour-knowledge\n---\nan older installment\n");
    const foreign = path.join(workspace, "copilot-home", "skills", "other-skill", "SKILL.md");
    mkdirSync(path.dirname(foreign), { recursive: true });
    writeFileSync(foreign, "---\nname: other-skill\n---\nforeign\n");

    const installed = run(workspace, ["--install", "copilot"]);
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(installed.stdout, /Removed the retired standalone Knowledge skill/);
    assert.ok(!existsSync(skillFile(workspace)), "the retired skill is not installed again");
    assert.ok(!existsSync(path.dirname(skillFile(workspace))), "its empty directory is removed too");
    assert.equal(readFileSync(foreign, "utf8"), "---\nname: other-skill\n---\nforeign\n");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an uninstall removes a leftover standalone Knowledge skill too", () => {
  const workspace = temporaryDirectory("codetour-skill-uninstall-");
  try {
    assert.equal(run(workspace, ["--install", "copilot"]).status, 0);
    mkdirSync(path.dirname(skillFile(workspace)), { recursive: true });
    writeFileSync(skillFile(workspace), "---\nname: codetour-knowledge\n---\nan older installment\n");
    const foreign = path.join(workspace, "copilot-home", "skills", "other-skill", "SKILL.md");
    mkdirSync(path.dirname(foreign), { recursive: true });
    writeFileSync(foreign, "---\nname: other-skill\n---\nforeign\n");

    const removed = run(workspace, ["--uninstall", "copilot"]);
    assert.equal(removed.status, 0, removed.stderr);
    assert.match(removed.stdout, /Removed the retired standalone Knowledge skill/);
    assert.ok(!existsSync(skillFile(workspace)), "the retired skill is removed with the integration");
    assert.equal(readFileSync(foreign, "utf8"), "---\nname: other-skill\n---\nforeign\n");
    assert.ok(!existsSync(path.join(workspace, "copilot-extensions", "extension.mjs")), "owned adapter files are removed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an install writes the Agent Plugins 1.0 plugin and keeps foreign servers", () => {
  const workspace = temporaryDirectory("codetour-plugin-install-");
  try {
    // A configuration the user already owns: its servers must survive as is.
    writeFileSync(
      path.join(workspace, "mcp-config.json"),
      JSON.stringify({
        mcpServers: {
          other: { command: "other", args: ["serve"] },
          codetour: { type: "local", command: "codetour", args: ["mcp"], tools: ["*"] }
        }
      }, null, 2) + "\n"
    );
    const install = run(workspace, ["--install", "copilot"]);
    assert.equal(install.status, 0, install.stderr);
    assert.match(install.stdout, /Installed the CodeTour plugin/);
    assert.match(install.stdout, /Removed the legacy 'codetour' MCP server/);

    for (const [name, content] of Object.entries(COPILOT_PLUGIN_FILES)) {
      if (name === "mcp.json") continue;
      assert.equal(readFileSync(path.join(pluginDirectory(workspace), ...name.split("/")), "utf8"), content);
    }
    // The installed mcp.json carries the verified absolute launcher of the CLI
    // that performed the install, not a PATH-dependent command.
    const installedMcp = JSON.parse(readFileSync(path.join(pluginDirectory(workspace), "mcp.json"), "utf8"));
    assert.equal(installedMcp.mcpServers.codetour.type, "stdio");
    assert.equal(installedMcp.mcpServers.codetour.command, process.execPath);
    assert.deepEqual(
      installedMcp.mcpServers.codetour.args,
      [cli, "mcp", "--workspace-root", "${COPILOT_SESSION_CWD}"]
    );
    const servers = mcpConfig(workspace).mcpServers!;
    assert.deepEqual(servers.other, { command: "other", args: ["serve"] });
    assert.equal(servers.codetour, undefined, "the legacy entry this CLI wrote is removed");

    // A correct installation is not rewritten.
    const pluginFile = path.join(pluginDirectory(workspace), "plugin.json");
    const before = readFileSync(pluginFile, "utf8");
    assert.equal(run(workspace, ["--install", "copilot"]).status, 0);
    assert.equal(readFileSync(pluginFile, "utf8"), before);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an install preserves a same-named MCP server it did not configure", () => {
  const workspace = temporaryDirectory("codetour-plugin-foreign-entry-");
  try {
    const file = path.join(workspace, "mcp-config.json");
    const foreign = { type: "local", command: "someone-elses-codetour", args: ["--stdio", "mcp"], tools: ["*"] };
    writeFileSync(file, JSON.stringify({ mcpServers: { codetour: foreign } }, null, 2) + "\n");
    const before = readFileSync(file, "utf8");
    const installed = run(workspace, ["--install", "copilot"]);
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(readFileSync(file, "utf8"), before, "a foreign same-named entry is never rewritten");
    const agents = run(workspace, ["--agents"]);
    assert.match(agents.stdout, /same-named 'codetour' server/);
    assert.match(agents.stdout, /preserved/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("the plugin declares one workspace-scoped CodeTour MCP server exposing the creation tools", async () => {
  const workspace = temporaryDirectory("codetour-plugin-mcp-");
  try {
    const installed = run(workspace, ["--install", "copilot"]);
    assert.equal(installed.status, 0, installed.stderr);
    const manifest = JSON.parse(readFileSync(path.join(pluginDirectory(workspace), "mcp.json"), "utf8"));
    assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
    assert.deepEqual(Object.keys(manifest.mcpServers), ["codetour"], "exactly one server is declared");
    assert.equal(manifest.mcpServers.codetour.type, "stdio");
    assert.equal(manifest.mcpServers.codetour.command, process.execPath);
    assert.deepEqual(
      manifest.mcpServers.codetour.args,
      [cli, "mcp", "--workspace-root", "${COPILOT_SESSION_CWD}"]
    );
    // The declaration is a real launch contract: resolve the session-cwd token
    // against the current CLI bundle and list the tools Copilot would see.
    const tools = await listRegisteredTools({
      command: process.execPath,
      args: [cli, "mcp", "--workspace-root", workspace]
    }, workspace);
    assert.ok(tools.includes("create_project_tour"), `tools: ${tools.join(", ")}`);
    assert.ok(tools.includes("create_changes_tour"), `tools: ${tools.join(", ")}`);
    assert.ok(!tools.some(tool => tool.startsWith("knowledge_")), `tools: ${tools.join(", ")}`);
  } finally {
    rmSync(workspace, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  }
});

test("an uninstall removes the plugin and preserves a foreign same-named server", () => {
  const workspace = temporaryDirectory("codetour-plugin-uninstall-");
  try {
    assert.equal(run(workspace, ["--install", "copilot"]).status, 0);
    assert.ok(existsSync(path.join(pluginDirectory(workspace), "plugin.json")));
    const file = path.join(workspace, "mcp-config.json");
    const foreign = { type: "local", command: "someone-elses-codetour", args: ["--stdio", "mcp"], tools: ["*"] };
    writeFileSync(file, JSON.stringify({ mcpServers: { codetour: foreign } }, null, 2) + "\n");
    const before = readFileSync(file, "utf8");
    const removed = run(workspace, ["--uninstall", "copilot"]);
    assert.equal(removed.status, 0, removed.stderr);
    assert.ok(!existsSync(path.join(pluginDirectory(workspace), "plugin.json")), "the owned plugin files are removed");
    assert.equal(readFileSync(file, "utf8"), before, "the unowned same-named entry is preserved");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an uninstall preserves plugin files edited by the user", () => {
  const workspace = temporaryDirectory("codetour-plugin-uninstall-edited-");
  try {
    assert.equal(run(workspace, ["--install", "copilot"]).status, 0);
    const edited = path.join(pluginDirectory(workspace), "mcp.json");
    writeFileSync(edited, "// edited by the user\n");
    const foreign = path.join(pluginDirectory(workspace), "notes", "mine.txt");
    mkdirSync(path.dirname(foreign), { recursive: true });
    writeFileSync(foreign, "user notes\n");
    const removed = run(workspace, ["--uninstall", "copilot"]);
    assert.equal(removed.status, 0, removed.stderr);
    assert.match(removed.stdout, /Left mcp.json .* untouched/);
    assert.equal(readFileSync(edited, "utf8"), "// edited by the user\n");
    assert.equal(readFileSync(foreign, "utf8"), "user notes\n", "foreign files in the managed directory are preserved");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an unreadable MCP configuration is reported and left untouched while the plugin installs", () => {
  const workspace = temporaryDirectory("codetour-plugin-mcp-unreadable-");
  try {
    // A directory where the file belongs makes the legacy cleanup fail with a
    // real I/O error other than ENOENT: it must never be mistaken for "no
    // configuration yet" and silently replaced.
    const configFile = path.join(workspace, "mcp-config.json");
    mkdirSync(configFile);
    const installed = run(workspace, ["--install", "copilot"]);
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(installed.stdout, /Left .*mcp-config\.json untouched/);
    assert.ok(existsSync(configFile), "the unreadable path is left in place");
    assert.ok(existsSync(path.join(pluginDirectory(workspace), "plugin.json")), "the plugin is still installed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an unlaunchable plugin MCP launcher is rejected before any adapter file is written", () => {
  const workspace = temporaryDirectory("codetour-plugin-launcher-unverified-");
  const bundle = path.join(path.dirname(cli), `codetour-cli-unverified-${process.pid}-${process.hrtime.bigint()}`);
  try {
    // A runtime whose script path cannot be resolved falls back to the
    // documented `codetour mcp` launcher; an empty PATH makes it unverifiable.
    copyFileSync(cli, bundle);
    const runner = path.join(workspace, "unresolved-runner.js");
    writeFileSync(runner, [
      `process.argv[1] = ${JSON.stringify(path.join(workspace, "missing-cli.js"))};`,
      `require(${JSON.stringify(bundle)});`
    ].join("\n"));
    const emptyBin = path.join(workspace, "empty-bin");
    mkdirSync(emptyBin);
    const custom = "// a pre-existing custom installation\n";
    mkdirSync(path.join(workspace, "copilot-extensions"));
    writeFileSync(path.join(workspace, "copilot-extensions", "extension.mjs"), custom);
    const installed = spawnSync(process.execPath, [runner, "--install", "copilot"], {
      cwd: workspace, encoding: "utf8",
      env: {
        ...process.env,
        PATH: emptyBin,
        COPILOT_HOME: path.join(workspace, "copilot-home"),
        CODETOUR_COPILOT_MCP_CONFIG: path.join(workspace, "mcp-config.json"),
        CODETOUR_COPILOT_EXTENSIONS_DIR: path.join(workspace, "copilot-extensions"),
        CODETOUR_COPILOT_PLUGIN_DIR: pluginDirectory(workspace)
      }
    });
    assert.notEqual(installed.status, 0);
    assert.match(installed.stderr, /launch contract could not be verified/);
    assert.equal(
      readFileSync(path.join(workspace, "copilot-extensions", "extension.mjs"), "utf8"),
      custom,
      "an existing adapter file is untouched when the launcher cannot be verified"
    );
    assert.ok(!existsSync(path.join(workspace, "copilot-extensions", "adapter.mjs")));
    assert.ok(!existsSync(path.join(pluginDirectory(workspace), "plugin.json")));
  } finally {
    rmSync(bundle, { force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a failed plugin installation restores the previous adapter and skill", () => {
  const workspace = temporaryDirectory("codetour-plugin-rollback-");
  const extensionDir = path.join(workspace, "copilot-extensions");
  try {
    mkdirSync(extensionDir);
    const custom = "// a pre-existing custom installation\n";
    writeFileSync(path.join(extensionDir, "extension.mjs"), custom);
    // A file where the managed plugin directory belongs makes the last write
    // fail after the adapter files were installed.
    writeFileSync(pluginDirectory(workspace), "not a directory\n");
    const installed = run(workspace, ["--install", "copilot"], { CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir });
    assert.notEqual(installed.status, 0);
    assert.equal(
      readFileSync(path.join(extensionDir, "extension.mjs"), "utf8"),
      custom,
      "the replaced adapter file is restored to its previous content"
    );
    assert.ok(!existsSync(path.join(extensionDir, "adapter.mjs")), "an adapter file created by the failed install is removed");
    assert.equal(readFileSync(pluginDirectory(workspace), "utf8"), "not a directory\n", "the user path is untouched");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("`--agents` and `--doctor` report an absent host with the command that installs it", () => {
  const workspace = temporaryDirectory("codetour-agents-absent-");
  const emptyPath = path.join(workspace, "empty-path");
  mkdirSync(emptyPath, { recursive: true });
  try {
    const agents = run(workspace, ["--agents"], { PATH: emptyPath });
    assert.equal(agents.status, 0, agents.stderr);
    for (const id of ["copilot", "pi", "vscode"]) {
      assert.match(agents.stdout, new RegExp(`^  absent: .*'codetour --install ${id}'`, "m"));
    }
    const doctor = run(workspace, ["--doctor"], { PATH: emptyPath });
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.match(doctor.stdout, /^copilot: absent\. /m);
    assert.match(doctor.stdout, /^pi: absent\. /m);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a host that cannot host the integration is reported incompatible and installs nothing", {
  skip: process.platform === "win32"
}, () => {
  const workspace = temporaryDirectory("codetour-agents-incompatible-");
  const bin = path.join(workspace, "bin");
  mkdirSync(bin);
  try {
    // A Copilot CLI old enough to answer --version but without the `plugin`
    // command: the host exists, it cannot host an Agent Plugins 1.0 plugin.
    const copilot = path.join(bin, "copilot");
    writeFileSync(copilot, [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then echo 'GitHub Copilot CLI 0.0.4.'; exit 0; fi",
      "exit 64"
    ].join("\n") + "\n");
    chmodSync(copilot, 0o755);
    const env = {
      PATH: bin + path.delimiter + (process.env.PATH ?? ""),
      COPILOT_HOME: path.join(workspace, "copilot-home"),
      CODETOUR_COPILOT_MCP_CONFIG: path.join(workspace, "mcp-config.json"),
      CODETOUR_COPILOT_EXTENSIONS_DIR: path.join(workspace, "copilot-extensions"),
      // No managed plugin override: the real prerequisite decides.
      CODETOUR_COPILOT_PLUGIN_DIR: "",
      PI_CODING_AGENT_DIR: path.join(workspace, "pi-agent")
    };
    const runCli = (args: string[]) => spawnSync(process.execPath, [cli, ...args], {
      cwd: workspace, encoding: "utf8", env: { ...process.env, ...env }
    });
    const agents = runCli(["--agents"]);
    assert.equal(agents.status, 0, agents.stderr);
    assert.match(agents.stdout, /^  incompatible: .*has no 'plugin' command/m);
    const installed = runCli(["--install", "copilot"]);
    assert.equal(installed.status, 1);
    assert.match(installed.stderr, /has no 'plugin' command/);
    assert.ok(!existsSync(path.join(workspace, "copilot-extensions")), "nothing was written");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("the agent diagnostics report a missing plugin and a legacy duplicate", () => {
  const workspace = temporaryDirectory("codetour-plugin-status-");
  try {
    assert.equal(run(workspace, ["--install", "copilot"]).status, 0);
    rmSync(pluginDirectory(workspace), { recursive: true, force: true });

    const agents = run(workspace, ["--agents"]);
    assert.equal(agents.status, 0, agents.stderr);
    assert.match(agents.stdout, /copilot\tGitHub Copilot CLI/);
    assert.match(agents.stdout, /pi\tPi coding agent/);
    assert.match(agents.stdout, /incomplete/);
    assert.match(agents.stdout, /plugin is missing/);
    assert.match(run(workspace, ["--doctor"]).stdout, /^copilot: incomplete\. /m);

    assert.equal(run(workspace, ["--install", "copilot"]).status, 0);
    const file = path.join(workspace, "mcp-config.json");
    writeFileSync(file, JSON.stringify({ mcpServers: { codetour: { type: "local", command: "codetour", args: ["mcp"], tools: ["*"] } } }, null, 2) + "\n");
    const drifted = run(workspace, ["--agents"]);
    assert.equal(drifted.status, 0, drifted.stderr);
    assert.match(drifted.stdout, /outdated/);
    assert.match(drifted.stdout, /duplicates the plugin's server/);
    const repaired = run(workspace, ["--install", "copilot"]);
    assert.equal(repaired.status, 0, repaired.stderr);
    assert.equal(mcpConfig(workspace).mcpServers!.codetour, undefined);
    assert.match(run(workspace, ["--doctor"]).stdout, /^copilot: installed\. /m);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a repair install rewrites nothing that is already current", async () => {
  const workspace = temporaryDirectory("codetour-idempotent with spaces-");
  try {
    assert.equal(run(workspace, ["--install", "copilot"]).status, 0);
    // A legacy entry this CLI owns makes the Copilot integration outdated while
    // every installed file is current: the repair must touch the configuration
    // and leave the files alone.
    writeFileSync(
      path.join(workspace, "mcp-config.json"),
      JSON.stringify({ mcpServers: { codetour: { type: "local", command: "codetour", args: ["mcp"], tools: ["*"] } } }, null, 2) + "\n"
    );
    const files = () => [
      ...managedFiles(extensionDirectory(workspace)),
      ...managedFiles(pluginDirectory(workspace))
    ];
    const before = files().map(file => [file, statSync(file).mtimeMs]);
    assert.ok(before.length > 0, "the install wrote its files");
    // Filesystem timestamps are coarse on some filesystems: a rewrite in the
    // same tick as the first install would be invisible.
    await new Promise(resolve => setTimeout(resolve, 100));

    const repaired = run(workspace, ["--install", "copilot"]);
    assert.equal(repaired.status, 0, repaired.stderr);
    assert.equal(mcpConfig(workspace).mcpServers!.codetour, undefined, "the legacy entry was repaired");
    assert.deepEqual(files().map(file => [file, statSync(file).mtimeMs]), before, "no current file is rewritten");
    assert.deepEqual(files(), before.map(([file]) => file), "no file is duplicated");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a repair install of a missing Pi declaration keeps the package files", async () => {
  const workspace = temporaryDirectory("codetour-idempotent-pi-");
  try {
    assert.equal(run(workspace, ["--install", "pi"]).status, 0);
    const packageDirectory = path.join(workspace, "pi-agent", "packages", "codetour-plugin");
    const before = managedFiles(packageDirectory).map(file => [file, statSync(file).mtimeMs]);
    await new Promise(resolve => setTimeout(resolve, 100));
    // The declaration is what drifted, not the package.
    writeFileSync(path.join(workspace, "pi-agent", "settings.json"), "{}\n");
    const repaired = run(workspace, ["--install", "pi"]);
    assert.equal(repaired.status, 0, repaired.stderr);
    assert.deepEqual(
      managedFiles(packageDirectory).map(file => [file, statSync(file).mtimeMs]), before,
      "no current package file is rewritten"
    );
    const settings = JSON.parse(readFileSync(path.join(workspace, "pi-agent", "settings.json"), "utf8"));
    assert.deepEqual(settings.packages, [path.resolve(packageDirectory)], "the declaration is written once");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("install, report and uninstall work in a path containing spaces", () => {
  const workspace = temporaryDirectory("codetour paths with spaces-");
  try {
    const installed = run(workspace, ["--install", "pi"]);
    assert.equal(installed.status, 0, installed.stderr);
    assert.ok(existsSync(path.join(workspace, "pi-agent", "packages", "codetour-plugin", "package.json")));
    const agents = run(workspace, ["--agents"]);
    assert.match(agents.stdout, /^pi\tPi coding agent$/m);
    assert.match(agents.stdout, /^  installed: .*with spaces/m);
    const removed = run(workspace, ["--uninstall", "pi"]);
    assert.equal(removed.status, 0, removed.stderr);
    assert.ok(!existsSync(path.join(workspace, "pi-agent", "packages", "codetour-plugin")));
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

test("vscode stays a valid explicit agent outside the generation picker", () => {
  const workspace = temporaryDirectory("codetour-agents-vscode-");
  const emptyPath = path.join(workspace, "empty-path");
  mkdirSync(emptyPath, { recursive: true });
  try {
    // Naming the reader integration is accepted; only its missing host stops
    // it, never the fact that the picker does not offer it.
    const installed = run(workspace, ["--install", "vscode"], { PATH: emptyPath });
    assert.equal(installed.status, 1);
    assert.doesNotMatch(installed.stderr, /Unsupported agent/);
    assert.match(installed.stderr, /'code' command was not found on PATH/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an agent named explicitly is installed even when the batch excludes it", () => {
  const workspace = temporaryDirectory("codetour-agents-disabled-explicit-");
  try {
    const installed = run(workspace, ["--install", "pi"], { CODETOUR_DISABLE_AGENTS: "pi,vscode" });
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(installed.stdout, /^  pi: installed$/m);
    assert.ok(existsSync(path.join(workspace, "pi-agent", "packages", "codetour-plugin", "package.json")));
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
    assert.match(unsupported.stderr, /Available agents: copilot, pi, vscode/);
    // --agents reports every registered agent without failing on machines
    // where an agent CLI is missing.
    const agents = run(workspace, ["--agents"]);
    assert.equal(agents.status, 0, agents.stderr);
    assert.match(agents.stdout, /copilot\tGitHub Copilot CLI/);
    assert.match(agents.stdout, /pi\tPi coding agent/);
    assert.match(agents.stdout, /vscode\tVisual Studio Code/);
    const doctor = run(workspace, ["--doctor"]);
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.match(doctor.stdout, /git/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("--install all installs every compatible agent and reports the rest", () => {
  const workspace = temporaryDirectory("codetour-agents-install-all-");
  try {
    // VS Code is excluded: a batch must never install an extension into the
    // developer's real editor from a test.
    const result = run(workspace, ["--install", "all"], { CODETOUR_DISABLE_AGENTS: "vscode" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Agent integrations:$/m);
    assert.match(result.stdout, /^  copilot: (installed|already-installed|skipped)/m);
    assert.match(result.stdout, /^  pi: (installed|already-installed|skipped)/m);
    assert.doesNotMatch(result.stdout, /vscode/, "a disabled agent takes no part in the batch");
    // Whatever the machine has, every agent the batch reports as `installed`
    // left its files behind. A `skipped` line carries the reason for it in
    // parentheses (`skipped (The 'pi' command was not found on PATH.)`), so the
    // outcome is matched on the result token alone: a machine with neither
    // agent CLI must not be read as "an agent was installed".
    const installed = (agent: string) =>
      new RegExp(`^  ${agent}: installed$`, "m").test(result.stdout);
    if (installed("copilot") || installed("pi")) {
      assert.ok(
        existsSync(path.join(workspace, "copilot-plugin", "plugin.json")) ||
          existsSync(path.join(workspace, "pi-agent", "packages", "codetour-plugin", "package.json")),
        "an agent reported installed, so its files must exist in the workspace"
      );
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("--install without a value and without a terminal names the alternatives and installs nothing", () => {
  const workspace = temporaryDirectory("codetour-agents-install-no-terminal-");
  try {
    // piped stdin is not a terminal: the picker cannot ask, and installing
    // every agent instead would decide for the caller.
    const result = run(workspace, ["--install"], { CODETOUR_DISABLE_AGENTS: "vscode" });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /Agent integrations:/, "nothing is reported as installed");
    assert.match(result.stderr, /needs an interactive terminal/);
    assert.match(result.stderr, /--install <agent>/);
    assert.match(result.stderr, /--install all/);
    assert.ok(!existsSync(path.join(workspace, "copilot-plugin", "plugin.json")));
    assert.ok(!existsSync(path.join(workspace, "pi-agent", "packages", "codetour-plugin")));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an absent host keeps an installed integration reported by its installation state", () => {
  const workspace = temporaryDirectory("codetour-agents-absent-installed-");
  const emptyPath = path.join(workspace, "empty-path");
  mkdirSync(emptyPath, { recursive: true });
  try {
    assert.equal(run(workspace, ["--install", "pi"]).status, 0);
    // The files are on disk, so `--agents` reports them even where no Pi
    // binary exists: an installed integration stays removable.
    const agents = run(workspace, ["--agents"], { PATH: emptyPath });
    assert.equal(agents.status, 0, agents.stderr);
    assert.match(agents.stdout, /^pi\tPi coding agent$/m);
    assert.match(agents.stdout, /^  installed: /m);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("the picker installs the agent chosen at a real terminal", { skip: ptySkip }, () => {
  const workspace = temporaryDirectory("codetour picker with spaces-");
  try {
    const result = answerPicker(workspace, "2");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /1\. GitHub Copilot CLI \(/);
    assert.match(result.stdout, /2\. Pi coding agent \(/);
    assert.match(result.stdout, /^  pi: installed$/m);
    assert.ok(existsSync(path.join(workspace, "pi-agent", "packages", "codetour-plugin", "package.json")));
    assert.ok(!existsSync(path.join(workspace, "copilot-plugin")), "the unselected agent is untouched");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an empty answer at a real terminal installs nothing", { skip: ptySkip }, () => {
  const workspace = temporaryDirectory("codetour picker cancel-");
  try {
    const result = answerPicker(workspace, "");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /No agent selected; nothing was installed\./);
    assert.ok(!existsSync(path.join(workspace, "pi-agent", "packages", "codetour-plugin")));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an absent agent is skipped with its reason and does not fail the batch", () => {
  const workspace = temporaryDirectory("codetour-agents-install-none-");
  const emptyPath = path.join(workspace, "empty-path");
  mkdirSync(emptyPath, { recursive: true });
  try {
    // No agent CLI is reachable: every integration reports why it is skipped,
    // and the exit code stays zero because nothing failed.
    const result = run(workspace, ["--install", "all"], { PATH: emptyPath });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^  copilot: skipped \(/m);
    assert.match(result.stdout, /^  pi: skipped \(/m);
    assert.match(result.stdout, /^  vscode: skipped \(/m);
    assert.ok(!existsSync(path.join(workspace, "pi-agent", "packages", "codetour-plugin")));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("--uninstall with no agent removes every integration this CLI installed", () => {
  const workspace = temporaryDirectory("codetour-agents-uninstall-all-");
  try {
    const installed = run(workspace, ["--install", "all"], { CODETOUR_DISABLE_AGENTS: "vscode" });
    assert.equal(installed.status, 0, installed.stderr);
    const removed = run(workspace, ["--uninstall"], { CODETOUR_DISABLE_AGENTS: "vscode" });
    assert.equal(removed.status, 0, removed.stderr);
    assert.match(removed.stdout, /^  copilot: (uninstalled|not-installed)/m);
    assert.match(removed.stdout, /^  pi: (uninstalled|not-installed)/m);
    assert.ok(!existsSync(path.join(workspace, "pi-agent", "packages", "codetour-plugin")));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
