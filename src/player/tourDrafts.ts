/**
 * In-memory drafts of the tour steps edited from the webview panel.
 *
 * A draft is keyed by the (tour id, step number) pair and never by the
 * panel itself, so it survives panel closes, playback mode switches and
 * step navigations within the session. Nothing is persisted here: the
 * registered content of the step in the store stays untouched until an
 * explicit save, and a later slice can build the draft transfer and the
 * save/discard prompts on this very structure.
 */

export interface EditingSession {
  tourId: string;
  step: number;
}

const drafts = new Map<string, string>();
let session: EditingSession | undefined;

function draftKey(tourId: string, step: number): string {
  return `${tourId}::${step}`;
}

// The draft of the given step, if the author has one in memory.
export function getStepDraft(tourId: string, step: number): string | undefined {
  return drafts.get(draftKey(tourId, step));
}

// Records the current draft of the given step.
export function setStepDraft(
  tourId: string,
  step: number,
  text: string
): void {
  drafts.set(draftKey(tourId, step), text);
}

// Drops the draft of the given step, when it was saved or abandoned.
export function clearStepDraft(tourId: string, step: number): void {
  drafts.delete(draftKey(tourId, step));
}

// Marks the step as the one being edited right now, seeding its draft with
// the given source (an existing draft is never overwritten by a re-entry).
export function startEditingSession(
  tourId: string,
  step: number,
  source: string
): void {
  const key = draftKey(tourId, step);
  if (!drafts.has(key)) {
    drafts.set(key, source);
  }
  session = { tourId, step };
}

// The step being edited right now, if any.
export function getEditingSession(): EditingSession | undefined {
  return session;
}

export function isEditingSession(tourId: string, step: number): boolean {
  return session?.tourId === tourId && session.step === step;
}

// Ends the editing session, without touching any stored draft.
export function endEditingSession(): void {
  session = undefined;
}
