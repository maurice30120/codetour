import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createContext } from "./context";
import {
  changedFiles,
  committedDiffIsEmpty,
  currentBranchName,
  currentHeadSha,
  isGitRepository,
  mergeBase,
  normalizeSlashes,
  uncommittedChanges,
  workspacePrefix,
} from "./git";
import { OutputPathError, writeTourAtomic } from "./persistence";
import { validateCodetourTour } from "./codetour-schema";
import {
  ErrorResult,
  Issue,
  SuccessResult,
  TourFile,
  TourStep,
  Warning,
  WorkspaceContext,
} from "./types";
import {
  MAX_RECOMMENDED_STEPS,
  validateChangesParams,
  validateProjectParams,
  validateSteps,
} from "./validation";
import packageJson from "../package.json";

// Serveur MCP V1 : expose exactement deux outils, `create_project_tour` et
// `create_changes_tour`. L'agent IA rédige le contenu ; le serveur ne fait que
// valider la proposition, appliquer les règles Git et de sécurité, puis écrire
// de façon atomique le fichier de Tour réservé correspondant.
//
// Les schémas d'entrée des outils restent volontairement permissifs
// (`z.unknown()` + `.passthrough()`) : le SDK MCP rejette lui-même les arguments
// qui ne correspondent pas à un schéma strict, ce qui casserait l'exigence
// d'agréger toutes les erreurs de validation dans une seule réponse. La
// validation complète, champ par champ, est donc effectuée dans validation.ts.

const CODETOUR_SCHEMA_URI = "https://aka.ms/codetour-schema";
const SERVER_NAME = "codetour-mcp";
const SERVER_VERSION = packageJson.version;

// Destinations fixes et réservées aux Tours générés. Elles sont toujours
// remplacées après une validation complète, et ignorées lors de la détection
// d'un workspace sale (voir git.ts).
const PROJECT_TOUR_PATH = ".tours/project.tour";
const CHANGES_TOUR_PATH = ".tours/changes.tour";

const PROJECT_TOUR_DESCRIPTION =
  "Creates a CodeTour Project Tour that explains a codebase as a whole, persisted at " +
  ".tours/project.tour (replacing any previously generated tour of the same kind). " +
  "You provide the fully written content; the server only validates and persists it deterministically. " +
  "A good Project Tour ideally covers: the project's purpose, its main entry points, its important " +
  "components, and its main execution flows. " +
  "Arguments: an optional title (defaults to \"Project Overview\"), an optional description, and a " +
  "required non-empty steps array. Each step takes an optional title, a required Markdown description, " +
  "and at most one locator: a file or a directory (workspace-relative paths). A step may also target a " +
  "line, a unique stable pattern, or a selection, but only together with a file; line and pattern are " +
  "mutually exclusive. Prefer a unique stable pattern over a line number so the anchor resists file " +
  "evolution, and use a line only as a fallback. Steps without any locator are allowed for general " +
  "context. Every anchor is " +
  "validated against the real workspace state, and all validation errors are reported in a single " +
  "response. On failure, the previous tour file is preserved.";

const CHANGES_TOUR_DESCRIPTION =
  "Creates a CodeTour Changes Tour that explains the committed changes on the current branch since it " +
  "diverged from a base ref, persisted at .tours/changes.tour (replacing any previously generated tour " +
  "of the same kind). You provide the fully written content; the server only validates and persists it " +
  "deterministically. A good Changes Tour ideally covers: the intent of the changes, the major " +
  "modifications, their impact, and the relevant tests. " +
  "Arguments: base (required Git ref), head (required full 40-character SHA of the analyzed commit, " +
  "which must equal the current HEAD), includeUncommitted (optional boolean, default false), an optional " +
  "title (defaults to \"Changes on <branch>\"), an optional description, and a required non-empty steps " +
  "array. Steps follow the same rules as the Project Tour (prefer a unique stable pattern over a line " +
  "number); steps may anchor unchanged files when they " +
  "provide essential context, and deleted files must be explained with steps that have no locator. " +
  "Uncommitted changes are excluded by default and reported as a warning; pass includeUncommitted to " +
  "include them explicitly. The description is automatically enriched with the base, merge-base and " +
  "head. On failure, the previous tour file is preserved.";

const warningSchema = z.object({
  code: z.string(),
  message: z.string(),
});
const issueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
const toolResultSchema = z.object({
  status: z.enum(["created", "error"]),
  path: z.string().optional(),
  stepCount: z.number().int().nonnegative().optional(),
  warnings: z.array(warningSchema).optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  issues: z.array(issueSchema).optional(),
});

