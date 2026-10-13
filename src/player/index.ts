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
import { CONTENT_URI, SMALL_ICON_URL } from "../constants";
import { CodeTour, CodeTourStep, store } from "../store";
import { initializeStorage } from "../store/storage";
import {
  getActiveStepMarker,
  getActiveTourNumber,
  getFileUri,
  getStepFileUri,
  getStepLabel,
  getTourTitle
} from "../utils";
import {
  ActiveAnchor,
  clearActiveAnchorDecoration,
  registerActiveAnchorModule,
  setActiveAnchorDecoration
} from "./activeAnchor";
import { registerCodeStatusModule } from "./codeStatus";
import { getStepDiff, StepDiff } from "./diff";
import { registerPlayerCommands } from "./commands";
import { registerDecorators } from "./decorator";
import { disposeStepDescription } from "./descriptionWebview";
import { registerFileSystemProvider } from "./fileSystem";
import { registerTextDocumentContentProvider } from "./fileSystem/documentProvider";
import { renderPreviewDescription } from "./description";
import { getCommentLineAbove } from "./commentPlacement";
import { getPlaybackMode } from "./playbackMode";
import { registerStatusBar } from "./status";
import { endWebviewEditingSession } from "./tourDraftExit";
import { isEditingSession } from "./tourDrafts";
import {
  disposeTourWebview,
  renderTourStep,
  revealTourWebview
} from "./tourWebview";
import { registerTreeProvider } from "./tree";

const CONTROLLER_ID = "codetour";
const CONTROLLER_LABEL = "CodeTour";

let id = 0;

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
let currentDiff: StepDiff | undefined;
let currentSelection: Selection | undefined;
let currentAnchor: ActiveAnchor | undefined;
let renderVersion = 0;

// The presentation used for the active tour. Recording keeps the native
// comment threads, because the recording flows build on them.
function isWebviewPlayback() {
  return store.playbackMode === "webview" && !store.isRecording;
}

export async function focusPlayer() {
  const activeTour = store.activeTour;
  if (!activeTour) {
    return;
  }

  const step = activeTour.tour.steps[activeTour.step];
  if (step?.display === "diff") {
    await renderCurrentStep();
  } else if (currentAnchor) {
    // Resuming doesn't depend on a native comment thread: the anchor of the
    // current step is enough to bring the reader back to the code.
    await showDocument(currentAnchor.uri, currentAnchor.range, currentSelection);
  }

  if (isWebviewPlayback()) {
    // Reprendre reopens the step's presentation, including after the panel
    // was closed mid-tour.
    await revealTourWebview();
  }
}

