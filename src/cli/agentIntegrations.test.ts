import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import * as os from "os";
import * as path from "path";
import { COPILOT_EXTENSION_FILES } from "./copilot-extension.generated";
import { COPILOT_PLUGIN_FILES } from "./copilot-plugin.generated";
import { CODETOUR_KNOWLEDGE_SKILL } from "./knowledge-skill.generated";

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
    // ~/.copilot/mcp-config.json, nor the real ~/.copilot/skills directory.
    env: {
      ...process.env,
      CODETOUR_COPILOT_MCP_CONFIG: path.join(cwd, "mcp-config.json"),
      CODETOUR_COPILOT_EXTENSIONS_DIR: path.join(cwd, "copilot-extensions"),
      CODETOUR_COPILOT_SKILLS_DIR: path.join(cwd, "copilot-skills"),
      // The Agent Plugins 1.0 directory is installed directly in tests: the
      // real `copilot plugin install` is exercised by
      // test/copilot-plugin-install.test.mjs against the installed CLI.
      CODETOUR_COPILOT_PLUGIN_DIR: path.join(cwd, "copilot-plugin"),
      ...env
    }
  });
}

function pluginDirectory(workspace: string): string {
  return path.join(workspace, "copilot-plugin");
}

function skillFile(workspace: string): string {
  return path.join(workspace, "copilot-skills", "codetour-knowledge", "SKILL.md");
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

test("an install writes the Knowledge skill the CLI can load without a checkout", () => {
  const workspace = temporaryDirectory("codetour-skill-install-");
  try {
    const installed = run(workspace, ["--install", "copilot"]);
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(installed.stdout, /Installed the Knowledge skill/);
    // The embedded copy is the skill source of truth: the installed file must
    // be exactly it, at the personal Skills location Copilot discovers.
    assert.equal(readFileSync(skillFile(workspace), "utf8"), CODETOUR_KNOWLEDGE_SKILL);
    assert.match(readFileSync(skillFile(workspace), "utf8"), /^---\nname: codetour-knowledge\n/);
    // The skill is not a .tour and does not sit in an agent-specific extension
    // directory: it is the personal skill Copilot lists.
    const agents = run(workspace, ["--agents"]);
    assert.equal(agents.status, 0, agents.stderr);
    assert.match(agents.stdout, /installed/);
    assert.match(agents.stdout, /copilot-skills|codetour-knowledge/);

    // Repeating the install is a no-op, not a rewrite of identical content.
    const second = run(workspace, ["--install", "copilot"]);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(skillFile(workspace), "utf8"), CODETOUR_KNOWLEDGE_SKILL);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("the diagnostics report a missing or outdated Knowledge skill", () => {
  const workspace = temporaryDirectory("codetour-skill-status-");
  try {
    assert.equal(run(workspace, ["--install", "copilot"]).status, 0);

    rmSync(skillFile(workspace));
    const missing = run(workspace, ["--agents"]);
    assert.equal(missing.status, 0, missing.stderr);
    assert.match(missing.stdout, /incomplete/);
    assert.match(missing.stdout, /Knowledge skill/);
    assert.match(missing.stdout, /codetour --install copilot/);
    assert.match(run(workspace, ["--doctor"]).stdout, /copilot: .*integration incomplete/);

    // Reinstalling restores the owned skill file.
    assert.equal(run(workspace, ["--install", "copilot"]).status, 0);
    assert.equal(readFileSync(skillFile(workspace), "utf8"), CODETOUR_KNOWLEDGE_SKILL);

    writeFileSync(skillFile(workspace), "---\nname: codetour-knowledge\n---\nan older revision\n");
    const outdated = run(workspace, ["--agents"]);
    assert.equal(outdated.status, 0, outdated.stderr);
    assert.match(outdated.stdout, /outdated/);
    assert.match(outdated.stdout, /Knowledge skill/);

    const repaired = run(workspace, ["--install", "copilot"]);
    assert.equal(repaired.status, 0, repaired.stderr);
    assert.match(repaired.stdout, /Replaced the differing Knowledge skill/);
    assert.equal(readFileSync(skillFile(workspace), "utf8"), CODETOUR_KNOWLEDGE_SKILL);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an uninstall removes only the Knowledge skill it owns and preserves edited ones", () => {
  const workspace = temporaryDirectory("codetour-skill-uninstall-");
  try {
    assert.equal(run(workspace, ["--install", "copilot"]).status, 0);
    // A foreign skill in the shared personal directory is never touched.
    const foreign = path.join(workspace, "copilot-skills", "other-skill", "SKILL.md");
    mkdirSync(path.dirname(foreign), { recursive: true });
    writeFileSync(foreign, "---\nname: other-skill\n---\nforeign\n");

    const removed = run(workspace, ["--uninstall", "copilot"]);
    assert.equal(removed.status, 0, removed.stderr);
    assert.ok(!existsSync(skillFile(workspace)), "the unchanged owned skill is removed");
    assert.ok(!existsSync(path.dirname(skillFile(workspace))), "its empty directory is removed too");
    assert.equal(readFileSync(foreign, "utf8"), "---\nname: other-skill\n---\nforeign\n");

    // An edited skill is user work: the uninstall reports it and leaves it.
    assert.equal(run(workspace, ["--install", "copilot"]).status, 0);
    writeFileSync(skillFile(workspace), "---\nname: codetour-knowledge\n---\nedited by the user\n");
    const preserved = run(workspace, ["--uninstall", "copilot"]);
    assert.equal(preserved.status, 0, preserved.stderr);
    assert.match(preserved.stdout, /left .* untouched|preserved/i);
    assert.equal(readFileSync(skillFile(workspace), "utf8"), "---\nname: codetour-knowledge\n---\nedited by the user\n");
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
    assert.ok(tools.includes("knowledge_save"), `tools: ${tools.join(", ")}`);
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
    assert.ok(existsSync(skillFile(workspace)), "the Knowledge skill is still installed");
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
        CODETOUR_COPILOT_MCP_CONFIG: path.join(workspace, "mcp-config.json"),
        CODETOUR_COPILOT_EXTENSIONS_DIR: path.join(workspace, "copilot-extensions"),
        CODETOUR_COPILOT_SKILLS_DIR: path.join(workspace, "copilot-skills"),
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
    // fail after the adapter files and the skill were installed.
    writeFileSync(pluginDirectory(workspace), "not a directory\n");
    const installed = run(workspace, ["--install", "copilot"], { CODETOUR_COPILOT_EXTENSIONS_DIR: extensionDir });
    assert.notEqual(installed.status, 0);
    assert.equal(
      readFileSync(path.join(extensionDir, "extension.mjs"), "utf8"),
      custom,
      "the replaced adapter file is restored to its previous content"
    );
    assert.ok(!existsSync(path.join(extensionDir, "adapter.mjs")), "an adapter file created by the failed install is removed");
    assert.ok(!existsSync(skillFile(workspace)), "the Knowledge skill written by the failed install is rolled back");
    assert.equal(readFileSync(pluginDirectory(workspace), "utf8"), "not a directory\n", "the user path is untouched");
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
    assert.match(agents.stdout, /incomplete/);
    assert.match(agents.stdout, /plugin is missing/);
    assert.match(run(workspace, ["--doctor"]).stdout, /copilot: .*integration incomplete/);

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
    assert.match(run(workspace, ["--doctor"]).stdout, /integration installed\./);
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
