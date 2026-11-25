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
  questions?: string[];
  file?: string;
  baseFile?: string;
  display?: "diff";
  directory?: string;
  line?: number;
  pattern?: string;
  selection?: Selection;
}

export interface ProjectParams {
  workspacePath?: string;
  title?: string;
  description?: string;
  fileName?: string;
  steps?: unknown[];
}

export type ReviewMode = "neutral" | "critical";

export interface ChangesParams extends ProjectParams {
  baseRef?: string;
  headRef?: string;
  includeUncommittedChanges?: boolean;
  reviewMode?: ReviewMode;
}

export interface TourFile {
  $schema?: string;
  title: string;
  description?: string;
  ref?: string;
  baseRef?: string;
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

export interface WorkspaceContext {
  root: string;
  realRoot: string;
}

/** The two Tour kinds the creation rules can produce. */
export type TourKind = "project" | "changes";

/** A Tour that exists on disk, as the creation rules report it. */
export interface CreatedTour {
  kind: TourKind;
  /** Canonical workspace root the creation was requested for. */
  workspaceRoot: string;
  /** Absolute path of the written Tour file. */
  tourPath: string;
  title: string;
  stepCount: number;
  warnings: Warning[];
}

/** A refused creation: nothing was written and no existing Tour was touched. */
export interface CreationFailure {
  ok: false;
  code: string;
  message: string;
  issues?: Issue[];
}

export type CreationResult = (CreatedTour & { ok: true }) | CreationFailure;

export interface CreateTourOptions {
  /** Workspace the creation runs in; every anchor and output stays inside it. */
  workspaceRoot: string;
  /** The proposal, exactly as the caller received it: untrusted JSON. */
  proposal: unknown;
  /**
   * Name of the entry point the report addresses, so a rejection names the
   * command the caller actually ran. Without one, the entry point is named
   * after the Tour kind: `create-project-tour` or `create-changes-tour`.
   */
  surface?: string;
}
