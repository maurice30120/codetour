import * as fs from "fs";
import * as path from "path";
import { validateCodetourTour } from "./codetour-schema";
import { createContext } from "./context";
import {
  changedFiles,
  committedDiffIsEmpty,
  currentBranchName,
  currentHeadSha,
  isGitRepository,
  mergeBase,
  normalizeSlashes,
  readCommitAnchors,
  resolveCommit,
  uncommittedChanges,
  workspacePrefix,
} from "./git";
import { recordCreation } from "./journal";
import { OutputPathError, writeTourAtomic } from "./persistence";
import { stageCommitAnchors, validateTourProposal } from "./proposal-validation";
import {
  CreationFailure,
  CreationResult,
  CreateTourOptions,
  CreatedTour,
  TourFile,
  TourKind,
  TourStep,
  Warning,
  WorkspaceContext,
} from "./types";
import { MAX_RECOMMENDED_STEPS, orientationStepWarnings } from "./validation";

// Tour creation, free of any transport: both entry points take the
// workspace to create in and the proposal exactly as it arrived, validate it,
// apply the Git, image, Mermaid and workspace-confinement rules, write the
// Tour file atomically, and report the outcome as a value. Nothing here writes
// to a stream or reads a command line, so the MCP server and the CLI share the
// same rules instead of reimplementing them.
//
// Validation always precedes the write: a rejected proposal writes no file and
// leaves any existing Tour untouched.

const CODETOUR_SCHEMA_URI = "https://aka.ms/codetour-schema";

// Fixed destinations reserved for generated Tours. They are replaced only
// after complete validation and ignored while detecting a dirty workspace (see
// git.ts).
const PROJECT_TOUR_PATH = ".tours/project.tour";
const CHANGES_TOUR_PATH = ".tours/changes.tour";

// A custom `fileName` is always confined to the `.tours` directory next to the
// reserved destinations; without one the reserved default applies.
function tourTargetPath(defaultPath: string, fileName?: string): string {
  return fileName === undefined ? defaultPath : `.tours/${fileName}`;
}

/** The name of the entry point a rejection addresses, per surface. */
function surfaceName(kind: TourKind, options: CreateTourOptions): string {
  return options.surface ?? `create_${kind}_tour`;
}

function failure(code: string, message: string, issues?: CreationFailure["issues"]): CreationFailure {
  return {
    ok: false,
    code,
    message,
    ...(issues && issues.length > 0 ? { issues } : {}),
  };
}

// A written Tour as the kind-specific rules report it; the caller adds the
// kind and the workspace, then records the creation.
type WrittenTour = { ok: true } & Omit<CreatedTour, "kind" | "workspaceRoot">;
type WriteOutcome = WrittenTour | CreationFailure;

// Create a Project Tour: no Git access is required, the tour works in any
// workspace, and it is never attached to a `ref` so it remains viewable as the
// project evolves.
export async function createProjectTour(options: CreateTourOptions): Promise<CreationResult> {
  return createTour("project", options);
}

// Create a Changes Tour: analyze committed changes from the merge-base of
// `baseRef` to `headRef`. `headRef` must be the full SHA of the current HEAD;
// otherwise creation fails with STALE_HEAD to avoid a stale explanation. By
// default only committed changes are included; `includeUncommittedChanges`
// enables explaining local work.
export async function createChangesTour(options: CreateTourOptions): Promise<CreationResult> {
  return createTour("changes", options);
}

async function createTour(kind: TourKind, options: CreateTourOptions): Promise<CreationResult> {
  // The requested workspace is the boundary every rule confines to; a call may
  // only narrow it with `workspacePath`, never expand it.
  const requested = createContext(options.workspaceRoot);
  const outcome =
    kind === "project"
      ? await projectTour(options, requested)
      : await changesTour(options, requested);
  if (!outcome.ok) return outcome;

  const created: CreatedTour = { kind, workspaceRoot: requested.root, ...outcome };
  // The journal is observability: it is written once the Tour exists, and a
  // journal that cannot be written never turns a creation into a failure.
  await recordCreation({
    workspaceRoot: requested.root,
    tourPath: created.tourPath,
    tourTitle: created.title,
    kind: created.kind,
  });
  return { ok: true, ...created };
}

