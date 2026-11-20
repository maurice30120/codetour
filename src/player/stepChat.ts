import { Uri, window, workspace } from "vscode";
import { ActiveTour } from "../store";
import { FS_SCHEME } from "../constants";
import { getStepFileUri } from "../utils";
import {
  AgentSelection,
  type AgentAvailability
} from "../agent/agentCatalogue";
import { createFallbackStepChatResponder } from "../agent/fallbackStepChatAgent";
import {
  StepConversations,
  type StepConversationView
} from "../agent/stepConversations";
import { getStepDiff, getStepDiffPath } from "./diff";
import { renderMarkdownToHtml } from "./markdown";

/**
 * The Tour Step Conversation painter of the Expanded Description View
 * (webview chat).
 *
 * Message protocol between the webview and the extension:
 *
 * - webview → extension: `{ type: "askQuestion", question, token,
 *   targetTourId, step }` submits the reader's question for the rendered
 *   step, with the same identity as every other webview message.
 * - webview → extension: `{ type: "stopQuestion", token, targetTourId,
 *   step }` interrupts the step's answer in flight: the responder's
 *   exchange is cancelled, the interrupted state is displayed in the
 *   chat and a new question is accepted immediately.
 * - extension → webview: `{ type: "stepChat", exchanges, responding,
 *   agent }` replaces the rendered conversation of the step. Each exchange
 *   is a question with the answer HTML produced by the shared renderer and
 *   sanitizer, captioned with the agent that produced it; a failed exchange
 *   carries the error message instead of a responder answer. `agent` is the
 *   agent answering right now — the effective Agent Profile once a session
 *   handshake confirmed it, the preselected one before that. The answer streams chunk by chunk: one update per
 *   received chunk, `responding` true and the latest exchange `pending`
 *   while the answer is in progress, `responding` false once it is
 *   complete. A question is blocked while the step's previous answer is
 *   still in progress.
 *
 * The conversation lifecycle — store, blocking, history, interruption and
 * failures — lives in the shared StepConversations module above the
 * responder seam, common to every playback surface. This file only paints
 * the stored exchanges as sanitized HTML: the webview's own knowledge is
 * the step context capture, which reads the displayed buffers.
 */

import type {
  StepChatAgentIdentity,
  StepChatAnswerEvents,
  StepChatContext,
  StepChatDiffSide,
  StepChatHistoryEntry,
  StepChatRequest,
  StepChatResponder,
  StepChatToolUse
} from "../agent/stepChatContract";
import { StepChatAgentUnavailableError } from "../agent/stepChatContract";

export type {
  StepChatAgentIdentity,
  StepChatAnswerEvents,
  StepChatContext,
  StepChatDiffSide,
  StepChatHistoryEntry,
  StepChatRequest,
  StepChatResponder,
  StepChatToolUse
};
export { StepChatAgentUnavailableError };

/** The shared conversation store: every surface keeps only its painter. */
const conversations = new StepConversations();

/**
 * The reading panel's Agent Selection and the responder over it. Both live
 * as long as the panel: nothing probed survives the webview (ADR 0048).
 */
let agents: { selection: AgentSelection; responder: StepChatResponder } |
  undefined;
/** True while a responder was injected instead of the catalogued one. */
let injectedResponder = false;

/**
 * The Agent Selection the panel opens, composed by the extension at
 * activation with the catalogued Agent Probe. Without one — the deterministic
 * tests, or a host composing none — the panel starts no probe at all.
 */
let createSelection: (() => AgentSelection) | undefined;

/** Composes (or removes) the Agent Selection the reading panel opens. */
export function setStepChatAgentSelection(
  create?: () => AgentSelection
): void {
  createSelection = create;
}

/**
 * Injects (or removes) the responder answering step chat questions. While one
 * is injected the panel starts no Agent Probe of its own.
 */
export function setStepChatResponder(next?: StepChatResponder): void {
  injectedResponder = next !== undefined;
  agents?.selection.dispose();
  agents = undefined;
  conversations.setResponder(next);
}

/**
 * Opens the reading panel's Agent Selection: the catalogue, the availability
 * the initial Agent Probe establishes and the agent answering by default.
 *
 * The probe runs sequentially in rank order and stops at the first available
 * profile; `onProbed` reports that it settled, so the reader sees the probed
 * states and the preselected agent instead of provisional ones.
 */
export function openStepChatAgents(
  workspaceRoot: string,
  onProbed?: () => void
): void {
  closeStepChatAgents();
  if (injectedResponder || !createSelection) return;
  const selection = createSelection();
  const responder = createFallbackStepChatResponder(
    cwd => selection.candidates(cwd),
    {
      // A question asked while the initial probe runs waits for it: it is
      // never sent to an Agent Profile the panel has not verified.
      whenReady: () => selection.whenInitialProbeSettled(),
      onConversationStarted: () => selection.hasConversationStarted()
    }
  );
  agents = { selection, responder };
  conversations.setResponder(responder);
  void selection
    .probeInitial(workspaceRoot)
    .then(() => onProbed?.(), () => onProbed?.());
}

