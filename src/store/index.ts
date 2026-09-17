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

  // A step guides the player to one destination type: a file, directory,
  // virtual content, resource, or VS Code view.
  file?: string;
  directory?: string;
  contents?: string;
  uri?: string;
  view?: string;

  // The line and selection identify the area to show in a file. Without a
  // position, the step is presented as an explanation of the entire file.
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
  isPrimary?: boolean;
  nextTour?: string;
  stepMarker?: string;
  when?: string;
}

export interface ActiveTour {
  tour: CodeTour;
  step: number;

  // During recording, a tour can be active before its first comment is placed
  // in the editor.
  thread: CommentThread | null | undefined;

  // The root identifies the project in which the tour's relative paths open.
  workspaceRoot?: Uri;

  // Related tours allow links to open another tour, including when the group
  // comes from a source outside the project.
  tours?: CodeTour[];
}

type CodeTourProgress = [string, number[]];
export type CodeTourStepTuple = [CodeTour, CodeTourStep, number, number?];

export interface Store {
  tours: CodeTour[];
  activeTour: ActiveTour | null;
  activeEditorSteps?: CodeTourStepTuple[];
  hasTours: boolean;
  isRecording: boolean;
  isEditing: boolean;
  showMarkers: boolean;
  progress: CodeTourProgress[];
}

export const store: Store = observable({
  tours: [],
  activeTour: null,
  isRecording: false,
  isEditing: false,
  get hasTours() {
    return this.tours.length > 0;
  },
  showMarkers: false,
  progress: []
});
