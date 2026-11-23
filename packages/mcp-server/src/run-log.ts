import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { canonicalWorkspacePath } from "codetour-knowledge";

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

/** Additive Knowledge observation version (ADR 0045). */
export const RUN_KNOWLEDGE_VERSION = 1;

export interface KnowledgeInvalidObservation {
  name: string;
  reason: string;
}

/**
 * What the run's own Knowledge discovery returned (ADR 0045). Written only by
 * the MCP server, only when a Knowledge call carried the run identity: the
 * block records work already done by verification at discovery (ADR 0044), it
 * never triggers a second scan. Verified names accumulate as a union because a
 * targeted `query` listing is a subset of the catalogue the agent could choose
 * from; the invalid set is the latest listing's, which ADR 0044 always returns
 * in full; `used` holds the distinct entries whose body `knowledge_read`
 * actually served.
 */
export interface KnowledgeObservation {
  version: number;
  observed: true;
  at: string;
  /** Number of recorded listings, so a partial view is visible as such. */
  listings: number;
  /** Verified entry names seen by this run, deduplicated across listings. */
  valid: string[];
  /** Largest `total` observed: the catalogue size, before pagination. */
  validTotal: number;
  /** True when one listing covered the whole catalogue untruncated. */
  complete: boolean;
  /** The latest listing's invalid set, in full and with its reasons. */
  invalid: KnowledgeInvalidObservation[];
  /** Distinct entries whose verified body `knowledge_read` returned. */
  used: string[];
}

export type ConsolidationStatus =
  | "completed_zero"
  | "created"
  | "appended"
  | "replaced"
  | "partial"
  | "failed"
  | "skipped";

export interface ConsolidationClosure {
  status: ConsolidationStatus;
  runId: string;
  at: string;
  /** Names published by this closure, when the MCP created entries. */
  created?: string[];
  /**
   * Names this closure modified without creating, when the MCP appended to or
   * rewrote an existing entry (`append`, `replace`, spec #232). Distinct from
   * `created` so a run audit separates what it added from what it changed.
   */
  changed?: string[];
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
  /** The title of the persisted Tour, so later readers need not open the file. */
  tourTitle?: string | null;
  consolidation: ConsolidationClosure | null;
  continuationUsed: boolean;
  /**
   * Additive observability block written by the plugin side only (spec #223):
   * the adapter records preparation facts and the agentStop hook summarizes
   * the Copilot session usage records. Metrics are never an authenticated
   * outcome and never feed a guard decision; the server preserves the field
   * verbatim and does not read it.
   */
  metrics?: Record<string, unknown>;
  /**
   * Additive observability block written by the MCP server alone (ADR 0045):
   * the Knowledge sets this run's own discovery verified. Never an
   * authenticated outcome, never read by a guard, and absent for a run that
   * never listed the catalogue.
   */
  knowledge?: KnowledgeObservation;
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
    // The state carries the canonical workspace spelling (ADR 0056): the hooks
    // compare it with their own real path, and an 8.3 or symlinked spelling
    // would make the run invisible to the guard that must read it.
    workspace: canonicalWorkspacePath(workspace),
    sessionId: null,
    kind,
    request: null,
    at,
    updatedAt: at,
    tourCreated: false,
    tourPath: null,
    tourTitle: null,
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
  tourPath: string,
  tourTitle: string
): Promise<RunUpdate> {
  return updateRunState(workspace, runId, kind, (state) => ({
    ...state,
    tourCreated: true,
    tourPath,
    tourTitle,
    updatedAt: new Date().toISOString(),
  }));
}

/**
 * Merge one save outcome into the run's accumulated consolidation state.
 *
 * A save call is all-or-nothing, but a run can make several save calls. Names
 * are facts: `created` and `changed` accumulate by union, so no later closure
 * may erase an entry a previous call really published or rewrote. When one
 * call succeeded and another was refused, the run did not fully succeed: the
 * closure becomes `partial`, keeping the published names and the refusal
 * outcome. This never turns a refusal into a success and never hides the
 * entries that were actually written.
 *
 * Between successful closures the precedence is `created` > `appended` /
 * `replaced` > `completed_zero` (and a deliberate `skipped` ranks last, so an
 * explicit zero never degrades to a skip and vice versa). The precedence is a
 * fixed rank, never the call order: two runs that made the same writes produce
 * the same Run State. An append and a rewrite share one rank: both modify an
 * entry that existed, and neither is worth more than the other. That tie is
 * broken by `replaced` below, so the verdict depends on the statuses alone and
 * never on which call came first.
 */
const CONSOLIDATION_RANK: Record<ConsolidationStatus, number> = {
  created: 4,
  appended: 3,
  replaced: 3,
  completed_zero: 1,
  skipped: 0,
  // Refusals are handled before the rank and never compete with a success.
  partial: 0,
  failed: 0,
};

const SUCCESS_OUTCOMES = new Set<ConsolidationStatus>([
  "created",
  "appended",
  "replaced",
  "completed_zero",
  "skipped"
]);

const isRefusal = (status: ConsolidationStatus): boolean =>
  status === "failed" || status === "partial";

