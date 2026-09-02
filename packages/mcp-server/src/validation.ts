import * as fs from "fs";
import * as path from "path";
import {
  Issue,
  Position,
  Selection,
  TourParams,
  TourStep,
  WorkspaceContext,
} from "./types";

// Moteur de validation déterministe des propositions de Tours.
//
// Toute erreur détectée est agrégée dans une liste d'`Issue` (chemin + message)
// avant de répondre, afin que l'agent corrige la proposition en un seul cycle.
// Une étape peut être purement explicative (sans Tour Anchor) ; lorsqu'elle
// possède un localisateur, celui-ci est validé contre l'état réel du workspace
// (existence, bornes de lignes/sélections, unicité du motif, confinement des
// liens symboliques à la racine configurée).

export const STEP_FIELDS = [
  "title",
  "description",
  "file",
  "directory",
  "line",
  "pattern",
  "selection",
] as const;

export const MAX_RECOMMENDED_STEPS = 15;

// Schémas d'URI actifs refusés dans le Markdown : une description générée ne
// doit pas pouvoir déclencher une action dans l'éditeur ou le terminal.
const FORBIDDEN_URI_SCHEME =
  /(?:command|file|vscode|vscode-insiders|javascript):/i;

type RawObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is RawObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isOptionalString(
  raw: RawObject,
  key: string,
  errorPath: string,
  issues: Issue[]
): string | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    issues.push({ path: errorPath, message: "must be a string" });
    return undefined;
  }
  return value;
}

function reportUnknownFields(
  raw: RawObject,
  allowed: readonly string[],
  errorPath: string,
  issues: Issue[]
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      issues.push({
        path: errorPath === "$" ? key : `${errorPath}.${key}`,
        message:
          "unknown field (V1 tours only allow title, description, file, directory, line, pattern and selection)",
      });
    }
  }
}

const TOUR_PARAM_FIELDS = ["fileName", "title", "description", "steps"] as const;

export function validateTourParams(
  raw: unknown
): { params?: TourParams; issues: Issue[] } {
  const issues: Issue[] = [];
  if (!isPlainObject(raw)) {
    issues.push({ path: "$", message: "the arguments must be an object" });
    return { issues };
  }
  // Le contrat public est strict : tout champ inconnu est refusé, ce qui exclut
  // notamment `ref`, `baseRef`, `headRef`, `includeUncommittedChanges`, `mode`
  // et les capacités CodeTour V2 (`when`, `commands`, `uri`).
  reportUnknownFields(raw, TOUR_PARAM_FIELDS, "$", issues);

  const params: TourParams = { fileName: "", title: "" };

  const fileName = validateFileName(raw.fileName, issues);
  if (fileName !== undefined) {
    params.fileName = fileName;
  }

  if (raw.title === undefined) {
    issues.push({ path: "title", message: "is required and must be a non-empty string" });
  } else if (typeof raw.title !== "string" || raw.title.trim() === "") {
    issues.push({ path: "title", message: "must be a non-empty string" });
  } else {
    params.title = raw.title;
  }

  const description = isOptionalString(raw, "description", "description", issues);
  if (description !== undefined) {
    if (FORBIDDEN_URI_SCHEME.test(description)) {
      issues.push({
        path: "description",
        message:
          "contains a forbidden URI scheme (command:, file:, vscode:, vscode-insiders:, javascript:)",
      });
    }
    params.description = description;
  }

  if (raw.steps === undefined) {
    issues.push({ path: "steps", message: "is required" });
  } else if (!Array.isArray(raw.steps)) {
    issues.push({ path: "steps", message: "must be an array" });
  } else {
    params.steps = raw.steps;
  }

  return { params, issues };
}

// Valide le nom du fichier de sortie. Il doit être un nom de base non vide
// terminé par `.tour`, sans séparateur de chemin, sans `.` / `..` et sans
// chemin absolu. Le serveur ne normalise ni ne renomme silencieusement cette
// valeur : elle est utilisée telle quelle sous `.tours/<fileName>`.
function validateFileName(value: unknown, issues: Issue[]): string | undefined {
  if (value === undefined) {
    issues.push({ path: "fileName", message: "is required" });
    return undefined;
  }
  if (typeof value !== "string") {
    issues.push({ path: "fileName", message: "must be a string" });
    return undefined;
  }
  if (value.length === 0) {
    issues.push({ path: "fileName", message: "must not be empty" });
    return undefined;
  }
  if (path.isAbsolute(value)) {
    issues.push({ path: "fileName", message: "must be a bare file name, not an absolute path" });
    return undefined;
  }
  if (value.includes("/") || value.includes("\\")) {
    issues.push({ path: "fileName", message: "must be a bare file name without path separators" });
    return undefined;
  }
  if (value === "." || value === "..") {
    issues.push({ path: "fileName", message: "must not be '.' or '..'" });
    return undefined;
  }
  if (!value.endsWith(".tour")) {
    issues.push({ path: "fileName", message: "must end with '.tour'" });
    return undefined;
  }
  return value;
}

