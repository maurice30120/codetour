/**
 * In-memory drafts of the tour steps edited from the webview panel.
 *
 * A draft belongs to the step object, resolved through its tour and current
 * step number, so insertion/reordering cannot reassign its content. Never the
 * panel itself, so it survives panel closes, playback mode switches and
 * step navigations within the session. Nothing is persisted here: the
 * registered content of the step in the store stays untouched until an
 * explicit save, and a later slice can build the draft transfer and the
 * save/discard prompts on this very structure.
 */

import { CodeTourStep, store } from "../store";

// Identifies one step of one tour: the key of every draft, editing session
// and pending resolution.
export interface TourStepRef {
  tourId: string;
  step: number;
}

export type EditingSession = TourStepRef;

const drafts = new WeakMap<CodeTourStep, string>();
let sessionStep: CodeTourStep | undefined;
let session: EditingSession | undefined;

function draftKey(tourId: string, step: number): CodeTourStep | undefined {
  const tour = store.activeTour?.tour.id === tourId ? store.activeTour.tour : store.tours.find(tour => tour.id === tourId);
  return tour?.steps[step];
}

// The draft of the given step, if the author has one in memory.
export function getStepDraft(tourId: string, step: number): string | undefined {
  const key = draftKey(tourId, step);
  return key ? drafts.get(key) : undefined;
}

// Records the current draft of the given step.
export function setStepDraft(tourId: string, step: number, text: string): void {
  const key = draftKey(tourId, step);
  if (key) drafts.set(key, text);
}

// Drops the draft of the given step, when it was saved or abandoned.
export function clearStepDraft(tourId: string, step: number): void {
  const key = draftKey(tourId, step);
  if (key) drafts.delete(key);
}

// Marks the step as the one being edited right now, seeding its draft with
// the given source (an existing draft is never overwritten by a re-entry).
export function startEditingSession(
  tourId: string,
  step: number,
  source: string
): void {
  const key = draftKey(tourId, step);
  if (!key) return;
  if (!drafts.has(key)) {
    drafts.set(key, source);
  }
  sessionStep = key;
  session = { tourId, step };
}

// The step being edited right now, if any.
export function getEditingSession(): EditingSession | undefined {
  if (!session || !sessionStep) return undefined;
  const tour = store.activeTour?.tour.id === session.tourId ? store.activeTour.tour : store.tours.find(tour => tour.id === session!.tourId);
  const step = tour?.steps.indexOf(sessionStep) ?? -1;
  return step >= 0 ? { tourId: session.tourId, step } : undefined;
}

export function isEditingSession(tourId: string, step: number): boolean {
  const current = getEditingSession();
  return current?.tourId === tourId && current.step === step;
}

// True when the given step of the given tour is the active one and the one
// being edited right now: the only step a panel message may ever touch.
export function isActiveEditingStep(tourId: string, step: number): boolean {
  const activeTour = store.activeTour;
  return (
    !!activeTour &&
    activeTour.tour.id === tourId &&
    activeTour.step === step &&
    isEditingSession(tourId, step)
  );
}

// Ends the editing session, without touching any stored draft.
export function endEditingSession(): void {
  session = undefined;
  sessionStep = undefined;
}
