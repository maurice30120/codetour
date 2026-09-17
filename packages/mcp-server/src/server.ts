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
import {
  MERMAID_TOOL_GUIDANCE,
  validateMermaidDescriptions,
} from "./mermaid-validation";
import packageJson from "../package.json";

// Point de passage entre l'agent IA et CodeTour : l'agent propose une visite
// complète, puis le serveur garantit qu'elle peut être ouverte sans risque dans
// le projet. Deux usages sont proposés : découvrir le projet dans son ensemble
// ou expliquer les changements de la branche courante.
//
// Les schémas d'entrée des outils restent volontairement permissifs
// (`z.unknown()` + `.passthrough()`) : le SDK MCP rejette lui-même les arguments
// qui ne correspondent pas à un schéma strict, ce qui casserait l'exigence
// d'agréger toutes les erreurs de validation dans une seule réponse. La
// validation complète, champ par champ, est donc effectuée dans validation.ts.

const CODETOUR_SCHEMA_URI = "https://aka.ms/codetour-schema";
const SERVER_NAME = "codetour-mcp";
const SERVER_VERSION = packageJson.version;

// Chaque type de visite possède une destination stable. L'utilisateur retrouve
// ainsi toujours la dernière visite générée au même endroit, sans que ces
// fichiers soient eux-mêmes considérés comme des changements à expliquer.
const PROJECT_TOUR_PATH = ".tours/project.tour";
const CHANGES_TOUR_PATH = ".tours/changes.tour";

const MARKDOWN_WRITING_GUIDANCE =
  "Write the Tour-level description and every step description as readable Markdown. " +
  "Split distinct ideas into short paragraphs separated by blank lines (`\\n\\n`), because " +
  "a single newline (`\\n`) is a Markdown soft break and may render as a space. Use a short " +
  "heading when a description covers multiple topics, and use bullet or numbered lists " +
  "for collections, alternatives, or sequences. Use **bold** sparingly for important " +
  "concepts and backticks for code identifiers. Avoid dense monolithic paragraphs, and " +
  "keep each explanation concise and tied to the current Tour Anchor. Do not add " +
  "structure mechanically: a short, single-purpose description may remain one paragraph. ";

const PROJECT_TOUR_DESCRIPTION =
  "Creates a CodeTour Project Tour that explains a codebase as a whole, persisted at " +
  ".tours/project.tour (replacing any previously generated tour of the same kind). " +
  "You provide the fully written content; the server only validates and persists it deterministically. " +
  "A good Project Tour ideally covers: the project's purpose, its main entry points, its important " +
  "components, and its main execution flows. Begin with a directory-anchored overview step whenever " +
  "the project has a meaningful directory structure. If the tour is scoped to a subdirectory, anchor " +
  "that first step to the exact workspace-relative directory. Use additional directory-anchored steps " +
  "to introduce major components before moving into detailed file anchors. " +
  "Arguments: an optional title (defaults to \"Project Overview\"), an optional description, and a " +
  "required non-empty steps array. Each step takes an optional title, a required Markdown description, " +
  "and at most one locator: a file or a directory (workspace-relative paths). A step may also target a " +
  "line, a unique stable pattern, or a selection, but only together with a file; line and pattern are " +
  "mutually exclusive. Prefer a unique stable pattern over a line number so the anchor resists file " +
  "evolution, and use a line only as a fallback. Steps without any locator are allowed for general " +
  "context. Every anchor is " +
  "validated against the real workspace state, and all validation errors are reported in a single " +
  "response. On failure, the previous tour file is preserved. " +
  MARKDOWN_WRITING_GUIDANCE +
  MERMAID_TOOL_GUIDANCE;

