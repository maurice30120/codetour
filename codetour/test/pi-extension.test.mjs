import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import plugin from "../packages/pi-plugin/extensions/codetour.ts";
import { CREATIONS_DIRECTORY } from "../packages/pi-plugin/lib/journal.mjs";
import { TERMINAL_OPTION, VSCODE_OPTION } from "../packages/pi-plugin/lib/reader.mjs";

// The Pi extension at its hook boundary: the events Pi emits, and what the
// extension tells the user through `ctx.ui.notify`.
//
// No Pi process runs here. A fake host records the handlers and commands the
// extension registers, and a real temporary workspace holds the creation
// journal the CLI writes. Node strips the TypeScript types, so the shipped file
// is what runs.

const SESSION = "pi-session-test";
const USAGE_TURN_1 = { input: 1522, output: 118, cacheRead: 0, cacheWrite: 0, totalTokens: 1640 };
const USAGE_TURN_2 = { input: 142, output: 35, cacheRead: 1536, cacheWrite: 0, totalTokens: 1713 };

function fakeHost(execResult = { code: 0, stdout: "", stderr: "" }, extension = plugin) {
  const handlers = new Map();
  const commands = new Map();
  const notifications = [];
  const sent = [];
  const executions = [];
  const pi = {
    on(event, handler) {
      handlers.set(event, handler);
    },
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    sendUserMessage(text, options) {
      sent.push({ text, options });
    },
    async exec(command, args, options) {
      executions.push({ command, args, options });
      return execResult;
    },
  };
  extension(pi);
  return { handlers, commands, notifications, sent, executions };
}

function fakeContext(workspace, { hasUI = true, sessionId = SESSION, entries } = {}) {
  const notifications = [];
  const selections = [];
  const selects = [];
  return {
    notifications,
    selections,
    selects,
    ctx: {
      cwd: workspace,
      hasUI,
      ui: {
        notify: (message, level) => notifications.push({ message, level }),
        select: async (title, options) => {
          selects.push({ title, options });
          return selections.shift();
        },
      },
      sessionManager: {
        getSessionId: () => sessionId,
        getEntries: () => entries ?? [],
      },
    },
  };
}

function temporaryWorkspace() {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-pi-extension-"));
  const workspace = path.join(root, "work space");
  mkdirSync(workspace, { recursive: true });
  // The canonical spelling the CLI records and the hook compares (ADR 0056).
  return { root, workspace: realpathSync.native(workspace) };
}

function journalDirectory(workspace) {
  return path.join(workspace, ...CREATIONS_DIRECTORY.split(path.sep));
}

// The journal names its files by creation time, so successive creations of one
// response are ordered by name: the report follows the creation order.
let creationIndex = 0;

/** One creation record as the CLI writes it. */
function writeCreation(workspace, overrides = {}) {
  const record = {
    version: 1,
    workspace,
    tourPath: path.join(workspace, ".tours", "project.tour"),
    tourTitle: "Payment flow",
    kind: "project",
    at: new Date().toISOString(),
    sessionId: SESSION,
    responseId: null,
    host: "pi",
    ...overrides,
  };
  const directory = journalDirectory(workspace);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(
      directory,
      `${String(Date.parse(record.at)).padStart(13, "0")}-${creationIndex++}-${Math.random()
        .toString(16)
        .slice(2)}.json`
    ),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8"
  );
  return record;
}

/** Drive one whole response: start, one run's messages, then the settlement. */
async function respond(host, ctx, { usages = [USAGE_TURN_1, USAGE_TURN_2], aborted = false } = {}) {
  await host.handlers.get("agent_start")({ type: "agent_start" }, ctx);
  await host.handlers.get("agent_end")(
    { type: "agent_end", messages: usages.map(usage => ({ role: "assistant", usage })) },
    ctx
  );
  return host.handlers.get("agent_settled")({ type: "agent_settled", aborted }, ctx);
}

function summaryMessages(notifications) {
  return notifications.filter(entry => entry.message.startsWith("CodeTour: "));
}

function tokenMessages(notifications) {
  return notifications.filter(entry => entry.message.startsWith("CodeTour tokens"));
}

