import { runInAction } from "mobx";
import * as vscode from "vscode";
import { saveTour } from "../recorder/commands";
import { CodeTour } from "../store";

// The single persistence sequence behind every draft save: the step
// description is updated in the store and the tour file is rewritten
// as-is, like the existing saveTourStep sequence. On a write failure the
// registered content is restored, the author is told their draft is
// preserved, and the caller keeps the draft for a retry.
export async function persistStepDescription(
  tour: CodeTour,
  step: number,
  description: string
): Promise<boolean> {
  const tourStep = tour.steps[step];
  const previousDescription = tourStep.description;

  runInAction(() => {
    tourStep.description = description;
  });

  try {
    await saveTour(tour);
  } catch {
    runInAction(() => {
      tourStep.description = previousDescription;
    });
    vscode.window.showErrorMessage(
      "Unable to save the tour step. Your draft is preserved."
    );
    return false;
  }

  return true;
}