async function projectTour(
  options: CreateTourOptions,
  defaultContext: WorkspaceContext
): Promise<WriteOutcome> {
  const result = await validateTourProposal(
    "project",
    options.proposal,
    defaultContext,
    surfaceName("project", options)
  );
  if (!result.ok) {
    return result.rejection;
  }
  const { ctx, params, steps: finalSteps } = result.proposal;

  const warnings = [
    ...stepLimitWarnings(finalSteps),
    ...orientationStepWarnings(finalSteps),
  ];

  const title = params.title ?? "Project Overview";

  const tour: TourFile = {
    $schema: CODETOUR_SCHEMA_URI,
    title,
    ...(params.description !== undefined ? { description: params.description } : {}),
    steps: finalSteps,
  };

  const targetPath = tourTargetPath(PROJECT_TOUR_PATH, params.fileName);
  const writeFailure = await persistTour(ctx, targetPath, tour);
  if (writeFailure) {
    return writeFailure;
  }

  return {
    ok: true,
    tourPath: path.join(ctx.root, targetPath),
    title,
    stepCount: finalSteps.length,
    warnings,
  };
}

async function changesTour(
  options: CreateTourOptions,
  defaultContext: WorkspaceContext
): Promise<WriteOutcome> {
  const surface = surfaceName("changes", options);
  const result = await validateTourProposal("changes", options.proposal, defaultContext, surface);
  if (!result.ok) {
    return result.rejection;
  }
  const { ctx, params } = result.proposal;

  const baseRef = params.baseRef as string;
  const headRef = params.headRef as string;
  const includeUncommittedChanges = params.includeUncommittedChanges === true;

  // The Changes Tour depends on Git history and fails outside a repository.
  if (!(await isGitRepository(ctx))) {
    return failure(
      "GIT_REPOSITORY_REQUIRED",
      `${surface} requires a Git repository, but the configured workspace root (${ctx.root}) is not inside one. ` +
        "Select a repository with workspacePath, or point the workspace at the repository to analyze rather than at its parent directory."
    );
  }

  // The analyzed SHA must exactly match the current HEAD; otherwise the
  // explanation might not correspond to the snapshot read again.
  const currentHead = await currentHeadSha(ctx);
  if (currentHead === null) {
    return failure(
      "STALE_HEAD",
      "The repository has no commits, so there is no HEAD to analyze."
    );
  }
  if (headRef !== currentHead) {
    return failure(
      "STALE_HEAD",
      `The provided headRef ${headRef} does not match the current HEAD (${currentHead}). The analysis is stale; re-run it against the current HEAD.`
    );
  }

  // Resolve the base reference to a full commit SHA up front: only a verified
  // SHA is ever passed as a positional Git argument, so an agent-supplied
  // string can never be interpreted as a Git option.
  const resolvedBaseSha = await resolveCommit(ctx, baseRef);
  if (resolvedBaseSha === null) {
    return failure(
      "INVALID_BASE_REF",
      `Unable to resolve the base ref ${baseRef} to a commit in this repository.`
    );
  }

  let mergeBaseSha: string;
  try {
    mergeBaseSha = await mergeBase(ctx, resolvedBaseSha, headRef);
  } catch (error) {
    return failure(
      "INVALID_BASE_REF",
      `Unable to compute the merge-base between ${baseRef} and ${headRef}: ${(error as Error).message}`
    );
  }

  // Without committed changes (and without included local work), return
  // NO_CHANGES and preserve the previous Changes Tour: an empty tour never
  // replaces a useful one.
  const uncommitted = await uncommittedChanges(ctx);
  const includesLocalChanges = includeUncommittedChanges && uncommitted.length > 0;
  const staged = await stageCommitAnchors(result.proposal, {
    mergeBaseSha,
    includesLocalChanges,
  });
  if (staged.issues.length > 0) {
    return failure("INVALID_PROPOSAL", `The ${surface} arguments are invalid.`, staged.issues);
  }
  if (
    (await committedDiffIsEmpty(ctx, mergeBaseSha, headRef)) &&
    (!includeUncommittedChanges || uncommitted.length === 0)
  ) {
    return failure(
      "NO_CHANGES",
      `No committed changes between the merge-base of ${baseRef} (${mergeBaseSha}) and ${headRef}. The previous tour file was preserved.`
    );
  }

  // Uncommitted changes are excluded by default with a warning, or explicitly
  // included; in that case the Tour has no `ref` and reports that the result
  // describes a non-reproducible local state.
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

  const finalSteps = staged.steps.map((step) => {
    const { display, baseFile, ...ordinaryStep } = step;
    if (includesLocalChanges || step.file === undefined) return ordinaryStep;
    const file = path.posix.normalize(normalizeSlashes(step.file));
    return { ...ordinaryStep, file, display: "diff" as const, baseFile: staged.renames.get(file) };
  });
  warnings.push(...stepLimitWarnings(finalSteps));

  // A Changes Tour must anchor at least one file the comparison actually
  // modified. The former advisory warning let a whole tour describe a change
  // set without ever pointing at it, so the agent had to regenerate. Deleted
  // files cannot host an anchor; when every changed file is gone (a
  // deletion-only branch), the rule has nothing to anchor and stays satisfied.
  const anchorableChangedFiles = await changedFilesAvailableToAnchor(
    ctx,
    mergeBaseSha,
    headRef,
    uncommitted,
    includeUncommittedChanges
  );
  if (
    anchorableChangedFiles.length > 0 &&
    !finalSteps.some(
      (step) =>
        step.file !== undefined &&
        anchorableChangedFiles.includes(normalizeSlashes(step.file))
    )
  ) {
    const listed = anchorableChangedFiles.slice(0, 5).join(", ");
    const suffix =
      anchorableChangedFiles.length > 5
        ? ` and ${anchorableChangedFiles.length - 5} more`
        : "";
    return failure(
      "MISSING_CHANGED_FILE_ANCHOR",
      `No step anchors a file modified by these changes. Add at least one step ` +
        `with file and a line or a short unique pattern on one of: ${listed}${suffix}. ` +
        "The previous tour file was preserved.",
      [
        {
          path: "steps",
          message:
            `must anchor at least one changed file (${listed}${suffix}) ` +
            "with file plus line or pattern; deletion-only changes are exempt",
        },
      ]
    );
  }

  const title = params.title ?? (await defaultChangesTitle(ctx, headRef));
  // Enrich the description automatically with the provenance, base, and head
  // so the reader always knows the analyzed scope.
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

  // HEAD may advance during the Git reads above. Reading it again at the last
  // moment prevents stale analysis from replacing the previous Changes Tour.
  const headImmediatelyBeforePersistence = await currentHeadSha(ctx);
  if (headImmediatelyBeforePersistence !== headRef) {
    return failure(
      "STALE_HEAD",
      headImmediatelyBeforePersistence === null
        ? "The repository no longer has a HEAD to persist this analysis against. The previous tour file was preserved."
        : `The provided head ${headRef} no longer matches the current HEAD (${headImmediatelyBeforePersistence}). The analysis became stale before persistence; re-run it against the current HEAD.`
    );
  }

  const targetPath = tourTargetPath(CHANGES_TOUR_PATH, params.fileName);
  const writeFailure = await persistTour(ctx, targetPath, tour);
  if (writeFailure) {
    return writeFailure;
  }

  return {
    ok: true,
    tourPath: path.join(ctx.root, targetPath),
    title,
    stepCount: finalSteps.length,
    warnings,
  };
}

