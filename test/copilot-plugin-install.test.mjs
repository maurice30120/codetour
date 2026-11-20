import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRunState, runLogDirectory, runStatePath } from "../packages/copilot-plugin/com.github.copilot/lib/run-log.mjs";

// Real verifications against the installed GitHub Copilot CLI. The plugin is
// installed into a temporary COPILOT_HOME so the developer's own configuration
// is never modified, then uninstalled and the state checked again.
//
// The local path deliberately contains spaces and the temporary home is a
// separate directory: this is the cross-platform path contract the plugin's
// hook command and MCP launcher must survive.

const pluginSource = path.resolve("packages/copilot-plugin");
const copilot = spawnSync("copilot", ["--version"], { encoding: "utf8" });
const copilotAvailable = copilot.status === 0;
const skip = copilotAvailable ? false : "the 'copilot' CLI is not available on PATH";

function copilotHome(root) {
  return path.join(root, "copilot home with spaces");
}

function cli(home, args, cwd) {
  return spawnSync("copilot", args, {
    cwd,
    encoding: "utf8",
    timeout: 180000,
    env: { ...process.env, COPILOT_HOME: home }
  });
}

function parseConfig(home) {
  const raw = readFileSync(path.join(home, "config.json"), "utf8");
  return JSON.parse(raw.split(/\r?\n/).filter(line => !line.trimStart().startsWith("//")).join("\n"));
}

function installedPlugin(home) {
  return parseConfig(home).installedPlugins?.find(plugin => plugin.name === "codetour");
}

function runHook(hook, workspace, payload) {
  const result = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 20000
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("codetour --install copilot installs the plugin into a temporary COPILOT_HOME", { skip }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-cli-install-"));
  const home = copilotHome(root);
  const workspace = path.join(root, "install workspace with spaces");
  mkdirSync(workspace, { recursive: true });
  const env = { ...process.env, COPILOT_HOME: home };
  const cliPath = path.resolve("dist/cli.js");
  try {
    const installed = spawnSync(process.execPath, [cliPath, "--install", "copilot"], {
      cwd: workspace, env, encoding: "utf8", timeout: 240000
    });
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(installed.stdout, /Installed the CodeTour plugin/);
    assert.ok(existsSync(path.join(home, "extensions", "codetour", "adapter.mjs")));
    assert.ok(!existsSync(path.join(home, "skills", "codetour-knowledge", "SKILL.md")),
      "the retired standalone Knowledge skill is not installed; the plugin is the only guidance");

    const plugins = spawnSync("copilot", ["plugin", "list", "--json"], { env, encoding: "utf8" });
    assert.equal(plugins.status, 0, plugins.stderr);
    assert.ok(JSON.parse(plugins.stdout).some(plugin => plugin.name === "codetour"));
    const mcp = spawnSync("copilot", ["mcp", "list"], { env, encoding: "utf8" });
    assert.match(mcp.stdout, /codetour \(local\)/);
    const details = spawnSync("copilot", ["mcp", "get", "codetour", "--json"], { env, encoding: "utf8" });
    const server = JSON.parse(details.stdout).codetour;
    assert.equal(server.command, process.execPath, "the installed plugin uses the verified runtime");
    assert.match(server.args[0], /dist\/cli\.js$/);
    assert.deepEqual(server.args.slice(1), ["mcp", "--workspace-root", "${COPILOT_SESSION_CWD}"]);
    const skills = spawnSync("copilot", ["skill", "list"], { env, encoding: "utf8" });
    assert.match(skills.stdout, /codetour-generate/);
    assert.ok(!existsSync(path.join(home, "mcp-config.json")), "the plugin is the only registration");

    const removed = spawnSync(process.execPath, [cliPath, "--uninstall", "copilot"], {
      cwd: workspace, env, encoding: "utf8", timeout: 240000
    });
    assert.equal(removed.status, 0, removed.stderr);
    const after = spawnSync("copilot", ["plugin", "list", "--json"], { env, encoding: "utf8" });
    assert.equal(JSON.parse(after.stdout).find(plugin => plugin.name === "codetour"), undefined);
    assert.doesNotMatch(spawnSync("copilot", ["mcp", "list"], { env, encoding: "utf8" }).stdout, /codetour \(local\)/);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  }
});

