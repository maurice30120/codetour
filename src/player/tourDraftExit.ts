import { runInAction } from "mobx";
import * as vscode from "vscode";
import { saveTour } from "../recorder/commands";
import { store } from "../store";
import { EDITING_KEY } from "../store/actions";
import {
  clearStepDraft,
  endEditingSession,
  getStepDraft,
  isEditingSession
} from "./tourDrafts";

// The step whose draft exit is currently being resolved. Only one prompt
// ever runs at a time: exit actions fired in a burst while a prompt is open
// are ignored, so a late answer can never save or discard another step.
let pendingResolution: { tourId: string; step: number } | undefined;

// True when the active step has an in-memory draft that differs from its
// registered content: the only case where leaving needs the author's answer.
export function hasUnsavedStepDraft(): boolean {
  const activeTour = store.activeTour;
  if (!activeTour || store.isRecording) {
    return false;
  }

  const { tour, step } = activeTour;
  const draft = getStepDraft(tour.id, step);
  const tourStep = tour.steps[step];
  return (
    draft !== undefined &&
    tourStep !== undefined &&
    draft !== tourStep.description
  );
}

// Leaves the webview editing session of the given step without touching the
// draft itself: the native presentation re-renders the registered content
// and the draft stays available in memory for a later re-entry.
export function endWebviewEditingSession(tourId: string, step: number): void {
  // The native recorder editing keeps its own comment flow: a webview
  // session never interferes with it.
  if (store.isRecording || !isEditingSession(tourId, step)) {
    return;
  }

  endEditingSession();
  store.isEditing = false;
  vscode.commands.executeCommand("setContext", EDITING_KEY, false);
}

// Asks the author what to do with the unsaved draft of the active step
// before an action leaves it. Every exit funnel goes through here, so the
// same prompt and the same outcomes apply whatever the origin of the exit.
//
// Returns true when the action may proceed, and false when it must be
// dropped: the author cancelled (or dismissed the prompt), or the save
// failed — in which case the draft is preserved to retry.
export async function resolveStepDraftBeforeExit(): Promise<boolean> {
  const activeTour = store.activeTour;
  if (!activeTour) {
    return true;
  }

  const { tour, step } = activeTour;
  if (pendingResolution) {
    // A resolution is already in flight: the late action is ignored so a
    // burst of exits never triggers a second save on another step.
    return false;
  }

  if (!hasUnsavedStepDraft()) {
    // An editing session left without any change is closed cleanly: the
    // draft matched the registered content, so nothing is lost.
    if (isEditingSession(tour.id, step)) {
      endWebviewEditingSession(tour.id, step);
      clearStepDraft(tour.id, step);
    }
    return true;
  }

  pendingResolution = { tourId: tour.id, step };
  try {
    const choice = await vscode.window.showInformationMessage(
      "This step has unsaved draft changes. Save them before leaving?",
      "Save",
      "Discard",
      "Cancel"
    );

    // The answer must still target the step it was asked about: a late
    // answer never saves or discards another step or tour.
    if (
      !store.activeTour ||
      store.activeTour.tour.id !== tour.id ||
      store.activeTour.step !== step
    ) {
      return false;
    }

    if (choice === "Save") {
      return await saveDraftAndLeave(tour.id, step);
    }

    if (choice === "Discard") {
      clearStepDraft(tour.id, step);
      endWebviewEditingSession(tour.id, step);
      return true;
    }

    // Cancelling — or dismissing the prompt — keeps the author on the step
    // with the draft and the editing session untouched.
    return false;
  } finally {
    pendingResolution = undefined;
  }
}

async function saveDraftAndLeave(
  tourId: string,
  step: number
): Promise<boolean> {
  const activeTour = store.activeTour!;
  const tourStep = activeTour.tour.steps[step];
  const draft = getStepDraft(tourId, step)!;
  const previousDescription = tourStep.description;

  // The very persistence of the existing saveTourStep sequence: the store
  // is updated and the tour file rewritten as-is.
  runInAction(() => {
    tourStep.description = draft;
  });

  try {
    await saveTour(activeTour.tour);
  } catch {
    // A failed save blocks the exit: the registered content is restored,
    // the draft is preserved and the author stays on the step to retry.
    runInAction(() => {
      tourStep.description = previousDescription;
    });
    vscode.window.showErrorMessage(
      "Unable to save the tour step. Your draft is preserved."
    );
    return false;
  }

  endWebviewEditingSession(tourId, step);
  clearStepDraft(tourId, step);
  return true;
}
