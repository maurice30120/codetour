import { promises as fs, realpathSync } from "node:fs";
import path from "node:path";

// The creation journal as the Pi hook reads it.
//
// `codetour create-project-tour` and `codetour create-changes-tour` append one
// record per created Tour under `<workspace>/.tours/.log/creations/`
// (DESIGN §3). A record carries the workspace, the created Tour, its creation
// time and whatever session identity the creating process could observe; the
// hook uses exactly those fields to decide whether a creation belongs to the
// response it is closing.
//
// The journal is observability only: an unreadable, foreign or malformed entry
// is a diagnostic, never a reason to report a Tour or to fail a response.
//
// Pure decisions plus one directory read, so the attribution rules can be
// tested without a Pi session.

/** Directory of the creation records, relative to the workspace root. */
export const CREATIONS_DIRECTORY = path.join(".tours", ".log", "creations");

export const CREATION_RECORD_VERSION = 1;

// The workspace spelling every comparison uses (ADR 0056). Node has *two*
// realpath implementations with different answers on Windows: `realpathSync`
// keeps an 8.3 short name while `fs.promises.realpath` answers the long on-disk
// form. The creating CLI and the hook must agree, so both go through the native
// call — the file system's own answer — with the trailing separator removed.
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

/** Whether two spellings name the same workspace root. */
export function sameWorkspace(left, right) {
  return canonicalWorkspace(left) === canonicalWorkspace(right);
}

function creationDirectory(workspace) {
  return path.join(workspace, CREATIONS_DIRECTORY);
}

/**
 * Whether a parsed entry is a creation record this build understands. Anything
 * else — another version, another writer, a truncated file — is foreign and is
 * never attributed.
 */
export function isCreationRecord(value) {
  if (!value || typeof value !== "object") return false;
  const optionalString = candidate => candidate === null || typeof candidate === "string";
  return (
    value.version === CREATION_RECORD_VERSION &&
    typeof value.workspace === "string" &&
    value.workspace !== "" &&
    typeof value.tourPath === "string" &&
    value.tourPath !== "" &&
    typeof value.tourTitle === "string" &&
    typeof value.at === "string" &&
    Number.isFinite(Date.parse(value.at)) &&
    optionalString(value.sessionId) &&
    optionalString(value.responseId) &&
    optionalString(value.host)
  );
}

/**
 * Every readable creation record of this workspace, in file order, with the
 * entries that could not be read. A missing journal is not a problem: most
 * workspaces never created a Tour.
 */
export async function readCreations(workspace) {
  const directory = creationDirectory(workspace);
  let names;
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    return {
      records: [],
      problems:
        error?.code === "ENOENT" ? [] : [`unreadable creation journal: ${error?.message || error}`],
    };
  }
  const records = [];
  const problems = [];
  for (const name of names.sort()) {
    if (name.startsWith(".") || !name.endsWith(".json")) continue;
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
    } catch (error) {
      problems.push(`${name}: ${error?.code || "unreadable"}`);
      continue;
    }
    if (!isCreationRecord(parsed)) {
      problems.push(`${name}: not a creation record`);
      continue;
    }
    records.push(parsed);
  }
  return { records, problems };
}

/**
 * The creations of this response: same workspace, same session identity, and
 * stamped inside the response window.
 *
 * A creation is attributed only when all three hold. Pi exposes no response
 * identity, so the window is the `agent_start` instant and the settle instant;
 * a record without a session identity is never attributed, and a record that
 * predates the response belongs to an earlier one.
 */
export function selectCreated(records, { workspace, sessionId, since, now = Date.now() }) {
  if (!Array.isArray(records)) return [];
  if (typeof sessionId !== "string" || sessionId === "") return [];
  const selected = [];
  const seen = new Set();
  for (const record of records) {
    if (!isCreationRecord(record)) continue;
    if (typeof record.sessionId !== "string" || record.sessionId === "") continue;
    if (record.sessionId !== sessionId) continue;
    if (!sameWorkspace(record.workspace, workspace)) continue;
    const at = Date.parse(record.at);
    if (at < since || at > now) continue;
    const key = `${record.tourPath}|${record.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(record);
  }
  // Oldest first: the response reads in the order the Tours were created.
  return selected.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

/** One line per attributed creation: its title and its absolute path. */
export function summaryLines(records) {
  if (!Array.isArray(records)) return [];
  return records
    .filter(isCreationRecord)
    .map(record => `CodeTour: "${record.tourTitle}" (${record.tourPath})`);
}

const tokens = new Intl.NumberFormat("en-GB");

/**
 * One token reading for the response, or its unavailability.
 *
 * Pi reports `Usage` on every assistant message: `input` already excludes the
 * cache, and `totalTokens` is `input + output + cacheRead + cacheWrite`. The
 * cache is therefore its own figure — `totalTokens` is never added to it — and
 * an all-zero or absent usage is unavailable, never zero. `approximate` states
 * that the scope is not the run's own messages (a fallback read of the session
 * entries, or an assistant message whose usage was missing).
 */
export function tokenReading(usages, { approximate = false } = {}) {
  const provided = Array.isArray(usages) ? usages : [];
  const usable = provided.filter(usage => usage && typeof usage === "object");
  const sum = field =>
    usable.reduce(
      (total, usage) => total + (Number.isFinite(usage[field]) ? usage[field] : 0),
      0
    );
  const input = sum("input");
  const output = sum("output");
  const cache = sum("cacheRead") + sum("cacheWrite");
  return {
    available: usable.length > 0 && input + output + cache > 0,
    input,
    output,
    cache,
    approximate: approximate || usable.length !== provided.length,
  };
}

/**
 * The single token line of the response. It is printed at most once per
 * response, after the created Tours: a reading whose scope is not exact says
 * so, and an unavailable reading says unavailable instead of zero.
 */
export function tokenLine(reading) {
  if (!reading || reading.available !== true) {
    return "CodeTour tokens: unavailable for this response.";
  }
  const figures = [
    `input ${tokens.format(reading.input)}`,
    `output ${tokens.format(reading.output)}`,
    `cache ${tokens.format(reading.cache)}`,
  ].join(" / ");
  return `CodeTour tokens${reading.approximate ? " (approximate)" : ""}: ${figures}`;
}
