import { Uri, window, workspace } from "vscode";
import { ActiveTour } from "../store";
import { FS_SCHEME } from "../constants";
import { getStepFileUri } from "../utils";
import { getStepDiff, getStepDiffPath } from "./diff";
import { renderMarkdownToHtml } from "./markdown";

/**
 * The Tour Step Conversation base (webview chat).
 *
 * Message protocol between the webview and the extension:
 *
 * - webview → extension: `{ type: "askQuestion", question, token,
 *   targetTourId, step }` submits the reader's question for the rendered
 *   step, with the same identity as every other webview message.
 * - extension → webview: `{ type: "stepChat", exchanges, responding }`
 *   replaces the rendered conversation of the step. Each exchange is a
 *   question with the answer HTML produced by the shared renderer and
 *   sanitizer; a failed exchange carries the error message instead of a
 *   responder answer. The answer streams chunk by chunk: one update per
 *   received chunk, `responding` true and the latest exchange `pending`
 *   while the answer is in progress, `responding` false once it is
 *   complete. A question is blocked while the step's previous answer is
 *   still in progress.
 *
 * Conversations are kept in memory per tour and step identity, until the
 * reading webview closes; nothing is persisted to disk.
 */

/** One side of a displayed diff comparison, identified as such. */
export interface StepChatDiffSide {
  // The tour's declared path for this side's file.
  path: string;
  // The Git commit whose snapshot this side displays.
  ref: string;
  // The side's displayed content.
  code: string;
}

/** The step context captured for a question, faithful to the display. */
export type StepChatContext =
  | {
      available: true;
      // The tour's declared path for the step target, when it has one.
      path?: string;
      // The code the reader actually sees for the step target.
      code: string;
      description: string;
    }
  | {
      available: true;
      // The tour's declared path label of the compared files.
      path: string;
      // A diff step displays two sides: both are transmitted, each
      // identified with its own path and Git commit.
      diff: { original: StepChatDiffSide; modified: StepChatDiffSide };
      description: string;
    }
  | {
      // The step target is not currently displayed: it is reported as
      // such and never silently replaced by another file.
      available: false;
      path?: string;
      description: string;
    };

/** One question of a step conversation, with the raw answer of the responder. */
export interface StepChatHistoryEntry {
  question: string;
  answer: string;
}

/**
 * The conversation's agent could not be launched or its connection broke;
 * the reader may retry with a new question, which relaunches the agent.
 */
export class StepChatAgentUnavailableError extends Error {}

/** Streaming callbacks for one step question's answer. */
export interface StepChatAnswerEvents {
  /**
   * Called for each answer chunk as it arrives from the responder; the
   * chat displays it immediately, before the answer is complete.
   */
  onAnswerDelta?(delta: string): void;
}

/** What the responder receives for a question. */
export interface StepChatRequest {
  question: string;
  context: StepChatContext;
  history: StepChatHistoryEntry[];
  /** The workspace root the tour lives in; the agent session's cwd. */
  workspaceRoot: string;
}

/**
 * The responder answering step questions: the ACP session layer over the
 * installed agent entry in production, injected by the deterministic tests
 * at the same seam.
 */
export interface StepChatResponder {
  answer(
    request: StepChatRequest,
    events?: StepChatAnswerEvents
  ): Promise<string> | string;
  /**
   * Releases the responder's agent resources; called when the reading
   * webview closes or the responder is replaced.
   */
  dispose?(): Promise<void> | void;
}

let responder: StepChatResponder | undefined;

/** Injects (or removes) the responder answering step chat questions. */
export function setStepChatResponder(next?: StepChatResponder): void {
  releaseResponder(responder);
  responder = next;
}

function releaseResponder(current: StepChatResponder | undefined): void {
  if (!current) {
    return;
  }
  try {
    const released = current.dispose?.();
    if (released) {
      Promise.resolve(released).catch(() => undefined);
    }
  } catch {
    // Releasing a responder must never disturb the reader.
  }
}

interface StoredExchange {
  question: string;
  // The raw answer feeds follow-up questions; the HTML feeds the chat.
  answerMarkdown: string;
  answerHtml: string;
  failed: boolean;
  // True while the responder is still answering this question: the
  // response-in-progress state of the chat.
  pending?: boolean;
}

const conversations = new Map<string, StoredExchange[]>();

