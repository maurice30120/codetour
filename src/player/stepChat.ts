import { window } from "vscode";
import { ActiveTour } from "../store";
import { getFileUri } from "../utils";
import { renderMarkdownToHtml } from "./markdown";

/**
 * The Tour Step Conversation base (webview chat).
 *
 * Message protocol between the webview and the extension:
 *
 * - webview → extension: `{ type: "askQuestion", question, token,
 *   targetTourId, step }` submits the reader's question for the rendered
 *   step, with the same identity as every other webview message.
 * - extension → webview: `{ type: "stepChat", exchanges }` replaces the
 *   rendered conversation of the step. Each exchange is a question with the
 *   answer HTML produced by the shared renderer and sanitizer; a failed
 *   exchange carries the error message instead of a responder answer.
 *
 * Conversations are kept in memory per tour and step identity, until the
 * reading webview closes; nothing is persisted to disk.
 */

/** The step context captured for a question, faithful to the display. */
export type StepChatContext =
  | {
      available: true;
      // The tour's declared path for the step target.
      path: string;
      // The code the reader actually sees in the open buffer.
      code: string;
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

/** What the responder receives for a question. */
export interface StepChatRequest {
  question: string;
  context: StepChatContext;
  history: StepChatHistoryEntry[];
}

/**
 * The injected responder answering step questions. The extension owns no
 * real agent in this base; tests and later features inject one.
 */
export interface StepChatResponder {
  answer(request: StepChatRequest): Promise<string> | string;
}

let responder: StepChatResponder | undefined;

/** Injects (or removes) the responder answering step chat questions. */
export function setStepChatResponder(next?: StepChatResponder): void {
  responder = next;
}

interface StoredExchange {
  question: string;
  // The raw answer feeds follow-up questions; the HTML feeds the chat.
  answerMarkdown: string;
  answerHtml: string;
  failed: boolean;
}

const conversations = new Map<string, StoredExchange[]>();

function conversationKey(tourId: string, step: number): string {
  return `${tourId}::${step}`;
}

function getConversation(tourId: string, step: number): StoredExchange[] {
  return conversations.get(conversationKey(tourId, step)) ?? [];
}

/** The conversation of a step, as the webview renders it. */
export function getStepChatExchanges(
  tourId: string,
  step: number
): { question: string; answerHtml: string; failed?: boolean }[] {
  return getConversation(tourId, step).map(exchange => ({
    question: exchange.question,
    answerHtml: exchange.answerHtml,
    failed: exchange.failed || undefined
  }));
}

/** Forgets every step conversation; called when the reading webview closes. */
export function clearStepChatConversations(): void {
  conversations.clear();
}

/**
 * Captures the step context from the open buffer. This base covers the
 * buffer the reader is shown; other target kinds are resolved later. The
 * captured code is the buffer's current content — unsaved edits included —
 * and an unshown target is reported unavailable, never substituted.
 */
export function resolveOpenBufferContext(active: ActiveTour): StepChatContext {
  const step = active.tour.steps[active.step];
  const description = step?.description ?? "";
  const file = step?.file;
  if (!step || !file) {
    return { available: false, description };
  }

  const target = getFileUri(file, active.workspaceRoot);
  const editor = window.visibleTextEditors.find(
    editor => editor.document.uri.path === target.path
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

/**
 * Asks the injected responder for the rendered step, records the exchange in
 * the step's conversation and returns the updated webview conversation.
 */
export async function askTourStepQuestion(
  active: ActiveTour,
  question: string
): Promise<{ question: string; answerHtml: string; failed?: boolean }[]> {
  const key = conversationKey(active.tour.id, active.step);
  const history: StepChatHistoryEntry[] = getConversation(
    active.tour.id,
    active.step
  )
    .filter(exchange => !exchange.failed)
    .map(exchange => ({
      question: exchange.question,
      answer: exchange.answerMarkdown
    }));

  let exchange: StoredExchange;
  if (!responder) {
    exchange = failedExchange(
      question,
      "Le répondant de cette étape n'est pas disponible. La lecture du tour reste utilisable."
    );
  } else {
    try {
      const answerMarkdown = await responder.answer({
        question,
        context: resolveOpenBufferContext(active),
        history
      });
      exchange = {
        question,
        answerMarkdown,
        answerHtml: renderMarkdownToHtml(answerMarkdown),
        failed: false
      };
    } catch {
      exchange = failedExchange(
        question,
        "La réponse à cette question a échoué. La lecture du tour reste utilisable."
      );
    }
  }

  const conversation = getConversation(active.tour.id, active.step);
  conversation.push(exchange);
  conversations.set(key, conversation);
  return getStepChatExchanges(active.tour.id, active.step);
}

function failedExchange(question: string, message: string): StoredExchange {
  return {
    question,
    answerMarkdown: "",
    answerHtml: renderMarkdownToHtml(message),
    failed: true
  };
}