export async function startPlayer() {
  // Starting a tour invalidates any anchor or render still in flight for a
  // previous tour, so a late resolution can never resurface.
  ++renderVersion;
  currentDiff = undefined;
  currentSelection = undefined;
  currentAnchor = undefined;
  clearActiveAnchorDecoration();

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
  ++renderVersion;
  currentDiff = undefined;
  currentSelection = undefined;
  currentAnchor = undefined;
  clearActiveAnchorDecoration();
  disposeTourWebview();
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

export function getPreviousTour(): CodeTour | undefined {
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

export function getNextTour(): CodeTour | undefined {
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


async function renderCurrentStep(forceCurrentFile = false) {
  const version = ++renderVersion;
  if (store.activeTour!.thread) {
    store.activeTour!.thread.dispose();
    store.activeTour!.thread = null;
  }

  const currentTour = store.activeTour!.tour;
  const currentStep = store.activeTour!.step;

  const step = currentTour!.steps[currentStep];
  if (!step) {
    return;
  }

  const workspaceRoot = store.activeTour?.workspaceRoot;
  let diff = forceCurrentFile ? undefined : await getStepDiff(step, currentTour, workspaceRoot);
  let uri = diff?.modified || await getStepFileUri(
    step, workspaceRoot, step.display === "diff" ? undefined : currentTour.ref
  );
  let unavailableFile = false;
  let document: TextDocument | undefined;
  let line = step.line
    ? step.line - 1
    : step.selection
    ? step.selection.end.line - 1
    : undefined;

  // The existing fallback when a step's target cannot be opened: the reader
  // is warned, the step stays readable and the tour continues.
  const markUnavailableFile = () => {
    unavailableFile = true;
    line = 0;
    uri = CONTENT_URI;
    if (version === renderVersion) {
      window.showWarningMessage(
        `CodeTour: file unavailable: ${step.file || step.uri}. You can continue the tour.`
      );
    }
  };

  if (step.display === "diff" && step.file) {
    try {
      document = await workspace.openTextDocument(uri);
    } catch {
      diff = undefined;
      uri = await getStepFileUri(step, workspaceRoot);
      try {
        document = await workspace.openTextDocument(uri);
      } catch {
        markUnavailableFile();
      }
    }
  }
  if (version !== renderVersion || !store.activeTour || !controller) return;

  if (step.file && !unavailableFile && line === undefined) {
    const stepPattern = step.pattern || getActiveStepMarker();
    if (stepPattern) {
      try {
        document = document || await workspace.openTextDocument(uri);
        const match = document.getText().match(new RegExp(stepPattern, "m"));
        if (match) {
          line = document.positionAt(match.index!).line;
        }
      } catch (error) {
        if (!isWebviewPlayback()) {
          throw error;
        }
        if (version !== renderVersion || !store.activeTour) {
          return;
        }
        // In webview mode a missing pattern host keeps the step readable in
        // the panel instead of breaking the render.
        markUnavailableFile();
      }
    }
  }

  const hasSourceAnchor = line !== undefined && !!step.file && !unavailableFile;
  if (line === undefined) {
    // The step doesn't have a discoverable line number and so
    // stick the step at the end of the file. Unfortunately, there
    // isn't a way to say EOF, so 2000 is a temporary hack.
    line = document ? document.lineCount - 1 : 2000;
  }
  if (document) line = Math.min(line, document.lineCount - 1);
  if (version !== renderVersion || !store.activeTour || !controller) return;
  currentDiff = diff;

  const range = new Range(line!, 0, line!, 0);

  let selection;
  if (step.selection && !unavailableFile) {
    // Adjust the 1-based positions
    // to the 0-based positions that
    // VS Code's editor uses.
    selection = new Selection(
      step.selection.start.line - 1,
      step.selection.start.character - 1,
      step.selection.end.line - 1,
      step.selection.end.character - 1
    );
  } else {
    selection = new Selection(range.start, range.end);
  }

  currentSelection = selection;
  currentAnchor = { uri, range };

  // The anchor is resolved and opened the same way in both playback modes;
  // only the description presentation differs. In webview mode, a step
  // without an anchorable document stays readable in the panel: nothing is
  // opened and no anchor marker is invented.
  const hasCodeAnchor =
    step.file !== undefined || step.uri !== undefined || step.contents !== undefined;
  if (isWebviewPlayback() && !hasCodeAnchor && !unavailableFile) {
    // Keep the reading panel as the only presentation of this step. No
    // anchorable document exists, so none is recorded: resuming reveals
    // the panel without ever trying to show a document.
    currentAnchor = undefined;
    currentSelection = undefined;
  } else if (currentDiff) {
    try {
      await showDiff(currentDiff, range, selection, version);
    } catch {
      if (version === renderVersion) await renderCurrentStep(true);
      return;
    }
  } else {
    try {
      await showDocument(uri, range, selection);
    } catch (error) {
      if (!isWebviewPlayback()) {
        throw error;
      }
      if (version !== renderVersion || !store.activeTour) {
        return;
      }
      // In webview mode a file that cannot be opened leaves the step
      // readable in the panel: no anchor is invented and the tour continues.
      markUnavailableFile();
      currentAnchor = undefined;
      currentSelection = undefined;
    }
  }
  if (version !== renderVersion || !store.activeTour) return;

  if (isWebviewPlayback()) {
    // No comment thread ever carries the description in webview mode, and
    // the expanded description cannot duplicate the panel's text.
    disposeStepDescription();
    setActiveAnchorDecoration(
      hasCodeAnchor && !unavailableFile ? currentAnchor : undefined
    );
    await renderTourStep();
  } else {
    disposeTourWebview();
    clearActiveAnchorDecoration();
    // Presenting the step natively ends the webview editing session, but
    // never its in-memory draft: the author finds it again when the panel
    // comes back, and the native thread shows the registered content.
    endWebviewEditingSession(currentTour.id, currentStep);
    let commentRange = range;
    if (
      hasSourceAnchor &&
      !store.isEditing &&
      workspace.getConfiguration("codetour", uri).get("commentPosition", "above") === "above"
    ) {
      document = document || await workspace.openTextDocument(uri);
      const startLine = step.selection ? step.selection.start.line - 1 : line!;
      const commentLine = getCommentLineAbove(startLine, document);
      commentRange = new Range(commentLine, 0, commentLine, 0);
    }
    if (version !== renderVersion || !store.activeTour || !controller) return;
    await presentCurrentStepInThread(step, version, commentRange);
  }
  if (version !== renderVersion || !store.activeTour) return;

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
        await commands.executeCommand(name, ...args);
      } catch (e) {
        window.showErrorMessage(`An error has occurred: ${e}`);
      }
    }
  }
}