const projectToolInputSchema = z
  .object({
    title: z.unknown().optional(),
    description: z.unknown().optional(),
    steps: z.unknown().optional(),
  })
  .passthrough();

const changesToolInputSchema = z
  .object({
    title: z.unknown().optional(),
    description: z.unknown().optional(),
    steps: z.unknown().optional(),
    base: z.unknown().optional(),
    head: z.unknown().optional(),
    includeUncommitted: z.unknown().optional(),
  })
  .passthrough();

export function createServer(workspaceRoot: string): McpServer {
  const ctx = createContext(workspaceRoot);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "create_project_tour",
    {
      description: PROJECT_TOUR_DESCRIPTION,
      inputSchema: projectToolInputSchema,
      outputSchema: toolResultSchema,
    },
    (args) => handleCreateProjectTour(ctx, args)
  );

  server.registerTool(
    "create_changes_tour",
    {
      description: CHANGES_TOUR_DESCRIPTION,
      inputSchema: changesToolInputSchema,
      outputSchema: toolResultSchema,
    },
    (args) => handleCreateChangesTour(ctx, args)
  );

  return server;
}

// Crée un Project Tour : aucun accès Git n'est nécessaire, la visite fonctionne
// dans n'importe quel workspace et n'est jamais attachée à un `ref`, afin de
// rester consultable pendant l'évolution normale du projet.
async function handleCreateProjectTour(
  ctx: WorkspaceContext,
  args: unknown
): Promise<ToolResponse> {
  const rawSteps = extractSteps(args);
  if (rawSteps === undefined || (Array.isArray(rawSteps) && rawSteps.length === 0)) {
    return errorResponse("TOUR_STEPS_REQUIRED", "A tour requires at least one step.");
  }

  // La validation agrège toutes les erreurs (paramètres puis étapes) avant de
  // répondre, pour permettre à l'agent de corriger la proposition en un cycle.
  const { params, issues: paramIssues } = validateProjectParams(args);
  const allIssues = [...paramIssues];
  let steps: TourStep[] | undefined;
  if (Array.isArray(rawSteps)) {
    const validated = validateSteps(rawSteps, ctx);
    steps = validated.steps;
    allIssues.push(...validated.issues);
  }
  if (!params || allIssues.length > 0) {
    return errorResponse(
      "INVALID_PROPOSAL",
      "The create_project_tour arguments are invalid.",
      allIssues
    );
  }
  const finalSteps = steps as TourStep[];

  const warnings = stepLimitWarnings(finalSteps);

  const tour: TourFile = {
    $schema: CODETOUR_SCHEMA_URI,
    title: params.title ?? "Project Overview",
    ...(params.description !== undefined ? { description: params.description } : {}),
    steps: finalSteps,
  };

  const writeFailure = await persistTour(ctx, PROJECT_TOUR_PATH, tour);
  if (writeFailure) {
    return writeFailure;
  }

  return successResponse(
    PROJECT_TOUR_PATH,
    finalSteps.length,
    warnings,
    `Created Project Tour at ${PROJECT_TOUR_PATH} with ${finalSteps.length} step(s).`
  );
}

