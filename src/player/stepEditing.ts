import { runInAction } from "mobx";
import * as vscode from "vscode";
import { CodeTour, CodeTourStep, store } from "../store";
import { EDITING_KEY } from "../store/actions";
import { saveTour } from "../recorder/commands";
import { disposeTourWebview } from "./tourWebview";

interface StepEditor {
  tour: CodeTour;
  target: CodeTourStep;
  opening?: PromiseLike<vscode.TextDocument>;
  document?: vscode.TextDocument;
}

const drafts = new WeakMap<CodeTourStep, string>();
let editor: StepEditor | undefined;
let pendingSave: Promise<boolean> | undefined;
let resolvingExit = false;

function findStep(tourId: string, step: number): CodeTourStep | undefined {
  const tour = store.activeTour?.tour.id === tourId
    ? store.activeTour.tour : store.tours.find(tour => tour.id === tourId);
  return tour?.steps[step];
}

export function getStepDraft(tourId: string, step: number): string | undefined {
  const target = findStep(tourId, step);
  return target ? drafts.get(target) : undefined;
}

export function clearStepDraft(tourId: string, step: number): void {
  const target = findStep(tourId, step);
  if (target) drafts.delete(target);
}

export function getEditingSession(): { tourId: string; step: number } | undefined {
  if (!editor) return;
  const step = editor.tour.steps.indexOf(editor.target);
  return step >= 0 ? { tourId: editor.tour.id, step } : undefined;
}

export function isEditingSession(tourId: string, step: number): boolean {
  return editor?.tour.id === tourId && editor.tour.steps[step] === editor.target;
}

function activeEditor(): StepEditor | undefined {
  const active = store.activeTour;
  return active && isEditingSession(active.tour.id, active.step) ? editor : undefined;
}

export function endEditingSession(): void {
  editor = undefined;
  store.isEditing = false;
  vscode.commands.executeCommand("setContext", EDITING_KEY, false);
}

/** A draft has one native document per editing session. */
export async function enterStepEditing(): Promise<boolean> {
  const active = store.activeTour;
  if (!active) return false;
  if (!store.canEditTour) {
    vscode.window.showErrorMessage("This tour cannot be edited.");
    return false;
  }
  const target = active.tour.steps[active.step];
  if (!target) return false;
  if (!activeEditor()) editor = { tour: active.tour, target };
  if (!drafts.has(target)) drafts.set(target, target.description);
  disposeTourWebview();
  store.isEditing = true;
  vscode.commands.executeCommand("setContext", EDITING_KEY, true);
  await showNativeDraftEditor(editor!);
  return true;
}

export function registerNativeDraftEditor(): vscode.Disposable {
  return vscode.workspace.onDidChangeTextDocument(event => {
    const current = activeEditor();
    if (current?.document === event.document) {
      drafts.set(current.target, event.document.getText());
    }
  });
}

async function showNativeDraftEditor(current: StepEditor): Promise<void> {
  if (current.document?.isClosed) {
    current.opening = undefined;
    current.document = undefined;
  }
  current.opening ??= vscode.workspace.openTextDocument({
    language: "markdown", content: drafts.get(current.target) ?? current.target.description
  });
  const document = await current.opening;
  if (activeEditor() !== current || store.isExpandedViewOpen) return;
  current.document = document;
  // Never rewrite an existing draft document during a reader/theme refresh.
  await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
}

/** Both Save Step and Save before leaving use this exact snapshot operation. */
export async function saveStepDraft(): Promise<boolean> {
  const current = activeEditor();
  const active = store.activeTour;
  if (!current || !active || pendingSave) return false;
  if (!store.canEditTour) {
    vscode.window.showErrorMessage("This tour cannot be edited. Your changes were not saved.");
    return false;
  }
  const source = drafts.get(current.target) ?? current.target.description;
  const snapshot = {
    ...current.tour,
    steps: current.tour.steps.map(step => ({ ...step,
      ...(step === current.target ? { description: source } : {}) }))
  };
  pendingSave = (async () => {
    try {
      await saveTour(snapshot);
      runInAction(() => { current.target.description = source; });
      // Typing during a write stays dirty; an old save cannot end its session.
      if (store.activeTour !== active || activeEditor() !== current ||
          drafts.get(current.target) !== source) return false;
      drafts.delete(current.target);
      endEditingSession();
      return true;
    } catch {
      vscode.window.showErrorMessage("Unable to save the tour step. Your draft is preserved.");
      return false;
    } finally {
      pendingSave = undefined;
    }
  })();
  return pendingSave;
}

export async function cancelStepEditing(): Promise<boolean> {
  const current = activeEditor();
  if (!current) return false;
  if (pendingSave) await pendingSave;
  if (activeEditor() !== current) return false;
  drafts.delete(current.target);
  endEditingSession();
  const visible = vscode.window.visibleTextEditors.find(item => item.document === current.document);
  if (visible && visible.document.getText() !== current.target.description) {
    await visible.edit(edit => edit.replace(
      new vscode.Range(0, 0, visible.document.lineCount, 0), current.target.description
    ));
  }
  return true;
}

export function hasUnsavedStepDraft(): boolean {
  const active = store.activeTour;
  if (!active || store.isRecording) return false;
  const target = active.tour.steps[active.step];
  const draft = target && drafts.get(target);
  return draft !== undefined && draft !== target.description;
}

/** Navigation, reordering, ending and expanded reading share one exit guard. */
export async function resolveStepDraftBeforeExit(): Promise<boolean> {
  const active = store.activeTour;
  if (!active) return true;
  if (pendingSave && !(await pendingSave)) return false;
  if (store.activeTour !== active || resolvingExit) return false;
  if (!hasUnsavedStepDraft()) {
    if (activeEditor()) {
      clearStepDraft(active.tour.id, active.step);
      endEditingSession();
    }
    return true;
  }
  const step = active.step;
  resolvingExit = true;
  try {
    const choice = await vscode.window.showQuickPick(["Save", "Discard", "Cancel"], {
      placeHolder: "This step has unsaved draft changes. Save them before leaving?",
      ignoreFocusOut: true
    });
    if (store.activeTour !== active || active.step !== step) return false;
    if (choice === "Save") return await saveStepDraft();
    if (choice === "Discard") return await cancelStepEditing();
    return false;
  } finally {
    resolvingExit = false;
  }
}
