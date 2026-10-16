import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { ActiveTour, CodeTourStep, store } from "../store";
import { getTourTitle } from "../utils";
import { renderPreviewDescription } from "./description";
import { createTourWebviewHtml } from "./markdown";
import {
  askTourStepQuestion,
  clearStepChatConversations,
  getStepChatConversationView,
  getStepChatExchanges,
  stopTourStepQuestion,
  type StepChatConversationView
} from "./stepChat";
import { getNextTour, getPreviousTour } from "./index";

interface TourView {
  panel: vscode.WebviewPanel;
  version: number;
  codeViewColumn: vscode.ViewColumn;
  rendered?: { active: ActiveTour; step: number; token: string };
}

let view: TourView | undefined;

/** Opens or focuses the sole reading panel. The player reaction renders it. */
export function showTourWebview(): void {
  const active = store.activeTour;
  if (!active || store.isRecording) return;
  if (!view) {
    const current: TourView = {
      panel: vscode.window.createWebviewPanel(
        "codetour.tour",
        `CodeTour — ${getTourTitle(active.tour)}`,
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, localResourceRoots: [] }
      ),
      codeViewColumn: vscode.window.activeTextEditor?.viewColumn ??
        vscode.window.visibleTextEditors[0]?.viewColumn ?? vscode.ViewColumn.One,
      version: 0
    };
    view = current;
    current.panel.onDidDispose(() => {
      if (view !== current) return;
      view = undefined;
      store.isExpandedViewOpen = false;
      // The conversations live only as long as the reading webview.
      clearStepChatConversations();
    });
    current.panel.webview.onDidReceiveMessage(async message => {
      const rendered = current.rendered;
      if (view !== current || !rendered || rendered.active !== store.activeTour ||
          rendered.step !== store.activeTour.step || message?.token !== rendered.token ||
          message?.targetTourId !== store.activeTour.tour.id || message?.step !== rendered.step) return;
      try {
        if (message.type === "editStep") {
          if (store.canEditTour) await vscode.commands.executeCommand("codetourIA.editTour");
        } else if (message.type === "previous" || message.type === "next") {
          const backward = message.type === "previous";
          const withinTour = backward ? rendered.step > 0 : rendered.step < rendered.active.tour.steps.length - 1;
          if (withinTour) {
            await vscode.commands.executeCommand(backward ? "codetourIA.previousTourStep" : "codetourIA.nextTourStep");
          } else {
            const target = backward ? getPreviousTour() : getNextTour();
            if (target) await vscode.commands.executeCommand(backward ? "codetourIA.startTourByTitle" : "codetourIA.finishTour", target.title);
          }
        } else if (message.type === "openLink" && typeof message.href === "string") {
          await openDescriptionLink(message.href, rendered.active.workspaceRoot);
        } else if (
          message.type === "askQuestion" &&
          typeof message.question === "string" &&
          message.question.trim()
        ) {
          // Every streamed chunk of the answer is posted as it arrives, with
          // the response-in-progress state; a question asked while the step's
          // previous answer is still streaming is blocked inside the chat and
          // produces no update.
          const postChatView = (chatView: StepChatConversationView) => {
            // A stale render (navigation while the answer was streaming) must
            // not push a conversation into the step the reader now sees; the
            // stored exchange resurfaces when its step is rendered again.
            if (view !== current || current.rendered !== rendered) return;
            void current.panel.webview.postMessage({
              type: "stepChat",
              ...chatView
            });
          };
          await askTourStepQuestion(
            rendered.active,
            message.question.trim(),
            postChatView
          );
        } else if (message.type === "stopQuestion") {
          // The Stop button interrupts the step's answer in flight: the
          // responder's ACP exchange is cancelled, the interrupted state is
          // posted to the chat and a new question is accepted immediately.
          const postChatView = (chatView: StepChatConversationView) => {
            // A stale render (navigation while the answer was streaming) must
            // not push a conversation into the step the reader now sees.
            if (view !== current || current.rendered !== rendered) return;
            void current.panel.webview.postMessage({
              type: "stepChat",
              ...chatView
            });
          };
          stopTourStepQuestion(rendered.active, postChatView);
        }
      } catch {
        vscode.window.showErrorMessage("Unable to open this description link.");
      }
    });
    store.isExpandedViewOpen = true;
  }
  view.panel.reveal(undefined, true);
}