const CHANGES_TOUR_DESCRIPTION =
  "Creates a CodeTour Changes Tour that explains the committed changes on the current branch since it " +
  "diverged from a base ref, persisted at .tours/changes.tour (replacing any previously generated tour " +
  "of the same kind). You provide the fully written content; the server only validates and persists it " +
  "deterministically. A good Changes Tour ideally covers: the intent of the changes, the major " +
  "modifications, their impact, and the relevant tests. " +
  "Arguments: baseRef (required Git ref), headRef (required full 40-character SHA of the analyzed commit, " +
  "which must equal the current HEAD), includeUncommittedChanges (optional boolean, default false), an optional " +
  "title (defaults to \"Changes on <branch>\"), an optional description, and a required non-empty steps " +
  "array. Steps follow the same rules as the Project Tour (prefer a unique stable pattern over a line " +
  "number); steps may anchor unchanged files when they " +
  "provide essential context, and deleted files must be explained with steps that have no locator. " +
  "Uncommitted changes are excluded by default and reported as a warning; pass includeUncommittedChanges to " +
  "include them explicitly. The description is automatically enriched with the base, merge-base and " +
  "head. On failure, the previous tour file is preserved. " +
  MARKDOWN_WRITING_GUIDANCE +
  MERMAID_TOOL_GUIDANCE;

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
    description: z
      .unknown()
      .optional()
      .describe(
        "Optional readable Markdown overview; separate distinct ideas with blank lines between paragraphs."
      ),
    steps: z
      .unknown()
      .optional()
      .describe(
        "Non-empty array whose descriptions use concise Markdown with blank lines between paragraphs."
      ),
  })
  .passthrough();