// Crée un Changes Tour : l'analyse porte sur les changements committés depuis
// le merge-base de `base` jusqu'à `head`. `head` doit être le SHA complet du
// HEAD courant, sinon la génération échoue avec STALE_HEAD pour éviter une
// explication obsolète. Par défaut, seuls les changements committés sont pris
// en compte ; `includeUncommitted` permet d'expliquer un travail local.
async function handleCreateChangesTour(
  ctx: WorkspaceContext,
  args: unknown
): Promise<ToolResponse> {
  const rawSteps = extractSteps(args);
  if (rawSteps === undefined || (Array.isArray(rawSteps) && rawSteps.length === 0)) {
    return errorResponse("TOUR_STEPS_REQUIRED", "A tour requires at least one step.");
  }

  // Même stratégie d'agrégation que pour le Project Tour : toutes les erreurs
  // de validation sont collectées avant de répondre.
  const { params, issues: paramIssues } = validateChangesParams(args);
  const allIssues = [...paramIssues];
  let steps: TourStep[] | undefined;
  if (Array.isArray(rawSteps)) {
    const validated = validateSteps(rawSteps, ctx);
    steps = validated.steps;
    allIssues.push(...validated.issues);
  }
  if (!params || allIssues.length > 0) {
    return errorResponse(
      "INVALID_PROPOSAL",
      "The create_changes_tour arguments are invalid.",
      allIssues
    );
  }

  const base = params.base as string;
  const head = params.head as string;
  const includeUncommitted = params.includeUncommitted === true;

  // Le Changes Tour dépend de l'historique Git : hors dépôt, l'outil échoue.
  if (!(await isGitRepository(ctx))) {
    return errorResponse(
      "GIT_REPOSITORY_REQUIRED",
      "create_changes_tour requires a Git repository, but the workspace root is not inside one."
    );
  }

  // Le SHA analysé doit correspondre exactement au HEAD courant : sinon
  // l'explication risquerait de ne pas correspondre au snapshot relu.
  const currentHead = await currentHeadSha(ctx);
  if (currentHead === null) {
    return errorResponse(
      "STALE_HEAD",
      "The repository has no commits, so there is no HEAD to analyze."
    );
  }
  if (head !== currentHead) {
    return errorResponse(
      "STALE_HEAD",
      `The provided head ${head} does not match the current HEAD (${currentHead}). The analysis is stale; re-run it against the current HEAD.`
    );
  }

  let mergeBaseSha: string;
  try {
    mergeBaseSha = await mergeBase(ctx, base, head);
  } catch (error) {
    return errorResponse(
      "INVALID_BASE_REF",
      `Unable to compute the merge-base between ${base} and ${head}: ${(error as Error).message}`
    );
  }

  // Sans aucun changement committé (et sans travail local inclus), l'outil
  // répond NO_CHANGES et conserve l'ancien Changes Tour : une visite vide ne
  // remplace jamais une visite utile.
  const uncommitted = await uncommittedChanges(ctx);
  if (
    (await committedDiffIsEmpty(ctx, mergeBaseSha, head)) &&
    (!includeUncommitted || uncommitted.length === 0)
  ) {
    return errorResponse(
      "NO_CHANGES",
      `No committed changes between the merge-base of ${base} (${mergeBaseSha}) and ${head}. The previous tour file was preserved.`
    );
  }

  // Les changements non committés sont exclus par défaut (avertissement),
  // ou inclus explicitement : le Tour n'a alors pas de `ref` et signale que
  // le résultat décrit un état local non reproductible.
  const warnings: Warning[] = [];
  if (includeUncommitted) {
    warnings.push({
      code: "UNCOMMITTED_CHANGES_INCLUDED",
      message:
        "Uncommitted changes were explicitly included; the tour describes a local state that is not reproducible from Git.",
    });
  } else if (uncommitted.length > 0) {
    warnings.push({
      code: "UNCOMMITTED_CHANGES_EXCLUDED",
      message: `${uncommitted.length} uncommitted change(s) were excluded from the analysis (staged, unstaged or untracked).`,
    });
  }

  const finalSteps = steps as TourStep[];
  const warningsFromStepLimit = stepLimitWarnings(finalSteps);
  warnings.push(...warningsFromStepLimit);

  // Ensemble des fichiers modifiés (committés, plus les fichiers non committés
  // lorsque includeUncommitted est actif), utilisé pour l'avertissement
  // NO_CHANGED_FILE_ANCHOR.
  const changedInWorkspace = await changedFilesInWorkspace(ctx, mergeBaseSha, head);
  if (includeUncommitted) {
    for (const entry of uncommitted) {
      if (!changedInWorkspace.includes(entry.path)) {
        changedInWorkspace.push(entry.path);
      }
    }
  }
  if (
    changedInWorkspace.length > 0 &&
    !finalSteps.some(
      (step) =>
        step.file !== undefined &&
        changedInWorkspace.includes(normalizeSlashes(step.file))
    )
  ) {
    warnings.push({
      code: "NO_CHANGED_FILE_ANCHOR",
      message:
        "No step anchors a file modified by these changes; consider anchoring steps on changed files.",
    });
  }

  const title = params.title ?? (await defaultChangesTitle(ctx, head));
  // La description est enrichie automatiquement avec la provenance, la base et
  // la tête, afin que le périmètre analysé soit toujours connu du lecteur.
  const provenance = includeUncommitted
    ? `Generated from the merge-base of \`${base}\` (\`${mergeBaseSha}\`) to \`${head}\`, including uncommitted changes (non-reproducible local state).`
    : `Generated from the merge-base of \`${base}\` (\`${mergeBaseSha}\`) to \`${head}\`.`;
  const description =
    params.description !== undefined
      ? `${params.description}\n\n${provenance}`
      : provenance;

  const tour: TourFile = {
    $schema: CODETOUR_SCHEMA_URI,
    title,
    description,
    ...(!includeUncommitted ? { ref: head } : {}),
    steps: finalSteps,
  };

  const writeFailure = await persistTour(ctx, CHANGES_TOUR_PATH, tour);
  if (writeFailure) {
    return writeFailure;
  }

  return successResponse(
    CHANGES_TOUR_PATH,
    finalSteps.length,
    warnings,
    `Created Changes Tour at ${CHANGES_TOUR_PATH} with ${finalSteps.length} step(s) for head ${head} (base ${base}).`
  );
}

