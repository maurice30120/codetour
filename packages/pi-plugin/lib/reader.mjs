// The opening dialogue of the Pi plugin (ticket #242).
//
// At the end of a generation the plugin asks the user to open the created Tour
// through one of the two real surfaces — never a textual summary:
//
//   Terminal : the shipped CLI's real interactive reader, on the reader
//              view-model seam (tickets #240, #241), in the agent's own
//              terminal, never an independent window;
//   VS Code  : the "Open in VS Code" opening (ticket #244) through the
//              shipped CLI's non-interactive surface
//              `codetour --internal-open-vscode <tour path> [workspace]`,
//              which reuses the T5 decision module as-is (canonical
//              workspace, window detection, plan, executor). The dialogue
//              builds no URI and owns no opening logic of its own.
//
// The Terminal choice spawns the resolved launcher reader itself with
// inherited stdio — the SAME terminal, never a PTY and never an independent
// window — and waits for the reading to end before handing the terminal back
// to the session. The VS Code choice only names the exact command; the
// extension never opens a PTY and never runs a shell.
//
// Pure decisions plus one injected spawn; no I/O beyond that, so the dialogue
// can be tested without a Pi session, exactly like `guard.mjs`.

import { spawn as nodeSpawn } from "node:child_process";

/** Quote one shell word: double quotes around it, embedded quotes escaped. */
function shellQuote(value) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * The exact CLI invocation that opens the real interactive reader of the
 * created Tour, at the workspace root, or null when no Tour exists to read.
 *
 * The recorded title walks the default reading path (the terminal reader is
 * the CLI's default renderer, ticket #241); the recorded Tour file drives the
 * reader directly when no title is available.
 */
export function readerCommand(state) {
  if (!state || state.tourCreated !== true) return null;
  if (typeof state.tourTitle === "string" && state.tourTitle !== "") {
    return `codetour ${shellQuote(state.tourTitle)}`;
  }
  if (typeof state.tourPath === "string" && state.tourPath !== "") {
    return `codetour --internal-tour ${shellQuote(state.tourPath)}`;
  }
  return null;
}

/**
 * The spawn plan of the Terminal choice (review F2): the recorded launcher —
 * the very CLI that installed this package — minus its `mcp` subcommand,
 * driving the real interactive reader, in the workspace, at the workspace
 * root. The recorded Tour file drives the reader directly when it exists (the
 * deterministic internal route, no discovery, no selection prompt); the
 * recorded title walks the default reading path otherwise. Null when no Tour
 * exists to read.
 */
export function readerSpawnPlan(state, launcher) {
  if (!state || state.tourCreated !== true) return null;
  const base = Array.isArray(launcher?.args) ? [...launcher.args] : [];
  if (base[base.length - 1] === "mcp") base.pop();
  const command = typeof launcher?.command === "string" && launcher.command !== ""
    ? launcher.command
    : "codetour";
  const cwd = typeof state.workspace === "string" && state.workspace !== ""
    ? state.workspace
    : undefined;
  if (typeof state.tourPath === "string" && state.tourPath !== "") {
    return { command, args: [...base, "--internal-tour", state.tourPath], cwd };
  }
  if (typeof state.tourTitle === "string" && state.tourTitle !== "") {
    return { command, args: [...base, state.tourTitle], cwd };
  }
  return null;
}

/** Whether this process owns an interactive terminal for the reader. */
function interactiveSession() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * The Terminal choice performed (review F2): spawn the resolved launcher
 * reader with inherited stdin/stdout — the SAME terminal, never a PTY and
 * never an independent window — wait for the reading to end, then return the
 * terminal to the calling Pi session. A non-interactive session or a failed
 * spawn degrades to the documented hand-over command (`readerCommand`), never
 * a crash and never a textual summary in the Tour's place.
 *
 * `deps` are the test seams: `spawn` (default `node:child_process`.spawn),
 * `isInteractive` (default the process's own TTY state).
 */
export async function playInTerminal(state, launcher, deps = {}) {
  const plan = readerSpawnPlan(state, launcher);
  if (!plan) return { played: false };
  const isInteractive = deps.isInteractive ?? interactiveSession;
  const spawn = deps.spawn ?? nodeSpawn;
  if (!isInteractive()) {
    return { played: false, degraded: true, command: readerCommand(state),
      reason: "This session terminal is not interactive (no TTY): the reader " +
        "cannot take control. Run the command below from an interactive terminal instead." };
  }
  const ended = await new Promise((resolve) => {
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", (error) => resolve({ error }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (ended.error !== undefined) {
    const message = ended.error instanceof Error ? ended.error.message : String(ended.error);
    return { played: false, degraded: true, command: readerCommand(state), reason: message };
  }
  return { played: true, exitCode: ended.code, signal: ended.signal };
}

/** The two real openings of the end-of-generation question, in offer order. */
export const TERMINAL_OPTION = "Terminal — the real interactive reader";
export const VSCODE_OPTION = "VS Code — the Tour at the active step";

export function openingOptions() {
  return [TERMINAL_OPTION, VSCODE_OPTION];
}

/** The end-of-generation question, or null without a Tour to open. */
export function openingQuestion(state) {
  if (!state || state.tourCreated !== true) return null;
  if (typeof state.tourTitle === "string" && state.tourTitle !== "") {
    return `Open ${shellQuote(state.tourTitle)} now?`;
  }
  const base =
    typeof state.tourPath === "string" && state.tourPath !== ""
      ? state.tourPath.split("/").pop()
      : null;
  return base ? `Open the Tour in ${base} now?` : null;
}

/**
 * The CLI command that opens the created Tour in VS Code at its active step
 * (the first one after a generation), or null when no Tour exists to open.
 * All the opening logic — canonical workspace, no duplicate window, the
 * VS Code-absent case — stays in the T5 decision module behind this surface.
 */
export function vscodeCommand(state) {
  if (!state || state.tourCreated !== true) return null;
  if (typeof state.tourPath === "string" && state.tourPath !== "") {
    return `codetour --internal-open-vscode ${shellQuote(state.tourPath)}`;
  }
  return null;
}