// Non-blocking warning when a Tour exceeds fifteen steps.
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

// Validate the generated Tour against the general CodeTour schema, then write
// it atomically. If validation fails, the previous file remains intact.
async function persistTour(
  ctx: WorkspaceContext,
  relativePath: string,
  tour: TourFile
): Promise<CreationFailure | null> {
  const schemaResult = validateCodetourTour(tour);
  if (!schemaResult) {
    return failure(
      "SCHEMA_VALIDATION_FAILED",
      "The generated tour did not validate against the CodeTour schema."
    );
  }
  try {
    await writeTourAtomic(ctx, relativePath, serializeTour(tour));
  } catch (error) {
    if (error instanceof OutputPathError) {
      return failure("OUTPUT_PATH_ESCAPES_WORKSPACE", error.message);
    }
    throw error;
  }
  return null;
}

// Files modified by the committed diff, converted to paths relative to the
// workspace (the workspace may be a repository subdirectory).
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

// Changed paths that a step can actually anchor. A committed-only tour reads
// anchors from the analyzed commit, so a file deleted there is not anchorable
// even if a working-tree copy exists; an included-local-changes tour reads the
// workspace, so only a regular file present on disk qualifies. The distinction
// is what keeps a deletion-only branch from being rejected.
async function changedFilesAvailableToAnchor(
  ctx: WorkspaceContext,
  mergeBaseSha: string,
  headRef: string,
  uncommitted: ReadonlyArray<{ path: string }>,
  includesLocalChanges: boolean
): Promise<string[]> {
  const changed = await changedFilesInWorkspace(ctx, mergeBaseSha, headRef);
  if (includesLocalChanges) {
    for (const entry of uncommitted) {
      if (!changed.includes(entry.path)) {
        changed.push(entry.path);
      }
    }
    return changed.filter((file) => {
      try {
        return fs.statSync(path.resolve(ctx.root, file)).isFile();
      } catch {
        return false;
      }
    });
  }
  if (changed.length === 0) return [];
  const anchors = await readCommitAnchors(ctx, headRef, []);
  return changed.filter(
    (file) =>
      anchors.get(path.posix.normalize(normalizeSlashes(file)))?.kind === "file"
  );
}

// Default Changes Tour title: "Changes on <branch>", falling back to the short
// SHA when HEAD is detached.
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
