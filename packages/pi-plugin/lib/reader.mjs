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