/** Keeps code navigation outside the reading panel, even when it has focus. */
export function getTourCodeViewColumn(): vscode.ViewColumn | undefined {
  if (!view) return undefined;
  const panelColumn = view.panel.viewColumn;
  const editors = vscode.window.visibleTextEditors;
  const editor = editors.find(candidate =>
    candidate.viewColumn === view!.codeViewColumn && candidate.viewColumn !== panelColumn
  ) ?? editors.find(candidate => candidate.viewColumn !== panelColumn);
  const column = editor?.viewColumn ??
    (view.codeViewColumn !== panelColumn ? view.codeViewColumn : undefined) ??
    (panelColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One);
  view.codeViewColumn = column;
  return column;
}

/** Updates an existing panel; rendering can never reopen a closed panel. */
export async function renderTourStep(): Promise<void> {
  const current = view;
  const active = store.activeTour;
  if (!current || !active) return;
  const { tour, step: stepNumber, workspaceRoot } = active;
  const step = tour.steps[stepNumber];
  if (!step) return;
  const version = ++current.version;
  const description = await renderPreviewDescription(step.description, undefined, {
    tour, tours: active.tours, workspaceRoot
  });
  if (view !== current || current.version !== version || store.activeTour !== active ||
      active.step !== stepNumber || !store.isExpandedViewOpen) return;

  const token = randomBytes(16).toString("base64");
  current.rendered = { active, step: stepNumber, token };
  current.panel.title = `CodeTour — ${getTourTitle(tour)}`;
  current.panel.webview.html = createTourWebviewHtml({
    tourTitle: getTourTitle(tour), tourId: tour.id, stepNumber,
    stepCount: tour.steps.length, stepTitle: step.title || `Step ${stepNumber + 1}`,
    anchorLabel: getStepAnchorLabel(step), description,
    questions: step.questions,
    canEdit: store.canEditTour,
    chatExchanges: getStepChatExchanges(tour.id, stepNumber),
    chatResponding: getStepChatConversationView(tour.id, stepNumber).responding,
    previousTourTitle: getPreviousTour()?.title,
    nextTourTitle: getNextTour()?.title
  }, token);
}

export function disposeTourWebview(): void {
  const previous = view;
  view = undefined;
  previous?.panel.dispose();
  store.isExpandedViewOpen = false;
}

function getStepAnchorLabel(step: CodeTourStep): string {
  const file = step.file || step.uri;
  if (!file) return step.directory || step.view || "Presentation";
  return file + (step.line ? ` : ${step.line}` : "") +
    (step.display === "diff" ? " · Diff" : "");
}

const ALLOWED_COMMANDS = /^(codetourIA\.|vscode\.open$)/;

function reviveCommandArgument(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "scheme" in value &&
    "path" in value
  ) {
    const components = value as {
      scheme: string;
      authority?: string;
      path?: string;
      query?: string;
      fragment?: string;
    };
    return vscode.Uri.from({
      scheme: components.scheme,
      authority: components.authority,
      path: components.path,
      query: components.query,
      fragment: components.fragment
    });
  }

  return value;
}

// Opens a link clicked in an extension-owned description surface, applying the
// shared allowlist and workspace-relative resolution.
async function openDescriptionLink(
  href: string,
  workspaceRoot?: vscode.Uri
): Promise<void> {
  const uri = vscode.Uri.parse(href, true);
  if (uri.scheme === "command" && ALLOWED_COMMANDS.test(uri.path)) {
    const parsedArgs: unknown = uri.query
      ? JSON.parse(decodeURIComponent(uri.query))
      : [];
    const args = (Array.isArray(parsedArgs) ? parsedArgs : [parsedArgs]).map(
      reviveCommandArgument
    );
    await vscode.commands.executeCommand(uri.path, ...args);
  } else if (["http", "https", "mailto"].includes(uri.scheme)) {
    await vscode.env.openExternal(uri);
  } else if (!uri.scheme && workspaceRoot) {
    await vscode.commands.executeCommand(
      "vscode.open",
      vscode.Uri.joinPath(workspaceRoot, uri.path)
    );
  }
}