const uniqueNames = (...lists: Array<string[] | undefined>): string[] => [
  ...new Set(lists.flatMap((list) => list ?? []))
];

function mergeConsolidation(
  previous: ConsolidationClosure | null,
  incoming: ConsolidationClosure
): ConsolidationClosure {
  if (!previous) return incoming;
  const created = uniqueNames(previous.created, incoming.created);
  const changed = uniqueNames(previous.changed, incoming.changed);
  const previousRefused = isRefusal(previous.status);
  const incomingRefused = isRefusal(incoming.status);

  if ((previousRefused || incomingRefused) && (created.length > 0 || changed.length > 0)) {
    // A success and a refusal in separate calls: keep both facts.
    const refusedClosure = incomingRefused ? incoming : previous;
    return {
      ...incoming,
      status: "partial",
      ...(created.length > 0 ? { created } : {}),
      ...(changed.length > 0 ? { changed } : {}),
      // The accumulated closure's outcome always agrees with its status.
      outcome: refusedClosure.outcome ?? "conflict"
    };
  }
  if (previousRefused || incomingRefused) {
    // Nothing was published: keep the refusal that actually happened rather
    // than letting a later empty answer hide it.
    if (previousRefused && !incomingRefused) return previous;
    return incoming;
  }
  const incomingRank = CONSOLIDATION_RANK[incoming.status];
  const previousRank = CONSOLIDATION_RANK[previous.status];
  const status =
    incomingRank > previousRank
      ? incoming.status
      : incomingRank < previousRank
        ? previous.status
        : incoming.status === "replaced" || previous.status === "replaced"
          ? "replaced"
          : incoming.status;
  return {
    ...incoming,
    status,
    ...(created.length > 0 ? { created } : {}),
    ...(changed.length > 0 ? { changed } : {}),
    outcome: SUCCESS_OUTCOMES.has(status) ? status : incoming.outcome
  };
}

/**
 * Record the consolidation closure. Any status closes the run for the hook:
 * an explicit zero creation and a refusal are assessments, not omissions. Only
 * a missing closure remains incomplete.
 *
 * The merge happens under the run-state lock, so two concurrent save calls
 * cannot lose each other's created names or refusal outcome.
 */
export function recordConsolidation(
  workspace: string,
  runId: string,
  kind: "project" | "changes",
  closure: ConsolidationClosure
): Promise<RunUpdate> {
  return updateRunState(workspace, runId, kind, (state) => ({
    ...state,
    consolidation: mergeConsolidation(state.consolidation, closure),
    updatedAt: new Date().toISOString(),
  }));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Record one Knowledge discovery page for a run (ADR 0045).
 *
 * Verified names are unioned across listings and `validTotal` keeps the largest
 * catalogue size observed; `complete` becomes true as soon as one listing was
 * untruncated. The invalid set is replaced by the latest listing's, because
 * ADR 0044 always reports it in full: a later listing is a better answer, and
 * an entry the run repaired must stop being displayed as broken. A run without
 * a listing has no block at all, so absence keeps meaning "not measured".
 */
export function recordKnowledgeListing(
  workspace: string,
  runId: string | undefined,
  kind: "project" | "changes",
  listing: {
    valid: string[];
    total: number;
    complete: boolean;
    invalid: KnowledgeInvalidObservation[];
  }
): Promise<RunUpdate> {
  if (!runId) return Promise.resolve({ persisted: false, reason: "no_run" });
  return updateRunState(workspace, runId, kind, (state) => {
    const previous = state.knowledge;
    return {
      ...state,
      knowledge: {
        version: RUN_KNOWLEDGE_VERSION,
        observed: true,
        at: new Date().toISOString(),
        listings: (previous?.listings ?? 0) + 1,
        valid: unique([...(previous?.valid ?? []), ...listing.valid]),
        validTotal: Math.max(previous?.validTotal ?? 0, listing.total),
        complete: Boolean(previous?.complete) || listing.complete,
        invalid: listing.invalid.map((entry) => ({
          name: entry.name,
          reason: entry.reason,
        })),
        used: previous?.used ?? [],
      },
      updatedAt: new Date().toISOString(),
    };
  });
}

/**
 * Record that one verified Knowledge body was served to this run (ADR 0045).
 * A refusal is not a use: only `status: "valid"` reads are recorded, and names
 * are deduplicated so the figure counts entries, not calls.
 */
export function recordKnowledgeRead(
  workspace: string,
  runId: string | undefined,
  kind: "project" | "changes",
  name: string
): Promise<RunUpdate> {
  if (!runId) return Promise.resolve({ persisted: false, reason: "no_run" });
  return updateRunState(workspace, runId, kind, (state) => {
    const previous = state.knowledge;
    return {
      ...state,
      knowledge: {
        version: RUN_KNOWLEDGE_VERSION,
        observed: true,
        at: new Date().toISOString(),
        listings: previous?.listings ?? 0,
        valid: previous?.valid ?? [],
        validTotal: previous?.validTotal ?? 0,
        complete: previous?.complete ?? false,
        invalid: previous?.invalid ?? [],
        used: unique([...(previous?.used ?? []), name]),
      },
      updatedAt: new Date().toISOString(),
    };
  });
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
