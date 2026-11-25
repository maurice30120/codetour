#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  canonicalWorkspace,
  isReported,
  listCreations,
  markReported,
  readResponseWindow,
  summarizeUsage
} from "../lib/run-log.mjs";

// Copilot `agentStop` summary: what this response created, and what it cost.
//
// Purely informative. The hook writes its summary to stderr, answers `{}` on
// stdout whatever happens, and exits 0: it never blocks, never asks for a
// continuation, never calls a model and never writes Tour content (spec #320).
//
// Two sources, both foreign and both tolerant: the creation journal the CodeTour
// CLI appends to after a successful write (`<workspace>/.tours/.log/creations/`)
// and the session transcript the Copilot CLI owns (`transcriptPath`). A Tour is
// reported only when the attribution is established: same workspace, same
// `sessionId` as the payload, created inside this response — the window between
// the last `user.message` and the stop — and not in the future. A creation
// without a session identity, or one the transcript cannot place, is never
// guessed into the summary.
//
// The token reading is one per response, for the response as a whole: no Tour is
// given a share it cannot have. `inputTokens` already includes the cache reads
// and writes, so cache is shown as a part of the input total, never added to it;
// an unreadable or empty window says unavailable, never zero. The
// `<sessionId>-<responseStart>` marker keeps a second stop of the same response
// silent.
//
// Silences: no payload, a hook-triggered re-entry, an unusable workspace, no
// session identity, no response boundary, and no attributed creation. Every
// failure is a diagnostic on stderr, never a decision.

const MAX_INPUT_BYTES = 1024 * 1024;
const HOOK_OUTPUT = {};

function diagnostic(message) {
  process.stderr.write(`CodeTour agentStop: ${message}\n`);
}

function report(message) {
  process.stderr.write(`CodeTour: ${message}\n`);
}

const numbers = new Intl.NumberFormat("en-GB");

function formatTokens(value) {
  return numbers.format(value);
}

// One line for the response: input as the total that already contains the
// cache, output beside it. A figure the session never recorded is omitted
// rather than printed as zero.
function usageLine(usage, approximate) {
  const suffix = approximate ? " (approximate)" : "";
  if (usage.records === 0) {
    return `tokens unavailable (no usage records in this response)`;
  }
  const { sums, observed } = usage;
  const parts = [];
  if (observed.inputTokens) {
    const cache = [];
    if (observed.cacheReadTokens) cache.push(`${formatTokens(sums.cacheReadTokens)} cached reads`);
    if (observed.cacheWriteTokens) cache.push(`${formatTokens(sums.cacheWriteTokens)} cached writes`);
    parts.push(
      cache.length === 0
        ? `${formatTokens(sums.inputTokens)} in`
        : `${formatTokens(sums.inputTokens)} in (of which ${cache.join(", ")})`
    );
  }
  if (observed.outputTokens) parts.push(`${formatTokens(sums.outputTokens)} out`);
  if (parts.length === 0) {
    return `tokens unavailable (no token figures in this response)`;
  }
  return `tokens ${parts.join(", ")}${suffix}`;
}

// A creation can only belong to this response when it names this workspace and
// this session identity: a record without a session, or with another agent's
// host, is never attributed. The response window is applied afterwards.
function belongsToSession(record, { workspace, sessionId }) {
  if (record.sessionId === null || record.sessionId !== sessionId) return false;
  if (record.host !== null && record.host !== undefined && record.host !== "copilot") return false;
  return canonicalWorkspace(record.workspace) === workspace;
}

function attributed(record, { fromMs, untilMs }) {
  const at = Date.parse(record.at);
  return at >= fromMs && at <= untilMs;
}

function tourPathOf(record, workspace) {
  return path.isAbsolute(record.tourPath) ? record.tourPath : path.resolve(workspace, record.tourPath);
}

async function workspaceRealPath(cwd) {
  if (typeof cwd !== "string" || !cwd) return undefined;
  try {
    const real = await fs.realpath(cwd);
    const stat = await fs.stat(real);
    return stat.isDirectory() ? canonicalWorkspace(real) : undefined;
  } catch {
    return undefined;
  }
}

async function readInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw new Error("input payload is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function reportResponse(input) {
  if (!input || typeof input !== "object") return;
  if (input.stop_hook_active === true || input.stopHookActive === true) return;
  const sessionId = typeof input.sessionId === "string" && input.sessionId ? input.sessionId : undefined;
  if (!sessionId) return;
  const untilMs = Number.isFinite(input.timestamp) ? input.timestamp : Date.now();
  const workspace = await workspaceRealPath(input.cwd);
  if (!workspace) return;

  const listed = await listCreations(workspace, untilMs);
  // Damage in the journal is worth one diagnostic; an absent one says nothing.
  for (const problem of listed.problems) diagnostic(`ignored creation record (${problem})`);
  // An ordinary conversation has no candidate at all: the transcript is not
  // read and no summary is printed.
  const candidates = listed.records.filter(record =>
    belongsToSession(record, { workspace, sessionId })
  );
  if (candidates.length === 0) return;

  const window = await readResponseWindow(input.transcriptPath, untilMs);
  if (!window.observed) {
    diagnostic(`tokens not observed (${window.reason})`);
    return;
  }
  if (await isReported(workspace, sessionId, window.fromMs)) return;

  const own = candidates.filter(record => attributed(record, { fromMs: window.fromMs, untilMs }));
  if (own.length === 0) return;

  const approximate = window.approximate ? " (approximate)" : "";
  report(`${own.length} ${own.length === 1 ? "Tour" : "Tours"} created in this response${approximate}`);
  for (const record of own) {
    report(`"${record.tourTitle}" — ${tourPathOf(record, workspace)}`);
  }
  report(usageLine(summarizeUsage(window.usageRecords), window.approximate));
  if (!(await markReported(workspace, sessionId, window.fromMs))) {
    diagnostic("could not mark the response as reported");
  }
}

async function main() {
  try {
    await reportResponse(await readInput());
  } catch (error) {
    // A malformed payload, an unavailable workspace or any storage failure is
    // a diagnostic; the conversation stops, untouched.
    diagnostic(`ignored stop (${error?.message || error})`);
  }
  process.stdout.write(`${JSON.stringify(HOOK_OUTPUT)}\n`);
}

await main();
