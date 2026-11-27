import { EventEmitter } from "node:events";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TERMINAL_OPTION,
  VSCODE_OPTION,
  openingOptions,
  openingQuestion,
  playInTerminal,
  readerCommand,
  readerSpawnPlan,
  vscodeCommand,
} from "../packages/pi-plugin/lib/reader.mjs";

// The opening dialogue of the Pi plugin (ticket #242, amendment): at the end of
// a generation the plugin asks the user to open the created Tour in the
// terminal (the shipped CLI's real interactive reader, ticket #241) or in VS
// Code (the "Open in VS Code" contract of ticket #244, the Tour at the active
// step). Never a textual summary, whatever the choice. Pure decisions, no
// I/O, so the dialogue is testable without a Pi session, exactly like
// `guard.mjs`.

test("a created Tour proposes the default reading path on its exact title", () => {
  const command = readerCommand({ tourTitle: "Payment Flow", tourPath: ".tours/payment.tour" });
  assert.equal(command, 'codetour "Payment Flow"');
});

test("a title with quotes and spaces is quoted safely", () => {
  const command = readerCommand({ tourTitle: 'Rates "on claim"', tourPath: ".tours/rates.tour" });
  assert.equal(command, 'codetour "Rates \\"on claim\\""');
});

test("without a title the recorded Tour file drives the reader directly", () => {
  const command = readerCommand({ tourTitle: null, tourPath: ".tours/changes.tour" });
  assert.equal(command, 'codetour --internal-tour ".tours/changes.tour"');
});

test("no recorded creation, no command and no question", () => {
  // A journal record always carries the created Tour; an attributed creation
  // is exactly what the offer consumes.
  const state = { tourTitle: null, tourPath: null };
  assert.equal(readerCommand(state), null);
  assert.equal(openingQuestion(state), null);
  assert.equal(readerCommand(null), null);
  assert.equal(openingQuestion(null), null);
  assert.equal(readerCommand({ tourTitle: "", tourPath: null }), null);
  assert.equal(readerCommand({ tourTitle: null, tourPath: "" }), null);
});

test("the dialogue offers exactly the two real openings, never a summary", () => {
  assert.deepEqual(openingOptions(), [TERMINAL_OPTION, VSCODE_OPTION]);
  assert.match(TERMINAL_OPTION, /interactive reader/);
  assert.match(VSCODE_OPTION, /VS Code/);
});

test("the question names the created Tour", () => {
  assert.equal(
    openingQuestion({ tourTitle: "Payment Flow", tourPath: ".tours/payment.tour" }),
    'Open "Payment Flow" now?'
  );
  // Without a title the Tour file identifies it.
  assert.equal(
    openingQuestion({ tourTitle: null, tourPath: ".tours/changes.tour" }),
    'Open the Tour in changes.tour now?'
  );
});

test("the VS Code choice walks the CLI's Open-in-VS Code surface on the Tour file", () => {
  const command = vscodeCommand({ tourPath: ".tours/payment.tour" });
  assert.equal(command, 'codetour --internal-open-vscode ".tours/payment.tour"');
});

test("a Tour path with spaces is quoted in the VS Code contract", () => {
  const command = vscodeCommand({ tourPath: ".tours/my tour.tour" });
  assert.equal(command, 'codetour --internal-open-vscode ".tours/my tour.tour"');
});

test("no Tour file recorded, no VS Code contract", () => {
  assert.equal(vscodeCommand({ tourPath: null }), null);
  assert.equal(vscodeCommand({ tourPath: "" }), null);
  assert.equal(vscodeCommand(null), null);
});

// The Terminal choice opens the real reader immediately (review F2): the
// extension spawns the launcher CLI with inherited stdio — the SAME terminal,
// never a PTY or an independent window — and waits for the reading to end
// before handing the terminal back to the Pi session. The spawn plan is a
// pure decision here; the spawn itself is injected, so no test starts a
// process, a PTY or a TTY.

/** A fake spawn: records the call, emits the scripted end in a microtask. */
function fakeSpawn(script = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    if (script.error !== undefined) {
      queueMicrotask(() => child.emit("error", script.error));
    } else {
      const code = script.exitCode === undefined ? 0 : script.exitCode;
      queueMicrotask(() => child.emit("exit", code, script.signal ?? null));
    }
    return child;
  };
  return { spawn, calls };
}

