import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closingLine,
  continuationMessage,
  displayKey,
  isClosed,
  knowledgeClause,
  knowledgeDetailLines,
  selectContinuation,
} from "../packages/pi-plugin/lib/guard.mjs";
import {
  createRunState,
  isRunState,
  newRunId,
  readRunState,
  RUN_STATE_VERSION,
  writeRunState,
} from "../packages/pi-plugin/lib/run-log.mjs";

// The Pi consolidation guard and closing line. These are the pure decisions
// the extension applies at `agent_before_settle`: the same semantics as the
// Copilot agentStop hook, so the same state must produce the same verdict.

const WORKSPACE = "/workspace/with spaces";
const SESSION = "pi-session-1";

function state(overrides = {}) {
  const base = createRunState({
    runId: newRunId(),
    workspace: WORKSPACE,
    sessionId: SESSION,
    kind: "project",
    request: null,
    at: "2026-11-20T10:00:00.000Z",
  });
  return { ...base, ...overrides };
}

test("a created Tour without a closure is the one run a stop may close", () => {
  const created = state({ tourCreated: true });
  const selected = selectContinuation([created], { workspace: WORKSPACE, sessionId: SESSION });
  assert.equal(selected?.runId, created.runId);
});

test("an ordinary conversation, another session, another workspace or a closed run is inert", () => {
  const cases = [
    state({ tourCreated: false }),
    state({ tourCreated: true, sessionId: "other-session" }),
    state({ tourCreated: true, workspace: "/elsewhere" }),
    state({ tourCreated: true, consolidation: { status: "created", runId: "x", at: "now" } }),
    state({ tourCreated: true, consolidation: { status: "appended", runId: "x", at: "now", changed: ["dispatch_flow"] } }),
    state({ tourCreated: true, consolidation: { status: "replaced", runId: "x", at: "now" } }),
    state({ tourCreated: true, consolidation: { status: "replaced", runId: "x", at: "now", changed: ["dispatch_flow", "billing_flow"] } }),
    state({ tourCreated: true, consolidation: { status: "created", runId: "x", at: "now", created: ["new_flow"], changed: ["dispatch_flow"] } }),
    state({ tourCreated: true, consolidation: { status: "completed_zero", runId: "x", at: "now" } }),
    state({ tourCreated: true, consolidation: { status: "partial", runId: "x", at: "now" } }),
    state({ tourCreated: true, consolidation: { status: "failed", runId: "x", at: "now" } }),
    state({ tourCreated: true, consolidation: { status: "skipped", runId: "x", at: "now" } }),
    state({ tourCreated: true, continuationUsed: true }),
  ];
  for (const candidate of cases) {
    assert.equal(
      selectContinuation([candidate], { workspace: WORKSPACE, sessionId: SESSION }),
      null,
      `${JSON.stringify(candidate.consolidation)} / ${candidate.sessionId} / ${candidate.workspace} must be inert`
    );
  }
});

test("an expired run state never drives the guard", () => {
  const expired = state({ tourCreated: true, updatedAt: "2026-11-01T00:00:00.000Z", at: "2026-11-01T00:00:00.000Z" });
  const now = Date.parse("2026-11-20T00:00:00.000Z");
  assert.equal(selectContinuation([expired], { workspace: WORKSPACE, sessionId: SESSION, now }), null);
});

test("two open runs: the newest one wins, so one stop asks for one continuation", () => {
  const older = state({ tourCreated: true, updatedAt: "2026-11-20T10:00:00.000Z" });
  const newer = state({ tourCreated: true, updatedAt: "2026-11-20T11:00:00.000Z" });
  const selected = selectContinuation([older, newer], { workspace: WORKSPACE, sessionId: SESSION });
  assert.equal(selected?.runId, newer.runId);
});

test("the continuation message names the run and forbids inventing outcomes", () => {
  const run = state({ tourCreated: true });
  const message = continuationMessage(run);
  assert.match(message, new RegExp(`knowledge_save with runId "${run.runId}"`));
  assert.match(message, /knowledge_close_run/);
  assert.match(message, /Do not create the Tour again/);
  // It never restates the Tour method.
  assert.doesNotMatch(message, /Mermaid|anchor|step/i);
});

test("isClosed treats every recorded status as an assessment", () => {
  assert.equal(isClosed(state()), false);
  for (const status of ["created", "appended", "replaced", "completed_zero", "partial", "failed", "skipped"]) {
    assert.equal(isClosed(state({ consolidation: { status, runId: "x", at: "now" } })), true, status);
  }
});

