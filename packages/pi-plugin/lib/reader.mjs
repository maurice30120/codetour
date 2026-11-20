// The opening dialogue of the Pi plugin (ticket #242).
//
// At the end of a generation the plugin asks the user to open the created Tour
// through one of the two real surfaces — never a textual summary:
//
//   Terminal : the shipped CLI's real interactive reader, on the reader
//              view-model seam (tickets #240, #241), in the agent's own
//              terminal, never an independent window;
//   VS Code  : the "Open in VS Code" contract of ticket #244, the Tour with
//              its step — wired here against the explicit URI contract the
//              extension already serves (src/extension.ts: `tour`, then the
//              1-based `step`); the final wiring is verified at merge time by
//              T5.
//
// The extension never spawns anything (no subprocess, no PTY): the decision
// module only names the exact command for the user's surface.
//
// Pure decisions, no I/O beyond the run state passed in, so the dialogue can
// be tested without a Pi session, exactly like `guard.mjs`.

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
 * The deep-link address of the Tour, on the explicit uri contract of the
 * VS Code extension's handler: the recorded Tour file plus the active step,
 * numbered 1 (the first Step after generation).
 */
export function vscodeUri(state) {
  if (!state || state.tourCreated !== true) return null;
  if (typeof state.tourPath !== "string" || state.tourPath === "") return null;
  const tour = encodeURIComponent(state.tourPath);
  return `vscode://maurice30120.codetour/openTour?tour=${tour}&step=1`;
}

/**
 * The command that hands the address to VS Code from the user's terminal:
 * `code --open-url` routes to the window holding this workspace (a new one
 * when none does) — the window-reuse decision stays with VS Code, the
 * duplicate-window detection is ticket #244's.
 */
export function vscodeOpenCommand(state) {
  const uri = vscodeUri(state);
  return uri ? `code --open-url ${shellQuote(uri)}` : null;
}
