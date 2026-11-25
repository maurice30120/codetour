import { createReadStream, promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

// Observability data for the Copilot `agentStop` hook: the creation journal the
// CodeTour CLI writes, and the session transcript the Copilot CLI owns.
//
// Nothing here decides anything: the hook reports what these two files say and
// stays silent when they say nothing. Both are foreign documents, so every
// reader is tolerant — a missing, unreadable or malformed file yields "not
// observed" instead of an error, and an unreadable record is skipped instead of
// invalidating its neighbours.

/** Creation records, relative to the workspace root (journal.ts writes them). */
export const CREATIONS_DIRECTORY = path.join(".tours", ".log", "creations");
/** Response markers, relative to the workspace root. */
export const REPORTED_DIRECTORY = path.join(CREATIONS_DIRECTORY, ".reported");
/** Readers ignore older creation records (spec #320). */
export const CREATION_RECORD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Response markers are garbage after the same delay. */
export const REPORTED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The token figures a Copilot session usage record carries. */
export const TOKEN_KEYS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens"
];

// The workspace spelling every comparison uses (ADR 0056). Node has *two*
// realpath implementations with different answers on Windows: `realpathSync`
// keeps an 8.3 short name while `fs.promises.realpath` answers the long on-disk
// form. A writer using one and a reader comparing with the other never agree,
// so both sides go through the native call, without a trailing separator.
export function canonicalWorkspace(value) {
  if (typeof value !== "string" || value === "") return "";
  const resolved = path.resolve(value);
  let canonical = resolved;
  try {
    canonical =
      typeof realpathSync.native === "function" ? realpathSync.native(resolved) : realpathSync(resolved);
  } catch {
    // An unavailable real path keeps the resolved argument.
  }
  return canonical.length > 1 && (canonical.endsWith("/") || canonical.endsWith("\\"))
    ? canonical.slice(0, -1)
    : canonical;
}

export function creationsDirectory(workspace) {
  return path.join(workspace, CREATIONS_DIRECTORY);
}

export function reportedDirectory(workspace) {
  return path.join(workspace, REPORTED_DIRECTORY);
}

/** Whether a parsed document is one creation record of the current version. */
export function isCreationRecord(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    value.version === 1 &&
    typeof value.workspace === "string" &&
    typeof value.tourPath === "string" &&
    value.tourPath !== "" &&
    typeof value.tourTitle === "string" &&
    typeof value.at === "string" &&
    Number.isFinite(Date.parse(value.at))
  );
}

/**
 * Every readable creation record of one workspace, oldest first. A corrupt or
 * foreign file is reported and skipped: one bad record never hides the others,
 * and an unreadable directory is an empty journal.
 */
export async function listCreations(workspace, now = Date.now()) {
  const directory = creationsDirectory(workspace);
  let names;
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    return {
      records: [],
      problems:
        error?.code === "ENOENT" ? [] : [`unreadable creation journal: ${error?.message || error}`]
    };
  }
  const records = [];
  const problems = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const file = path.join(directory, name);
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      problems.push(`${name}: ${error?.code || "unreadable"}`);
      continue;
    }
    if (!isCreationRecord(parsed)) {
      problems.push(`${name}: malformed`);
      continue;
    }
    // An expired record can no longer be attributed and is left for pruning.
    if (now - Date.parse(parsed.at) > CREATION_RECORD_MAX_AGE_MS) continue;
    records.push(parsed);
  }
  records.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  return { records, problems };
}

