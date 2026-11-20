#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  collectSessionUsage,
  listRunStates,
  recordRunMetrics,
  summarizeRunUsage,
  updateRunState
} from "../lib/run-log.mjs";

// Copilot agentStop guard for one CodeTour generation run.
//
// Deterministic, no model, no Knowledge write. It reads the run state the
// controlled generation entry point wrote and the consolidation closure the
// CodeTour MCP server persisted. It returns the Copilot hook decision on
// stdout:
//   {}                                  let the agent stop (the default)
//   {"decision":"block","reason":"..."} ask for ONE continuation
//
// Besides the guard decision, every stop that matches a CodeTour run of this
// session records one usage snapshot (spec #223 observability) into the run
// state's metrics: model, project state, calls, tokens and cache split into
// generation and consolidation, built from the Copilot session usage records.
// The snapshot never feeds the decision, never reports a Tour or Knowledge
// outcome, and an unreadable session events file is a diagnostic, not a block.
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

// The user-facing usage line. Also stderr, so it never enters the hook
// protocol, and never influences the decision.
function report(message) {
  process.stderr.write(`CodeTour usage: ${message}\n`);
}

// Invalid Knowledge entries are a list of actions, so they are always printed
// in full, one line each, with the machine-readable reason only (ADR 0044).
function reportKnowledgeDetails(state) {
  const knowledge = state?.knowledge;
  if (!knowledge || knowledge.observed !== true) return;
  if (!Array.isArray(knowledge.invalid)) return;
  for (const entry of knowledge.invalid) {
    if (!entry || typeof entry.name !== "string") continue;
    const reason = typeof entry.reason === "string" ? entry.reason : "invalid";
    process.stderr.write(`CodeTour knowledge invalid: ${entry.name} — ${reason}\n`);
  }
}

const tokens = new Intl.NumberFormat("en-GB");

function formatTokens(usage) {
  const input = tokens.format(usage.inputTokens || 0);
  const output = tokens.format(usage.outputTokens || 0);
  const cached = usage.cacheReadTokens || 0;
  return `${input} in / ${output} out${cached > 0 ? ` (${tokens.format(cached)} cached)` : ""}`;
}

// One readable summary per run: the Tour that was created, its path, the
// generation and consolidation token phases, and the run total. Unobservable
// usage is reported as such instead of being omitted.
function usageReport(state, summary) {
  const title =
    typeof state.tourTitle === "string" && state.tourTitle
      ? state.tourTitle
      : state.tourPath
        ? path.basename(state.tourPath)
        : null;
  const label = [title ? `"${title}"` : null, state.tourPath ? `(${state.tourPath})` : null]
    .filter(Boolean)
    .join(" ");
  const prefix = `run ${state.runId}${label ? ` ${label}` : ""}`;
  const knowledge = knowledgeClause(state);
  if (summary.observed !== true) {
    const reason = `usage not observed (${summary.reason || "unavailable"})`;
    return `${prefix} — ${[reason, knowledge].filter(Boolean).join("; ")}`;
  }
  const parts = [`generation ${formatTokens(summary.windows.generation)}`];
  if (summary.windows.consolidation) {
    parts.push(`consolidation ${formatTokens(summary.windows.consolidation)}`);
  }
  parts.push(`total ${formatTokens(summary.totals)}`);
  if (knowledge) parts.push(knowledge);
  if (summary.model) parts.push(summary.model);
  return `${prefix} — ${parts.join("; ")}`;
}

// A bounded list of names, because a catalogue can be large while the line
// stays readable; the run state keeps every name.
const KNOWLEDGE_NAME_LIMIT = 10;

function formatNames(names) {
  const shown = names.slice(0, KNOWLEDGE_NAME_LIMIT);
  const remaining = names.length - shown.length;
  return remaining > 0 ? `${shown.join(", ")} and ${remaining} more` : shown.join(", ");
}

