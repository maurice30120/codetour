// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { reaction } from "mobx";
import {
  commands,
  Comment,
  CommentAuthorInformation,
  CommentController,
  CommentMode,
  comments,
  CommentThread,
  CommentThreadCollapsibleState,
  ExtensionContext,
  MarkdownString,
  Range,
  Selection,
  TextDocument,
  TextEditorRevealType,
  Uri,
  window,
  workspace
} from "vscode";
import { clearMermaidRenderCache } from "codetour-description-renderer";
import { SMALL_ICON_URL } from "../constants";
import { CodeTour, store } from "../store";
import { initializeStorage } from "../store/storage";
import {
  getActiveStepMarker,
  getActiveTourNumber,
  getFileUri,
  getStepFileUri,
  getStepLabel,
  getTourTitle
} from "../utils";
import { registerCodeStatusModule } from "./codeStatus";
import { registerPlayerCommands } from "./commands";
import { registerDecorators } from "./decorator";
import { registerFileSystemProvider } from "./fileSystem";
import { registerTextDocumentContentProvider } from "./fileSystem/documentProvider";
import { renderPreviewDescription } from "./description";
import { registerStatusBar } from "./status";
import { registerTreeProvider } from "./tree";

const CONTROLLER_ID = "codetour";
const CONTROLLER_LABEL = "CodeTour";

let id = 0;
let renderRequest = 0;

export { generatePreviewContent } from "./description";

export class CodeTourComment implements Comment {
  public id: string = (++id).toString();
  public contextValue: string = "";
  public author: CommentAuthorInformation = {
    name: CONTROLLER_LABEL,
    iconPath: Uri.parse(SMALL_ICON_URL)
  };
  public body: MarkdownString;

  constructor(
    content: string,
    public label: string = "",
    public parent: CommentThread,
    public mode: CommentMode
  ) {
    this.body = new MarkdownString(content);
    this.body.isTrusted = true;
  }
}

let controller: CommentController | null;

export async function focusPlayer() {
  const currentThread = store.activeTour?.thread;
  if (!currentThread?.range) {
    return;
  }

  showDocument(currentThread.uri, currentThread.range);
}

export async function startPlayer() {
  if (controller) {
    controller.dispose();
  }

  controller = comments.createCommentController(
    CONTROLLER_ID,
    CONTROLLER_LABEL
  );

  // TODO: Correctly limit the commenting ranges
  // to files within the workspace root
  controller.commentingRangeProvider = {
    provideCommentingRanges: (document: TextDocument) => {
      if (store.isRecording) {
        return [new Range(0, 0, document.lineCount, 0)];
      } else {
        return null;
      }
    }
  };
}

export async function stopPlayer() {
  if (store.activeTour?.thread) {
    store.activeTour!.thread.dispose();
    store.activeTour!.thread = null;
  }

  if (controller) {
    controller.dispose();
    controller = null;
  }
}

const VIEW_COMMANDS = new Map([
  ["comments", "workbench.panel.comments"],
  ["console", "workbench.panel.console"],
  ["debug", "workbench.view.debug"],
  ["debug:breakpoints", "workbench.debug.action.focusBreakpointsView"],
  ["debug:callstack", "workbench.debug.action.focusCallStackView"],
  ["debug:variables", "workbench.debug.action.focusVariablesView"],
  ["debug:watch", "workbench.debug.action.focusWatchView"],
  ["explorer", "workbench.view.explorer"],
  ["extensions", "workbench.view.extensions"],
  ["extensions:disabled", "extensions.disabledExtensionList.focus"],
  ["extensions:enabled", "extensions.enabledExtensionList.focus"],
  ["output", "workbench.panel.output"],
  ["problems", "workbench.panel.markers"],
  ["scm", "workbench.view.scm"],
  ["search", "workbench.view.search"],
  ["terminal", "terminal.focus"]
]);

