// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import * as path from "path";
import { fileURLToPath } from "url";
import { createFallbackStepChatResponder } from "./agent/fallbackStepChatAgent";
import { initializeApi } from "./api";
import { canonicalWorkspacePath } from "./core/workspacePath";
import { initializeGitApi } from "./git";
import { registerLiveShareModule } from "./liveShare";
import { registerNotebookProvider } from "./notebook";
import { registerPlayerModule } from "./player";
import { setStepChatResponder } from "./player/stepChat";
import { registerRecorderModule } from "./recorder";
import { store } from "./store";
import {
  promptForTour,
  startCodeTour,
  startDefaultTour
} from "./store/actions";
import { discoverTours as _discoverTours } from "./store/provider";
import { registerDesktopIntegrations } from "./desktopIntegration";

/**
 * Partage la découverte des visites entre l'ouverture normale du projet et
 * l'ouverture via un lien CodeTour. Une seule lecture des fichiers est ainsi
 * nécessaire avant d'afficher la visite demandée à l'utilisateur.
 */
let cachedDiscoverTours: Promise<void> | undefined;
function discoverTours(): Promise<void> {
  return cachedDiscoverTours ?? (cachedDiscoverTours = _discoverTours());
}

/**
 * The Tour file a workspace-carrying link names, as a canonical local path.
 * Discovery stores `decodeURIComponent(uri.toString())`, so literal
 * delimiters are escaped again before the string is read as a file URL.
 */
function linkTourPath(workspace: string, tourPath: string): string {
  return canonicalWorkspacePath(path.resolve(workspace, tourPath));
}

function tourFilePath(tour: { id: string }): string | undefined {
  try {
    const escaped = tour.id.replace(/%/g, "%25").replace(/#/g, "%23").replace(/\?/g, "%3F");
    return canonicalWorkspacePath(fileURLToPath(escaped));
  } catch {
    return undefined;
  }
}

function startTour(params: URLSearchParams) {
  let tourPath = params.get("tour");
  const step = params.get("step");

  let stepNumber;
  if (step) {
    // In public links, the first step is numbered 1; the internal player
    // uses a zero-based index.
    stepNumber = Number(step) - 1;
  }

  if (tourPath) {
    if (!tourPath.endsWith(".tour")) {
      tourPath = `${tourPath}.tour`;
    }

    const workspace = params.get("workspace");
    const expected = workspace ? linkTourPath(workspace, tourPath) : undefined;
    const tour = store.tours.find(tour =>
      expected
        ? tourFilePath(tour) === expected
        : tour.id.endsWith(tourPath as string)
    );
    if (tour) {
      startCodeTour(tour, stepNumber);
    } else if (workspace) {
      void vscode.window.showErrorMessage("The requested tour was not found in the intended workspace.");
    }
  } else {
    startDefaultTour(undefined, undefined, stepNumber);
  }
}

export class URIHandler implements vscode.UriHandler {
  private _didStartDefaultTour = false;
  get didStartDefaultTour(): boolean {
    return this._didStartDefaultTour;
  }

  async handleUri(uri: vscode.Uri): Promise<void> {
    const target = new URLSearchParams(uri.query).get("workspace");
    if (uri.path === "/openTour" && target) {
      const expected = canonicalWorkspacePath(target);
      const matches = vscode.workspace.workspaceFolders?.some(folder =>
        folder.uri.scheme === "file" && canonicalWorkspacePath(folder.uri.fsPath) === expected
      );
      if (!matches) {
        void vscode.window.showErrorMessage("This tour link was sent to a different workspace. Open the intended workspace and retry.");
        return;
      }
    }
    this._didStartDefaultTour = true;
    await discoverTours();

    let query = uri.query;
    if (uri.path === "/startDefaultTour") {
      query = vscode.Uri.parse(uri.query).query;
    }

    if (query) {
      const params = new URLSearchParams(query);
      startTour(params);
    } else {
      startDefaultTour();
    }
  }
}

export async function activate(context: vscode.ExtensionContext) {
  registerDesktopIntegrations(context);
  const notebookProvider = registerNotebookProvider();
  if (notebookProvider) {
    context.subscriptions.push(notebookProvider);
  }
  registerPlayerModule(context);
  // Tour Step Conversations answer through the ACP session layer, launched
  // in priority order with the tour's workspace root. Each session verifies
  // its provider's configured mode before the first prompt.
  const stepChatResponder = createFallbackStepChatResponder();
  setStepChatResponder(stepChatResponder);
  context.subscriptions.push({
    dispose: () => {
      void stepChatResponder.dispose?.();
    }
  });
  registerRecorderModule();
  registerLiveShareModule();

  const uriHandler = new URIHandler();
  context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));

  if (vscode.workspace.workspaceFolders) {
    await discoverTours();

    if (!uriHandler.didStartDefaultTour) {
      promptForTour(context.globalState);
    }

    initializeGitApi();
  }

  return initializeApi(context);
}
