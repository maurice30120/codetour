export interface Position {
  line: number;
  character: number;
}

export interface Selection {
  start: Position;
  end: Position;
}

export interface TourStep {
  title?: string;
  description: string;
  file?: string;
  directory?: string;
  line?: number;
  pattern?: string;
  selection?: Selection;
}

// Contrat public de l'unique outil `create_tour`. Le Tour Generator choisit le
// sujet du Tour, analyse lui-même l'état du workspace (Git ou autre) et fournit
// le nom du fichier de sortie. Le serveur ne connaît ni mode, ni référence Git.
export interface TourParams {
  fileName: string;
  title: string;
  description?: string;
  steps?: unknown[];
}

// Fichier Tour produit. Le serveur n'écrit jamais de propriété `ref` : les
// stratégies de référencement Git relèvent désormais du Tour Generator.
export interface TourFile {
  $schema?: string;
  title: string;
  description?: string;
  steps: TourStep[];
}

export interface Issue {
  path: string;
  message: string;
}

export interface Warning {
  code: string;
  message: string;
}

export interface SuccessResult {
  status: "created";
  path: string;
  stepCount: number;
  warnings: Warning[];
}

export interface ErrorResult {
  status: "error";
  code: string;
  message: string;
  issues?: Issue[];
}

export type ToolResult = SuccessResult | ErrorResult;

export interface WorkspaceContext {
  root: string;
  realRoot: string;
}
