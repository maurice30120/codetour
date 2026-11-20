import { constants, createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

// One CodeTour generation run, persisted under <workspace>/.tours/.log/.
//
// The file is the only state the Copilot agentStop hook reads. It is written by
// the controlled generation entry point before the first agent request, then
// updated by the CodeTour MCP server when it creates the Tour and when it
// records a consolidation closure. The hook only toggles `continuationUsed`
// after it has decided to ask for one continuation; it never writes Tour or
// Knowledge content. Every update is an atomic read-modify-write under a small
// cross-process lock, so two generations, a resumed session or a concurrent
// stop cannot lose each other's fields.
//
// The consolidation closure is the MCP server's verdict and stays one object
// across the save calls of a run: its status is `created`, `appended`,
// `replaced`, `completed_zero`, `partial`, `failed` or `skipped`, `created`
// lists the names the run published and `changed` the existing entries it
// appended to or rewrote (spec #232). Any recorded closure closes the run for
// the hook, whatever its status.
//
// One additive, optional field exists alongside the guarded outcomes: the
// `metrics` object (spec #223 observability). The adapter writes the
// preparation facts it alone knows, and the agentStop hook summarizes the
// Copilot session usage records at stop time (tokens, cache, calls, model,
// project state, generation/consolidation windows). Metrics are never
// authenticated, never feed the guard decision, and a run without them is
// valid; the MCP server only preserves the field.
//
// This file is the single source of truth for the JavaScript surfaces (the
// Copilot adapter, the plugin hook). The plugin copy at
// `packages/copilot-plugin/com.github.copilot/lib/run-log.mjs` is generated
// from it by `node scripts/sync-copilot-run-log.js`; a test fails when the two
// ever diverge, so there is no silent drift. The MCP server implements the
// same on-disk contract in TypeScript (`packages/mcp-server/src/run-log.ts`);
// the shared tests pin both implementations to the same format.

export const RUN_STATE_VERSION = 1;
export const RUN_LOG_DIRECTORY = path.join(".tours", ".log");
export const RUN_FILE_PREFIX = "codetour-run-";
export const RUN_STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const RUN_STATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Run usage metrics (spec #223 observability). One additive, optional
// `metrics` object in the run state, written only by the plugin side: the
// adapter records the preparation facts it alone knows, and the agentStop hook
// summarizes the Copilot session usage records at stop time. Metrics are never
// an authenticated outcome and never feed a guard decision; a run stays valid
// without them, and every snapshot is a recomputation, never an accumulation.
export const RUN_METRICS_VERSION = 1;
export const CODETOUR_TOOLS = new Set([
  "create_project_tour",
  "create_changes_tour",
  "knowledge_list",
  "knowledge_read",
  "knowledge_save",
  "knowledge_close_run"
]);
export const CODETOUR_CREATION_TOOLS = new Set(["create_project_tour", "create_changes_tour"]);
const CODETOUR_TOOL_SUFFIX = new RegExp(`codetour[-_](${[...CODETOUR_TOOLS].join("|")})$`);
const USAGE_TOKEN_KEYS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"];
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const LOCK_SUFFIX = ".lock";
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 15000;

export function isValidRunId(runId) {
  return typeof runId === "string" && RUN_ID_PATTERN.test(runId);
}

export function runLogDirectory(workspace) {
  return path.join(workspace, RUN_LOG_DIRECTORY);
}

export function runStatePath(workspace, runId) {
  if (!isValidRunId(runId)) throw new Error("Invalid CodeTour runId.");
  return path.join(runLogDirectory(workspace), `${RUN_FILE_PREFIX}${runId}.json`);
}

export function createRunState({ runId, workspace, sessionId, kind, request, at = new Date().toISOString(), metrics }) {
  const state = {
    version: RUN_STATE_VERSION,
    runId,
    workspace,
    sessionId: typeof sessionId === "string" && sessionId ? sessionId : null,
    kind: kind === "changes" ? "changes" : "project",
    request: typeof request === "string" && request.trim() ? request : null,
    at,
    updatedAt: at,
    tourCreated: false,
    tourPath: null,
    consolidation: null,
    continuationUsed: false
  };
  if (metrics && typeof metrics === "object" && !Array.isArray(metrics)) {
    state.metrics = {...metrics, version: RUN_METRICS_VERSION};
  }
  return state;
}

export function isRunState(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    value.version === RUN_STATE_VERSION &&
    isValidRunId(value.runId) &&
    typeof value.workspace === "string" &&
    typeof value.at === "string" &&
    typeof value.tourCreated === "boolean" &&
    typeof value.continuationUsed === "boolean" &&
    (value.consolidation === null || typeof value.consolidation === "object");
}

function isExpired(state, now = Date.now()) {
  const stamp = Date.parse(state.updatedAt || state.at);
  return !Number.isFinite(stamp) || now - stamp > RUN_STATE_MAX_AGE_MS;
}

async function ensureDirectory(workspace) {
  const directory = runLogDirectory(workspace);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

// Atomic replacement in the same directory: a reader never observes a partial
// JSON document, and the rename is the publication point.
async function atomicWrite(target, text) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, text, "utf8");
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

// A single-writer lock for one run state file. An exclusive create is portable
// (Windows included); a lock left by a crashed process is reclaimed by age.
async function acquireLock(target) {
  const lock = `${target}${LOCK_SUFFIX}`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await fs.open(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      await handle.close();
      return lock;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const stat = await fs.stat(lock).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        await fs.rm(lock, { force: true }).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) throw new Error("CodeTour run state is locked by another process.");
      await sleep(25);
    }
  }
}