const STATE = {
  tourTitle: "Payment Flow",
  tourPath: ".tours/payment.tour",
  workspace: "/tmp/fake-workspace",
};

const LAUNCHER = { command: "/usr/local/bin/node", args: ["/opt/codetour/cli.js"] };

test("the spawn plan drives the recorded CLI's reader in the workspace", () => {
  const plan = readerSpawnPlan(STATE, LAUNCHER);
  assert.equal(plan.command, "/usr/local/bin/node");
  assert.deepEqual(plan.args, [
    "/opt/codetour/cli.js",
    "--internal-tour",
    ".tours/payment.tour",
  ]);
  assert.equal(plan.cwd, "/tmp/fake-workspace");
});

const state1 = { tourTitle: "Payment Flow", tourPath: null, workspace: "/tmp/ws" };
const state2 = { tourTitle: "", tourPath: null, workspace: "/tmp/ws" };

test("without a recorded Tour file the plan falls back to the default reading path", () => {
  const plan = readerSpawnPlan(state1, { command: "codetour", args: [] });
  assert.equal(plan.command, "codetour");
  assert.deepEqual(plan.args, ["Payment Flow"]);
  assert.equal(plan.cwd, "/tmp/ws");
  assert.equal(readerSpawnPlan(state2, LAUNCHER), null);
  assert.equal(readerSpawnPlan({}, LAUNCHER), null);
});

test("Terminal opens the real reader immediately, in this terminal, and waits for the reading", async () => {
  const { spawn, calls } = fakeSpawn();
  const outcome = await playInTerminal(STATE, LAUNCHER, {
    spawn,
    isInteractive: () => true,
  });
  assert.equal(outcome.played, true);
  assert.equal(outcome.degraded, undefined);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.signal, null);
  assert.equal(calls.length, 1);
  // Same terminal: inherited stdio, no PTY, no independent window, the
  // workspace root as the working directory.
  assert.deepEqual(calls[0].args, [
    "/opt/codetour/cli.js",
    "--internal-tour",
    ".tours/payment.tour",
  ]);
  assert.equal(calls[0].options.cwd, "/tmp/fake-workspace");
  assert.deepEqual(calls[0].options.stdio, "inherit");
});

test("an interrupted reading is reported, the terminal still returned to the session", async () => {
  const { spawn, calls } = fakeSpawn({ exitCode: null, signal: "SIGINT" });
  const outcome = await playInTerminal(STATE, LAUNCHER, {
    spawn,
    isInteractive: () => true,
  });
  assert.equal(outcome.played, true);
  assert.equal(outcome.exitCode, null);
  assert.equal(outcome.signal, "SIGINT");
  assert.equal(calls.length, 1);
});

test("a non-TTY session degrades to the documented command, never a crash", async () => {
  const { spawn, calls } = fakeSpawn();
  const outcome = await playInTerminal(STATE, LAUNCHER, {
    spawn,
    isInteractive: () => false,
  });
  assert.equal(outcome.played, false);
  assert.equal(outcome.degraded, true);
  assert.equal(outcome.command, 'codetour "Payment Flow"');
  assert.equal(calls.length, 0);
});

test("a failed spawn degrades to the documented command instead of crashing", async () => {
  const { spawn, calls } = fakeSpawn({ error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }) });
  const outcome = await playInTerminal(STATE, LAUNCHER, {
    spawn,
    isInteractive: () => true,
  });
  assert.equal(outcome.played, false);
  assert.equal(outcome.degraded, true);
  assert.equal(outcome.command, 'codetour "Payment Flow"');
  assert.match(String(outcome.reason), /ENOENT/);
  assert.equal(calls.length, 1);
});

test("no Tour to read, no spawn plan, no degraded command", async () => {
  const { spawn, calls } = fakeSpawn();
  const outcome = await playInTerminal({}, LAUNCHER, {
    spawn,
    isInteractive: () => true,
  });
  assert.equal(outcome.played, false);
  assert.equal(outcome.command, undefined);
  assert.equal(calls.length, 0);
});
