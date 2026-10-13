// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { observable } from "mobx";
import { CommentThread, Uri } from "vscode";

export interface CodeTourStepPosition {
  line: number;
  character: number;
}

export interface CodeTourStep {
  title?: string;
  description: string;
  icon?: string;

  // A step guides the reader to a single type of destination: a file,
  // a directory, virtual content, a resource, or a VS Code view.
  file?: string;
  baseFile?: string;
  display?: "diff";
  directory?: string;
  contents?: string;
  uri?: string;
  view?: string;

  // Line and selection narrow the region to show inside a file. Without a
  // position, the step is presented as an explanation of the whole file.
  line?: number;
  selection?: { start: CodeTourStepPosition; end: CodeTourStepPosition };

  commands?: string[];

  pattern?: string;
  markerTitle?: string;
}

export interface CodeTour {
  id: string;
  title: string;
  description?: string;
  steps: CodeTourStep[];
  ref?: string;
  baseRef?: string;
  isPrimary?: boolean;
  nextTour?: string;
  stepMarker?: string;
  when?: string;
}

export interface ActiveTour {
  tour: CodeTour;
  step: number;

  // While recording, the tour can be active before its first comment is
  // placed in the editor.
  thread: CommentThread | null | undefined;

  // The root indicates in which project to open the tour's relative paths.
  workspaceRoot?: Uri;

  // Associated tours make it possible to follow a link to another tour, even
  // when the set comes from a source outside the project.
  tours?: CodeTour[];
}

type CodeTourProgress = [string, number[]];
export type CodeTourStepTuple = [CodeTour, CodeTourStep, number, number?];

// The presentation used while reading a tour: the historical inline comment
// threads, or the side webview panel. The mode belongs to VS Code settings
// and never changes the persisted tour format.
export type PlaybackMode = "comments" | "webview";

export interface Store {
  tours: CodeTour[];
  activeTour: ActiveTour | null;
  activeEditorSteps?: CodeTourStepTuple[];
  hasTours: boolean;
  isRecording: boolean;
  isEditing: boolean;
  playbackMode: PlaybackMode;
  showMarkers: boolean;
  progress: CodeTourProgress[];
}

export const store: Store = observable({
  tours: [],
  activeTour: null,
  isRecording: false,
  isEditing: false,
  playbackMode: "comments",
  get hasTours() {
    return this.tours.length > 0;
  },
  showMarkers: false,
  progress: []
});
