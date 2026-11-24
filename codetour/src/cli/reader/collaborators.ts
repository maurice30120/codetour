import type {
  StepChatAgentIdentity,
  StepChatAnswerEvents,
  StepChatRequest
} from "../../agent/stepChatContract";
import type { AcpModelSelector } from "../../agent/acpModelOptions";
import type { CodeTour, CodeTourStep } from "../../store";
import type { ReadonlyStepContext } from "../stepContext";

/**
 * The collaborators the reading module depends on, injected from the
 * composition root (spec #93). The reader only ever sees these interfaces —
 * never a process, a DOM or a terminal — so its tests replace each one with
 * a fake at the module boundary and stay in-process.
 */

/**
 * The agent answering Tour Step Conversation questions (ADR 0026, ADR 0031):
 * the ACP failover session layer in production — `openTerminalChat`'s
 * responder over every installed candidate — adapted from the
 * Step chat support module by the composition root. The reader only sees
 * this port; the conversation lifecycle lives in the shared
 * `StepConversations` store above the seam.
 */
export interface ConversationResponder {
  /**
   * The agent answering right now: the effective Agent Profile once a
   * session handshake confirmed it, the preselected one before that. The
   * reader's role line and status line paint this, so the first installed
   * candidate is never presented as the agent that answered.
   */
  identity?(): StepChatAgentIdentity | undefined;
  agentNames?: readonly string[];
  selectAgent?(name: string): Promise<void>;
  prepareModels?(): Promise<void>;
  /**
   * The model selector the answering agent announces right now, with the
   * model it confirms: undefined when it announces no model at all, which is
   * what the picker's explicit `agent-managed model` notice reports.
   */
  model?(): AcpModelSelector | undefined;
  /**
   * Requests a model change for the agent that answers: remembered for the
   * sessions still to open and applied live on an open one. The change only
   * counts once the agent confirms it, which {@link model} then reports.
   */
  selectModel?(value: string): void | Promise<void>;
  answer(request: StepChatRequest, events?: StepChatAnswerEvents): Promise<string> | string;
  /**
   * Interrupts the in-flight answer, if any; the store's stop calls it and
   * the cancelled answer's late completion is ignored (ADR 0031).
   */
  cancel?(): void;
  /** Release the responder's agent resources; the session is over. */
  dispose?(): Promise<void> | void;
}

/**
 * Renders one Step's description to sanitized HTML. Async by nature
 * (diagram rasterization, image reading) — the await that makes the render
 * pipeline versioned. Injected so tests control latency and failures.
 */
export type DescriptionRenderer = (
  tour: CodeTour,
  index: number,
  /** The text width the description may occupy, diagram art included. */
  width: number
) => Promise<string>;

/**
 * Resolves the readonly context of one Step: the code, the diff or the
 * diagnostic the reader displays. Injected so tests never run Git.
 */
export type StepContextResolver = (
  root: string,
  tour: CodeTour,
  step: CodeTourStep
) => ReadonlyStepContext;

/** Reads one file as it exists at a commit, for grounding diff questions. */
export type CommitFileReader = (ref: string, file: string) => string | undefined;