test("one creation of the response is reported with its title and its path", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({ type: "agent_start" }, context.ctx);
    const record = writeCreation(workspace);
    await host.handlers.get("agent_end")({ type: "agent_end", messages: [] }, context.ctx);
    const result = await host.handlers.get("agent_settled")({ aborted: false }, context.ctx);

    assert.equal(result, undefined, "the hook never answers the host");
    const [summary] = summaryMessages(context.notifications);
    assert.equal(summary.message, `CodeTour: "Payment flow" (${record.tourPath})`);
    assert.equal(summary.level, "info");
    // One token reading for the response, and only one.
    assert.equal(tokenMessages(context.notifications).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("several creations of one response are all reported, with one token reading", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({ type: "agent_start" }, context.ctx);
    const project = writeCreation(workspace);
    const changes = writeCreation(workspace, {
      tourPath: path.join(workspace, ".tours", "changes.tour"),
      tourTitle: "Renderer changes",
      kind: "changes",
    });
    await respondTail(host, context.ctx);

    assert.deepEqual(
      summaryMessages(context.notifications).map(entry => entry.message),
      [
        `CodeTour: "Payment flow" (${project.tourPath})`,
        `CodeTour: "Renderer changes" (${changes.tourPath})`,
      ]
    );
    assert.equal(tokenMessages(context.notifications).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function respondTail(host, ctx, usages = [USAGE_TURN_1, USAGE_TURN_2]) {
  await host.handlers.get("agent_end")(
    { messages: usages.map(usage => ({ role: "assistant", usage })) },
    ctx
  );
  return host.handlers.get("agent_settled")({ aborted: false }, ctx);
}

test("no creation means no report at all", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await respond(host, context.ctx);
    assert.deepEqual(context.notifications, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("another session's creation is never reported", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({}, context.ctx);
    writeCreation(workspace, { sessionId: "another-session" });
    await respondTail(host, context.ctx);
    assert.deepEqual(context.notifications, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a creation without a session identity is never reported", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({}, context.ctx);
    writeCreation(workspace, { sessionId: null, host: null });
    await respondTail(host, context.ctx);
    assert.deepEqual(context.notifications, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a creation made before this response is never reported", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    // The previous response created it.
    writeCreation(workspace, { at: new Date(Date.now() - 60_000).toISOString() });
    await host.handlers.get("agent_start")({}, context.ctx);
    await respondTail(host, context.ctx);
    assert.deepEqual(context.notifications, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an aborted response reports nothing", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({}, context.ctx);
    writeCreation(workspace);
    await respondTail(host, context.ctx);
    context.notifications.length = 0;
    const result = await host.handlers.get("agent_settled")({ aborted: true }, context.ctx);
    assert.equal(result, undefined);
    assert.deepEqual(context.notifications, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the same response is reported once, however often the host settles it", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({}, context.ctx);
    writeCreation(workspace);
    await respondTail(host, context.ctx);
    await host.handlers.get("agent_settled")({ aborted: false }, context.ctx);
    assert.equal(summaryMessages(context.notifications).length, 1);
    assert.equal(tokenMessages(context.notifications).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the response reading splits input, output and cache exactly once", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({}, context.ctx);
    writeCreation(workspace);
    await respondTail(host, context.ctx);
    const [tokens] = tokenMessages(context.notifications);
    // `totalTokens` (1640 + 1713) is never added to the cache: input and cache
    // are disjoint on Pi.
    assert.equal(tokens.message, "CodeTour tokens: input 1,664 / output 153 / cache 1,536");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing usage reads as unavailable, never as zero", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({}, context.ctx);
    writeCreation(workspace);
    await respondTail(host, context.ctx, []);
    const [tokens] = tokenMessages(context.notifications);
    assert.equal(tokens.message, "CodeTour tokens: unavailable for this response.");
    // The creation is still reported: token unavailability never fails it.
    assert.equal(summaryMessages(context.notifications).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an all-zero usage reads as unavailable, never as zero", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({}, context.ctx);
    writeCreation(workspace);
    await respondTail(host, context.ctx, [
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    ]);
    assert.equal(
      tokenMessages(context.notifications)[0].message,
      "CodeTour tokens: unavailable for this response."
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a partial usage is qualified as approximate", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({}, context.ctx);
    writeCreation(workspace);
    await host.handlers.get("agent_end")(
      { messages: [{ role: "assistant", usage: USAGE_TURN_1 }, { role: "assistant" }] },
      context.ctx
    );
    await host.handlers.get("agent_settled")({ aborted: false }, context.ctx);
    assert.equal(
      tokenMessages(context.notifications)[0].message,
      "CodeTour tokens (approximate): input 1,522 / output 118 / cache 0"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("without a run message the session entries give an approximate reading", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({}, context.ctx);
    const stampedAt = new Date().toISOString();
    context.ctx.sessionManager.getEntries = () => [
      { type: "message", role: "user", timestamp: stampedAt },
      { type: "message", role: "assistant", timestamp: stampedAt, usage: USAGE_TURN_1 },
    ];
    writeCreation(workspace);
    // `agent_end` never delivered a message (retry, compaction, host quirk).
    await host.handlers.get("agent_settled")({ aborted: false }, context.ctx);
    assert.equal(
      tokenMessages(context.notifications)[0].message,
      "CodeTour tokens (approximate): input 1,522 / output 118 / cache 0"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a repeated run of the response is qualified as approximate", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({}, context.ctx);
    writeCreation(workspace);
    // A retry or a queued follow-up re-enters the loop inside one response:
    // the messages of the last run no longer cover the whole response.
    for (const usage of [USAGE_TURN_1, USAGE_TURN_2]) {
      await host.handlers.get("agent_end")({ messages: [{ role: "assistant", usage }] }, context.ctx);
    }
    await host.handlers.get("agent_settled")({ aborted: false }, context.ctx);
    assert.equal(
      tokenMessages(context.notifications)[0].message,
      "CodeTour tokens (approximate): input 142 / output 35 / cache 1,536"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a retried run does not hide the creation of the earlier run", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({}, context.ctx);
    writeCreation(workspace);
    await host.handlers.get("agent_end")({ messages: [] }, context.ctx);
    // The run is retried inside the same response.
    await host.handlers.get("agent_start")({}, context.ctx);
    await respondTail(host, context.ctx);
    assert.equal(summaryMessages(context.notifications).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unreadable journal leaves the response silent instead of failing", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    // A file where the journal directory belongs: every read fails.
    mkdirSync(path.dirname(journalDirectory(workspace)), { recursive: true });
    writeFileSync(journalDirectory(workspace), "not a directory", "utf8");
    const host = fakeHost();
    const context = fakeContext(workspace);
    await respond(host, context.ctx);
    assert.deepEqual(context.notifications, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the hook never continues, never blocks and never writes a Tour", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    // Only notification-only events are handled; the actionable settle event
    // and the MCP registry are untouched.
    assert.deepEqual(
      [...host.handlers.keys()].sort(),
      ["agent_end", "agent_settled", "agent_start"]
    );
    await host.handlers.get("agent_start")({}, context.ctx);
    writeCreation(workspace);
    const settled = await respondTail(host, context.ctx);
    assert.equal(settled, undefined);
    // Nothing but the summary and the token line: no opening dialogue when the
    // host has no UI, no execution, no message sent to the agent.
    assert.deepEqual(host.executions, []);
    assert.deepEqual(host.sent, []);
    assert.equal(context.selects.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("print and JSON modes report without offering a dialogue", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace, { hasUI: false });
    await host.handlers.get("agent_start")({}, context.ctx);
    writeCreation(workspace);
    await respondTail(host, context.ctx);
    assert.equal(summaryMessages(context.notifications).length, 1);
    assert.equal(context.selects.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reading an existing Tour still works without any MCP server", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const tours = [
      { id: "file:///first.tour", title: "Shared Tour" },
      { id: "file:///second.tour", title: "Shared Tour" },
    ];
    const host = fakeHost({ code: 0, stdout: JSON.stringify(tours), stderr: "" });
    const context = fakeContext(workspace);
    context.selections.push("Lire", "2. Shared Tour");
    await host.commands.get("codetour").handler("", context.ctx);
    assert.deepEqual(context.selects, [
      { title: "CodeTour", options: ["Générer", "Lire"] },
      { title: "Select a CodeTour", options: ["1. Shared Tour", "2. Shared Tour"] },
    ]);
    assert.deepEqual(host.executions, [
      { command: "codetour", args: ["--internal-list-tours"], options: { cwd: workspace } },
    ]);
    assert.match(context.notifications[0].message, /--internal-tour-id.*second\.tour/);
    assert.deepEqual(host.sent, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit choices deliver the skill invocation and create no run state", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.commands.get("codetour").handler("changes critical explain the renderer", context.ctx);
    assert.equal(host.sent.length, 1);
    assert.match(
      host.sent[0].text,
      /^\/skill:codetour-generate type=changes reviewMode=critical request=explain the renderer$/
    );
    assert.deepEqual(host.sent[0].options, { expandPromptTemplates: true });
    // The generation is the agent's own: no state file, no MCP registration.
    assert.deepEqual(readdirSync(workspace), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a cancelled generation selection starts nothing", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.commands.get("codetour").handler("generate", context.ctx);
    assert.deepEqual(host.sent, []);
    assert.match(context.notifications[0].message, /generation cancelled/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the native generation menu sends the selected review mode", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    context.selections.push("Changes Tour — Critique");
    await host.commands.get("codetour").handler("explain the payment flow", context.ctx);
    assert.equal(host.sent.length, 1);
    assert.match(host.sent[0].text, /type=changes reviewMode=critical/);
    assert.match(host.sent[0].text, /request=explain the payment flow/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the installed launcher travels to the skill, without the retired mcp subcommand", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const packageDir = path.join(root, "installed plugin");
    cpSync(path.resolve("packages/pi-plugin"), packageDir, { recursive: true });
    writeFileSync(
      path.join(packageDir, "launcher.json"),
      JSON.stringify({ command: "/custom node", args: ["/custom cli.js", "mcp"] }),
      "utf8"
    );
    const { default: installed } = await import(
      pathToFileURL(path.join(packageDir, "extensions/codetour.ts")).href
    );
    const host = fakeHost(undefined, installed);
    const context = fakeContext(workspace);
    await host.commands.get("codetour").handler("project", context.ctx);
    assert.equal(
      host.sent[0].text,
      '/skill:codetour-generate type=project codetour-cli=["/custom node","/custom cli.js"]'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a creation is offered to the terminal reader, once", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({}, context.ctx);
    const record = writeCreation(workspace, { tourTitle: "Payment Flow" });
    context.selections.push(TERMINAL_OPTION);
    await respondTail(host, context.ctx);
    assert.equal(context.selects.length, 1);
    assert.match(context.selects[0].title, /"Payment Flow"/);
    assert.deepEqual(context.selects[0].options.length, 2);
    // The terminal is not interactive in this test process: the documented
    // hand-over command is reported instead, never a summary in the Tour's
    // place.
    const handOver = context.notifications.find(entry =>
      entry.message.includes(`codetour "Payment Flow"`)
    );
    assert.ok(handOver, `expected the reader hand-over, got ${JSON.stringify(context.notifications)}`);
    assert.match(handOver.message, /never an independent window/);
    // A second settlement of the same window asks nothing again.
    await host.handlers.get("agent_settled")({ aborted: false }, context.ctx);
    assert.equal(context.selects.length, 1);
    assert.ok(record.tourPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the VS Code choice delegates to the explicit open-in-VS Code contract", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({}, context.ctx);
    const record = writeCreation(workspace);
    context.selections.push(VSCODE_OPTION);
    await respondTail(host, context.ctx);
    assert.deepEqual(host.executions, [
      {
        command: "codetour",
        args: ["--internal-open-vscode", record.tourPath, workspace],
        options: { cwd: workspace },
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed VS Code opening reports the failure and the manual command", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost({ code: 1, stderr: "VS Code unavailable", stdout: "" });
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({}, context.ctx);
    writeCreation(workspace);
    context.selections.push(VSCODE_OPTION);
    await respondTail(host, context.ctx);
    const warning = context.notifications.find(
      entry => entry.level === "warning" && entry.message.includes("VS Code unavailable")
    );
    assert.ok(warning);
    assert.match(warning.message, /codetour --internal-open-vscode/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a declined opening leaves no substitute text", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({}, context.ctx);
    writeCreation(workspace, { tourTitle: "Payment Flow" });
    await respondTail(host, context.ctx);
    assert.equal(context.selects.length, 1);
    const handOver = context.notifications.filter(entry =>
      /--internal-|never an independent window|code --open-url/.test(entry.message)
    );
    assert.deepEqual(handOver, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Tour created by the real CLI in this response is reported end to end", async () => {
  const { root, workspace } = temporaryWorkspace();
  try {
    const cli = path.resolve("dist", "cli.js");
    const proposal = {
      title: "Orientation",
      description: "A deterministic end-to-end creation.",
      steps: [
        {
          title: "Overview",
          description:
            "**Diagram — entry and store**\n\n```mermaid\nflowchart LR\n  A[entry] --> B[store]\n```",
        },
        { title: "Entry", description: "The entry point.", file: "index.js", line: 1 },
      ],
    };
    writeFileSync(path.join(workspace, "index.js"), "console.log('hi');\n", "utf8");

    const host = fakeHost();
    const context = fakeContext(workspace);
    await host.handlers.get("agent_start")({}, context.ctx);
    // What the skill does through the agent's shell: the CLI creates the Tour
    // from the workspace root, with the Pi session the host exported.
    const created = spawnSync(
      process.execPath,
      [cli, "create-project-tour", "--workspace", workspace, "--proposal", "-"],
      {
        encoding: "utf8",
        input: JSON.stringify(proposal),
        env: { ...process.env, PI_SESSION_ID: SESSION, CODETOUR_SESSION_ID: "" },
      }
    );
    assert.equal(created.status, 0, created.stderr || created.stdout);
    const result = JSON.parse(created.stdout);
    assert.equal(result.ok, true);
    await respondTail(host, context.ctx);

    const [summary] = summaryMessages(context.notifications);
    assert.equal(summary.message, `CodeTour: "Orientation" (${result.tourPath})`);
    // The written Tour is the one the record names.
    assert.equal(path.isAbsolute(result.tourPath), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
