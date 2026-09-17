// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { store } from "../store";
import { getStepLabel } from "../utils";
import { renderPreviewDescription } from "./description";
import { createDescriptionWebviewHtml } from "./markdown";

const VIEW_TYPE = "codetour.description";
const ALLOWED_COMMANDS = /^(codetour\.|vscode\.open$)/;

let panel: vscode.WebviewPanel | undefined;
let linkWorkspaceRoot: vscode.Uri | undefined;

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

async function openLink(
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
        try {
          await openLink(message.href, linkWorkspaceRoot);
        } catch {
          vscode.window.showErrorMessage("Unable to open this description link.");
        }
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