// Avertissement non bloquant lorsqu'un Tour dépasse quinze étapes.
function stepLimitWarnings(steps: TourStep[]): Warning[] {
  if (steps.length <= MAX_RECOMMENDED_STEPS) {
    return [];
  }
  return [
    {
      code: "STEP_LIMIT_EXCEEDED",
      message: `The tour has ${steps.length} steps; the recommended maximum is ${MAX_RECOMMENDED_STEPS}.`,
    },
  ];
}

// Valide le Tour produit contre le schéma CodeTour général, puis l'écrit de
// façon atomique. En cas d'échec, l'ancien fichier reste intact.
async function persistTour(
  ctx: WorkspaceContext,
  relativePath: string,
  tour: TourFile
): Promise<ToolResponse | null> {
  const schemaResult = validateCodetourTour(tour);
  if (!schemaResult) {
    return errorResponse(
      "SCHEMA_VALIDATION_FAILED",
      "The generated tour did not validate against the CodeTour schema.",
      []
    );
  }
  try {
    await writeTourAtomic(ctx, relativePath, serializeTour(tour));
  } catch (error) {
    if (error instanceof OutputPathError) {
      return errorResponse("OUTPUT_PATH_ESCAPES_WORKSPACE", error.message);
    }
    throw error;
  }
  return null;
}

function extractSteps(args: unknown): unknown {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return undefined;
  }
  return (args as Record<string, unknown>).steps;
}

// Fichiers modifiés par le diff committé, convertis en chemins relatifs au
// workspace (le workspace peut être un sous-répertoire du dépôt).
async function changedFilesInWorkspace(
  ctx: WorkspaceContext,
  mergeBaseSha: string,
  head: string
): Promise<string[]> {
  const files = await changedFiles(ctx, mergeBaseSha, head);
  const prefix = normalizeSlashes(await workspacePrefix(ctx));
  return files
    .map(normalizeSlashes)
    .filter((file) => file.startsWith(prefix))
    .map((file) => file.slice(prefix.length));
}

// Titre par défaut du Changes Tour : « Changes on <branche> », avec un
// repli sur le SHA court lorsque HEAD est détaché.
async function defaultChangesTitle(
  ctx: WorkspaceContext,
  head: string
): Promise<string> {
  const branch = await currentBranchName(ctx);
  if (branch && branch !== "HEAD") {
    return `Changes on ${branch}`;
  }
  return `Changes at ${head.slice(0, 7)}`;
}

function serializeTour(tour: TourFile): string {
  return JSON.stringify(tour, null, 2) + "\n";
}

interface ToolResponse {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

function successResponse(
  relativePath: string,
  stepCount: number,
  warnings: Warning[],
  message: string
): ToolResponse {
  const result: SuccessResult = {
    status: "created",
    path: relativePath,
    stepCount,
    warnings,
  };
  const text = [
    message,
    ...warnings.map((warning) => `Warning (${warning.code}): ${warning.message}`),
  ].join("\n");
  return {
    content: [{ type: "text", text }],
    structuredContent: result as unknown as Record<string, unknown>,
  };
}

function errorResponse(
  code: string,
  message: string,
  issues?: Issue[]
): ToolResponse {
  const result: ErrorResult = {
    status: "error",
    code,
    message,
    ...(issues && issues.length > 0 ? { issues } : {}),
  };
  const text =
    issues && issues.length > 0
      ? `Error (${code}): ${message}\n` +
        issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n")
      : `Error (${code}): ${message}`;
  return {
    content: [{ type: "text", text }],
    structuredContent: result as unknown as Record<string, unknown>,
    isError: true,
  };
}
