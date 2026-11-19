#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { listRunStates, updateRunState } from "../lib/run-log.mjs";

// Copilot agentStop guard for one CodeTour generation run.
//
// Deterministic, no model, no Knowledge write. It reads the run state the
// controlled generation entry point wrote and the consolidation closure the
// CodeTour MCP server persisted. It returns the Copilot hook decision on
// stdout:
//   {}                                  let the agent stop (the default)
//   {"decision":"block","reason":"..."} ask for ONE continuation
//
// Inert when: the conversation is not a CodeTour run for this session and
// workspace, the stop is already a hook-triggered re-entry, this run already
// used its continuation, the Tour was not created (nothing to consolidate) or
// any consolidation closure exists (created, completed_zero, partial, failed,
// skipped). Storage failures are diagnostics, never a block.

const MAX_INPUT_BYTES = 1024 * 1024;
const HOOK_OUTPUT = {};

function diagnostic(message) {
  // stderr is not the hook protocol channel; Copilot keeps it for the user.
  process.stderr.write(`CodeTour agentStop: ${message}\n`);
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

async function workspaceRealPath(cwd) {
  if (typeof cwd !== "string" || !cwd) return undefined;
  try {
    const real = await fs.realpath(cwd);
    const stat = await fs.stat(real);
    return stat.isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

// Any closure means the consolidation step was assessed; the hook never
// reopens a closed run. Zero creation (`completed_zero`) is deliberately a
// closure: it is not an omission.
function isClosed(state) {
  return state.consolidation !== null && state.consolidation !== undefined;
}

function continuationReason(state) {
  return [
    `Finish the CodeTour consolidation for run ${state.runId} before stopping.`,
    `The Tour was created, but no consolidation closure was recorded for this run.`,
    `Call knowledge_save with runId "${state.runId}" and the entries array (zero, one or more Knowledge entries).`,
    `If you deliberately cannot assess the run, call knowledge_close_run with runId "${state.runId}" and status "skipped".`,
    `Do not create the Tour again, do not invent Knowledge, and do not report persistence that the MCP did not confirm.`
  ].join(" ");
}

async function decide(input) {
  if (!input || typeof input !== "object") return HOOK_OUTPUT;
  if (input.stop_hook_active === true || input.stopHookActive === true) return HOOK_OUTPUT;
  const workspace = await workspaceRealPath(input.cwd);
  if (!workspace) return HOOK_OUTPUT;
  const sessionId = typeof input.sessionId === "string" && input.sessionId ? input.sessionId : undefined;
  if (!sessionId) return HOOK_OUTPUT;

  const listed = await listRunStates(workspace);
  for (const problem of listed.problems) diagnostic(`ignored run state (${problem})`);
  const candidates = listed.states.filter(state =>
    state.workspace === workspace &&
    state.sessionId === sessionId &&
    state.tourCreated === true &&
    !state.continuationUsed &&
    !isClosed(state)
  );
  if (candidates.length === 0) return HOOK_OUTPUT;

  // Two generations can be open for one session. One stop asks for at most one
  // continuation: the newest incomplete run is chosen and marked under the
  // cross-process lock, so a concurrent hook invocation cannot also block.
  const chosen = candidates[0];
  let result;
  try {
    result = await updateRunState(workspace, chosen.runId, state => {
      if (state.continuationUsed || isClosed(state) || state.tourCreated !== true) return null;
      return {
        ...state,
        continuationUsed: true,
        updatedAt: new Date().toISOString()
      };
    });
  } catch (error) {
    // A failed mark must not block: without the mark the one-continuation
    // bound cannot be guaranteed, so the safe answer is to let the agent stop.
    diagnostic(`could not record the continuation (${error?.message || error})`);
    return HOOK_OUTPUT;
  }
  if (!result.updated) {
    if (result.reason && result.reason !== "noop") diagnostic(`could not record the continuation (${result.reason})`);
    return HOOK_OUTPUT;
  }
  return { decision: "block", reason: continuationReason(result.state) };
}

async function main() {
  let output = HOOK_OUTPUT;
  try {
    output = await decide(await readInput());
  } catch (error) {
    // Malformed payload or an unavailable workspace: never block a
    // conversation the hook cannot attribute to a CodeTour run.
    diagnostic(`ignored stop (${error?.message || error})`);
    output = HOOK_OUTPUT;
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

await main();
