import { Uri, window, workspace } from "vscode";
import { ActiveTour } from "../store";
import { FS_SCHEME } from "../constants";
import { getStepFileUri } from "../utils";
import {
  AgentSelection,
  isSelectable,
  type AgentAvailability
} from "../agent/agentCatalogue";
import type { AcpModelValue } from "../agent/acpModelOptions";
import { signInPlan, type AgentSignInPlan } from "../agent/agentAuth";
import { authenticateAgentProfile } from "../agent/agentProbe";
import { createFallbackStepChatResponder } from "../agent/fallbackStepChatAgent";
import {
  StepConversations,
  type StepConversationView
} from "../agent/stepConversations";
import { getStepDiff, getStepDiffPath } from "./diff";
import {
  renderMarkdownToHtml,
  type TourAgentAvailability
} from "./markdown";

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
 * - webview → extension: `{ type: "retryQuestion", question, token,
 *   targetTourId, step }` asks the failed exchange's question again, to the
 *   same agent: the reader's choice is never replaced by a failure.
 * - webview → extension: `{ type: "chooseAgent", agent, token,
 *   targetTourId, step }` makes the chosen Agent Profile answer, and
 *   `{ type: "refreshAgents", ... }` / `{ type: "probeUnverified", ... }`
 *   re-probe the catalogue or the profiles still unverified, once.
 * - webview → extension: `{ type: "signIn", agent, token, targetTourId,
 *   step }` is the reader's own request to connect that Agent Profile. It is
 *   never sent by CodeTour on its own: no probe and no switch authenticates
 *   anything.
 * - webview → extension: `{ type: "chooseModel", model, token,
 *   targetTourId, step }` remembers the reader's model for the answering
 *   Agent Profile and applies it live when its session is open.
 * - extension → webview: `{ type: "stepChat", exchanges, responding,
 *   agent, modelOptions, model }` replaces the rendered conversation of the
 *   step. Each exchange
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
let agents:
  | {
      selection: AgentSelection;
      responder: StepChatResponder;
      workspaceRoot: string;
      // Reposts the painted conversation whenever the panel's agents change.
      onSettled?: () => void;
    }
  | undefined;
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
 * The responder answering a question with the panel's current Agent
 * Selection: the catalogue alone decides which profile is launched.
 */
function composeResponder(selection: AgentSelection): StepChatResponder {
  return createFallbackStepChatResponder(
    cwd => selection.candidates(cwd),
    {
      // A question asked while the initial probe runs waits for it: it is
      // never sent to an Agent Profile the panel has not verified.
      whenReady: () => selection.whenInitialProbeSettled(),
      onConversationStarted: () => selection.hasConversationStarted(),
      // The profile whose session proved effective is the one the panel
      // names: an initial fall-through completes its slide here, while an
      // explicit choice stays the reader's.
      onAgentAnswered: name => selection.recordAnswer(name),
      // A conversation failure degrades only the profile that failed: no
      // probe runs, the other cached states stay, and the selector shows the
      // state the reader would otherwise never see.
      onProfileFailed: (name, reason) => {
        selection.degrade(name, reason);
        agents?.onSettled?.();
      },
      // Model identifiers belong to one agent: the reader's model choice is
      // remembered per Agent Profile and replayed on each session it opens.
      modelFor: name => ({
        modelFor: () => selection.modelFor(name),
        remember: value => selection.chooseModel(name, value),
        recordEffective: (value, offered) => {
          selection.recordEffective(name, value, offered);
          // The agent is the only source of truth for the model displayed: a
          // confirmed value repaints the panel, even one the agent changed by
          // itself between two questions.
          agents?.onSettled?.();
        }
      })
    }
  );
}

/**
 * Opens the reading panel's Agent Selection: the catalogue, the availability
 * the initial Agent Probe establishes and the agent answering by default.
 *
 * The probe runs sequentially in rank order and stops at the first available
 * profile; `onSettled` reports that it settled, so the reader sees the probed
 * states and the preselected agent instead of provisional ones. The same
 * callback repaints the panel whenever the panel's agents change afterwards.
 */
export function openStepChatAgents(
  workspaceRoot: string,
  onSettled?: () => void
): void {
  closeStepChatAgents();
  if (injectedResponder || !createSelection) return;
  const selection = createSelection();
  const responder = composeResponder(selection);
  agents = { selection, responder, workspaceRoot, onSettled };
  conversations.setResponder(responder);
  void selection
    .probeInitial(workspaceRoot)
    .then(() => onSettled?.(), () => onSettled?.());
}

/** Closes the reading panel's Agent Selection: its cache does not outlive it. */
export function closeStepChatAgents(): void {
  const current = agents;
  agents = undefined;
  current?.selection.dispose();
}

/**
 * Re-probes the whole catalogue on the reader's request: the manual way to
 * retry after installing or connecting something.
 */
export async function refreshStepChatAgents(): Promise<void> {
  const current = agents;
  if (!current) return;
  await current.selection.refresh(current.workspaceRoot);
  current.onSettled?.();
}

/**
 * Probes the profiles still `unverified`, once: what opening the agent
 * selector asks for. Nothing already established is probed again.
 */
