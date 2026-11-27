import { promises as fs } from "fs";
import * as path from "path";
import { LEGACY_COPILOT_EXTENSION_FILES } from "./legacyCopilotExtension";

// Ownership of the surfaces this release retires (spec #320, DESIGN §11).
//
// The writers those surfaces compared against are gone: nothing in this
// release registers a `codetour` MCP server, writes the legacy Copilot adapter,
// records a Pi launcher with a subcommand, or creates a guarded run state. What
// remains is the proof that a file on disk is ours, frozen here as literals so
// a migration can remove it and never touch anybody else's file. A broader
// match — "a local entry whose last argument is mcp", "every file in the
// extension directory", "every codetour-run-* file" — would delete a foreign
// server or a user's edit, so no predicate here is ever widened.

/** One MCP server entry as a client configuration stores it. */
export interface McpServerEntry {
  type?: unknown;
  command?: unknown;
  args?: unknown;
  tools?: unknown;
  [key: string]: unknown;
}

const LEGACY_SERVER_NAME = "codetour";
const LEGACY_SUBCOMMAND = "mcp";
const LEGACY_TOOLS = ["*"];
// The CLI bundle an older install recorded as its launcher:
// `<node runtime> <absolute .../cli.js> mcp`. The npm bin, the development build
// and the standalone launcher all resolve to a file named cli.js.
const LEGACY_CLI_SCRIPT = /(^|[\\/])cli\.js$/i;
const NODE_RUNTIME = /(^|[\\/])node(\.exe)?$/i;

function sameValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === "string")
    ? (value as string[])
    : undefined;
}

/**
 * Whether a `codetour` MCP server entry is one an older CodeTour CLI
 * registered, in either frozen shape: the documented `codetour mcp` command, or
 * the absolute Node launcher this CLI wrote for the runtime that installed it.
 * Any other same-named server belongs to another installation and is preserved.
 */
export function isLegacyCodetourMcpEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const server = entry as McpServerEntry;
  const type = typeof server.type === "string" ? server.type : "local";
  if (type !== "local") return false;
  const command = typeof server.command === "string" ? server.command : undefined;
  const args = stringArray(server.args);
  if (!command || !args) return false;
  // The documented launcher of the standalone CLI.
  if (command === LEGACY_SERVER_NAME && sameValues(args, [LEGACY_SUBCOMMAND])) return true;
  // The launcher this CLI wrote: its own runtime, the absolute CLI bundle and
  // the retired subcommand, with every tool allowed.
  if (command !== process.execPath && !NODE_RUNTIME.test(command)) return false;
  if (!sameValues(stringArray(server.tools) ?? [], LEGACY_TOOLS)) return false;
  return (
    args.length === 2 &&
    args[1] === LEGACY_SUBCOMMAND &&
    path.isAbsolute(args[0]) &&
    LEGACY_CLI_SCRIPT.test(args[0])
  );
}

/** The MCP declaration an older release wrote inside the Copilot plugin. */
export const LEGACY_COPILOT_PLUGIN_FILES: readonly string[] = ["mcp.json"];

/**
 * Whether a recorded Pi launcher still carries the retired subcommand. The
 * installed package is ours as a whole; an older install is the only writer of
 * this shape, and the next install rewrites it.
 */
export function isLegacyPiLauncher(content: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object") return false;
  const args = stringArray((parsed as { args?: unknown }).args);
  return Boolean(args && args.length > 0 && args[args.length - 1] === LEGACY_SUBCOMMAND);
}

/** The guarded run states of the retired hook. */
export const LEGACY_RUN_LOG_DIRECTORY = path.join(".tours", ".log");
export const LEGACY_RUN_FILE_PREFIX = "codetour-run-";
const LEGACY_LOCK_SUFFIX = ".lock";
const LEGACY_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const LEGACY_RUN_STATE_VERSION = 1;

/** `<workspace>/.tours/.log/codetour-run-<runId>.json`. */
export function isLegacyRunStateName(name: string): boolean {
  if (!name.startsWith(LEGACY_RUN_FILE_PREFIX) || !name.endsWith(".json")) return false;
  return LEGACY_RUN_ID.test(name.slice(LEGACY_RUN_FILE_PREFIX.length, -".json".length));
}

/**
 * The on-disk contract the removed server wrote and the retired agentStop
 * guard read. A file that does not satisfy it is corrupt or foreign: it is
 * reported, never deleted.
 */
