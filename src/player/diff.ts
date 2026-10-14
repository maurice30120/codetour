// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, workspace } from "vscode";
import { FS_SCHEME_CONTENT } from "../constants";
import { api, initializeGitApi } from "../git";
import { CodeTour, CodeTourStep } from "../store";
import { getFileUri } from "../utils";

const COMMIT_SHA = /^[0-9a-f]{40}$/;

/** The workspace-relative label of the compared paths, shown in the diff title. */
export function getStepDiffPath(step: CodeTourStep): string {
  return step.baseFile ? `${step.baseFile} → ${step.file}` : step.file!;
}

export interface StepDiff {
  original: Uri;
  modified: Uri;
  title: string;
}

// Unlike the ordinary tour resolver, this always uses the Git snapshot even
// when the requested SHA is the checkout's HEAD.
export async function getStepSnapshotUri(
  step: CodeTourStep,
  workspaceRoot: Uri | undefined,
  ref: string
): Promise<Uri> {
  if (!api) await initializeGitApi();
  const file = getFileUri(step.file!, workspaceRoot);
  const repository = api?.getRepository(file);
  if (!repository) throw new Error("Git repository is unavailable.");
  const details = await repository.getObjectDetails(ref, file.fsPath);
  if (details.mode !== "100644" && details.mode !== "100755") {
    throw new Error("The snapshot is not a regular file.");
  }
  const uri = api.toGitUri(file, ref);
  await workspace.openTextDocument(uri);
  return uri;
}

export async function getStepDiff(
  step: CodeTourStep,
  tour: CodeTour,
  workspaceRoot?: Uri
): Promise<StepDiff | undefined> {
  if (step.display !== "diff" || !step.file || step.uri || step.contents !== undefined ||
      !tour.baseRef || !tour.ref || !COMMIT_SHA.test(tour.baseRef) || !COMMIT_SHA.test(tour.ref)) {
    return;
  }
  try {
    if (!api) await initializeGitApi();
    const file = getFileUri(step.file, workspaceRoot);
    const repository = api?.getRepository(file);
    if (!repository) return;
    // A missing file and an inaccessible revision are different cases. Both
    // commits must resolve before UnknownPath can mean an added file.
    await Promise.all([repository.getCommit(tour.baseRef), repository.getCommit(tour.ref)]);
    const modified = await getStepSnapshotUri(step, workspaceRoot, tour.ref);
    const baseFile = getFileUri(step.baseFile || step.file, workspaceRoot);
    let original: Uri;
    try {
      const details = await repository.getObjectDetails(tour.baseRef, baseFile.fsPath);
      if (details.mode !== "100644" && details.mode !== "100755") return;
      original = api.toGitUri(baseFile, tour.baseRef);
      await workspace.openTextDocument(original);
    } catch (error) {
      if (step.baseFile || (error as { gitErrorCode?: string })?.gitErrorCode !== "UnknownPath") return;
      original = Uri.from({ scheme: FS_SCHEME_CONTENT, authority: "added", path: baseFile.path, query: tour.baseRef });
    }
    const path = getStepDiffPath(step);
    return { original, modified, title: `${path} (${tour.baseRef} ↔ ${tour.ref})` };
  } catch {
    return;
  }
}