/** Closes the reading panel's Agent Selection: its cache does not outlive it. */
export function closeStepChatAgents(): void {
  const current = agents;
  agents = undefined;
  current?.selection.dispose();
}

/** One catalogue profile as the webview paints it: serializable, no entry. */
export interface StepChatAgentView {
  name: string;
  state: AgentAvailability["state"];
  /** The authentication methods' names, or the connection error's reason. */
  detail?: string;
  /** True for the Agent Profile that answers by default. */
  selected: boolean;
}

function conversationKey(tourId: string, step: number): string {
  return `${tourId}::${step}`;
}

/** One question with its answer, as the webview renders it. */
export interface StepChatExchangeView {
  question: string;
  answerHtml: string;
  activityHtml?: string;
  // The forbidden tools the agent executed during this answer: reported
  // live while the answer streams and kept after it completes or stops.
  forbiddenTools?: StepChatToolUse[];
  failed?: boolean;
  // True while this question's answer is still streaming.
  pending?: boolean;
  // True when the reader stopped this answer: the partial answer stays
  // readable, marked as interrupted.
  interrupted?: boolean;
  // The agent that produced this answer, when the responder named one.
  agent?: StepChatAgentIdentity;
}

/** The conversation of a step, with its response-in-progress state. */
export interface StepChatConversationView {
  exchanges: StepChatExchangeView[];
  // True while the step's latest question is still being answered: new
  // questions are blocked until it turns false.
  responding: boolean;
  // The agent answering the step right now: effective after the session
  // handshake, preselected before it.
  agent?: StepChatAgentIdentity;
  // The Agent Catalogue with each profile's probed availability; absent when
  // no selection owns the panel (an injected responder).
  agents?: StepChatAgentView[];
  // True when the initial probe settled and no profile can answer: the
  // composer is disabled and the panel explains it.
  unavailable?: boolean;
}

/** The conversation of a step with its response-in-progress state. */
export function getStepChatConversationView(
  tourId: string,
  step: number
): StepChatConversationView {
  return paint(
    conversations.view(conversationKey(tourId, step)),
    conversations.identity()
  );
}

/**
 * The catalogue as the webview paints it, and whether any profile can answer
 * at all. Before the initial probe settles no state is final, so nothing is
 * announced as unusable yet.
 */
function paintAgents(): {
  agents?: StepChatAgentView[];
  unavailable?: boolean;
} {
  const selection = agents?.selection;
  if (!selection) {
    return {};
  }
  return {
    agents: selection.profiles().map(view => ({
      name: view.profile.name,
      state: view.availability.state,
      detail: availabilityDetail(view.availability),
      selected: view.selected
    })),
    unavailable:
      selection.initialProbeSettled() && selection.selectedProfile() === undefined
  };
}

/** The extra fact a profile's state carries, when it carries one. */
function availabilityDetail(
  availability: AgentAvailability
): string | undefined {
  if (availability.state === "auth-required") {
    const names = availability.authMethods.map(method => method.name);
    return names.length ? names.join(", ") : undefined;
  }
  return availability.state === "connection-error"
    ? availability.reason
    : undefined;
}

/** Forgets every step conversation; called when the reading webview closes. */
export function clearStepChatConversations(): void {
  conversations.clear();
}

/** Paints the shared store's raw conversation as the webview renders it. */
function paint(
  view: StepConversationView,
  agent: StepChatAgentIdentity | undefined
): StepChatConversationView {
  return {
    exchanges: view.exchanges.map(exchange => ({
      question: exchange.question,
      // Every displayed answer crosses the shared sanitizer: the
      // streamed chunks and the settled answer alike.
      answerHtml: exchange.interrupted
        ? interruptedAnswerHtml(renderMarkdownToHtml(exchange.answer))
        : renderMarkdownToHtml(exchange.answer),
      activityHtml: exchange.activity
        ? renderMarkdownToHtml(exchange.activity)
        : undefined,
      forbiddenTools: exchange.toolUses.filter(tool => tool.forbidden),
      failed: exchange.failed || undefined,
      pending: exchange.pending || undefined,
      interrupted: exchange.interrupted || undefined,
      agent: exchange.agent
    })),
    responding: view.responding,
    agent,
    ...paintAgents()
  };
}

/** The displayed answer of a stopped exchange, with its interruption. */
function interruptedAnswerHtml(streamedAnswer: string): string {
  return `${streamedAnswer}<p class="step-chat-interrupted" role="status">Answer interrupted.</p>`;
}

