import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { CodeTourStep, store } from "../store";
import { getTourTitle } from "../utils";
import { renderPreviewDescription } from "./description";
import { getNextTour, getPreviousTour } from "./index";
import { createTourWebviewHtml } from "./tourWebviewHtml";
import { openDescriptionLink } from "./webviewLinks";

const VIEW_TYPE = "codetour.tour";

let panel: vscode.WebviewPanel | undefined;
let linkWorkspaceRoot: vscode.Uri | undefined;
let panelRenderVersion = 0;
let disposingPanel = false;
// The presentation the reader closed themselves. A render arriving for that
// very step must not reopen the panel behind their back; navigating to
// another step or resuming presents again.
let userClosedPresentation: { tourId?: string; step?: number } | undefined;

function getStepAnchorLabel(step: CodeTourStep): string | undefined {
  if (step.file) {
    let label = step.file;
    if (step.line) {
      label += ` : ${step.line}`;
    }
    if (step.display === "diff") {
      label += " · Diff";
    }
    return label;
  }

  if (step.directory) {
    return step.directory;
  }

  if (step.view) {
    return step.view;
  }

  return "Présentation";
}

// Presents the active step in the layout A reading panel: tour header and
// progression, step title, prepared description, then navigation. The
// description comes from the shared rendering pipeline (Mermaid included) and
// the buttons drive the very same player commands as every other surface.
export async function renderTourStep(): Promise<void> {
  const activeTour = store.activeTour;
  if (!activeTour) {
    return;
  }

  const { tour, step: stepNumber, workspaceRoot } = activeTour;
  const step = tour.steps[stepNumber];
  if (!step) {
    return;
  }

  if (
    !panel &&
    userClosedPresentation?.tourId === tour.id &&
    userClosedPresentation.step === stepNumber
  ) {
    return;
  }

  const version = ++panelRenderVersion;
  const description = await renderPreviewDescription(step.description, undefined, {
    tour,
    tours: activeTour.tours,
    workspaceRoot
  });
  if (
    version !== panelRenderVersion ||
    !store.activeTour ||
    store.playbackMode !== "webview"
  ) {
    return;
  }

  // Tour transitions reuse the reader's own rules: the previous button
  // starts the previous tour at the first step, the finish action hands
  // over to the next tour of a series.
  const previousTour = stepNumber === 0 ? getPreviousTour() : undefined;
  const nextTour =
    stepNumber === tour.steps.length - 1 ? getNextTour() : undefined;

  const model = {
    tourTitle: getTourTitle(tour),
    tourId: tour.id,
    stepNumber,
    stepCount: tour.steps.length,
    stepTitle: step.title || `Étape ${stepNumber + 1}`,
    anchorLabel: getStepAnchorLabel(step),
    description,
    previousTourTitle: previousTour?.title,
    nextTourTitle: nextTour?.title
  };
  const title = `CodeTour — ${getTourTitle(tour)}`;

  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      title,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [] }
    );
    panel.onDidDispose(() => {
      // Closing the panel is a presentation choice, not a tour change: the
      // mode and the step stay as they are, and neither a render still in
      // flight nor one arriving late for this step may recreate the panel
      // with a stale step.
      panel = undefined;
      linkWorkspaceRoot = undefined;
      panelRenderVersion++;
      if (!disposingPanel && store.activeTour) {
        userClosedPresentation = {
          tourId: store.activeTour.tour.id,
          step: store.activeTour.step
        };
      }
    });
    panel.webview.onDidReceiveMessage(async message => {
      const tourTitle =
        typeof message?.tour === "string" && message.tour ? message.tour : undefined;
      switch (message?.type) {
        case "previous":
          if (tourTitle) {
            await vscode.commands.executeCommand(
              "codetour.startTourByTitle",
              tourTitle
            );
          } else {
            await vscode.commands.executeCommand("codetour.previousTourStep");
          }
          break;
        case "next":
          await vscode.commands.executeCommand("codetour.nextTourStep");
          break;
        case "finish":
          await vscode.commands.executeCommand(
            "codetour.finishTour",
            tourTitle
          );
          break;
        case "code":
          await vscode.commands.executeCommand("codetour.resumeTour");
          break;
        case "openLink":
          if (typeof message.href === "string") {
            try {
              await openDescriptionLink(message.href, linkWorkspaceRoot);
            } catch {
              vscode.window.showErrorMessage(
                "Unable to open this description link."
              );
            }
          }
          break;
      }
    });
  } else {
    panel.title = title;
  }

  linkWorkspaceRoot = workspaceRoot;
  userClosedPresentation = undefined;
  panel.webview.html = createTourWebviewHtml(
    model,
    randomBytes(16).toString("base64")
  );
}

// Brings the reading panel back when the reader closed it: the step is
// re-presented, never a stale one.
export async function revealTourWebview() {
  userClosedPresentation = undefined;
  if (!panel) {
    await renderTourStep();
  }
  panel?.reveal(undefined, true);
}

export function disposeTourWebview() {
  if (panel) {
    disposingPanel = true;
    panel.dispose();
    disposingPanel = false;
    panel = undefined;
    linkWorkspaceRoot = undefined;
    userClosedPresentation = undefined;
  }
}
