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
import { creationsDirectory } from "../packages/copilot-plugin/com.github.copilot/lib/run-log.mjs";

// Real verifications against the installed GitHub Copilot CLI. The plugin is
// installed into a temporary COPILOT_HOME so the developer's own configuration
// is never modified, then uninstalled and the state checked again.
//
// The local path deliberately contains spaces and the temporary home is a
// separate directory: this is the cross-platform path contract the plugin's
// hook command must survive. The plugin declares no MCP server (ADR 0057).

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
    input: JSON.stringify({ cwd: workspace, ...payload }),
    encoding: "utf8",
    timeout: 20000
  });
  assert.equal(result.status, 0, result.stderr);
  return { output: JSON.parse(result.stdout), stderr: result.stderr };
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
    // The retired MCP adapter is gone: nothing is written into the extension
    // directory, and no server is registered by any install path.
    assert.ok(!existsSync(path.join(home, "extensions", "codetour")),
      "the MCP-routed adapter of the previous release is not installed");
    assert.ok(!existsSync(path.join(home, "skills", "codetour-knowledge", "SKILL.md")),
      "the retired standalone Knowledge skill is not installed; the plugin is the only guidance");

    const plugins = spawnSync("copilot", ["plugin", "list", "--json"], { env, encoding: "utf8" });
    assert.equal(plugins.status, 0, plugins.stderr);
    assert.ok(JSON.parse(plugins.stdout).some(plugin => plugin.name === "codetour"));
    const mcp = spawnSync("copilot", ["mcp", "list"], { env, encoding: "utf8" });
    assert.doesNotMatch(mcp.stdout, /codetour \(local\)/, "the plugin declares no server");
    const skills = spawnSync("copilot", ["skill", "list"], { env, encoding: "utf8" });
    assert.match(skills.stdout, /codetour-generate/);
    assert.ok(!existsSync(path.join(home, "mcp-config.json")), "no user-level registration is written");

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
      "com.github.copilot/hooks/hooks.json",
      "com.github.copilot/hooks/agent-stop.mjs",
      "com.github.copilot/lib/run-log.mjs",
      "skills/codetour-generate/SKILL.md",
      "skills/codetour-generate/references/mermaid.md",
      "skills/codetour-generate/references/anchors.md",
      "skills/codetour-generate/references/project-tour.md",
      "skills/codetour-generate/references/changes-tour-neutral.md",
      "skills/codetour-generate/references/changes-tour-critical.md",
      "skills/codetour-generate/references/codetour-adaptation.md",
      "skills/codetour-generate/references/upstream-code-review.md",
      "skills/codetour-generate/references/upstream-LICENSE.txt"
    ]) {
      assert.ok(existsSync(path.join(cached.cache_path, ...relative.split("/"))), `${relative} was installed`);
    }
    // One public skill, three reference modules: the installed skill names the
    // module of each path before exploring.
    const skillDirectory = path.join(cached.cache_path, "skills", "codetour-generate");
    const installedSkill = readFileSync(path.join(skillDirectory, "SKILL.md"), "utf8");
    for (const module of ["project-tour.md", "changes-tour-neutral.md", "changes-tour-critical.md"]) {
      assert.match(installedSkill, new RegExp(`references/${module}`), `${module} is routed`);
      assert.match(
        readFileSync(path.join(skillDirectory, "references", module), "utf8"),
        /create-(?:project|changes)-tour --workspace/,
        `${module} names its creation command`
      );
    }
    // A Changes Tour of either mode carries both mandatory refs, per the
    // real Copilot example too.
    assert.match(installedSkill, /`baseRef` and `headRef` are mandatory for every Changes Tour/);
    // The plugin declares no server: the retired declaration is not shipped and
    // nothing is registered for the session.
    assert.equal(existsSync(path.join(cached.cache_path, "mcp.json")), false);
    const declared = cli(home, ["mcp", "list"], root);
    assert.equal(declared.status, 0, declared.stderr);
    assert.doesNotMatch(declared.stdout, /codetour \(local\)/);

    const skills = cli(home, ["skill", "list"], root);
    assert.equal(skills.status, 0, skills.stderr);
    assert.match(skills.stdout, /Plugin skills:/);
    assert.match(skills.stdout, /codetour-generate/);
    assert.doesNotMatch(skills.stdout, /codetour-mermaid/);

    // The plugin install must not create a second user-level registration in
    // mcp-config.json: that file is not touched by Copilot's plugin loader.
    const userMcp = path.join(home, "mcp-config.json");
    if (existsSync(userMcp)) {
      const config = JSON.parse(readFileSync(userMcp, "utf8"));
      assert.equal(config.mcpServers?.codetour, undefined);
    }

    // The installed hook script runs in place, from a workspace path that also
    // contains spaces, on the payload the Copilot CLI really sends: it answers
    // `{}` and summarizes the creation journal of the current response.
    const workspace = path.join(root, "workspace with spaces");
    mkdirSync(workspace, { recursive: true });
    const realWorkspace = realpathSync(workspace);
    const now = Date.now();
    const responseStart = now - 30000;
    const transcriptPath = path.join(root, "events.jsonl");
    writeFileSync(
      transcriptPath,
      [
        { type: "user.message", timestamp: new Date(responseStart).toISOString(), data: { content: "un flux" } },
        {
          type: "session.usage_record",
          timestamp: new Date(now - 20000).toISOString(),
          data: { usage: { inputTokens: 2000, outputTokens: 200, cacheReadTokens: 1800 } }
        }
      ]
        .map(event => JSON.stringify(event))
        .join("\n") + "\n"
    );
    const tourPath = path.join(realWorkspace, ".tours", "installed.tour");
    mkdirSync(creationsDirectory(realWorkspace), { recursive: true });
    writeFileSync(
      path.join(creationsDirectory(realWorkspace), `${now - 25000}-1-0123abcd.json`),
      JSON.stringify({
        version: 1,
        workspace: realWorkspace,
        tourPath,
        tourTitle: "Flux installé",
        kind: "project",
        at: new Date(now - 25000).toISOString(),
        sessionId: "session-real-cli",
        responseId: null,
        host: "copilot"
      })
    );
    const hook = path.join(cached.cache_path, "com.github.copilot", "hooks", "agent-stop.mjs");
    const first = runHook(hook, workspace, {
      sessionId: "session-real-cli",
      timestamp: now,
      transcriptPath,
      stopReason: "end_turn",
      stop_hook_active: false
    });
    assert.deepEqual(first.output, {}, "the summary is never a decision");
    assert.match(first.stderr, /CodeTour: 1 Tour created in this response/);
    assert.ok(first.stderr.includes(tourPath), "the created Tour is reported with its absolute path");
    assert.match(
      first.stderr,
      /CodeTour: tokens 2,000 in \(of which 1,800 cached reads\), 200 out/,
      "the input total already contains the cache"
    );
    const second = runHook(hook, workspace, {
      sessionId: "session-real-cli",
      timestamp: now + 500,
      transcriptPath,
      stopReason: "end_turn",
      stop_hook_active: false
    });
    assert.deepEqual(second.output, {}, "a second stop is inert");
    assert.equal(second.stderr.trim(), "", "one reading per response");

    const removed = cli(home, ["plugin", "uninstall", "codetour"], root);
    assert.equal(removed.status, 0, removed.stderr || removed.stdout);
    const after = cli(home, ["plugin", "list", "--json"], root);
    assert.equal(after.status, 0, after.stderr);
    assert.equal(JSON.parse(after.stdout).find(plugin => plugin.name === "codetour"), undefined);
    assert.doesNotMatch(cli(home, ["skill", "list"], root).stdout, /codetour-generate/);
    assert.equal(installedPlugin(home), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  }
});