async function withLock(target, action) {
  const lock = await acquireLock(target);
  try {
    return await action();
  } finally {
    await fs.rm(lock, { force: true }).catch(() => undefined);
  }
}

export async function readRunStateFile(file) {
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { state: undefined, reason: "missing" };
    return { state: undefined, reason: "unreadable" };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: undefined, reason: "malformed" };
  }
  if (!isRunState(parsed)) return { state: undefined, reason: "malformed" };
  return { state: parsed, reason: undefined };
}

export async function writeRunState(workspace, state) {
  if (!isRunState(state)) throw new Error("Invalid CodeTour run state.");
  if (path.resolve(state.workspace) !== path.resolve(await fs.realpath(workspace))) {
    throw new Error("The CodeTour run state belongs to another workspace.");
  }
  await ensureDirectory(workspace);
  const target = runStatePath(workspace, state.runId);
  await withLock(target, () => atomicWrite(target, `${JSON.stringify(state, null, 2)}\n`));
  return state;
}

export async function readRunState(workspace, runId) {
  const target = runStatePath(workspace, runId);
  return readRunStateFile(target);
}

// Read the current state, let the caller merge one field set, and write it back
// while holding the lock. A mutation returning null aborts without writing,
// which is how the hook guarantees at most one continuation per run.
export async function updateRunState(workspace, runId, mutate) {
  const target = runStatePath(workspace, runId);
  return withLock(target, async () => {
    const read = await readRunStateFile(target);
    if (!read.state) return { updated: false, reason: read.reason };
    const next = mutate(read.state);
    if (next === null || next === undefined) return { updated: false, reason: "noop", state: read.state };
    if (!isRunState(next)) throw new Error("The CodeTour run state update is invalid.");
    await atomicWrite(target, `${JSON.stringify(next, null, 2)}\n`);
    return { updated: true, state: next };
  });
}

export async function removeRunState(workspace, runId) {
  const target = runStatePath(workspace, runId);
  await fs.rm(target, { force: true }).catch(() => undefined);
  await fs.rm(`${target}${LOCK_SUFFIX}`, { force: true }).catch(() => undefined);
}

// Enumerate every readable run state of one workspace. A corrupt or unreadable
// file is reported, never treated as a CodeTour run: the hook must stay inert
// on storage damage instead of inventing work.
export async function listRunStates(workspace, now = Date.now()) {
  const directory = runLogDirectory(workspace);
  let names;
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    return { states: [], problems: error?.code === "ENOENT" ? [] : [`unreadable run log directory: ${error?.message || error}`] };
  }
  const states = [];
  const problems = [];
  for (const name of names) {
    if (!name.startsWith(RUN_FILE_PREFIX) || !name.endsWith(".json")) continue;
    const read = await readRunStateFile(path.join(directory, name));
    if (!read.state) {
      problems.push(`${name}: ${read.reason}`);
      continue;
    }
    // An expired run is not a problem: it can no longer drive the hook and is
    // left for pruning.
    if (isExpired(read.state, now)) continue;
    states.push(read.state);
  }
  states.sort((left, right) => (Date.parse(right.updatedAt || right.at) || 0) - (Date.parse(left.updatedAt || left.at) || 0));
  return { states, problems };
}