function getPreviousTour(): CodeTour | undefined {
  const previousTour = store.tours.find(
    tour => tour.nextTour === store.activeTour?.tour.title
  );

  if (previousTour) {
    return previousTour;
  }

  const match = store.activeTour?.tour.title.match(/^#?(\d+)\s+-/);
  if (match) {
    const previousTourNumber = Number(match[1]) - 1;
    return store.tours.find(tour =>
      tour.title.match(new RegExp(`^#?${previousTourNumber}\\s+[-:]`))
    );
  }
}

function getNextTour(): CodeTour | undefined {
  if (store.activeTour?.tour.nextTour) {
    return store.tours.find(
      tour => tour.title === store.activeTour?.tour.nextTour
    );
  } else {
    const tourNumber = getActiveTourNumber();
    if (tourNumber) {
      const nextTourNumber = tourNumber + 1;
      return store.tours.find(tour =>
        tour.title.match(new RegExp(`^#?${nextTourNumber}\\s+[-:]`))
      );
    }
  }
}

async function renderCurrentStep() {
  const request = ++renderRequest;
  const activeTour = store.activeTour;
  if (!activeTour) {
    return;
  }

  if (activeTour.thread) {
    activeTour.thread.dispose();
  }

  const currentTour = activeTour.tour;
  const currentStep = activeTour.step;
  const isCurrentRequest = () =>
    request === renderRequest &&
    store.activeTour === activeTour &&
    activeTour.step === currentStep;

  const step = currentTour!.steps[currentStep];
  if (!step) {
    return;
  }

  const workspaceRoot = store.activeTour?.workspaceRoot;
  const uri = await getStepFileUri(step, workspaceRoot, currentTour.ref);
  if (!isCurrentRequest()) {
    return;
  }

  let line = step.line
    ? step.line - 1
    : step.selection
    ? step.selection.end.line - 1
    : undefined;

  if (step.file && line === undefined) {
    const stepPattern = step.pattern || getActiveStepMarker();
    if (stepPattern) {
      const document = await workspace.openTextDocument(uri);
      if (!isCurrentRequest()) {
        return;
      }
      const match = document.getText().match(new RegExp(stepPattern, "m"));
      if (match) {
        line = document.positionAt(match.index!).line;
      }
    }
  }

  if (line === undefined) {
    // Sans ligne ni motif retrouvable, l'étape décrit le fichier dans son
    // ensemble ; son commentaire est donc placé visuellement en fin de fichier.
    line = 2000;
  }

  const range = new Range(line!, 0, line!, 0);
  let label = `Step #${currentStep + 1} of ${currentTour!.steps.length}`;

  if (currentTour.title) {
    const title = getTourTitle(currentTour);
    label += ` (${title})`;
  }

  if (!isCurrentRequest()) {
    return;
  }

  const thread = controller!.createCommentThread(uri, range, []);
  activeTour.thread = thread;

  const mode =
    store.isRecording && store.isEditing
      ? CommentMode.Editing
      : CommentMode.Preview;
  let content = step.description;
  if (mode === CommentMode.Preview) {
    content = await renderPreviewDescription(content, undefined, {
      tour: currentTour,
      tours: activeTour.tours,
      workspaceRoot
    });
  }
  if (!isCurrentRequest()) {
    thread.dispose();
    return;
  }

  let hasPreviousStep = currentStep > 0;
  const hasNextStep = currentStep < currentTour.steps.length - 1;
  const isFinalStep = currentStep === currentTour.steps.length - 1;

  const showNavigation = hasPreviousStep || hasNextStep || isFinalStep;
  if (!store.isEditing && showNavigation) {
    content += "\n\n---\n";

    if (hasPreviousStep) {
      const stepLabel = getStepLabel(
        currentTour,
        currentStep - 1,
        false,
        false
      );
      const suffix = stepLabel ? ` (${stepLabel})` : "";
      content += `← [Previous${suffix}](command:codetour.previousTourStep "Navigate to previous step")`;
    } else {
      const previousTour = getPreviousTour();
      if (previousTour) {
        hasPreviousStep = true;

        const tourTitle = getTourTitle(previousTour);
        const argsContent = encodeURIComponent(
          JSON.stringify([previousTour.title])
        );
        content += `← [Previous Tour (${tourTitle})](command:codetour.startTourByTitle?${argsContent} "Navigate to previous tour")`;
      }
    }

    const prefix = hasPreviousStep ? " | " : "";
    if (hasNextStep) {
      const stepLabel = getStepLabel(
        currentTour,
        currentStep + 1,
        false,
        false
      );
      const suffix = stepLabel ? ` (${stepLabel})` : "";
      content += `${prefix}[Next${suffix}](command:codetour.nextTourStep "Navigate to next step") →`;
    } else if (isFinalStep) {
      const nextTour = getNextTour();
      if (nextTour) {
        const tourTitle = getTourTitle(nextTour);
        const argsContent = encodeURIComponent(
          JSON.stringify([nextTour.title])
        );
        content += `${prefix}[Next Tour (${tourTitle})](command:codetour.finishTour?${argsContent} "Start next tour")`;
      } else {
        content += `${prefix}[Finish Tour](command:codetour.finishTour "Finish the tour")`;
      }
    }
  }

  const comment = new CodeTourComment(
    content,
    label,
    thread,
    mode
  );

  if (!isCurrentRequest()) {
    thread.dispose();
    return;
  }

  // @ts-ignore
  thread.canReply = false;
  thread.comments = [comment];

  const contextValues = [];
  if (hasPreviousStep) {
    contextValues.push("hasPrevious");
  }

  if (hasNextStep) {
    contextValues.push("hasNext");
  }

  thread.contextValue = contextValues.join(".");
  thread.collapsibleState =
    CommentThreadCollapsibleState.Expanded;

  let selection;
  if (step.selection) {
    // Les fichiers .tour utilisent des positions lisibles commençant à 1,
    // tandis que VS Code attend des positions commençant à 0.
    selection = new Selection(
      step.selection.start.line - 1,
      step.selection.start.character - 1,
      step.selection.end.line - 1,
      step.selection.end.character - 1
    );
  } else {
    selection = new Selection(range.start, range.end);
  }

  await showDocument(uri, range, selection);

  if (step.directory) {
    const directoryUri = getFileUri(step.directory, workspaceRoot);
    commands.executeCommand("revealInExplorer", directoryUri);
  } else if (step.view) {
    const commandName = VIEW_COMMANDS.has(step.view)
      ? VIEW_COMMANDS.get(step.view)!
      : `${step.view}.focus`;

    try {
      await commands.executeCommand(commandName);
    } catch {
      window.showErrorMessage(
        `The current tour step is attempting to focus a view which isn't available: ${step.view}. Please check the tour and try again.`
      );
    }
  }

  if (step.commands) {
    for (const command of step.commands) {
      let name = command,
      args: any[] = [];

      if (command.includes("?")) {
        const parts = command.split("?");
        name = parts[0];
        args = JSON.parse(parts[1]);
      }

      try {
        console.log("Executing command", name, JSON.stringify(args));
        await commands.executeCommand(name, ...args);
      } catch (e) {
        window.showErrorMessage(`An error has occurred: ${e}`);
      }
    }
  }
}

async function showDocument(uri: Uri, range: Range, selection?: Selection) {
  const document =
    window.visibleTextEditors.find(
      editor => editor.document.uri.toString() === uri.toString()
    ) || (await window.showTextDocument(uri, { preserveFocus: true }));

  // TODO: Figure out how to force focus when navigating
  // to documents which are already open.

  if (selection) {
    document.selection = selection;
  }

  document.revealRange(range, TextEditorRevealType.InCenter);
}

export function registerPlayerModule(context: ExtensionContext) {
  registerPlayerCommands();
  context.subscriptions.push(
    registerTreeProvider(context.extensionPath, () => {
      clearMermaidRenderCache();
      if (store.activeTour) {
        renderCurrentStep();
      }
    })
  );
  registerFileSystemProvider();
  registerTextDocumentContentProvider();
  registerStatusBar();
  registerDecorators();
  registerCodeStatusModule();

  initializeStorage(context);

  // Toute navigation ou modification de la visite rafraîchit automatiquement
  // l'étape visible, pour que le commentaire reste synchronisé avec le fichier.
  reaction(
    () => [
      store.activeTour
        ? [
            store.activeTour.step,
            store.activeTour.tour.title,
            store.activeTour.tour.steps.map(step => [
              step.title,
              step.description,
              step.line,
              step.directory,
              step.view
            ])
          ]
        : null
    ],
    () => {
      if (store.activeTour) {
        renderCurrentStep();
      }
    }
  );
}