// The Knowledge clause of the closing line (ADR 0045). It reports what the
// run's own discovery verified and what it actually read; an absent or
// unobserved block omits the clause instead of claiming an empty catalogue.
function knowledgeClause(state) {
  const knowledge = state?.knowledge;
  if (!knowledge || typeof knowledge !== "object" || knowledge.observed !== true) {
    return null;
  }
  const names = value =>
    Array.isArray(value) ? value.filter(name => typeof name === "string") : [];
  const valid = names(knowledge.valid);
  const invalid = Array.isArray(knowledge.invalid)
    ? knowledge.invalid.filter(entry => entry && typeof entry.name === "string")
    : [];
  const used = names(knowledge.used);
  const total =
    Number.isInteger(knowledge.validTotal) && knowledge.validTotal >= valid.length
      ? knowledge.validTotal
      : valid.length;
  const usedText =
    used.length === 0 ? "0 used" : `${used.length} used (${formatNames(used)})`;
  return `Knowledge ${total} valid / ${invalid.length} invalid, ${usedText}`;
}

// The Knowledge sets move independently of the token figures: a listing or a
// read changes them while the windows stay still. The line is printed when
// either side changed, never on every stop.
function knowledgeChanged(previous, next) {
  const stable = knowledge => {
    if (!knowledge || typeof knowledge !== "object") return "";
    const copy = JSON.parse(JSON.stringify(knowledge));
    delete copy.at;
    return JSON.stringify(copy);
  };
  return stable(previous) !== stable(next);
}

// The newest snapshot replaces the previous one, so the line is printed only
// when the figures actually changed: observability must not become a chorus on
// every stop of a long conversation.
function usageChanged(previous, next) {
  if (!previous || typeof previous !== "object") return true;
  const stable = usage => {
    if (!usage || typeof usage !== "object") return "";
    const copy = JSON.parse(JSON.stringify(usage));
    delete copy.observedAt;
    for (const window of [copy.windows?.generation, copy.windows?.consolidation]) {
      // The stop time moves on every call; the figures are what matters.
      if (window) delete window.untilAt;
    }
    return JSON.stringify(copy);
  };
  return stable(previous) !== stable(next);
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

// Record the usage snapshot for every Generation Run of this session in this
// workspace (spec #223 observability). This is a recomputation from Copilot's
// own session usage records, never an accumulation: the newest snapshot at
// the newest stop replaces the previous one. The windows cannot be attributed
// more finely than the record timestamps allow, so values are reported with
// their boundaries instead of being claimed as exact per-runId consumption.
// Nothing here influences the guard: any failure is a diagnostic.
async function recordUsageMetrics(workspace, sessionId, states) {
  const mine = states
    .filter(state => state.workspace === workspace && state.sessionId === sessionId)
    .sort((left, right) => (Date.parse(left.at) || 0) - (Date.parse(right.at) || 0));
  if (mine.length === 0) return;
  const session = await collectSessionUsage(sessionId);
  const stopAt = new Date().toISOString();
  for (let index = 0; index < mine.length; index++) {
    const summary = summarizeRunUsage(session, {
      runAt: mine[index].at,
      stopAt,
      nextRunAt: index + 1 < mine.length ? mine[index + 1].at : null
    });
    try {
      const recorded = await recordRunMetrics(workspace, mine[index].runId, {usage: summary});
      if (!recorded.updated && recorded.reason && recorded.reason !== "noop") {
        diagnostic(`usage metrics not updated (${recorded.reason})`);
      }
      const nextState = recorded.state || mine[index];
      if (
        recorded.updated &&
        mine[index].tourCreated === true &&
        (usageChanged(mine[index].metrics?.usage, summary) ||
          knowledgeChanged(mine[index].knowledge, nextState.knowledge))
      ) {
        report(usageReport(nextState, summary));
        reportKnowledgeDetails(nextState);
      }
    } catch (error) {
      diagnostic(`could not record usage metrics (${error?.message || error})`);
    }
  }
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
  await recordUsageMetrics(workspace, sessionId, listed.states);
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
