import { isExpired, sameWorkspace } from "./run-log.mjs";

// The bounded consolidation guard and the closing line of a Pi run.
//
// Pure decisions, no I/O beyond what the caller passes in, so the guard can be
// tested without a Pi session. The semantics are the Copilot agentStop hook's:
// one continuation per run, only for a run of this session and workspace, only
// when a Tour exists and no closure was recorded.

/** Any closure means the consolidation step was assessed. */
export function isClosed(state) {
  return state.consolidation !== null && state.consolidation !== undefined;
}

/**
 * The run this stop may ask to close, or null.
 *
 * The newest incomplete run wins: two generations can be open for one session,
 * and one stop asks for at most one continuation.
 */
export function selectContinuation(states, { workspace, sessionId, now = Date.now() }) {
  const candidates = states
    .filter(
      state =>
        sameWorkspace(state.workspace, workspace) &&
        state.sessionId === sessionId &&
        state.tourCreated === true &&
        state.continuationUsed !== true &&
        !isClosed(state) &&
        !isExpired(state, now)
    )
    .sort(
      (left, right) =>
        (Date.parse(right.updatedAt || right.at) || 0) - (Date.parse(left.updatedAt || left.at) || 0)
    );
  return candidates[0] ?? null;
}

/** The single continuation message; it never restates the Tour method. */
export function continuationMessage(state) {
  return [
    `Finish the CodeTour consolidation for run ${state.runId} before stopping.`,
    "The Tour was created, but no consolidation closure was recorded for this run.",
    `Call knowledge_save with runId "${state.runId}" and the entries array (zero, one or more Knowledge entries).`,
    `If you deliberately cannot assess the run, call knowledge_close_run with runId "${state.runId}" and status "skipped".`,
    "Do not create the Tour again, do not invent Knowledge, and do not report persistence that the MCP did not confirm."
  ].join(" ");
}

/** A bounded list of names: the closing line stays readable, the state keeps all. */
export const KNOWLEDGE_NAME_LIMIT = 10;

function formatNames(names) {
  const shown = names.slice(0, KNOWLEDGE_NAME_LIMIT);
  const remaining = names.length - shown.length;
  return remaining > 0 ? `${shown.join(", ")} and ${remaining} more` : shown.join(", ");
}

/**
 * The Knowledge clause of the closing line (ADR 0045). This is the same text
 * the Copilot hook appends to its stderr line; an absent or unobserved block
 * omits the clause instead of claiming an empty catalogue.
 */
export function knowledgeClause(state) {
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
  const usedText = used.length === 0 ? "0 used" : `${used.length} used (${formatNames(used)})`;
  return `Knowledge ${total} valid / ${invalid.length} invalid, ${usedText}`;
}

/** One line per invalid entry: a list of actions must be complete. */
export function knowledgeDetailLines(state) {
  const knowledge = state?.knowledge;
  if (!knowledge || knowledge.observed !== true) return [];
  if (!Array.isArray(knowledge.invalid)) return [];
  return knowledge.invalid
    .filter(entry => entry && typeof entry.name === "string")
    .map(entry => {
      const reason = typeof entry.reason === "string" ? entry.reason : "invalid";
      return `CodeTour knowledge invalid: ${entry.name} — ${reason}`;
    });
}

/** `CodeTour run <id> "<title>" (<path>) — <clause>`; the clause may be absent. */
export function closingLine(state) {
  const title =
    typeof state.tourTitle === "string" && state.tourTitle
      ? state.tourTitle
      : state.tourPath
        ? state.tourPath.split("/").pop()
        : null;
  const label = [title ? `"${title}"` : null, state.tourPath ? `(${state.tourPath})` : null]
    .filter(Boolean)
    .join(" ");
  const clause = knowledgeClause(state);
  return `CodeTour run ${state.runId}${label ? ` ${label}` : ""}${clause ? ` — ${clause}` : ""}`;
}

/** Stable identity of a run's displayed facts, to avoid repeating the line. */
export function displayKey(state) {
  const knowledge = state?.knowledge;
  if (!knowledge || typeof knowledge !== "object") return "";
  const copy = JSON.parse(JSON.stringify(knowledge));
  delete copy.at;
  return JSON.stringify(copy);
}