const changesToolInputSchema = z
  .object({
    title: z.unknown().optional(),
    description: z
      .unknown()
      .optional()
      .describe(
        "Optional readable Markdown overview; separate distinct ideas with blank lines between paragraphs."
      ),
    steps: z
      .unknown()
      .optional()
      .describe(
        "Non-empty array whose descriptions use concise Markdown with blank lines between paragraphs."
      ),
    baseRef: z.unknown().optional(),
    headRef: z.unknown().optional(),
    includeUncommittedChanges: z.unknown().optional(),
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

// Produit la visite d'accueil du projet. Elle reste disponible quelle que soit
// la branche ouverte, car elle présente le fonctionnement global du code et non
// un instant particulier de son historique Git.
async function handleCreateProjectTour(
  ctx: WorkspaceContext,
  args: unknown
): Promise<ToolResponse> {
  const rawSteps = extractSteps(args);
  // La validation agrège toutes les erreurs (paramètres puis étapes) avant de
  // répondre, pour permettre à l'agent de corriger la proposition en un cycle.
  const { params, issues: paramIssues } = validateProjectParams(args);
  const mermaidIssues = await validateMermaidDescriptions(args);
  if (rawSteps === undefined || (Array.isArray(rawSteps) && rawSteps.length === 0)) {
    if (mermaidIssues.length === 0) {
      return errorResponse("TOUR_STEPS_REQUIRED", "A tour requires at least one step.");
    }

    return errorResponse(
      "INVALID_PROPOSAL",
      "The create_project_tour arguments are invalid.",
      [
        ...mermaidIssues,
        { path: "steps", message: "is required and must contain at least one step" }
      ]
    );
  }

  const allIssues = [...paramIssues, ...mermaidIssues];
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

// Produit une visite de revue de branche. Le lecteur voit ce qui a changé
// depuis la branche de référence ; si le code avance pendant la génération, la
// visite est refusée pour ne jamais présenter une explication déjà obsolète.
// Le travail local n'est inclus que lorsque l'appelant le demande explicitement.
async function handleCreateChangesTour(
  ctx: WorkspaceContext,
  args: unknown
): Promise<ToolResponse> {
  const rawSteps = extractSteps(args);
  // Même stratégie d'agrégation que pour le Project Tour : toutes les erreurs
  // de validation sont collectées avant de répondre.
  const { params, issues: paramIssues } = validateChangesParams(args);
  const mermaidIssues = await validateMermaidDescriptions(args);
  if (rawSteps === undefined || (Array.isArray(rawSteps) && rawSteps.length === 0)) {
    if (mermaidIssues.length === 0) {
      return errorResponse("TOUR_STEPS_REQUIRED", "A tour requires at least one step.");
    }

    return errorResponse(
      "INVALID_PROPOSAL",
      "The create_changes_tour arguments are invalid.",
      [
        ...mermaidIssues,
        { path: "steps", message: "is required and must contain at least one step" }
      ]
    );
  }

  const allIssues = [...paramIssues, ...mermaidIssues];
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

  const baseRef = params.baseRef as string;
  const headRef = params.headRef as string;
  const includeUncommittedChanges = params.includeUncommittedChanges === true;

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
  if (headRef !== currentHead) {
    return errorResponse(
      "STALE_HEAD",
      `The provided headRef ${headRef} does not match the current HEAD (${currentHead}). The analysis is stale; re-run it against the current HEAD.`
    );
  }

  let mergeBaseSha: string;
  try {
    mergeBaseSha = await mergeBase(ctx, baseRef, headRef);
  } catch (error) {
    return errorResponse(
      "INVALID_BASE_REF",
      `Unable to compute the merge-base between ${baseRef} and ${headRef}: ${(error as Error).message}`
    );
  }

  // Sans aucun changement committé (et sans travail local inclus), l'outil
  // répond NO_CHANGES et conserve l'ancien Changes Tour : une visite vide ne
  // remplace jamais une visite utile.
  const uncommitted = await uncommittedChanges(ctx);
  if (
    (await committedDiffIsEmpty(ctx, mergeBaseSha, headRef)) &&
    (!includeUncommittedChanges || uncommitted.length === 0)
  ) {
    return errorResponse(
      "NO_CHANGES",
      `No committed changes between the merge-base of ${baseRef} (${mergeBaseSha}) and ${headRef}. The previous tour file was preserved.`
    );
  }

  // Les changements non committés sont exclus par défaut (avertissement),
  // ou inclus explicitement : le Tour n'a alors pas de `ref` et signale que
  // le résultat décrit un état local non reproductible.
  const warnings: Warning[] = [];
  if (includeUncommittedChanges) {
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
  // lorsque includeUncommittedChanges est actif), utilisé pour l'avertissement
  // NO_CHANGED_FILE_ANCHOR.
  const changedInWorkspace = await changedFilesInWorkspace(ctx, mergeBaseSha, headRef);
  if (includeUncommittedChanges) {
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

  const title = params.title ?? (await defaultChangesTitle(ctx, headRef));
  // La description est enrichie automatiquement avec la provenance, la base et
  // la tête, afin que le périmètre analysé soit toujours connu du lecteur.
  const provenance = includeUncommittedChanges
    ? `Generated from the merge-base of \`${baseRef}\` (\`${mergeBaseSha}\`) to \`${headRef}\`, including uncommitted changes (non-reproducible local state).`
    : `Generated from the merge-base of \`${baseRef}\` (\`${mergeBaseSha}\`) to \`${headRef}\`.`;
  const description =
    params.description !== undefined
      ? `${params.description}\n\n${provenance}`
      : provenance;

  const tour: TourFile = {
    $schema: CODETOUR_SCHEMA_URI,
    title,
    description,
    ...(!includeUncommittedChanges ? { ref: headRef } : {}),
    steps: finalSteps,
  };

  // HEAD peut avancer pendant les lectures Git effectuées ci-dessus. Le relire
  // au dernier moment empêche une analyse devenue obsolète de remplacer le
  // Changes Tour précédent.
  const headImmediatelyBeforePersistence = await currentHeadSha(ctx);
  if (headImmediatelyBeforePersistence !== headRef) {
    return errorResponse(
      "STALE_HEAD",
      headImmediatelyBeforePersistence === null
        ? "The repository no longer has a HEAD to persist this analysis against. The previous tour file was preserved."
        : `The provided head ${headRef} no longer matches the current HEAD (${headImmediatelyBeforePersistence}). The analysis became stale before persistence; re-run it against the current HEAD.`
    );
  }

  const writeFailure = await persistTour(ctx, CHANGES_TOUR_PATH, tour);
  if (writeFailure) {
    return writeFailure;
  }

  return successResponse(
    CHANGES_TOUR_PATH,
    finalSteps.length,
    warnings,
    `Created Changes Tour at ${CHANGES_TOUR_PATH} with ${finalSteps.length} step(s) for head ${headRef} (base ${baseRef}).`
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
  headRef: string
): Promise<string[]> {
  const files = await changedFiles(ctx, mergeBaseSha, headRef);
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
  headRef: string
): Promise<string> {
  const branch = await currentBranchName(ctx);
  if (branch && branch !== "HEAD") {
    return `Changes on ${branch}`;
  }
  return `Changes at ${headRef.slice(0, 7)}`;
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