// Remove run states that can no longer drive a hook: old files only. This never
// touches Knowledge or Tours, and a failed cleanup is never an error.
export async function pruneRunStates(workspace, now = Date.now()) {
  const directory = runLogDirectory(workspace);
  let names;
  try {
    names = await fs.readdir(directory);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(RUN_FILE_PREFIX) || !name.endsWith(".json")) continue;
    const file = path.join(directory, name);
    const read = await readRunStateFile(file);
    const stamp = read.state ? Date.parse(read.state.updatedAt || read.state.at) : NaN;
    const age = Number.isFinite(stamp) ? now - stamp : Infinity;
    if (age > RUN_STATE_RETENTION_MS) await fs.rm(file, { force: true }).catch(() => undefined);
  }
}

// Resolve the Copilot CLI session-state directory that holds
// `session-state/<sessionId>/events.jsonl`. The explicit override exists for
// tests and relocated layouts; COPILOT_HOME relocates the whole user
// directory, so it wins over the default home.
export function sessionStateDirectory(options = {}) {
  return options.sessionStateDirectory ||
    process.env.CODETOUR_COPILOT_SESSION_STATE_DIR ||
    path.join(process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"), "session-state");
}

function codeTourToolName(toolName) {
  if (typeof toolName !== "string") return null;
  const match = toolName.match(CODETOUR_TOOL_SUFFIX);
  return match ? match[1] : null;
}

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function emptyUsage() {
  const usage = {records: 0, durationMs: 0};
  for (const key of USAGE_TOKEN_KEYS) usage[key] = 0;
  return usage;
}

function accumulateUsage(usage, record) {
  usage.records += 1;
  usage.durationMs += numberOrZero(record.duration);
  for (const key of USAGE_TOKEN_KEYS) usage[key] += numberOrZero(record[key]);
  return usage;
}

/**
 * Read one Copilot session's raw usage facts from its events file: per-call
 * token records and CodeTour tool executions. Tolerant by contract — a
 * missing, unreadable, malformed or partial file yields an unobserved report
 * instead of an error, because the metrics are observability data and lose to
 * any guard decision. Input tokens include cached reads, exactly as the
 * session usage records report them.
 */
export async function collectSessionUsage(sessionId, options = {}) {
  const file = path.join(sessionStateDirectory(options), sessionId, "events.jsonl");
  const collected = {
    source: "copilot-session-events-v1",
    sessionId: typeof sessionId === "string" && sessionId ? sessionId : null,
    file,
    observedAt: new Date().toISOString(),
    observed: false,
    reason: "unreadable",
    copilotVersion: null,
    projectState: null,
    model: null,
    models: {},
    records: [],
    results: []
  };
  let events;
  try {
    events = createInterface({input: createReadStream(file, {encoding: "utf8"}), crlfDelay: Infinity});
  } catch {
    return {...collected, reason: "missing"};
  }
  // One CodeTour tool execution = a `tool.execution_start` naming the tool,
  // then a `tool.execution_complete` carrying only the same `toolCallId`. The
  // completion is joined back to its start; only joined calls are reported.
  const pending = new Map();
  try {
    for await (const line of events) {
      if (!line.includes("usage_record") && !line.includes("execution") && !line.includes("session.start")) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (!event || typeof event !== "object") continue;
      const data = event.data;
      if (!data || typeof data !== "object") continue;
      if (event.type === "session.start") {
        collected.copilotVersion = typeof data.copilotVersion === "string" ? data.copilotVersion : null;
        const context = data.context;
        if (context && typeof context === "object") {
          collected.projectState = {
            branch: typeof context.branch === "string" ? context.branch : null,
            headCommit: typeof context.headCommit === "string" ? context.headCommit : null
          };
        }
      } else if (event.type === "session.usage_record" && data.usage && typeof data.usage === "object") {
        const usage = data.usage;
        const record = {
          at: typeof event.timestamp === "string" ? event.timestamp : null,
          model: typeof usage.model === "string" ? usage.model : null,
          duration: numberOrZero(usage.duration)
        };
        for (const key of USAGE_TOKEN_KEYS) record[key] = numberOrZero(usage[key]);
        collected.records.push(record);
        if (record.model) collected.models[record.model] = (collected.models[record.model] || 0) + 1;
      } else if (event.type === "tool.execution_start") {
        const tool = codeTourToolName(data.toolName);
        if (tool && typeof event.timestamp === "string" && typeof data.toolCallId === "string") {
          pending.set(data.toolCallId, {tool, at: event.timestamp});
        }
      } else if (event.type === "tool.execution_complete") {
        const start = typeof data.toolCallId === "string" ? pending.get(data.toolCallId) : undefined;
        if (start && typeof event.timestamp === "string") {
          pending.delete(data.toolCallId);
          collected.results.push({tool: start.tool, at: event.timestamp, success: data.success === true});
        }
      }
    }
  } catch (error) {
    collected.reason = error?.code === "ENOENT" ? "missing" : `unreadable: ${error?.message || error}`;
    return collected;
  }
  collected.observed = true;
  delete collected.reason;
  let best = 0;
  for (const [model, count] of Object.entries(collected.models)) {
    if (count > best) {
      collected.model = model;
      best = count;
    }
  }
  return collected;
}

/**
 * Summarize a session's usage facts into the per-phase record for one run:
 * the run window starts at the run state's creation, ends at the hook
 * snapshot (another run's start bounds attribution in shared sessions), and
 * the last successful Tour creation splits generation from consolidation —
 * the same separation the trial logbook performed by hand. An unresolved
 * boundary keeps every record in the generation window and reports it
 * explicitly instead of inventing a consolidation phase.
 */
export function summarizeRunUsage(collected, {runAt, stopAt, nextRunAt}) {
  const source = {
    source: collected?.source || "copilot-session-events-v1",
    observed: collected?.observed === true,
    observedAt: collected?.observedAt || new Date().toISOString(),
    file: collected?.file || null
  };
  if (!source.observed) return {...source, reason: collected?.reason || "unavailable"};
  const from = Date.parse(runAt);
  const until = Number.isFinite(Date.parse(stopAt)) ? Date.parse(stopAt) : Date.now();
  const next = Date.parse(nextRunAt);
  const end = Number.isFinite(next) ? Math.min(next, until) : until;
  const inWindow = timestamp => {
    const at = Date.parse(timestamp);
    return Number.isFinite(at) && at >= from && at < end;
  };
  const records = (collected.records || []).filter(record => inWindow(record.at));
  // Only a completed call joins back to its start, so attempts are refusals
  // or successes observed exactly once; a call without a completion stays out.
  const results = (collected.results || []).filter(result => inWindow(result.at));
  const boundary = results
    .filter(result => CODETOUR_CREATION_TOOLS.has(result.tool) && result.success)
    .map(result => Date.parse(result.at))
    .reduce((latest, at) => Math.max(latest, at), null);
  const callsFor = subset => {
    const calls = {};
    for (const result of subset) {
      const statusKey = result.success ? "successful" : "refused";
      calls[statusKey] = calls[statusKey] || {};
      calls[statusKey][result.tool] = (calls[statusKey][result.tool] || 0) + 1;
    }
    for (const key of ["successful", "refused"]) calls[key] = calls[key] || {};
    return calls;
  };
  const totals = records.reduce((sum, record) => accumulateUsage(sum, record), emptyUsage());
  const generationUntil = boundary === null ? end : boundary;
  const usageWindow = (fromMs, untilMs, windowResults) => ({
    fromAt: new Date(fromMs).toISOString(),
    untilAt: new Date(untilMs).toISOString(),
    ...records
      .filter(record => {
        const at = Date.parse(record.at);
        return at >= fromMs && at < untilMs;
      })
      .reduce((sum, record) => accumulateUsage(sum, record), emptyUsage()),
    calls: callsFor(windowResults)
  });
  return {
    ...source,
    file: collected.file,
    copilotVersion: collected.copilotVersion,
    model: collected.model,
    models: collected.models,
    projectState: collected.projectState,
    totals,
    calls: callsFor(results),
    windows: {
      generation: usageWindow(from, generationUntil, results.filter(result => Date.parse(result.at) < generationUntil)),
      consolidation: boundary === null
        ? null
        : usageWindow(boundary, end, results.filter(result => Date.parse(result.at) >= boundary)),
      boundaryObserved: boundary !== null
    }
  };
}

function mergeMetrics(previous, incoming) {
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) {
    return incoming;
  }
  const merged = {...previous};
  for (const [key, value] of Object.entries(incoming)) {
    merged[key] = value && typeof value === "object" && !Array.isArray(value) &&
      previous[key] && typeof previous[key] === "object" && !Array.isArray(previous[key])
      ? {...previous[key], ...value}
      : value;
  }
  return merged;
}

/**
 * Merge one metrics part into a run state under the same cross-process lock as
 * every other writer. The metric block is observability only: an unreadable
 * snapshot or a lost update is reported to the caller and never flips a run
 * outcome, a Tour creation or a consolidation closure.
 */
export async function recordRunMetrics(workspace, runId, metrics) {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    throw new Error("Invalid CodeTour run metrics.");
  }
  return updateRunState(workspace, runId, state => ({
    ...state,
    metrics: mergeMetrics(state.metrics, {...metrics, version: RUN_METRICS_VERSION}),
    updatedAt: new Date().toISOString()
  }));
}