export function validateSteps(
  rawSteps: unknown[],
  ctx: WorkspaceContext
): { steps?: TourStep[]; issues: Issue[] } {
  const allIssues: Issue[] = [];
  const steps: TourStep[] = [];
  for (let index = 0; index < rawSteps.length; index++) {
    const { step, issues } = validateStep(rawSteps[index], index, ctx);
    allIssues.push(...issues);
    if (step) {
      steps.push(step);
    }
  }
  if (allIssues.length > 0) {
    return { issues: allIssues };
  }
  return { steps, issues: [] };
}

// Valide chaque étape contre les règles de Tour Anchor :
// - au plus un localisateur principal (fichier ou répertoire) ;
// - ligne, motif et sélection ne sont valides qu'avec un fichier ;
// - ligne et motif sont mutuellement exclusifs ;
// - le motif doit identifier une occurrence unique dans le fichier ;
// - les bornes de ligne et de sélection sont vérifiées contre le contenu réel.
function validateStep(
  raw: unknown,
  index: number,
  ctx: WorkspaceContext
): { step?: TourStep; issues: Issue[] } {
  const issues: Issue[] = [];
  const base = `steps[${index}]`;
  if (!isPlainObject(raw)) {
    issues.push({ path: base, message: "must be an object" });
    return { issues };
  }
  reportUnknownFields(raw, STEP_FIELDS, base, issues);

  const description = isOptionalString(raw, "description", `${base}.description`, issues);
  if (description === undefined && raw.description === undefined) {
    issues.push({ path: `${base}.description`, message: "is required and must be a string" });
  }

  const title = isOptionalString(raw, "title", `${base}.title`, issues);

  const file = isOptionalString(raw, "file", `${base}.file`, issues);
  const directory = isOptionalString(raw, "directory", `${base}.directory`, issues);

  if (file !== undefined && directory !== undefined) {
    issues.push({ path: base, message: "a step cannot have both a file and a directory" });
  }

  let line: number | undefined;
  if (raw.line !== undefined) {
    if (!isPositiveInteger(raw.line)) {
      issues.push({ path: `${base}.line`, message: "must be a positive integer" });
    } else {
      line = raw.line;
    }
    if (file === undefined) {
      issues.push({ path: `${base}.line`, message: "is only valid together with a file" });
    }
  }

  let pattern: string | undefined;
  if (raw.pattern !== undefined) {
    if (typeof raw.pattern !== "string") {
      issues.push({ path: `${base}.pattern`, message: "must be a string" });
    } else {
      pattern = raw.pattern;
    }
    if (file === undefined) {
      issues.push({ path: `${base}.pattern`, message: "is only valid together with a file" });
    }
  }

  if (line !== undefined && pattern !== undefined) {
    issues.push({ path: base, message: "line and pattern are mutually exclusive" });
  }

  let selection: Selection | undefined;
  if (raw.selection !== undefined) {
    selection = validateSelection(raw.selection, `${base}.selection`, issues);
    if (file === undefined) {
      issues.push({ path: `${base}.selection`, message: "is only valid together with a file" });
    }
  }

  // Le Markdown d'une étape ne peut contenir que des liens et images HTTPS
  // ordinaires ; les schémas actifs sont refusés.
  if (description !== undefined && FORBIDDEN_URI_SCHEME.test(description)) {
    issues.push({
      path: `${base}.description`,
      message:
        "contains a forbidden URI scheme (command:, file:, vscode:, vscode-insiders:, javascript:)",
    });
  }

  // Résolution du chemin réel de l'ancre : une lecture n'a lieu qu'après
  // vérification du confinement au workspace.
  let fileContent: string | undefined;
  let fileAnchorOk = true;
  if (file !== undefined) {
    const anchor = checkAnchor(ctx, file, "file", `${base}.file`, issues);
    if (anchor.ok && anchor.realPath !== undefined) {
      try {
        fileContent = fs.readFileSync(anchor.realPath, "utf8");
      } catch {
        issues.push({ path: `${base}.file`, message: "could not be read" });
      }
    }
    fileAnchorOk = anchor.ok;
  }
  if (directory !== undefined) {
    checkAnchor(ctx, directory, "directory", `${base}.directory`, issues);
  }

  if (fileContent === undefined && !fileAnchorOk) {
    for (const field of ["line", "pattern", "selection"] as const) {
      if (raw[field] !== undefined) {
        issues.push({
          path: `${base}.${field}`,
          message: "cannot be validated because the file anchor is invalid",
        });
      }
    }
  }

  if (line !== undefined && fileContent !== undefined) {
    const lineCount = fileContent.split("\n").length;
    if (line > lineCount) {
      issues.push({
        path: `${base}.line`,
        message: `is out of range: the file has ${lineCount} line(s)`,
      });
    }
  }

  if (pattern !== undefined && fileContent !== undefined) {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (error) {
      issues.push({
        path: `${base}.pattern`,
        message: `is not a valid regular expression: ${(error as Error).message}`,
      });
      regex = undefined as unknown as RegExp;
    }
    if (regex) {
      const matches = fileContent.match(new RegExp(regex.source, "g")) ?? [];
      if (matches.length !== 1) {
        issues.push({
          path: `${base}.pattern`,
          message: `must match exactly one occurrence in the file (matched ${matches.length})`,
        });
      }
    }
  }

  if (selection && fileContent !== undefined) {
    validateSelectionBounds(selection, fileContent, base, issues);
  }

  if (issues.length > 0) {
    return { issues };
  }
  return {
    step: {
      title,
      description: description as string,
      file,
      directory,
      line,
      pattern,
      selection,
    },
    issues: [],
  };
}

