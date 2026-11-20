import type { ConversationState } from "./viewModel";

/**
 * The keyboard of the reader, translated once into logical actions the
 * state machine applies (spec #93). Pure: the reader assembles the facts a
 * key depends on and runs {@link translateKey} through its single dispatch
 * — the same call that answers the adapter's `wouldConsume` query
 * (`"unhandled"` means: pass it through to the terminal untouched, no
 * preventDefault). The reader applies the returned action to its own state.
 */

/** One key input, the logical shape of the adapter's keyboard event. */
export interface ReaderKeyEvent {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
}

/** The reading facts a key dispatch depends on. */
export interface ReaderKeyState {
  /** The conversation state the dispatch depends on (spec #93). */
  conversation: ConversationState;
  /** Suggested questions of the active Step, in order; keys 1-9 ask them. */
  suggestions: string[];
  currentStep: number;
  stepCount: number;
  /** One screenful of the Step box, for the paging keys. */
  pageRows: number;
  /** Whether the Open-in-VS Code collaborator is wired; without it the `o` key stays terminal-owned. */
  canOpenInVsCode: boolean;
  /**
   * Whether the responder accepts a model change; without it the `m` key stays
   * terminal-owned (ticket #266).
   */
  canSelectModel: boolean;
  /**
   * Whether the model picker is up: it is modal, so it owns every unmodified
   * key until it closes (ticket #266).
   */
  pickerOpen: boolean;
}

export type ReaderKeyAction =
  | { type: "unhandled" }
  | { type: "quit" }
  | { type: "stop-answer" }
  | { type: "enter-ask-mode" }
  | { type: "ask-suggestion"; question: string }
  | { type: "navigate"; step: number }
  | { type: "toggle-voice" }
  | { type: "open-in-vscode" }
  | { type: "open-model-picker" }
  | { type: "picker-move"; delta: number }
  | { type: "picker-accept" }
  | { type: "picker-cancel" }
  | { type: "picker-ignored" }
  | { type: "scroll"; delta: number }
  | { type: "draft-append"; text: string }
  | { type: "draft-backspace" }
  | { type: "submit-draft" }
  | { type: "cancel-draft" };

/**
 * Dispatch one key exactly as the reader always has: the open model picker
 * holds the keyboard first, the ask-mode prompt next, then the reading-mode
 * keys in their fixed order.
 */
export function translateKey(state: ReaderKeyState, event: ReaderKeyEvent): ReaderKeyAction {
  const { asking, responding, hasResponder } = state.conversation;
  // The model picker is modal: while it is up its keys come first, so no
  // reading key fires underneath it (ticket #266). Modified combinations stay
  // unhandled — Ctrl+C must still reach the terminal.
  if (state.pickerOpen) {
    if (event.ctrl || event.meta || event.alt) return { type: "unhandled" };
    if (event.key === "ArrowDown" || event.key === "j") {
      return { type: "picker-move", delta: 1 };
    }
    if (event.key === "ArrowUp" || event.key === "k") {
      return { type: "picker-move", delta: -1 };
    }
    if (event.key === "Enter") return { type: "picker-accept" };
    if (event.key === "Escape" || event.key === "q" || event.key === "m") {
      return { type: "picker-cancel" };
    }
    // A key the picker does not map changes nothing and never reaches the
    // reading keys: the picker owns the keyboard while it is up.
    return { type: "picker-ignored" };
  }
  if (asking) {
    if (event.key === "Enter") return { type: "submit-draft" };
    if (event.key === "Escape") return { type: "cancel-draft" };
    if (event.key === "Backspace") return { type: "draft-backspace" };
    if (event.key.length === 1) return { type: "draft-append", text: event.key };
    return { type: "unhandled" };
  }
  // While an answer streams, the reading must survive: `q` and Escape
  // interrupt the Step's answer in flight instead of quitting the reader,
  // and a second press quits once nothing is in flight (ADR 0031).
  if (event.key === "q" || event.key === "Escape") {
    return responding ? { type: "stop-answer" } : { type: "quit" };
  }
  if (event.key === "a" && hasResponder && !responding) {
    return { type: "enter-ask-mode" };
  }
  if (/^[1-9]$/.test(event.key)) {
    const question = state.suggestions[Number(event.key) - 1];
    // A digit without its suggestion, or while an answer streams, falls
    // through unhandled — the terminal sees the key.
    if (question !== undefined && !responding) {
      return { type: "ask-suggestion", question };
    }
    return { type: "unhandled" };
  }
  if ((event.key === "ArrowRight" || event.key === "n") &&
    state.currentStep < state.stepCount - 1) {
    return { type: "navigate", step: state.currentStep + 1 };
  }
  if ((event.key === "ArrowLeft" || event.key === "p") && state.currentStep > 0) {
    return { type: "navigate", step: state.currentStep - 1 };
  }
  if (event.key === "v" || event.key === "V") {
    // A single unmodified V toggles the voice: Ctrl+V, Cmd+V and Alt+V are
    // not the narration shortcut (spec #79). A "v" typed in the ask prompt
    // never reaches this branch — it stayed draft text.
    if (event.ctrl || event.meta || event.alt) return { type: "unhandled" };
    return { type: "toggle-voice" };
  }
  if (event.key === "o" && state.canOpenInVsCode) {
    // The unmodified `o` opens the Tour in VS Code at the active Step; a
    // modified `o` and an `o` typed in the ask prompt are not the shortcut.
    if (event.ctrl || event.meta || event.alt) return { type: "unhandled" };
    return { type: "open-in-vscode" };
  }
  if (event.key === "m" && state.canSelectModel && !responding) {
    // The unmodified `m` lists the models the agent announces (ticket #266):
    // never while an answer streams, so no exchange mixes two models, and
    // never a modified `m`.
    if (event.ctrl || event.meta || event.alt) return { type: "unhandled" };
    return { type: "open-model-picker" };
  }
  if (event.key === "j" || event.key === "ArrowDown") return { type: "scroll", delta: 1 };
  if (event.key === "k" || event.key === "ArrowUp") return { type: "scroll", delta: -1 };
  if (event.key === "PageDown" || event.key === " ") {
    return { type: "scroll", delta: state.pageRows };
  }
  if (event.key === "PageUp") return { type: "scroll", delta: -state.pageRows };
  return { type: "unhandled" };
}
