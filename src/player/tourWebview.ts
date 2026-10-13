import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { CodeTourStep, store } from "../store";
import { getTourTitle } from "../utils";
import { renderPreviewDescription } from "./description";
import { createTourWebviewHtml } from "./tourWebviewHtml";
import { openDescriptionLink } from "./webviewLinks";

const VIEW_TYPE = "codetour.tour";

let panel: vscode.WebviewPanel | undefined;
let linkWorkspaceRoot: vscode.Uri | undefined;
let panelRenderVersion = 0;

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

  const model = {
    tourTitle: getTourTitle(tour),
    stepNumber,
    stepCount: tour.steps.length,
    stepTitle: step.title || `Étape ${stepNumber + 1}`,
    anchorLabel: getStepAnchorLabel(step),
    description
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
      panel = undefined;
      linkWorkspaceRoot = undefined;
    });
    panel.webview.onDidReceiveMessage(async message => {
      switch (message?.type) {
        case "previous":
          await vscode.commands.executeCommand("codetour.previousTourStep");
          break;
        case "next":
          await vscode.commands.executeCommand("codetour.nextTourStep");
          break;
        case "finish":
          await vscode.commands.executeCommand("codetour.finishTour");
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
  panel.webview.html = createTourWebviewHtml(
    model,
    randomBytes(16).toString("base64")
  );
}

export function revealTourWebview() {
  panel?.reveal(undefined, true);
}

export function disposeTourWebview() {
  if (panel) {
    panel.dispose();
    panel = undefined;
    linkWorkspaceRoot = undefined;
  }
}
