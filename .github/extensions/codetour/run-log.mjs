import { constants, promises as fs } from "node:fs";
import path from "node:path";
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
// This file is the source of truth for the JavaScript surfaces (the Copilot
// adapter, the plugin hook). The MCP server implements the same on-disk
// contract in TypeScript (`packages/mcp-server/src/run-log.ts`); the shared
// tests pin both implementations to the same format.

export const RUN_STATE_VERSION = 1;
export const RUN_LOG_DIRECTORY = path.join(".tours", ".log");
export const RUN_FILE_PREFIX = "codetour-run-";
export const RUN_STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const RUN_STATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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

export function createRunState({ runId, workspace, sessionId, kind, request, at = new Date().toISOString() }) {
  return {
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