/**
 * Captures the step context faithful to what the reader is shown, reusing
 * the reader's own target resolution across every step target kind.
 *
 * - A diff step captures the persisted comparison's two sides as such, each
 *   identified with its own path and Git commit.
 * - Any other code step captures the buffer of the exact target the render
 *   resolved — the Git snapshot of a Changes Tour step, never the current
 *   workspace file, the virtual document of an embedded-content step, or
 *   the open buffer of a file or URI step, unsaved edits included.
 * - A step without code (a directory, a view or a plain explanation)
 *   passes the declared target, if any, without any substitute code.
 * - A target that is not currently displayed is reported unavailable,
 *   never silently replaced by another file.
 */
export async function resolveStepContext(
  active: ActiveTour
): Promise<StepChatContext> {
  const tour = active.tour;
  const step = tour.steps[active.step];
  const description = step?.description ?? "";
  if (!step) {
    return { available: false, description };
  }

  if (step.display === "diff" && step.file) {
    const diff = await getStepDiff(step, tour, active.workspaceRoot);
    if (diff) {
      try {
        // The same snapshot documents the render displays, already opened
        // by the reader's resolution.
        const [original, modified] = await Promise.all([
          readDisplayedSide(diff.original),
          readDisplayedSide(diff.modified)
        ]);
        return {
          available: true,
          path: getStepDiffPath(step),
          diff: {
            original: {
              path: step.baseFile || step.file,
              ref: tour.baseRef!,
              code: original
            },
            modified: { path: step.file, ref: tour.ref!, code: modified }
          },
          description
        };
      } catch {
        // A side that cannot be read falls back to the single-target
        // resolution below, exactly like the render's own fallback.
      }
    }
  }

  // The virtual document of an embedded-content step, as the reader's own
  // resolution opens it.
  if (step.contents !== undefined) {
    const target = Uri.parse(`${FS_SCHEME}://current/${step.file}`);
    const editor = window.visibleTextEditors.find(
      editor => editor.document.uri.toString() === target.toString()
    );
    if (!editor) {
      return { available: false, path: step.file, description };
    }
    return {
      available: true,
      path: step.file,
      code: editor.document.getText(),
      description
    };
  }

  const file = step.file || step.uri;
  if (file) {
    // The same resolution the render performs: the Git snapshot of a Changes
    // Tour step, the current buffer of an ordinary step.
    const uri = await getStepFileUri(
      step,
      active.workspaceRoot,
      step.display === "diff" ? undefined : tour.ref
    );
    const editor = window.visibleTextEditors.find(
      editor => editor.document.uri.toString() === uri.toString()
    );
    if (!editor) {
      return { available: false, path: file, description };
    }

    return {
      available: true,
      path: file,
      code: editor.document.getText(),
      description
    };
  }

  // A directory-anchored step presents no code: the declared directory is
  // the target the agent receives, never a substitute buffer.
  if (step.directory) {
    return { available: false, path: step.directory, description };
  }

  // No code target at all: a view or plain explanation step.
  return { available: false, description };
}

async function readDisplayedSide(uri: Uri): Promise<string> {
  return (await workspace.openTextDocument(uri)).getText();
}

/**
 * Asks the injected responder for the rendered step, records the exchange
 * in the step's conversation and returns the updated webview conversation.
 *
 * The answer streams: each received chunk is reported through `onProgress`
 * with the response-in-progress state visible, until the complete answer
 * turns it off. A new question is blocked while the step's previous answer
 * is still in progress: it never reaches the responder.
 */
export async function askTourStepQuestion(
  active: ActiveTour,
  question: string,
  onProgress?: (view: StepChatConversationView) => void
): Promise<StepChatConversationView> {
  const key = conversationKey(active.tour.id, active.step);
  const stored = await conversations.ask(
    key,
    question,
    {
      context: () => resolveStepContext(active),
      workspaceRoot: active.workspaceRoot?.fsPath ?? ""
    },
    () => onProgress?.(getStepChatConversationView(active.tour.id, active.step))
  );
  const view = paint(stored, conversations.identity());
  onProgress?.(view);
  return view;
}

/**
 * Interrupts the step's answer in flight and returns the updated webview
 * conversation.
 *
 * The responder's exchange is cancelled and the stopped exchange keeps
 * whatever already streamed, marked as interrupted; the late completion
 * of the cancelled answer is ignored. A new question is accepted
 * immediately, without reloading the webview. Stopping with no answer in
 * flight changes nothing.
 */
export function stopTourStepQuestion(
  active: ActiveTour,
  onProgress?: (view: StepChatConversationView) => void
): StepChatConversationView {
  const view = paint(
    conversations.stop(conversationKey(active.tour.id, active.step)),
    conversations.identity()
  );
  onProgress?.(view);
  return view;
}