function conversationKey(tourId: string, step: number): string {
  return `${tourId}::${step}`;
}

function getConversation(tourId: string, step: number): StoredExchange[] {
  return conversations.get(conversationKey(tourId, step)) ?? [];
}

/** One question with its answer, as the webview renders it. */
export interface StepChatExchangeView {
  question: string;
  answerHtml: string;
  failed?: boolean;
  // True while this question's answer is still streaming.
  pending?: boolean;
}

/** The conversation of a step, with its response-in-progress state. */
export interface StepChatConversationView {
  exchanges: StepChatExchangeView[];
  // True while the step's latest question is still being answered: new
  // questions are blocked until it turns false.
  responding: boolean;
}

/** The conversation of a step, as the webview renders it. */
export function getStepChatExchanges(
  tourId: string,
  step: number
): StepChatExchangeView[] {
  return getStepChatConversationView(tourId, step).exchanges;
}

/** The conversation of a step with its response-in-progress state. */
export function getStepChatConversationView(
  tourId: string,
  step: number
): StepChatConversationView {
  const conversation = getConversation(tourId, step);
  return {
    exchanges: conversation.map(exchange => ({
      question: exchange.question,
      answerHtml: exchange.answerHtml,
      failed: exchange.failed || undefined,
      pending: exchange.pending || undefined
    })),
    responding: conversation.some(exchange => exchange.pending === true)
  };
}

/** Forgets every step conversation; called when the reading webview closes. */
export function clearStepChatConversations(): void {
  conversations.clear();
  // The ACP agent resources are released with the conversations; the
  // responder stays registered and lazily relaunches for a future reading
  // session.
  releaseResponder(responder);
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
  const view = (): StepChatConversationView =>
    getStepChatConversationView(active.tour.id, active.step);

  // A new question cannot be sent while the previous answer is in progress.
  if (view().responding) {
    return view();
  }

  const history: StepChatHistoryEntry[] = getConversation(
    active.tour.id,
    active.step
  )
    .filter(exchange => !exchange.failed && !exchange.pending)
    .map(exchange => ({
      question: exchange.question,
      answer: exchange.answerMarkdown
    }));

  // The question appears immediately with the response-in-progress state,
  // before any answer text arrives.
  const exchange: StoredExchange = {
    question,
    answerMarkdown: "",
    answerHtml: "",
    failed: false,
    pending: true
  };
  const conversation = getConversation(active.tour.id, active.step);
  conversation.push(exchange);
  conversations.set(key, conversation);
  onProgress?.(view());

  // The stored exchange is updated in place: the conversation keeps its
  // order and a refresh never mixes the streamed answer into another step.
  const complete = (final: StoredExchange) => {
    exchange.answerMarkdown = final.answerMarkdown;
    exchange.answerHtml = final.answerHtml;
    exchange.failed = final.failed;
    exchange.pending = undefined;
  };

  if (!responder) {
    complete(
      failedExchange(
        question,
        "Le répondant de cette étape n'est pas disponible. La lecture du tour reste utilisable."
      )
    );
  } else {
    let streamed = "";
    try {
      const answerMarkdown = await responder.answer(
        {
          question,
          context: await resolveStepContext(active),
          history,
          workspaceRoot: active.workspaceRoot?.fsPath ?? ""
        },
        {
          // Every chunk is rendered through the shared sanitizer and
          // displayed on its own: the answer is readable as it streams.
          onAnswerDelta: (delta: string) => {
            streamed += delta;
            exchange.answerHtml = renderMarkdownToHtml(streamed);
            onProgress?.(view());
          }
        }
      );
      complete({
        question,
        answerMarkdown,
        answerHtml: renderMarkdownToHtml(answerMarkdown),
        failed: false
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof StepChatAgentUnavailableError) {
        complete(
          failedExchange(
            question,
            `${reason} Une nouvelle question relancera l'agent ; la lecture du tour reste utilisable.`
          )
        );
      } else {
        complete(
          failedExchange(
            question,
            `La réponse à cette question a échoué (${reason}). La lecture du tour reste utilisable.`
          )
        );
      }
    }
  }

  const final = view();
  onProgress?.(final);
  return final;
}

function failedExchange(question: string, message: string): StoredExchange {
  return {
    question,
    answerMarkdown: "",
    answerHtml: renderMarkdownToHtml(message),
    failed: true
  };
}
