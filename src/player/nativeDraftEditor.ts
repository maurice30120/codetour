import * as vscode from "vscode";
import { CodeTour, CodeTourStep, store } from "../store";
import { getStepDraft, setStepDraft, isEditingSession } from "./tourDrafts";

const documents = new WeakMap<CodeTourStep, vscode.TextDocument>();
const owners = new Map<string, { tour: CodeTour; target: CodeTourStep }>();

/** Existing-step native editing uses a real Markdown document, whose change
 * events capture typing before any save or playback-mode switch. */
export function registerNativeDraftEditor(): vscode.Disposable {
  return vscode.workspace.onDidChangeTextDocument(event => {
    const owner = owners.get(event.document.uri.toString());
    if (!owner) return;
    const step = owner.tour.steps.indexOf(owner.target);
    if (step >= 0 && isEditingSession(owner.tour.id, step)) setStepDraft(owner.tour.id, step, event.document.getText());
  });
}

export async function showNativeDraftEditor(): Promise<void> {
  const active = store.activeTour;
  if (!active || !isEditingSession(active.tour.id, active.step)) return;
  const target = active.tour.steps[active.step];
  const source = getStepDraft(active.tour.id, active.step) ?? target.description;
  let document = documents.get(target);
  if (!document || document.isClosed) {
    document = await vscode.workspace.openTextDocument({ language: "markdown", content: source });
    documents.set(target, document);
    owners.set(document.uri.toString(), { tour: active.tour, target });
  }
  if (store.activeTour !== active || store.playbackMode !== "comments" || !isEditingSession(active.tour.id, active.step)) return;
  const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
  if (document.getText() !== source) {
    await editor.edit(edit => edit.replace(new vscode.Range(0, 0, document!.lineCount, 0), source));
  }
}

/** Cancel restores the registered source in any still-visible native editor. */
export async function restoreNativeDraftEditor(target: CodeTourStep): Promise<void> {
  const document = documents.get(target);
  if (!document) return;
  const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === document.uri.toString());
  if (editor && document.getText() !== target.description) {
    await editor.edit(edit => edit.replace(new vscode.Range(0, 0, document.lineCount, 0), target.description));
  }
}
