import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import plugin from "../packages/pi-plugin/extensions/codetour.ts";
import { updateRunState } from "../packages/pi-plugin/lib/run-log.mjs";
import { TERMINAL_OPTION, VSCODE_OPTION } from "../packages/pi-plugin/lib/reader.mjs";

// The extension wiring itself, exercised without a Pi process: a fake host
// records what the extension registers, and a real temporary workspace holds
// the run state. Node strips the TypeScript types, so the shipped file is what
// runs here.

function fakeHost() {
  const handlers = new Map();
  const servers = [];
  const commands = new Map();
  const notifications = [];
  const sent = [];
  const pi = {
    on(event, handler) {
      handlers.set(event, handler);
    },
    registerMcpServer(name, config) {
      servers.push({ name, config });
    },
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    sendUserMessage(text, options) {
      sent.push({ text, options });
    },
  };
  plugin(pi);
  return { handlers, servers, commands, notifications, sent };
}

function fakeContext(workspace) {
  const notifications = [];
  const selections = [];
  const selects = [];
  return {
    notifications,
    selections,
    selects,
    ctx: {
      cwd: workspace,
      ui: {
        notify: (message, level) => notifications.push({ message, level }),
        select: async (title, options) => {
          selects.push({ title, options });
          return selections.shift();
        },
      },
      sessionManager: { getSessionId: () => "pi-session-test" },
    },
  };
}

function workspaceWithSpaces() {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-pi-extension-"));
  const workspace = path.join(root, "work space");
  mkdirSync(workspace, { recursive: true });
  return { root, workspace: realpathSync(workspace) };
}

function runFiles(workspace) {
  try {
    return readdirSync(path.join(workspace, ".tours", ".log"));
  } catch {
    return [];
  }
}