function validateSelection(
  raw: unknown,
  base: string,
  issues: Issue[]
): Selection | undefined {
  if (!isPlainObject(raw)) {
    issues.push({ path: base, message: "must be an object with start and end" });
    return undefined;
  }
  reportUnknownFields(raw, ["start", "end"], base, issues);
  const start = validatePosition(raw.start, `${base}.start`, issues);
  const end = validatePosition(raw.end, `${base}.end`, issues);
  if (!start || !end) {
    return undefined;
  }
  if (
    start.line > end.line ||
    (start.line === end.line && start.character > end.character)
  ) {
    issues.push({ path: base, message: "the start position must be before the end position" });
    return undefined;
  }
  return { start, end };
}

function validatePosition(
  raw: unknown,
  base: string,
  issues: Issue[]
): Position | undefined {
  if (!isPlainObject(raw)) {
    issues.push({ path: base, message: "must be an object with line and character" });
    return undefined;
  }
  reportUnknownFields(raw, ["line", "character"], base, issues);
  let line: number | undefined;
  if (!isPositiveInteger(raw.line)) {
    issues.push({ path: `${base}.line`, message: "is required and must be a positive integer" });
  } else {
    line = raw.line;
  }
  let character: number | undefined;
  if (!isPositiveInteger(raw.character)) {
    issues.push({ path: `${base}.character`, message: "is required and must be a positive integer" });
  } else {
    character = raw.character;
  }
  if (line === undefined || character === undefined) {
    return undefined;
  }
  return { line, character };
}

function validateSelectionBounds(
  selection: Selection,
  fileContent: string,
  base: string,
  issues: Issue[]
): void {
  const lines = fileContent.split("\n");
  const maxLine = lines.length;
  if (selection.start.line > maxLine) {
    issues.push({
      path: `${base}.selection.start.line`,
      message: `is out of range: the file has ${maxLine} line(s)`,
    });
  } else {
    const maxCharacter = lines[selection.start.line - 1].length + 1;
    if (selection.start.character > maxCharacter) {
      issues.push({
        path: `${base}.selection.start.character`,
        message: `is out of range: line ${selection.start.line} has ${maxCharacter} character slot(s)`,
      });
    }
  }
  if (selection.end.line > maxLine) {
    issues.push({
      path: `${base}.selection.end.line`,
      message: `is out of range: the file has ${maxLine} line(s)`,
    });
  } else {
    const maxCharacter = lines[selection.end.line - 1].length + 1;
    if (selection.end.character > maxCharacter) {
      issues.push({
        path: `${base}.selection.end.character`,
        message: `is out of range: line ${selection.end.line} has ${maxCharacter} character slot(s)`,
      });
    }
  }
}

interface AnchorResult {
  ok: boolean;
  realPath?: string;
}

// Vérifie qu'une ancre (fichier ou répertoire) existe réellement et reste
// confinée au workspace : le chemin réel est résolu avant toute lecture, et un
// lien symbolique qui sort de la racine configurée est refusé.
function checkAnchor(
  ctx: WorkspaceContext,
  value: string,
  kind: "file" | "directory",
  errorPath: string,
  issues: Issue[]
): AnchorResult {
  if (value.trim() === "") {
    issues.push({ path: errorPath, message: "must not be empty" });
    return { ok: false };
  }
  if (path.isAbsolute(value)) {
    issues.push({ path: errorPath, message: "must be relative to the workspace root" });
    return { ok: false };
  }
  const target = path.resolve(ctx.root, value);
  let realPath: string;
  try {
    realPath = fs.realpathSync(target);
  } catch {
    issues.push({ path: errorPath, message: "does not exist in the workspace" });
    return { ok: false };
  }
  const relative = path.relative(ctx.realRoot, realPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    issues.push({
      path: errorPath,
      message: "resolves outside the workspace root (symlinks escaping the workspace are not allowed)",
    });
    return { ok: false };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(realPath);
  } catch {
    issues.push({ path: errorPath, message: "does not exist in the workspace" });
    return { ok: false };
  }
  if (kind === "file" && !stat.isFile()) {
    issues.push({ path: errorPath, message: "is not a file" });
    return { ok: false };
  }
  if (kind === "directory" && !stat.isDirectory()) {
    issues.push({ path: errorPath, message: "is not a directory" });
    return { ok: false };
  }
  return { ok: true, realPath };
}
