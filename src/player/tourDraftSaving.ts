import { runInAction } from "mobx";
import * as vscode from "vscode";
import { saveTour } from "../recorder/commands";
import { CodeTour } from "../store";

const pendingSaves = new WeakMap<CodeTour, Promise<boolean>>();
export function waitForDraftSave(tour: CodeTour): Promise<boolean> {
  return pendingSaves.get(tour) ?? Promise.resolve(true);
}

/** Persist a snapshot before publishing registered content; exits await it. */
export function persistStepDescription(tour: CodeTour, step: number, description: string): Promise<boolean> {
  if (pendingSaves.has(tour)) return Promise.resolve(false);
  const target = tour.steps[step];
  const snapshot = { ...tour, steps: tour.steps.map(item => ({ ...item, ...(item === target ? { description } : {}) })) };
  const operation = (async () => {
    try {
      await saveTour(snapshot);
      runInAction(() => { target.description = description; });
      return true;
    } catch {
      vscode.window.showErrorMessage("Unable to save the tour step. Your draft is preserved.");
      return false;
    } finally {
      pendingSaves.delete(tour);
    }
  })();
  pendingSaves.set(tour, operation);
  return operation;
}
