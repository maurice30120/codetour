import { runInAction } from "mobx";
import * as vscode from "vscode";
import { saveTour } from "../recorder/commands";
import { CodeTour, store } from "../store";
import { EDITING_KEY } from "../store/actions";
import { renderPreviewDescription } from "./description";
import { renderMarkdownToHtml } from "./markdown";
import {
  clearStepDraft,
  endEditingSession,
  getStepDraft,
  isEditingSession,
  setStepDraft,
  startEditingSession
} from "./tourDrafts";

// A save can end in one of three observable ways.
export type SaveStepDraftResult = "saved" | "error" | "rejected" | "stale";

function isTourId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStepNumber(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 0
  );
}

// Enters the editing session of the active step, without ever requiring a
// native comment thread: the webview keeps presenting the step and the
// editor keeps only the anchor. Re-entering an already drafted step never
// overwrites its in-memory draft.
export function enterStepEditing(): boolean {
  const activeTour = store.activeTour;
  if (!activeTour || !store.canEditTour) {
    return false;
  }

  const { tour, step } = activeTour;
  const tourStep = tour.steps[step];
  if (!tourStep) {
    return false;
  }

  startEditingSession(
    tour.id,
    step,
    getStepDraft(tour.id, step) ?? tourStep.description
  );
  store.isEditing = true;
  vscode.commands.executeCommand("setContext", EDITING_KEY, true);
  return true;
}

// Records the new draft of the edited step and returns its preview, rendered
// through the very same shared pipeline as the reading view. The message is
// rejected when it doesn't target the step being edited right now.
export async function updateStepDraft(
  tourId: unknown,
  step: unknown,
  text: unknown
): Promise<string | undefined> {
  if (!isTourId(tourId) || !isStepNumber(step) || typeof text !== "string") {
    return undefined;
  }

  const activeTour = store.activeTour;
  if (
    !activeTour ||
    !store.canEditTour ||
    !isEditingSession(tourId, step) ||
    activeTour.tour.id !== tourId ||
    activeTour.step !== step
  ) {
    return undefined;
  }

  setStepDraft(tourId, step, text);

  const prepared = await renderPreviewDescription(text, undefined, {
    tour: activeTour.tour,
    tours: activeTour.tours,
    workspaceRoot: activeTour.workspaceRoot
  });
  return renderMarkdownToHtml(prepared);
}

// Saves the draft into the active step, reusing the very persistence of the
// existing saveTourStep sequence: the step description is updated in the
// store and the tour file is rewritten as-is. A save message that doesn't
// target the active step or tour is stale and never touches anything. On
// a write failure the draft is preserved, the step is restored to its
// registered content and the author stays in the editor.
export async function saveStepDraft(
  tourId: unknown,
  step: unknown,
  text: unknown
): Promise<SaveStepDraftResult> {
  if (!isTourId(tourId) || !isStepNumber(step) || typeof text !== "string") {
    return "stale";
  }

  if (!store.canEditTour) {
    vscode.window.showErrorMessage(
      "This tour cannot be edited. Your changes were not saved."
    );
    return "rejected";
  }

  const activeTour = store.activeTour;
  if (
    !activeTour ||
    activeTour.tour.id !== tourId ||
    activeTour.step !== step ||
    !isEditingSession(tourId, step)
  ) {
    return "stale";
  }

  const tourStep = activeTour.tour.steps[step];
  if (!tourStep) {
    return "stale";
  }

  const previousDescription = tourStep.description;
  runInAction(() => {
    tourStep.description = text;
  });

  try {
    await saveTour(activeTour.tour);
  } catch {
    runInAction(() => {
      tourStep.description = previousDescription;
    });
    vscode.window.showErrorMessage(
      "Unable to save the tour step. Your draft is preserved."
    );
    return "error";
  }

  store.isEditing = false;
  vscode.commands.executeCommand("setContext", EDITING_KEY, false);
  clearStepDraft(tourId, step);
  endEditingSession();
  return "saved";
}

// Abandons the draft of the active step: the registered content is restored
// in the panel and the in-memory draft is dropped.
export function cancelStepEditing(
  tourId: unknown,
  step: unknown
): boolean {
  if (!isTourId(tourId) || !isStepNumber(step)) {
    return false;
  }

  const activeTour = store.activeTour;
  if (
    !activeTour ||
    activeTour.tour.id !== tourId ||
    activeTour.step !== step ||
    !isEditingSession(tourId, step)
  ) {
    return false;
  }

  clearStepDraft(tourId, step);
  endEditingSession();
  store.isEditing = false;
  vscode.commands.executeCommand("setContext", EDITING_KEY, false);
  return true;
}

// The recorder commands the reading panel can route to, with the arguments
// they expect from the tree. Anything outside this fixed set is ignored, so
// the panel never widens the command surface.
const PANEL_EDIT_COMMANDS: Record<
  string,
  { args: (tour: CodeTour, step: number) => unknown[]; canMove?: 1 | -1 }
> = {
  "codetour.changeTourStepTitle": {
    args: (tour, step) => [{ tour, stepNumber: step }]
  },
  "codetour.changeTourStepLine": {
    args: (tour, step) => [{ tour, stepNumber: step }]
  },
  "codetour.moveTourStepBack": {
    args: (tour, step) => [{ tour, stepNumber: step }],
    canMove: -1
  },
  "codetour.moveTourStepForward": {
    args: (tour, step) => [{ tour, stepNumber: step }],
    canMove: 1
  }
};

// Executes one of the panel's editing commands on the active step. The
// existing recorder commands stay the single implementation: both playback
// presentations route to them.
export async function executePanelEditCommand(
  command: unknown
): Promise<void> {
  const activeTour = store.activeTour;
  if (typeof command !== "string" || !activeTour || !store.canEditTour) {
    return;
  }

  const entry = PANEL_EDIT_COMMANDS[command];
  if (!entry) {
    return;
  }

  const { tour, step } = activeTour;
  if (
    entry.canMove === -1 && step === 0 ||
    entry.canMove === 1 && step >= tour.steps.length - 1
  ) {
    return;
  }

  await vscode.commands.executeCommand(command, ...entry.args(tour, step));
}