test("the real Copilot CLI installs, inspects and uninstalls the Agent Plugins 1.0 plugin", { skip }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-real-plugin-"));
  const home = copilotHome(root);
  const source = path.join(root, "plugin source with spaces");
  const listed = { state: "installed" };
  try {
    cpSync(pluginSource, source, { recursive: true });
    mkdirSync(home, { recursive: true });

    const installed = cli(home, ["plugin", "install", source], root);
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    assert.match(installed.stdout, /Plugin "codetour" installed successfully|installed successfully/);

    // `copilot plugin list --json` proves the manifest was accepted (Agent
    // Plugins 1.0 with $schema), and the cache path keeps the spaces.
    const plugins = cli(home, ["plugin", "list", "--json"], root);
    assert.equal(plugins.status, 0, plugins.stderr);
    const entries = JSON.parse(plugins.stdout);
    const entry = entries.find(plugin => plugin.name === "codetour");
    assert.ok(entry, plugins.stdout);
    assert.equal(entry.version, "0.1.2");
    assert.equal(entry.enabled, true);
    const cached = installedPlugin(home);
    assert.ok(cached?.cache_path, "the installed cache path is recorded");
    assert.match(cached.cache_path, /plugin source with spaces/);
    for (const relative of [
      "plugin.json",
      "mcp.json",
      "com.github.copilot/hooks/hooks.json",
      "com.github.copilot/hooks/agent-stop.mjs",
      "com.github.copilot/lib/run-log.mjs",
      "skills/codetour-generate/SKILL.md"
    ]) {
      assert.ok(existsSync(path.join(cached.cache_path, ...relative.split("/"))), `${relative} was installed`);
    }

    // One MCP server, sourced from the plugin, launched by the existing
    // `codetour mcp` command and scoped to the Copilot session workspace.
    const mcp = cli(home, ["mcp", "list"], root);
    assert.equal(mcp.status, 0, mcp.stderr);
    assert.match(mcp.stdout, /Plugin servers:/);
    assert.match(mcp.stdout, /codetour \(local\)/);
    const details = cli(home, ["mcp", "get", "codetour", "--json"], root);
    assert.equal(details.status, 0, details.stderr);
    const server = JSON.parse(details.stdout).codetour;
    assert.equal(server.source, "plugin");
    assert.equal(server.sourcePlugin, "codetour");
    assert.equal(server.command, "codetour");
    assert.deepEqual(server.args, ["mcp", "--workspace-root", "${COPILOT_SESSION_CWD}"]);
    assert.equal(server.cwd, "${PLUGIN_ROOT}");
    assert.match(server.env.PLUGIN_ROOT, /plugin source with spaces/, "PLUGIN_ROOT resolves to the installed cache");

    const skills = cli(home, ["skill", "list"], root);
    assert.equal(skills.status, 0, skills.stderr);
    assert.match(skills.stdout, /Plugin skills:/);
    assert.match(skills.stdout, /codetour-generate/);

    // The plugin install must not create a second user-level registration in
    // mcp-config.json: that file is not touched by Copilot's plugin loader.
    const userMcp = path.join(home, "mcp-config.json");
    if (existsSync(userMcp)) {
      const config = JSON.parse(readFileSync(userMcp, "utf8"));
      assert.equal(config.mcpServers?.codetour, undefined);
    }

    // The installed hook script runs in place, with a workspace path that also
    // contains spaces, and reads only the server-written run state.
    const workspace = path.join(root, "workspace with spaces");
    mkdirSync(workspace, { recursive: true });
    const runId = "run-real-cli-0123456789";
    const state = createRunState({
      runId,
      workspace: realpathSync(workspace),
      sessionId: "session-real-cli",
      kind: "project"
    });
    mkdirSync(runLogDirectory(workspace), { recursive: true });
    writeFileSync(runStatePath(workspace, runId), JSON.stringify({ ...state, tourCreated: true }, null, 2) + "\n");
    const hook = path.join(cached.cache_path, "com.github.copilot", "hooks", "agent-stop.mjs");
    const blocked = runHook(hook, workspace, {
      sessionId: "session-real-cli",
      cwd: workspace,
      transcriptPath: path.join(root, "transcript.jsonl"),
      stopReason: "end_turn",
      stop_hook_active: false
    });
    assert.equal(blocked.decision, "block");
    assert.match(blocked.reason, new RegExp(runId));
    assert.deepEqual(runHook(hook, workspace, {
      sessionId: "session-real-cli",
      cwd: workspace,
      transcriptPath: path.join(root, "transcript.jsonl"),
      stopReason: "end_turn",
      stop_hook_active: false
    }), {}, "a second stop is inert");

    const removed = cli(home, ["plugin", "uninstall", "codetour"], root);
    assert.equal(removed.status, 0, removed.stderr || removed.stdout);
    const after = cli(home, ["plugin", "list", "--json"], root);
    assert.equal(after.status, 0, after.stderr);
    assert.equal(JSON.parse(after.stdout).find(plugin => plugin.name === "codetour"), undefined);
    assert.doesNotMatch(cli(home, ["mcp", "list"], root).stdout, /codetour \(local\)/);
    assert.doesNotMatch(cli(home, ["skill", "list"], root).stdout, /codetour-generate/);
    assert.equal(installedPlugin(home), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  }
});

