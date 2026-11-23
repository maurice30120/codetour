import { constants, promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// One CodeTour generation run, persisted under <workspace>/.tours/.log/.
//
// The Pi package ships its own copy of the on-disk contract because it is
// installed from this directory alone: `packages/mcp-server/src/run-log.ts` is
// the writer of the authenticated outcomes (Tour creation, consolidation
// closure) and of the additive Knowledge block, while this copy is what the Pi
// extension reads and what it writes for the run identity it creates itself.
// The format is the Copilot plugin's, unchanged: one file per run, atomic
// replacement, a small cross-process lock, and an optional additive block that
// never drives a decision.
//
// Fields this module writes: the initial run state (`/codetour`), and
// `continuationUsed` when the guard asks for its one continuation. Everything
// else belongs to the MCP server.

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

/** A fresh identity: 24 lowercase hex characters, like the Copilot adapter's. */
export function newRunId() {
  return randomUUID().replace(/-/g, "").slice(0, 24);
}

// The workspace spelling every comparison uses (ADR 0056). Node has *two*
// realpath implementations with different answers on Windows: `realpathSync`
// keeps an 8.3 short name (`C:\Users\RUNNER~1\...`) while
// `fs.promises.realpath` answers the long on-disk form. A server writing with
// one and a hook comparing with the other never agree, so both sides go
// through the native call — the file system's own answer — with the trailing
// separator removed.
export function canonicalWorkspace(value) {
  if (typeof value !== "string" || value === "") return "";
  const resolved = path.resolve(value);
  let canonical = resolved;
  try {
    canonical = typeof realpathSync.native === "function" ? realpathSync.native(resolved) : realpathSync(resolved);
  } catch {
    // An unavailable real path keeps the resolved argument.
  }
  return canonical.length > 1 && (canonical.endsWith("/") || canonical.endsWith("\\"))
    ? canonical.slice(0, -1)
    : canonical;
}

/** Whether two spellings name the same workspace root. */
export function sameWorkspace(left, right) {
  return canonicalWorkspace(left) === canonicalWorkspace(right);
}

export function runLogDirectory(workspace) {
  return path.join(workspace, RUN_LOG_DIRECTORY);
}

export function runStatePath(workspace, runId) {
  if (!isValidRunId(runId)) throw new Error("Invalid CodeTour runId.");
  return path.join(runLogDirectory(workspace), `${RUN_FILE_PREFIX}${runId}.json`);
}

export function createRunState({ runId, workspace, sessionId, kind, request, at = new Date().toISOString() }) {
  if (!isValidRunId(runId)) throw new Error("Invalid CodeTour runId.");
  if (kind !== "project" && kind !== "changes") throw new Error("Invalid CodeTour run kind.");
  return {
    version: RUN_STATE_VERSION,
    runId,
    workspace,
    sessionId: sessionId ?? null,
    kind,
    request: request ?? null,
    at,
    updatedAt: at,
    tourCreated: false,
    tourPath: null,
    tourTitle: null,
    consolidation: null,
    continuationUsed: false
  };
}

// The optional blocks (`metrics`, `knowledge`) are deliberately not validated:
// they are additive observability written by another surface, and a run state
// that carries an unknown or absent block is still a valid run state.
export function isRunState(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    value.version === RUN_STATE_VERSION &&
    isValidRunId(value.runId) &&
    typeof value.workspace === "string" &&
    typeof value.at === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.tourCreated === "boolean" &&
    typeof value.continuationUsed === "boolean" &&
    (value.consolidation === null || typeof value.consolidation === "object");
}

export function isExpired(state, now = Date.now()) {
  const stamp = Date.parse(state.updatedAt || state.at);
  return !Number.isFinite(stamp) || now - stamp > RUN_STATE_MAX_AGE_MS;
}

async function atomicWrite(target, text) {
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.tmp`
  );
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
      if (Date.now() >= deadline) {
        throw new Error("CodeTour run state is locked by another process.");
      }
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
    return { state: undefined, reason: error?.code === "ENOENT" ? "missing" : "unreadable" };
  }
  try {
    const parsed = JSON.parse(raw);
    return isRunState(parsed)
      ? { state: parsed, reason: undefined }
      : { state: undefined, reason: "malformed" };
  } catch {
    return { state: undefined, reason: "malformed" };
  }
}

export async function writeRunState(workspace, state) {
  if (!isRunState(state)) throw new Error("Invalid CodeTour run state.");
  if (!sameWorkspace(state.workspace, workspace)) {
    throw new Error("The CodeTour run state belongs to another workspace.");
  }
  await fs.mkdir(runLogDirectory(workspace), { recursive: true });
  const target = runStatePath(workspace, state.runId);
  await withLock(target, () => atomicWrite(target, `${JSON.stringify(state, null, 2)}\n`));
  return state;
}

export function readRunState(workspace, runId) {
  return readRunStateFile(runStatePath(workspace, runId));
}

// Read, merge one field set, write back, under the lock. A mutation returning
// null aborts without writing: that is how the guard guarantees at most one
// continuation per run even if two stops race.
export async function updateRunState(workspace, runId, mutate) {
  const target = runStatePath(workspace, runId);
  return withLock(target, async () => {
    const read = await readRunStateFile(target);
    if (!read.state) return { updated: false, reason: read.reason };
    const next = mutate(read.state);
    if (next === null || next === undefined) {
      return { updated: false, reason: "noop", state: read.state };
    }
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

// Every readable run of this workspace. A corrupt or unreadable file is
// reported, never treated as a run: the guard stays inert on storage damage
// instead of inventing work.
export async function listRunStates(workspace, now = Date.now()) {
  const directory = runLogDirectory(workspace);
  let names;
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    return {
      states: [],
      problems: error?.code === "ENOENT" ? [] : [`unreadable run log directory: ${error?.message || error}`]
    };
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
    if (isExpired(read.state, now)) continue;
    states.push(read.state);
  }
  states.sort(
    (left, right) =>
      (Date.parse(right.updatedAt || right.at) || 0) - (Date.parse(left.updatedAt || left.at) || 0)
  );
  return { states, problems };
}

// Old run states only. This never touches a Tour or Knowledge.
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
    if (age > RUN_STATE_RETENTION_MS) {
      await fs.rm(file, { force: true }).catch(() => undefined);
    }
  }
}
