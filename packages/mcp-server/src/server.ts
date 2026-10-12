import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as path from "path";
import { createContext, selectContext } from "./context";
import {
  changedFiles,
  committedDiffIsEmpty,
  currentBranchName,
  currentHeadSha,
  isGitRepository,
  mergeBase,
  normalizeSlashes,
  readCommitAnchors,
  renamedFiles,
  resolveCommit,
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
  "Split distinct ideas into short paragraphs separated by blank lines (`\n\n`), because " +
  "a single newline (`\n`) is a Markdown soft break and may render as a space. Use a short " +
  "heading when a description covers multiple topics, and use bullet or numbered lists " +
  "for collections, alternatives, or sequences. Use **bold** sparingly for important " +
  "concepts and backticks for code identifiers. Avoid dense monolithic paragraphs, and " +
  "keep each explanation concise and tied to the current Tour Anchor. Do not add " +
  "structure mechanically: a short, single-purpose description may remain one paragraph. ";

const PROJECT_TOUR_DESCRIPTION =
  "Create a CodeTour guided walkthrough for understanding a codebase. Use this tool for onboarding " +
  "or explaining the project's architecture and execution flows. Read the relevant source before " +
  "writing the tour; every explanation and anchor must be supported by the code. " +
  "Build a coherent route from the project's purpose and entry points through its key components " +
  "and how they collaborate. Choose representative files rather than listing every module. " +
  "Each step should explain the anchored code's role, why it matters, and its connection to the " +
  "surrounding flow; avoid merely restating names or syntax. Adapt the depth and step count to the " +
  "requested audience and scope. " +
  "Input: a required non-empty steps array, an optional title (default: \"Project Overview\"), and " +
  "an optional description summarizing the tour. Each step requires a Markdown description and may " +
  "have a title. Use at most one locator per step: file or directory, relative to the workspace root. " +
  "Anchor code explanations to the relevant file and location; use a directory for structural " +
  "orientation, or no locator for general context. File steps may use line (1-based), pattern " +
  "(a regular expression matching exactly once in the file), or selection (start/end positions " +
  "with 1-based line and character). line and pattern are mutually exclusive. Prefer a short, " +
  "stable pattern when it identifies the intended code reliably; otherwise use a verified line. " +
  "Project Tours use ordinary file navigation and anchors are checked against the current workspace. " +
  "You author the complete content; the server validates it and atomically writes .tours/project.tour, " +
  "replacing the previous Project Tour only on success. Validation issues are returned together; " +
  "correct the reported issues before retrying. Failure preserves the previous tour. " +
  "Optional workspacePath selects a directory relative to the configured workspace root for this call. " +
  "All anchors and .tours paths are relative to that directory. It must remain inside the configured workspace. " +
  MARKDOWN_WRITING_GUIDANCE +
  MERMAID_TOOL_GUIDANCE;

const CHANGES_TOUR_DESCRIPTION =
  "Create a CodeTour guided review of the current branch's changes from the merge-base of a base " +
  "reference to an analyzed commit. Present the major changes, their implementation, observable " +
  "behavioral effects, and relevant tests factually. Describe intent only when supported by source " +
  "or supplied context. Do not give opinions on the changes, judge their quality, recommend " +
  "alternatives, or approve or reject them. Inspect the Git comparison and the affected source before " +
  "writing; explain the actual changes rather than inferring them from filenames or commit messages. " +
  "Organize steps into a coherent review path, grouping related changes and focusing on decisions " +
  "and behavior that help the reader understand the change set. Let review value determine the " +
  "step count: add steps when they clarify distinct changes, design decisions, behavioral impacts, " +
  "or test coverage, including multiple steps in the same file at different relevant locations. " +
  "Avoid redundant steps that repeat the same explanation. More than fifteen steps is allowed; " +
  "the server's step-count warning is advisory, so do not compress useful review guidance merely " +
  "to stay below it. An introductory directory step " +
  "can orient the reader to where the work happened. Anchor each code discussion at the relevant " +
  "changed lines in the analyzed head snapshot, so the tour comment appears beside the change. " +
  "Use unchanged code only when it supplies essential context. Do not claim tests passed without " +
  "verification; distinguish observed behavior from intended behavior. " +
  "Input: baseRef (required Git reference), headRef (required full 40-character commit SHA equal to " +
  "the current HEAD), a required non-empty steps array, optional title (default: \"Changes on <branch>\"), " +
  "optional description, and includeUncommittedChanges (optional boolean, default false). " +
  "Each step requires a Markdown description and may have a title. Use at most one workspace-relative " +
  "locator: file or directory. File steps may use line (1-based), pattern (a regular expression " +
  "matching exactly once), or selection (start/end positions with 1-based line and character). " +
  "line and pattern are mutually exclusive. Prefer a short, stable pattern identifying the discussed " +
  "change; otherwise use a verified line in headRef. Explain deleted files with no-locator steps. " +
  "For committed-only tours, anchors are validated against headRef, the persisted baseRef is the " +
  "resolved merge-base SHA, and ref is headRef. The server marks file steps with display: \"diff\"; " +
  "directory and no-locator steps retain ordinary navigation. New files have an empty original side. " +
  "For renames, file names the head path and the server supplies baseFile for the original path. " +
  "Optional display accepts only \"diff\" and requires file; optional baseFile also requires file " +
  "and must match the detected rename for a committed-only tour. " +
  "Local changes are excluded by default and reported when present. Set includeUncommittedChanges " +
  "to true only when the requested scope includes them; inspect the local changes as well. When " +
  "local changes are actually included, anchors are checked against the workspace and the server " +
  "omits the commit pair and diff metadata: file steps open current files. If the workspace is " +
  "clean, the tour remains a committed comparison. If a saved diff's revisions or file become " +
  "unavailable, the reader falls back to the current file. " +
  "You author the complete content; the server validates it, adds comparison provenance to the " +
  "description, and atomically writes .tours/changes.tour, replacing the previous Changes Tour only " +
  "on success. Failure preserves it. Correct reported validation issues before retrying; if HEAD " +
  "changed, re-analyze the comparison and submit the new SHA with matching content. " +
  "Optional workspacePath selects a repository or subdirectory relative to the configured workspace root for this call. " +
  "All anchors and .tours paths are relative to that directory. It must remain inside the configured workspace. " +
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
    workspacePath: z.unknown().optional(),
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
    workspacePath: z.unknown().optional(),
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
  defaultContext: WorkspaceContext,
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
  const selected = selectContext(defaultContext, params?.workspacePath);
  const ctx = selected.context ?? defaultContext;
  const allIssues = [...paramIssues, ...mermaidIssues, ...selected.issues];
  let steps: TourStep[] | undefined;
  if (Array.isArray(rawSteps)) {
    const validated = validateSteps(rawSteps, ctx,
      selected.context ? { kind: "workspace" } : { kind: "structure" });
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
    normalizeSlashes(path.relative(defaultContext.root, path.join(ctx.root, PROJECT_TOUR_PATH))),
    finalSteps.length,
    warnings,
    `Created Project Tour at ${PROJECT_TOUR_PATH} with ${finalSteps.length} step(s).`
  );
}

