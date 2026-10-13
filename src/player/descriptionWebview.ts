// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { store } from "../store";
import { getStepLabel } from "../utils";
import { renderPreviewDescription } from "./description";
import { createDescriptionWebviewHtml } from "./markdown";
import { openDescriptionLinkOrReport } from "./webviewLinks";

const VIEW_TYPE = "codetour.description";

let panel: vscode.WebviewPanel | undefined;
let linkWorkspaceRoot: vscode.Uri | undefined;

export async function showStepDescription(): Promise<void> {
  const activeTour = store.activeTour;
  if (!activeTour) {
    return;
  }

  const { tour, step, workspaceRoot } = activeTour;
  const currentStep = tour.steps[step];
  if (!currentStep?.description) {
    return;
  }

  const title = `Description — ${getStepLabel(tour, step)}`;
  const content = await renderPreviewDescription(currentStep.description, undefined, {
    tour,
    tours: activeTour.tours,
    workspaceRoot
  });

  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      title,
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );
    panel.onDidDispose(() => {
      panel = undefined;
      linkWorkspaceRoot = undefined;
    });
    panel.webview.onDidReceiveMessage(async message => {
      if (message?.type === "openLink" && typeof message.href === "string") {
        await openDescriptionLinkOrReport(message.href, linkWorkspaceRoot);
      }
    });
  } else {
    panel.reveal(vscode.ViewColumn.Beside);
    panel.title = title;
  }

  linkWorkspaceRoot = workspaceRoot;
  panel.webview.html = createDescriptionWebviewHtml(
    content,
    title,
    randomBytes(16).toString("base64")
  );
}

// Removes the expanded description so a stale duplicate of the step text can't
// outlive a playback mode change.
export function disposeStepDescription() {
  if (panel) {
    panel.dispose();
    panel = undefined;
    linkWorkspaceRoot = undefined;
  }
}