function numberOrUndefined(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Read one Copilot session transcript into the facts the summary needs: the
 * response boundary and the usage records it can attribute.
 *
 * The boundary is the last `user.message` at or before `untilMs`; without one
 * (a resumed or truncated transcript) the earliest event the reader can place
 * is used and the window is labelled approximate. A file that cannot be read, or that
 * carries no timestamp at all, yields no window: the hook then reports nothing
 * rather than guessing.
 */
export async function readResponseWindow(file, untilMs) {
  if (typeof file !== "string" || file === "") return { observed: false, reason: "no transcript" };
  const lines = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  let firstAtMs = null;
  let lastUserMessageAtMs = null;
  const usageRecords = [];
  try {
    for await (const line of lines) {
      // Cheap pre-filter: only these three event types matter.
      if (!line.includes("usage_record") && !line.includes("user.message") && !line.includes("session.start")) {
        continue;
      }
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (!event || typeof event !== "object") continue;
      const atMs = typeof event.timestamp === "string" ? Date.parse(event.timestamp) : NaN;
      if (!Number.isFinite(atMs)) continue;
      if (firstAtMs === null || atMs < firstAtMs) firstAtMs = atMs;
      if (event.type === "user.message") {
        if (atMs <= untilMs && (lastUserMessageAtMs === null || atMs > lastUserMessageAtMs)) {
          lastUserMessageAtMs = atMs;
        }
      } else if (event.type === "session.usage_record") {
        const usage = event.data?.usage;
        if (!usage || typeof usage !== "object") continue;
        const tokens = {};
        for (const key of TOKEN_KEYS) {
          const value = numberOrUndefined(usage[key]);
          if (value !== undefined) tokens[key] = value;
        }
        usageRecords.push({ atMs, tokens });
      }
    }
  } catch (error) {
    return { observed: false, reason: error?.code === "ENOENT" ? "no transcript" : "unreadable transcript" };
  }
  if (firstAtMs === null) return { observed: false, reason: "no session event" };
  const fromMs = lastUserMessageAtMs ?? firstAtMs;
  return {
    observed: true,
    fromMs,
    approximate: lastUserMessageAtMs === null,
    usageRecords: usageRecords.filter(record => record.atMs >= fromMs && record.atMs <= untilMs)
  };
}

/**
 * Sum the token figures of one response. A key is observed only when at least
 * one record carried a finite number for it, so an absent figure stays absent
 * instead of becoming a zero the source never reported. `inputTokens` already
 * contains the cache reads and writes: the sums are never added together.
 */
export function summarizeUsage(usageRecords) {
  const sums = {};
  const observed = {};
  for (const key of TOKEN_KEYS) {
    sums[key] = 0;
    observed[key] = false;
  }
  for (const record of usageRecords) {
    for (const key of TOKEN_KEYS) {
      const value = record.tokens[key];
      if (value === undefined) continue;
      sums[key] += value;
      observed[key] = true;
    }
  }
  return { records: usageRecords.length, sums, observed };
}

function markerName(sessionId, responseStartMs) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9._-]/g, "_");
  return `${safe}-${responseStartMs}`;
}

/** Whether this response already printed its summary. */
export async function isReported(workspace, sessionId, responseStartMs) {
  const file = path.join(reportedDirectory(workspace), markerName(sessionId, responseStartMs));
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark one response as reported and drop markers that have outlived their
 * session. Returns false when the marker cannot be written; the summary is
 * already printed at that point, so the failure only costs the de-duplication.
 */
export async function markReported(workspace, sessionId, responseStartMs, now = Date.now()) {
  const directory = reportedDirectory(workspace);
  try {
    await fs.mkdir(directory, { recursive: true });
    await pruneReported(directory, now);
    await fs.writeFile(
      path.join(directory, markerName(sessionId, responseStartMs)),
      `${new Date(responseStartMs).toISOString()}\n`,
      "utf8"
    );
    return true;
  } catch {
    return false;
  }
}

async function pruneReported(directory, now) {
  let names;
  try {
    names = await fs.readdir(directory);
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(directory, name);
    const stat = await fs.stat(file).catch(() => undefined);
    if (stat && now - stat.mtimeMs > REPORTED_MAX_AGE_MS) {
      await fs.rm(file, { force: true }).catch(() => undefined);
    }
  }
}