// Produit une visite de revue de branche : analyse des changements committés
// entre le merge-base de `baseRef` et `headRef`. `headRef` doit être le SHA
// complet du HEAD courant, sinon la génération échoue avec STALE_HEAD pour
// éviter une explication obsolète. Par défaut, seuls les changements committés
// sont inclus ; `includeUncommittedChanges` permet d'expliquer le travail local.
async function handleCreateChangesTour(
  defaultContext: WorkspaceContext,
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
  const selected = selectContext(defaultContext, params?.workspacePath);
  const ctx = selected.context ?? defaultContext;
  const allIssues = [...paramIssues, ...mermaidIssues, ...selected.issues];
  let steps: TourStep[] | undefined;
  if (Array.isArray(rawSteps)) {
    const validated = validateSteps(rawSteps, ctx, { kind: "structure" });
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
      `create_changes_tour requires a Git repository, but the configured workspace root (${ctx.root}) is not inside one. ` +
        "Select a repository with workspacePath, or restart codetour-mcp in the repository to analyze, rather than its parent directory."
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

  // La référence de base est résolue en SHA de commit complet dès le départ :
  // seul un SHA vérifié est passé en argument positionnel Git, ainsi une chaîne
  // fournie par l'agent ne peut jamais être interprétée comme une option Git.
  const resolvedBaseSha = await resolveCommit(ctx, baseRef);
  if (resolvedBaseSha === null) {
    return errorResponse(
      "INVALID_BASE_REF",
      `Unable to resolve the base ref ${baseRef} to a commit in this repository.`
    );
  }

  let mergeBaseSha: string;
  try {
    mergeBaseSha = await mergeBase(ctx, resolvedBaseSha, headRef);
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
  const includesLocalChanges = includeUncommittedChanges && uncommitted.length > 0;
  const proposedSteps = steps as TourStep[];
  const anchors = includesLocalChanges ? undefined : await readCommitAnchors(
    ctx, headRef, proposedSteps.flatMap((step) => step.file === undefined ? [] : [step.file])
  );
  const validated = validateSteps(rawSteps as unknown[], ctx,
    anchors ? { kind: "commit", anchors } : { kind: "workspace" });
  const renames = includesLocalChanges ? new Map<string, string>()
    : await renamedFiles(ctx, mergeBaseSha, headRef);
  for (const [index, step] of proposedSteps.entries()) {
    if (!includesLocalChanges && step.baseFile !== undefined &&
        path.posix.normalize(normalizeSlashes(step.baseFile)) !==
          renames.get(path.posix.normalize(normalizeSlashes(step.file!)))) {
      validated.issues.push({
        path: `steps[${index}].baseFile`,
        message: "must match the old path of the detected Git rename",
      });
    }
  }
  if (validated.issues.length > 0) {
    return errorResponse("INVALID_PROPOSAL", "The create_changes_tour arguments are invalid.", validated.issues);
  }
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
  if (includesLocalChanges) {
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

  const finalSteps = (validated.steps as TourStep[]).map((step) => {
    const { display, baseFile, ...ordinaryStep } = step;
    if (includesLocalChanges || step.file === undefined) return ordinaryStep;
    const file = path.posix.normalize(normalizeSlashes(step.file));
    return { ...ordinaryStep, file, display: "diff" as const, baseFile: renames.get(file) };
  });
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
  const provenance = includesLocalChanges
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
    ...(!includesLocalChanges ? { ref: headRef, baseRef: mergeBaseSha } : {}),
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
    normalizeSlashes(path.relative(defaultContext.root, path.join(ctx.root, CHANGES_TOUR_PATH))),
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