// The closure of spec #232 carries `created` and `changed` name lists beside
// its status. The twin reads them verbatim and the guard treats any of them as
// an assessment, so a run with appended or rewritten entries never asks for a
// second continuation.
test("an appended or replaced closure carrying changed names is reported and closes the run", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-pi-guard-"));
  try {
    const workspace = realpathSync(root);
    const closures = [
      { status: "appended", changed: ["dispatch_flow"] },
      { status: "replaced", changed: ["dispatch_flow", "billing_flow"] },
      { status: "created", created: ["new_flow"], changed: ["dispatch_flow"] },
      { status: "partial", created: ["new_flow"], changed: ["dispatch_flow"], outcome: "conflict" },
    ];
    for (const closure of closures) {
      const base = state({ workspace, tourCreated: true });
      const run = {
        ...base,
        consolidation: { ...closure, runId: base.runId, at: "now" },
      };
      await writeRunState(workspace, run);
      const read = (await readRunState(workspace, run.runId)).state;
      assert.deepEqual(read.consolidation, run.consolidation, `${closure.status}: created and changed are kept`);
      assert.equal(isRunState(read), true, `${closure.status}: the twin accepts the closure format`);
      assert.equal(isClosed(read), true, `${closure.status}: the run is closed`);
      assert.equal(
        selectContinuation([read], { workspace, sessionId: SESSION }),
        null,
        `${closure.status}: no second continuation`
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the closing line carries the same Knowledge clause the Copilot hook appends", () => {
  const run = state({
    tourCreated: true,
    tourPath: ".tours/onboarding.tour",
    tourTitle: "Onboarding API",
    knowledge: {
      version: 1,
      observed: true,
      at: "2026-11-20T11:00:00.000Z",
      listings: 2,
      valid: ["billing-retry", "auth-refresh"],
      validTotal: 9,
      complete: false,
      invalid: [{ name: "stale-auth", reason: "proof_hash_mismatch" }],
      used: ["billing-retry"],
    },
  });
  assert.equal(
    knowledgeClause(run),
    "Knowledge 9 valid / 1 invalid, 1 used (billing-retry)"
  );
  assert.equal(
    closingLine(run),
    'CodeTour run ' + run.runId + ' "Onboarding API" (.tours/onboarding.tour) — Knowledge 9 valid / 1 invalid, 1 used (billing-retry)'
  );
  assert.deepEqual(knowledgeDetailLines(run), [
    "CodeTour knowledge invalid: stale-auth — proof_hash_mismatch",
  ]);
});

test("an absent or unobserved block omits the clause instead of claiming zero", () => {
  const run = state({ tourCreated: true, tourPath: ".tours/project.tour", tourTitle: "Project" });
  assert.equal(knowledgeClause(run), null);
  assert.deepEqual(knowledgeDetailLines(run), []);
  assert.equal(closingLine(run), `CodeTour run ${run.runId} "Project" (.tours/project.tour)`);
  assert.equal(
    knowledgeClause({ ...run, knowledge: { observed: false, reason: "no_listing" } }),
    null
  );
});

test("the inline list of used names is capped at ten and the state keeps them all", () => {
  const used = Array.from({ length: 13 }, (_, index) => `entry-${index}`);
  const run = state({
    tourCreated: true,
    knowledge: {
      version: 1,
      observed: true,
      at: "2026-11-20T11:00:00.000Z",
      listings: 1,
      valid: used,
      validTotal: 13,
      complete: true,
      invalid: [],
      used,
    },
  });
  assert.match(knowledgeClause(run), /13 used \(entry-0, .*entry-9 and 3 more\)$/);
});

test("displayKey ignores the timestamp so a repeated stop does not repeat the line", () => {
  const base = { observed: true, valid: ["a"], validTotal: 1, complete: true, invalid: [], used: [] };
  const first = state({ knowledge: { version: 1, listings: 1, at: "2026-11-20T10:00:00.000Z", ...base } });
  const second = state({ knowledge: { version: 1, listings: 1, at: "2026-11-20T12:00:00.000Z", ...base } });
  assert.equal(displayKey(first), displayKey(second));
});

test("a run state without the Knowledge block is still a valid Pi run state", () => {
  const run = state({ tourCreated: true });
  assert.equal(isRunState(run), true);
  assert.equal(run.version, RUN_STATE_VERSION);
  assert.equal(run.knowledge, undefined);
  assert.equal(isRunState({ ...run, knowledge: { anything: true } }), true);
});
