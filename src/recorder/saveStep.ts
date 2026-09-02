// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Decides what to do after a "Save Step" attempt.
 *
 * A tour step's Markdown source is only turned into an image (Mermaid
 * included) once its comment leaves edit mode. Refreshing the preview must
 * therefore wait for a successful save: on failure the editor and its content
 * are kept untouched so nothing is lost, and the preview is not regenerated.
 */
export interface SaveStepOutcome {
  saved: boolean;
}

export interface SaveStepPlan {
  /** When true, the comment stays in edit mode with its current content. */
  keepEditing: boolean;
  /** When true, the tour is relaunched on the same step to render the preview. */
  relaunchPreview: boolean;
}

export function planSaveStep(outcome: SaveStepOutcome): SaveStepPlan {
  if (outcome.saved) {
    return { keepEditing: false, relaunchPreview: true };
  }
  return { keepEditing: true, relaunchPreview: false };
}