test("session_start registers one workspace-scoped CodeTour server", async () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const host = fakeHost();
    const { ctx } = fakeContext(workspace);
    await host.handlers.get("session_start")({ reason: "startup" }, ctx);
    assert.equal(host.servers.length, 1);
    const [server] = host.servers;
    assert.equal(server.name, "codetour");
    assert.equal(server.config.exposure, "deferred");
    // Without a managed launcher the documented PATH fallback is used.
    assert.equal(server.config.command, "codetour");
    assert.deepEqual(server.config.args, [
      "mcp",
      "--workspace-root",
      workspace,
    ]);
    assert.ok(host.commands.has("codetour"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a cancelled selection starts nothing and writes no run state", async () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.commands.get("codetour").handler("", context.ctx);
    assert.equal(host.sent.length, 0);
    assert.match(context.notifications[0].message, /generation cancelled/);
    assert.equal(runFiles(workspace).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit choices write the run state and deliver the skill invocation", async () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.commands
      .get("codetour")
      .handler("changes critical explain the renderer", context.ctx);
    assert.equal(host.sent.length, 1);
    const invocation = host.sent[0].text;
    assert.match(
      invocation,
      /^\/skill:codetour-generate type=changes reviewMode=critical runId=[A-Za-z0-9_-]{8,} request=explain the renderer$/
    );
    assert.deepEqual(host.sent[0].options, { expandPromptTemplates: true });

    const runId = invocation.match(/runId=(\S+)/)[1];
    const file = path.join(workspace, ".tours", ".log", `codetour-run-${runId}.json`);
    const state = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(state.kind, "changes");
    assert.equal(state.request, "explain the renderer");
    assert.equal(state.sessionId, "pi-session-test");
    assert.equal(state.tourCreated, false);
    assert.equal(state.continuationUsed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing type is asked for and a missing review mode is asked for once", async () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    context.selections.push("Changes Tour", "critical — explanation plus review findings");
    await host.commands.get("codetour").handler("explain the payment flow", context.ctx);
    assert.equal(host.sent.length, 1);
    assert.match(host.sent[0].text, /type=changes reviewMode=critical/);
    assert.match(host.sent[0].text, /request=explain the payment flow/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the guard is inert before a Tour and asks for exactly one continuation after", async () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.commands.get("codetour").handler("project", context.ctx);
    const runId = host.sent[0].text.match(/runId=(\S+)/)[1];

    const before = await host.handlers.get("agent_before_settle")(
      { entries: [], aborted: false, context: {} },
      context.ctx
    );
    assert.equal(before, undefined);

    await updateRunState(workspace, runId, state => ({
      ...state,
      tourCreated: true,
      tourPath: ".tours/project.tour",
      tourTitle: "Project",
      knowledge: {
        version: 1,
        observed: true,
        at: new Date().toISOString(),
        listings: 1,
        valid: ["billing-retry"],
        validTotal: 2,
        complete: true,
        invalid: [{ name: "stale-auth", reason: "proof_hash_mismatch" }],
        used: ["billing-retry"],
      },
    }));

    const first = await host.handlers.get("agent_before_settle")(
      { entries: [], aborted: false, context: {} },
      context.ctx
    );
    assert.equal(first.continue, true);
    assert.equal(first.entries.length, 1);
    assert.equal(first.entries[0].customType, "codetour-consolidation");
    assert.equal(first.entries[0].display, false);
    assert.match(first.entries[0].content, new RegExp(`runId "${runId}"`));

    const second = await host.handlers.get("agent_before_settle")(
      { entries: [], aborted: false, context: {} },
      context.ctx
    );
    assert.equal(second, undefined);

    // The closing line and the invalid detail are reported once, not per stop.
    const closing = context.notifications.filter(entry => entry.message.startsWith("CodeTour run"));
    assert.equal(closing.length, 1);
    assert.match(closing[0].message, /Knowledge 2 valid \/ 1 invalid, 1 used \(billing-retry\)/);
    const invalid = context.notifications.filter(entry => entry.message.startsWith("CodeTour knowledge invalid:"));
    assert.equal(invalid.length, 1);
    assert.match(invalid[0].message, /stale-auth — proof_hash_mismatch/);
    assert.equal(invalid[0].level, "warning");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an aborted settle never asks for a continuation", async () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.commands.get("codetour").handler("project", context.ctx);
    const runId = host.sent[0].text.match(/runId=(\S+)/)[1];
    await updateRunState(workspace, runId, state => ({ ...state, tourCreated: true }));
    const result = await host.handlers.get("agent_before_settle")(
      { entries: [], aborted: true, context: {} },
      context.ctx
    );
    assert.equal(result, undefined);
    const state = JSON.parse(
      readFileSync(path.join(workspace, ".tours", ".log", `codetour-run-${runId}.json`), "utf8")
    );
    assert.equal(state.continuationUsed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the end-of-generation ask offers the terminal reader and VS Code", async () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.commands.get("codetour").handler("project", context.ctx);
    const runId = host.sent[0].text.match(/runId=(\S+)/)[1];
    await updateRunState(workspace, runId, state => ({
      ...state,
      tourCreated: true,
      tourPath: ".tours/payment.tour",
      tourTitle: "Payment Flow",
      consolidation: { status: "created", at: new Date().toISOString() },
    }));
    context.selections.push(TERMINAL_OPTION);
    const settled = await host.handlers.get("agent_before_settle")(
      { entries: [], aborted: false, context: {} },
      context.ctx
    );
    // A closed run asks for no continuation: the dialogue is the last word.
    assert.equal(settled, undefined);
    // Exactly one ask, naming the created Tour and the two real openings.
    assert.equal(context.selects.length, 1);
    assert.match(context.selects[0].title, /"Payment Flow"/);
    assert.deepEqual(context.selects[0].options.length, 2);
    // The terminal choice hands over the exact real reader command; no
    // step list or summary ever answers for the reader.
    const commands = context.notifications.filter(entry => entry.message.includes('codetour "Payment Flow"'));
    assert.equal(commands.length, 1);
    assert.match(commands[0].message, /workspace root/);
    assert.match(commands[0].message, /never an independent window/);
    // The ask is once per run: a later settle of the same run never asks again.
    await updateRunState(workspace, runId, state => ({
      ...state,
      knowledge: { version: 1, observed: true, at: new Date().toISOString(), listings: 1, valid: [], invalid: [], used: [] },
    }));
    await host.handlers.get("agent_before_settle")(
      { entries: [], aborted: false, context: {} },
      context.ctx
    );
    assert.equal(context.selects.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the VS Code choice delegates to the explicit open-in-VS Code contract", async () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.commands.get("codetour").handler("project", context.ctx);
    const runId = host.sent[0].text.match(/runId=(\S+)/)[1];
    await updateRunState(workspace, runId, state => ({
      ...state,
      tourCreated: true,
      tourPath: ".tours/payment.tour",
      tourTitle: null,
      consolidation: { status: "skipped", at: new Date().toISOString() },
    }));
    context.selections.push(VSCODE_OPTION);
    await host.handlers.get("agent_before_settle")(
      { entries: [], aborted: false, context: {} },
      context.ctx
    );
    assert.equal(context.selects.length, 1);
    const openings = context.notifications.filter(entry => entry.message.includes("--internal-open-vscode"));
    assert.equal(openings.length, 1);
    assert.match(openings[0].message, /codetour --internal-open-vscode "\.tours\/payment\.tour"/);
    assert.match(openings[0].message, /active step/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a cancelled ask hands over nothing and no summary replaces the reader", async () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.commands.get("codetour").handler("project", context.ctx);
    const runId = host.sent[0].text.match(/runId=(\S+)/)[1];
    await updateRunState(workspace, runId, state => ({
      ...state,
      tourCreated: true,
      tourPath: ".tours/payment.tour",
      tourTitle: "Payment Flow",
      consolidation: { status: "created", at: new Date().toISOString() },
    }));
    await host.handlers.get("agent_before_settle")(
      { entries: [], aborted: false, context: {} },
      context.ctx
    );
    assert.equal(context.selects.length, 1);
    // Declined: no opening command and no textual stand-in for the reader.
    assert.equal(context.notifications.filter(entry => /codetour|code --open-url/.test(entry.message)).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
