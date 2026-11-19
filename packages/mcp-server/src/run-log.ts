import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

/**
 * The CodeTour generation run log (spec #223, ticket #228).
 *
 * The controlled Copilot generation wrapper writes one state file per run
 * under `<workspace>/.tours/.log/` before it contacts the agent. The MCP server
 * is the only writer of the two authenticated outcomes:
 *
 * - `create_project_tour` / `create_changes_tour` confirm that a Tour was
 *   actually persisted;
 * - `knowledge_save` (or `knowledge_close_run` for an explicit skip) records
 *   the consolidation closure.
 *
 * The Copilot `agentStop` hook reads this file and nothing else. It must never
 * infer a closure from assistant text or from the mere presence of a tool
 * call. The JavaScript twin (`packages/copilot-plugin/com.github.copilot/lib/run-log.mjs`)
 * implements the same on-disk contract for the adapter and the hook; the tests
 * pin both to one format.
 */

export const RUN_STATE_VERSION = 1;
export const RUN_LOG_DIRECTORY = path.join(".tours", ".log");
export const RUN_FILE_PREFIX = "codetour-run-";
export const RUN_STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const LOCK_SUFFIX = ".lock";
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 15000;

export type ConsolidationStatus =
  | "completed_zero"
  | "created"
  | "partial"
  | "failed"
  | "skipped";

export interface ConsolidationClosure {
  status: ConsolidationStatus;
  runId: string;
  at: string;
  /** Names published by this closure, when the MCP created entries. */
  created?: string[];
  /** The tool-level outcome that produced a non-created closure. */
  outcome?: string;
  reason?: string;
}

export interface RunState {
  version: number;
  runId: string;
  workspace: string;
  sessionId: string | null;
  kind: "project" | "changes";
  request: string | null;
  at: string;
  updatedAt: string;
  tourCreated: boolean;
  tourPath: string | null;
  consolidation: ConsolidationClosure | null;
  continuationUsed: boolean;
}

export function isValidRunId(runId: unknown): runId is string {
  return typeof runId === "string" && RUN_ID_PATTERN.test(runId);
}

export function runLogDirectory(workspace: string): string {
  return path.join(workspace, RUN_LOG_DIRECTORY);
}

export function runStatePath(workspace: string, runId: string): string {
  if (!isValidRunId(runId)) throw new Error("Invalid CodeTour runId.");
  return path.join(runLogDirectory(workspace), `${RUN_FILE_PREFIX}${runId}.json`);
}

export function isRunState(value: unknown): value is RunState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    state.version === RUN_STATE_VERSION &&
    isValidRunId(state.runId) &&
    typeof state.workspace === "string" &&
    typeof state.at === "string" &&
    typeof state.updatedAt === "string" &&
    typeof state.tourCreated === "boolean" &&
    typeof state.continuationUsed === "boolean" &&
    (state.consolidation === null || typeof state.consolidation === "object")
  );
}

async function atomicWrite(target: string, text: string): Promise<void> {
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${crypto.randomUUID()}.tmp`
  );
  try {
    await fs.promises.writeFile(temporary, text, "utf8");
    await fs.promises.rename(temporary, target);
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
  }
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function acquireLock(target: string): Promise<string> {
  const lock = `${target}${LOCK_SUFFIX}`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await fs.promises.open(lock, "wx");
      await handle.close();
      return lock;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await fs.promises.stat(lock).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        await fs.promises.rm(lock, { force: true }).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("CodeTour run state is locked by another process.");
      }
      await sleep(25);
    }
  }
}

async function withLock<T>(target: string, action: () => Promise<T>): Promise<T> {
  const lock = await acquireLock(target);
  try {
    return await action();
  } finally {
    await fs.promises.rm(lock, { force: true }).catch(() => undefined);
  }
}

async function readFile(target: string): Promise<
  | { state: RunState }
  | { state?: undefined; reason: "missing" | "unreadable" | "malformed" }
> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(target, "utf8");
  } catch (error) {
    return {
      reason:
        (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable",
    };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRunState(parsed) ? { state: parsed } : { reason: "malformed" };
  } catch {
    return { reason: "malformed" };
  }
}

export interface RunUpdate {
  persisted: boolean;
  state?: RunState;
  reason?: string;
}

function baseState(
  workspace: string,
  runId: string,
  kind: "project" | "changes"
): RunState {
  const at = new Date().toISOString();
  return {
    version: RUN_STATE_VERSION,
    runId,
    workspace,
    sessionId: null,
    kind,
    request: null,
    at,
    updatedAt: at,
    tourCreated: false,
    tourPath: null,
    consolidation: null,
    continuationUsed: false,
  };
}

/**
 * Merge one authenticated outcome into a run state under the cross-process
 * lock. A missing file is created (the wrapper may have failed to write it, or
 * the tool may be called by a client that does not use the wrapper), a corrupt
 * file is reported and left untouched, and a refused mutation writes nothing.
 */
export async function updateRunState(
  workspace: string,
  runId: string,
  kind: "project" | "changes",
  mutate: (state: RunState) => RunState | null
): Promise<RunUpdate> {
  if (!isValidRunId(runId)) return { persisted: false, reason: "invalid_run_id" };
  const target = runStatePath(workspace, runId);
  await fs.promises.mkdir(path.dirname(target), { recursive: true }).catch(() => undefined);
  return withLock(target, async () => {
    const read = await readFile(target);
    if (!read.state && read.reason !== "missing") {
      return { persisted: false, reason: read.reason };
    }
    const current = read.state ?? baseState(workspace, runId, kind);
    const next = mutate(current);
    if (next === null) return { persisted: false, reason: "refused", state: current };
    if (!isRunState(next)) return { persisted: false, reason: "invalid" };
    try {
      await atomicWrite(target, `${JSON.stringify(next, null, 2)}\n`);
    } catch (error) {
      return {
        persisted: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    return { persisted: true, state: next };
  });
}

/** Record that the MCP persisted a Tour for this run. */
export function recordTourCreated(
  workspace: string,
  runId: string,
  kind: "project" | "changes",
  tourPath: string
): Promise<RunUpdate> {
  return updateRunState(workspace, runId, kind, (state) => ({
    ...state,
    tourCreated: true,
    tourPath,
    updatedAt: new Date().toISOString(),
  }));
}

/**
 * Record the consolidation closure. Any status closes the run for the hook:
 * an explicit zero creation and a refusal are assessments, not omissions. Only
 * a missing closure remains incomplete.
 */
export function recordConsolidation(
  workspace: string,
  runId: string,
  kind: "project" | "changes",
  closure: ConsolidationClosure
): Promise<RunUpdate> {
  return updateRunState(workspace, runId, kind, (state) => ({
    ...state,
    consolidation: closure,
    updatedAt: new Date().toISOString(),
  }));
}

/** Read one run state for diagnostics and tests. */
export async function readRunState(
  workspace: string,
  runId: string
): Promise<RunState | undefined> {
  if (!isValidRunId(runId)) return undefined;
  const read = await readFile(runStatePath(workspace, runId));
  return read.state;
}