export function isLegacyRunState(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return (
    state.version === LEGACY_RUN_STATE_VERSION &&
    typeof state.runId === "string" &&
    LEGACY_RUN_ID.test(state.runId) &&
    typeof state.workspace === "string" &&
    typeof state.at === "string" &&
    typeof state.tourCreated === "boolean" &&
    typeof state.continuationUsed === "boolean" &&
    (state.consolidation === null || typeof state.consolidation === "object")
  );
}

export interface RemovalOutcome {
  /** Absolute paths this migration deleted. */
  removed: string[];
  /** Absolute paths it left in place, because it cannot prove they are ours. */
  preserved: string[];
}

/** What one retired surface holds: files this CLI owns, and files it does not. */
export interface LegacySurfaceScan {
  /** Absolute paths an older CodeTour CLI wrote; the migration removes them. */
  owned: string[];
  /** Absolute paths it cannot prove it wrote; they are reported, never removed. */
  preserved: string[];
}

function unreadable(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * The retired Copilot adapter files still on disk, one byte comparison at a
 * time. A file whose bytes are not the frozen snapshot — a user's edit, a
 * foreign file, a subdirectory — is preserved.
 */
export async function scanLegacyCopilotExtension(
  directory: string
): Promise<LegacySurfaceScan> {
  const scan: LegacySurfaceScan = { owned: [], preserved: [] };
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (unreadable(error)) return scan;
    throw error;
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    const expected = entry.isFile() ? LEGACY_COPILOT_EXTENSION_FILES[entry.name] : undefined;
    const content = entry.isFile()
      ? await fs.readFile(target, "utf8").catch(() => undefined)
      : undefined;
    if (expected === undefined || content !== expected) scan.preserved.push(target);
    else scan.owned.push(target);
  }
  return scan;
}

/**
 * Remove the retired Copilot adapter files and the directory itself once
 * nothing is left in it. A file whose bytes are not the frozen snapshot is
 * preserved and reported.
 */
export async function removeLegacyCopilotExtension(
  directory: string
): Promise<RemovalOutcome> {
  const scan = await scanLegacyCopilotExtension(directory);
  for (const file of scan.owned) await fs.rm(file, { force: true });
  if (scan.preserved.length === 0) await fs.rmdir(directory).catch(() => undefined);
  return { removed: scan.owned, preserved: scan.preserved };
}

/**
 * The guarded run states of the retired hook in one `.tours/.log` directory:
 * only the frozen file name joined with the frozen on-disk contract, with the
 * lock file of an owned state. Nothing else in that directory is ever listed as
 * owned — the creation journal of the current flow lives there too.
 */
export async function scanLegacyRunStates(
  logDirectory: string
): Promise<LegacySurfaceScan & { locks: string[] }> {
  const scan = { owned: [] as string[], preserved: [] as string[], locks: [] as string[] };
  let names: string[];
  try {
    names = await fs.readdir(logDirectory);
  } catch (error) {
    if (unreadable(error)) return scan;
    throw error;
  }
  for (const name of names.filter(isLegacyRunStateName)) {
    const target = path.join(logDirectory, name);
    const raw = await fs.readFile(target, "utf8").catch(() => undefined);
    let parsed: unknown;
    try {
      parsed = raw === undefined ? undefined : JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (isLegacyRunState(parsed)) {
      scan.owned.push(target);
      const lock = `${target}${LEGACY_LOCK_SUFFIX}`;
      if (names.includes(name + LEGACY_LOCK_SUFFIX)) scan.locks.push(lock);
    } else {
      scan.preserved.push(target);
    }
  }
  for (const name of names) {
    if (!name.startsWith(LEGACY_RUN_FILE_PREFIX) || !name.endsWith(LEGACY_LOCK_SUFFIX)) continue;
    const target = path.join(logDirectory, name);
    const base = name.slice(0, -LEGACY_LOCK_SUFFIX.length);
    if (!scan.owned.some((file) => file === path.join(logDirectory, base))) scan.preserved.push(target);
  }
  return scan;
}

/** Remove the guarded run states of the retired hook; never anything else. */
export async function removeLegacyRunStates(
  logDirectory: string
): Promise<RemovalOutcome> {
  const scan = await scanLegacyRunStates(logDirectory);
  for (const file of [...scan.owned, ...scan.locks]) await fs.rm(file, { force: true });
  return { removed: [...scan.owned, ...scan.locks], preserved: scan.preserved };
}
