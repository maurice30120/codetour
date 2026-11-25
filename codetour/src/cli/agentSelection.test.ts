import { test } from "node:test";
import * as assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "os";
import * as path from "path";
import { AgentReport, findAgentIntegration } from "./agentIntegrations";
import {
  generationAgents, generationAgentIds, installChosenAgents, parseAgentSelection, SelectionSession
} from "./agentSelection";

// The interactive agent picker (spec #320, decision §8). The decisions —
// which agents are offered, what an answer selects, what a non-interactive
// invocation does — are driven through the session seam, so a test never needs
// a real terminal to check them; `agentIntegrations.test.ts` runs the same
// picker once under a real pseudo-terminal.

const reports: AgentReport[] = [
  { id: "copilot", displayName: "GitHub Copilot CLI", state: "installed", detail: "" },
  { id: "pi", displayName: "Pi coding agent", state: "absent", detail: "" }
];

function session(answer: string, interactive = true): SelectionSession & { printed: string[] } {
  const printed: string[] = [];
  return {
    interactive,
    printed,
    print: line => printed.push(line),
    ask: async () => answer
  };
}

function offlineEnvironment(workspace: string): void {
  // The installs go to directories inside the workspace; no host CLI and no
  // user configuration is read or written.
  process.env.PI_CODING_AGENT_DIR = path.join(workspace, "pi agent dir");
  process.env.CODETOUR_PI_SETTINGS = path.join(workspace, "pi agent dir", "settings.json");
  process.env.CODETOUR_COPILOT_PLUGIN_DIR = path.join(workspace, "copilot plugin");
  process.env.CODETOUR_COPILOT_EXTENSIONS_DIR = path.join(workspace, "copilot extensions");
  process.env.COPILOT_HOME = path.join(workspace, "copilot home");
}

test("only the generation agents of this delivery are offered", () => {
  assert.deepEqual(generationAgents().map(agent => agent.id), ["copilot", "pi"]);
  assert.equal(generationAgentIds(), "copilot, pi");
  // The VS Code extension stays installable by naming it, so it is a valid
  // explicit id that the picker never offers.
  assert.equal(findAgentIntegration("vscode").supportsGeneration, false);
});

test("a numbered answer selects the offered agent", () => {
  assert.deepEqual(parseAgentSelection("2", reports), ["pi"]);
  assert.deepEqual(parseAgentSelection("1", reports), ["copilot"]);
});

test("explicit ids, mixed answers and repeated agents select once each", () => {
  assert.deepEqual(parseAgentSelection("pi", reports), ["pi"]);
  assert.deepEqual(parseAgentSelection("1,2", reports), ["copilot", "pi"]);
  assert.deepEqual(parseAgentSelection(" pi , 2 1 ", reports), ["pi", "copilot"]);
  assert.deepEqual(parseAgentSelection("Copilot", reports), ["copilot"]);
});

test("an empty answer selects nothing instead of everything", () => {
  assert.deepEqual(parseAgentSelection("", reports), []);
  assert.deepEqual(parseAgentSelection("   ", reports), []);
});

test("a selection outside the offered list is an explicit error", () => {
  assert.throws(() => parseAgentSelection("3", reports), /Unknown agent selection: 3/);
  assert.throws(() => parseAgentSelection("vscode", reports), /Unknown agent selection: vscode/);
  assert.throws(() => parseAgentSelection("pi,vscode", reports), /copilot, pi/);
});

test("without a terminal the picker fails with one instruction and installs nothing", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "codetour-selection-no-tty-"));
  try {
    offlineEnvironment(workspace);
    await assert.rejects(
      () => installChosenAgents(session("", false)),
      /Choosing the agents to install needs an interactive terminal/
    );
    assert.ok(!existsSync(path.join(workspace, "pi agent dir")), "nothing was installed");
    assert.ok(!existsSync(path.join(workspace, "copilot plugin")));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an empty selection is a no-op with a clear message", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "codetour-selection-cancel-"));
  try {
    offlineEnvironment(workspace);
    const terminal = session("\n");
    const report = await installChosenAgents(terminal);
    assert.deepEqual(report.outcomes, []);
    assert.equal(report.failed, false);
    assert.match(terminal.printed.join("\n"), /No agent selected; nothing was installed\./);
    assert.ok(!existsSync(path.join(workspace, "pi agent dir")));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("the selected agent is installed and the other one is left alone", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "codetour-selection-one-"));
  try {
    offlineEnvironment(workspace);
    const terminal = session("2");
    const report = await installChosenAgents(terminal);
    assert.deepEqual(report.outcomes.map(outcome => [outcome.id, outcome.result]), [["pi", "installed"]]);
    assert.ok(existsSync(path.join(workspace, "pi agent dir", "packages", "codetour-plugin", "package.json")));
    assert.ok(!existsSync(path.join(workspace, "copilot plugin")), "an unselected agent is untouched");
    // The numbers are the offered list, in registry order.
    assert.match(terminal.printed.join("\n"), /1\. GitHub Copilot CLI/);
    assert.match(terminal.printed.join("\n"), /2\. Pi coding agent/);
    assert.match(terminal.printed.join("\n"), /--install vscode/, "the VS Code exception is stated where it matters");
    const settings = JSON.parse(readFileSync(path.join(workspace, "pi agent dir", "settings.json"), "utf8"));
    assert.deepEqual(settings.packages, [path.resolve(workspace, "pi agent dir", "packages", "codetour-plugin")]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a failing selected agent is reported and makes the picker exit non-zero", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "codetour-selection-error-"));
  try {
    offlineEnvironment(workspace);
    // A file where the managed Pi package belongs makes the install fail after
    // it was selected.
    const packageDirectory = path.join(workspace, "pi agent dir", "packages", "codetour-plugin");
    mkdirSync(path.dirname(packageDirectory), { recursive: true });
    writeFileSync(packageDirectory, "not a directory\n");
    const terminal = session("pi");
    const report = await installChosenAgents(terminal);
    assert.equal(report.failed, true);
    assert.deepEqual(report.outcomes.map(outcome => [outcome.id, outcome.result]), [["pi", "failed"]]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an install from a process that is not the CLI records the portable launcher", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "codetour-selection-launcher-"));
  const entry = process.env.CODETOUR_CLI_ENTRY;
  try {
    offlineEnvironment(workspace);
    // The picker runs inside the test process, which is not the CLI: it must
    // record the documented command instead of naming (and probing) the test
    // script as the installed launcher.
    delete process.env.CODETOUR_CLI_ENTRY;
    const report = await installChosenAgents(session("pi"));
    assert.equal(report.failed, false);
    const launcher = JSON.parse(readFileSync(
      path.join(workspace, "pi agent dir", "packages", "codetour-plugin", "launcher.json"), "utf8"));
    assert.deepEqual(launcher, { command: "codetour", args: [] });
  } finally {
    if (entry === undefined) delete process.env.CODETOUR_CLI_ENTRY;
    else process.env.CODETOUR_CLI_ENTRY = entry;
    rmSync(workspace, { recursive: true, force: true });
  }
});