async function presentCurrentStepInThread(
  step: CodeTourStep,
  version: number,
  range: Range
) {
  const currentTour = store.activeTour!.tour;
  const currentStep = store.activeTour!.step;
  const workspaceRoot = store.activeTour!.workspaceRoot;

  let label = `Step #${currentStep + 1} of ${currentTour!.steps.length}`;
  if (currentTour.title) {
    const title = getTourTitle(currentTour);
    label += ` (${title})`;
  }

  const uri = currentAnchor!.uri;
  const thread = controller!.createCommentThread(uri, range, []);
  store.activeTour!.thread = thread;

  const mode =
    store.isRecording && store.isEditing
      ? CommentMode.Editing
      : CommentMode.Preview;
  let content = step.description;
  if (mode === CommentMode.Preview) {
    content = await renderPreviewDescription(content, undefined, {
      tour: currentTour,
      tours: store.activeTour!.tours,
      workspaceRoot
    });
  }
  if (version !== renderVersion || !store.activeTour || !controller) {
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

  if (version !== renderVersion || !store.activeTour || !controller) {
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

}

async function showDiff(diff: StepDiff, range: Range, selection: Selection, version: number) {
  await commands.executeCommand("vscode.diff", diff.original, diff.modified, diff.title, {
    preserveFocus: false,
    preview: true,
    selection: selection || range
  });
  if (version !== renderVersion || !store.activeTour) return;
  // Never use showTextDocument here: it would replace the diff with a plain
  // editor. vscode.diff reveals the modified side and its selection itself.
  const editor = window.visibleTextEditors.find(editor =>
    editor.document.uri.toString() === diff.modified.toString()
  );
  if (editor) {
    if (selection) editor.selection = selection;
    editor.revealRange(range, TextEditorRevealType.InCenter);
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
  context.subscriptions.push(
    workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("codetour.commentPosition") && store.activeTour) {
        renderCurrentStep();
      }
    })
  );
  registerPlayerCommands();
  store.playbackMode = getPlaybackMode();
  context.subscriptions.push(registerActiveAnchorModule());
  context.subscriptions.push(
    registerTreeProvider(context.extensionPath, () => {
      clearMermaidRenderCache();
      const activeTour = store.activeTour;
      if (
        activeTour &&
        // A webview editing session re-renders like any other step — the
        // panel presents the in-memory draft, never a stale theme — while
        // the native recorder editing keeps its own comment flow untouched.
        (!store.isEditing ||
          isEditingSession(activeTour.tour.id, activeTour.step))
      ) {
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

  // Any navigation, playback mode or tour change automatically refreshes the
  // visible step, so the presented description stays in sync with the code.
  reaction(
    () => [
      store.playbackMode,
      store.activeTour
        ? [
            store.activeTour.step,
            store.activeTour.tour.title,
            store.activeTour.tour.ref,
            store.activeTour.tour.baseRef,
            store.activeTour.tour.steps.map(step => [
              step.title,
              step.description,
              step.line,
              step.file,
              step.baseFile,
              step.display,
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
