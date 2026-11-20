import type { StepChatAgentIdentity } from "../../agent/stepChatContract";
import type { ConversationState, ReaderStatusLine } from "./viewModel";

/**
 * The status line of the reader as pure data: the mode chip, the key hints
 * and the right-side segments in their fixed precedence (spec #93, #240). The
 * adapter joins and truncates the segments; the order — voice state first,
 * then speech warning, the answering Agent Profile, exchange count, and the
 * Open-in-VS Code warning last (spec #239 review F3) — is reading behavior
 * the tests pin, because a narrow terminal cuts the least important segments
 * and never the voice state (spec #79, #244).
 */

/** "1 exchange" / "n exchanges", shared by the conversation head meta and the status line. */
export function exchangesLabel(count: number): string {
  return count + (count === 1 ? " exchange" : " exchanges");
}

/**
 * The agent the reader names, shared by the conversation panel's role line
 * and the status line's Agent Profile segment: the Agent Profile in the
 * reader's lowercase chrome, its effective model when the agent announces
 * one, and whether a session handshake confirmed it or it is still only
 * preselected.
 */
export function agentIdentityLabel(identity: StepChatAgentIdentity): string {
  const label = identity.model
    ? `${identity.agent.toLowerCase()} · ${identity.model}`
    : identity.agent.toLowerCase();
  return label + (identity.effective ? " (effective)" : " (preselected)");
}

export interface StatusLineInput {
  /** The conversation state the mode chip and hints depend on (spec #93). */
  conversation: ConversationState;
  compactHints: boolean;
  narrationEnabled: boolean;
  speechWarning: string | undefined;
  /** Whether the Open-in-VS Code collaborator is wired; owns the `o open` hint (ticket #244). */
  canOpenInVsCode: boolean;
  /** Whether the responder accepts a model change; owns the `m model` hint (ticket #266). */
  canSelectModel: boolean;
  /** The latest nonblocking Open-in-VS Code failure, cleared by a later success. */
  openWarning: string | undefined;
  /**
   * The latest model change the agent did not adopt, cleared by a later
   * confirmed one (ticket #266). It sits next to the Agent Profile it is about.
   */
  modelWarning: string | undefined;
  /** The agent answering right now, when an agent is installed. */
  agent: StepChatAgentIdentity | undefined;
  exchangeCount: number;
}

export function statusLine(input: StatusLineInput): ReaderStatusLine {
  const { asking, responding, hasResponder } = input.conversation;
  // Ask mode owns the keyboard and wins the mode chip over a streaming answer.
  const mode = asking ? "ASK" : responding ? "WAIT" : "READ";
  let hints: string;
  if (asking) {
    hints = " enter send · esc cancel";
  } else {
    const keys = input.compactHints
      ? ["←/→ step", "j/k scroll"]
      : ["←/→ previous/next", "j/k scroll", "PgUp/PgDn page"];
    if (hasResponder && !responding) keys.push("a ask");
    if (input.canSelectModel && !responding) keys.push("m model");
    if (input.canOpenInVsCode) keys.push("o open");
    // While an answer streams, quitting would lose it: the same key first
    // interrupts the answer in flight (ADR 0031).
    keys.push(responding ? "q stop" : "q quit");
    hints = " " + keys.join(" · ");
  }
  const rightSegments: string[] = [
    input.narrationEnabled ? "VOICE ON" : "VOICE OFF"
  ];
  if (input.speechWarning) rightSegments.push(input.speechWarning);
  if (input.agent) rightSegments.push(agentIdentityLabel(input.agent));
  // The model warning describes the agent it follows, so it goes before the
  // exchange count: a refused model says something about the agent, not about
  // the conversation's volume.
  if (input.modelWarning) rightSegments.push(input.modelWarning);
  if (input.exchangeCount) rightSegments.push(exchangesLabel(input.exchangeCount));
  // The Open-in-VS Code failure is the outermost, least reading-essential
  // segment: it preserves the documented fixed precedence of spec #240.
  if (input.openWarning) rightSegments.push(input.openWarning);
  return { mode, hints, rightSegments };
}
