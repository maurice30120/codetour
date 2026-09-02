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

  // Une étape guide le lecteur vers un seul type de destination : un fichier,
  // un répertoire, un contenu virtuel, une ressource ou une vue de VS Code.
  file?: string;
  directory?: string;
  contents?: string;
  uri?: string;
  view?: string;

  // La ligne et la sélection précisent la zone à montrer dans un fichier. Sans
  // position, l'étape est présentée comme une explication du fichier entier.
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

  // Pendant l'enregistrement, la visite peut être active avant que son premier
  // commentaire ne soit placé dans l'éditeur.
  thread: CommentThread | null | undefined;

  // La racine indique dans quel projet ouvrir les chemins relatifs de la visite.
  workspaceRoot?: Uri;

  // Les visites associées permettent de suivre un lien vers une autre visite,
  // y compris lorsque l'ensemble provient d'une source extérieure au projet.
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