export async function probeStepChatUnverifiedAgents(): Promise<void> {
  const current = agents;
  if (!current) return;
  await current.selection.probeUnverified(current.workspaceRoot);
  current.onSettled?.();
}

/**
 * Connects the Agent Profile the reader asked to sign in to, and re-probes it
 * alone.
 *
 * The agent's own terminal authentication command runs in a VS Code terminal
 * when its method declares one; otherwise the ACP method the agent handles
 * itself is called on a throwaway transport. Nothing is authenticated that the
 * reader did not ask for — no probe, no switch and no failure triggers this —
 * and only the profile the reader connected is probed again: every other
 * state stays cached, and the step history and the chosen agent are untouched.
 */
export async function signInStepChatAgent(name: string): Promise<void> {
  const current = agents;
  if (!current || conversations.hasAnswerInFlight()) return;
  const profile = current.selection.profile(name);
  const plan = signInPlan(current.selection.authMethods(name));
  if (!profile || !plan) return;

  if (plan.kind === "terminal") {
    openAuthTerminal(plan, current.workspaceRoot);
  } else {
    try {
      await authenticateAgentProfile(profile, current.workspaceRoot, plan.methodId);
    } catch {
      // The reader's action failed: say so instead of pretending anything was
      // connected, and let the re-probe keep showing the real state.
      void window.showWarningMessage(`Could not sign in to ${profile.name}.`);
    }
  }

  await current.selection.probeProfile(name, current.workspaceRoot);
  current.onSettled?.();
}

/**
 * Opens the terminal the agent's terminal authentication method declares: the
 * reader sees the command the agent asked for, in a shell of their own, and
 * CodeTour types nothing into it.
 */
function openAuthTerminal(
  plan: Extract<AgentSignInPlan, { kind: "terminal" }>,
  workspaceRoot: string
): void {
  window
    .createTerminal({
      name: plan.label,
      shellPath: plan.command,
      shellArgs: plan.args,
      env: plan.env,
      cwd: workspaceRoot || undefined
    })
    .show();
}

/**
 * Makes the reader's chosen Agent Profile answer this panel: the current
 * responder's session is released and a fresh responder is composed over the
 * same selection and the same conversation store, so the step history stays
 * and the next question opens a new session. A profile the reader cannot pick
 * and a choice made while an answer streams are both ignored.
 */
export function chooseStepChatAgent(name: string): void {
  const current = agents;
  if (!current || conversations.hasAnswerInFlight()) return;
  const before = current.selection.selectedProfile()?.profile.name;
  current.selection.select(name);
  if (current.selection.selectedProfile()?.profile.name === before) return;
  const responder = composeResponder(current.selection);
  agents = { ...current, responder };
  // Replacing the responder releases the previous agent's session; the
  // conversations it answered stay in the shared store.
  conversations.setResponder(responder);
  current.onSettled?.();
}

/**
 * Remembers the reader's model for the Agent Profile that answers: replayed on
 * every new session of that profile and applied live on an open one, where
 * only the agent's confirmation makes it effective. A change asked while an
 * answer streams is ignored, exactly like a change of agent.
 */
export async function chooseStepChatModel(value: string): Promise<void> {
  const current = agents;
  if (!current || conversations.hasAnswerInFlight()) return;
  await current.responder.selectModel?.(value);
  current.onSettled?.();
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
  agents?: TourAgentAvailability[];
  // True when the initial probe settled and no profile can answer: the
  // composer is disabled and the panel explains it.
  unavailable?: boolean;
  // The model values the selected Agent Profile announces, and the one the
  // Model control shows: the model the agent confirmed, else the reader's
  // remembered choice, else the value the probe's session announced. Absent
  // when no Agent Selection owns the panel, empty when the agent announces no
  // model.
  modelOptions?: AcpModelValue[];
  model?: string;
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
  agents?: TourAgentAvailability[];
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
      selected: view.selected,
      selectable: isSelectable(view.availability),
      signIn:
        view.availability.state === "auth-required" &&
        signInPlan(view.availability.authMethods) !== undefined
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
    ...paintAgents(),
    ...paintModel(agent)
  };
}

/**
 * The Model control's values and selection: only the values the answering
 * Agent Profile announces, and the model the agent confirmed — or, before a
 * session confirmed one, the reader's remembered choice — or, before the
 * reader chose anything, the value the probe's session announced.
 *
 * The agent that answers is the effective one once a session handshake
 * confirmed it: an initial fall-through may have answered with a profile
 * other than the preselected one, and its values are the only ones a choice
 * can reach.
 */
function paintModel(agent: StepChatAgentIdentity | undefined): {
  modelOptions?: AcpModelValue[];
  model?: string;
} {
  const selection = agents?.selection;
  if (!selection) {
    return {};
  }
  const name = agent?.effective
    ? agent.agent
    : selection.selectedProfile()?.profile.name;
  if (name === undefined) {
    return {};
  }
  return {
    modelOptions: [...selection.modelOptions(name)],
    model:
      agent?.model ??
      selection.modelFor(name) ??
      selection.announcedModel(name)
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
