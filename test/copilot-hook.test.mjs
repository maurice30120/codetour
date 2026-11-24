import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createRunState,
  listRunStates,
  runLogDirectory,
  runStatePath
} from "../packages/copilot-plugin/com.github.copilot/lib/run-log.mjs";

const hook = path.resolve("packages/copilot-plugin/com.github.copilot/hooks/agent-stop.mjs");

function workspaceWithSpaces() {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-hook-"));
  const workspace = path.join(root, "work space");
  mkdirSync(workspace, { recursive: true });
  return { root, workspace };
}

function writeState(workspace, overrides = {}) {
  const base = createRunState({
    runId: "run-0123456789abcdef",
    workspace: realpathSync(workspace),
    sessionId: "session-a",
    kind: "project",
    request: "generate project Explique le flux."
  });
  const state = { ...base, ...overrides };
  mkdirSync(runLogDirectory(workspace), { recursive: true });
  writeFileSync(runStatePath(workspace, state.runId), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

function payload(overrides = {}) {
  return {
    sessionId: "session-a",
    timestamp: Date.now(),
    cwd: overrides.cwd,
    transcriptPath: "/tmp/transcript.jsonl",
    stopReason: "end_turn",
    stop_hook_active: false,
    ...overrides
  };
}

function runHook(input) {
  const result = spawnSync(process.execPath, [hook], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    timeout: 20000
  });
  assert.equal(result.status, 0, result.stderr);
  return { output: JSON.parse(result.stdout), stderr: result.stderr };
}

function readState(workspace, runId) {
  return JSON.parse(readFileSync(runStatePath(workspace, runId), "utf8"));
}

test("an ordinary conversation is inert with no run state", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    assert.deepEqual(runHook(payload({ cwd: workspace })).output, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a run belonging to another session or workspace is inert", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    writeState(workspace);
    assert.deepEqual(runHook(payload({ cwd: workspace, sessionId: "session-b" })).output, {});
    assert.deepEqual(runHook(payload({ cwd: path.join(root, "other workspace") })).output, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed payloads and an unreadable workspace never block", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    writeState(workspace);
    for (const input of ["not json", "", "null", JSON.stringify({ sessionId: "session-a" })]) {
      assert.deepEqual(runHook(input).output, {});
    }
    assert.deepEqual(runHook(payload({ cwd: path.join(workspace, "missing") })).output, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stop_hook_active lets the agent stop and leaves the run untouched", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const state = writeState(workspace, { tourCreated: true });
    assert.deepEqual(runHook(payload({ cwd: workspace, stop_hook_active: true })).output, {});
    assert.deepEqual(
      runHook(payload({ cwd: workspace, stopHookActive: true })).output,
      {},
      "the SDK spelling is honored too"
    );
    assert.equal(readState(workspace, state.runId).continuationUsed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a run without a created Tour is inert", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    writeState(workspace, { tourCreated: false });
    assert.deepEqual(runHook(payload({ cwd: workspace })).output, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const status of ["created", "appended", "replaced", "completed_zero", "partial", "failed", "skipped"]) {
  test(`a ${status} consolidation closure is inert`, () => {
    const { root, workspace } = workspaceWithSpaces();
    try {
      const state = writeState(workspace, {
        tourCreated: true,
        consolidation: { status, runId: "run-0123456789abcdef", at: new Date().toISOString() }
      });
      assert.deepEqual(runHook(payload({ cwd: workspace })).output, {});
      assert.equal(readState(workspace, state.runId).continuationUsed, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// The closure of spec #232 carries `created` and `changed` name lists beside
// its status. Both are assessments, so the hook never asks for a second
// continuation and the twin reports the closure exactly as the MCP wrote it.
test("an appended or replaced closure carrying changed names closes the run", async () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const closures = [
      { status: "appended", changed: ["dispatch_flow"] },
      { status: "replaced", changed: ["dispatch_flow", "billing_flow"] },
      { status: "created", created: ["new_flow"], changed: ["dispatch_flow"] },
      { status: "partial", created: ["new_flow"], changed: ["dispatch_flow"], outcome: "conflict" }
    ];
    for (const closure of closures) {
      const state = writeState(workspace, {
        tourCreated: true,
        consolidation: { ...closure, runId: "run-0123456789abcdef", at: new Date().toISOString() }
      });
      assert.deepEqual(runHook(payload({ cwd: workspace })).output, {}, closure.status);
      const after = readState(workspace, state.runId);
      assert.equal(after.continuationUsed, false, `${closure.status}: no continuation is used`);
      assert.deepEqual(after.consolidation, state.consolidation, `${closure.status}: the closure is reported as recorded`);
      const [listed] = (await listRunStates(workspace)).states;
      assert.deepEqual(listed.consolidation, state.consolidation, `${closure.status}: the twin reports created and changed`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a created Tour finishes without a consolidation continuation", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const state = writeState(workspace, { tourCreated: true, tourPath: ".tours/project.tour" });
    assert.deepEqual(runHook(payload({ cwd: workspace })).output, {});
    assert.equal(readState(workspace, state.runId).continuationUsed, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("storage failures and corrupt state never block and never throw", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    // The run log location is a file instead of a directory.
    mkdirSync(path.join(workspace, ".tours"), { recursive: true });
    writeFileSync(runLogDirectory(workspace), "not a directory\n");
    const blocked = runHook(payload({ cwd: workspace }));
    assert.deepEqual(blocked.output, {});
    assert.match(blocked.stderr, /run log directory|ignored/);

    // A malformed state document is reported and ignored.
    rmSync(runLogDirectory(workspace), { force: true });
    mkdirSync(runLogDirectory(workspace), { recursive: true });
    writeFileSync(path.join(runLogDirectory(workspace), "codetour-run-run-eeeeeeeeeeeeeeee.json"), "{not json");
    const corrupt = runHook(payload({ cwd: workspace }));
    assert.deepEqual(corrupt.output, {});
    assert.match(corrupt.stderr, /malformed/);

    // An unwritable run directory cannot record the continuation, so the hook
    // lets the agent stop instead of blocking without its bound. Windows has
    // no directory mode a process cannot write to: the platform property the
    // case rests on does not exist there.
    if (process.platform !== "win32") {
      const state = writeState(workspace, { tourCreated: true });
      chmodSync(runLogDirectory(workspace), 0o555);
      const unwritable = runHook(payload({ cwd: workspace }));
      assert.deepEqual(unwritable.output, {});
      assert.equal(readState(workspace, state.runId).continuationUsed, false);
      chmodSync(runLogDirectory(workspace), 0o755);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the run log enumerates only well-formed, unexpired state files", async () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    writeState(workspace, { runId: "run-ffffffffffffffff", tourCreated: true });
    writeFileSync(path.join(runLogDirectory(workspace), "foreign.json"), "{}");
    writeFileSync(path.join(runLogDirectory(workspace), "codetour-run-broken.json"), "{}");
    const listed = await listRunStates(workspace);
    assert.equal(listed.states.length, 1);
    assert.equal(listed.states[0].runId, "run-ffffffffffffffff");
    assert.equal(listed.problems.length, 1);
    assert.match(listed.problems[0], /broken/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeSessionEvents(directory, sessionId, events) {
  const sessionDirectory = path.join(directory, sessionId);
  mkdirSync(sessionDirectory, { recursive: true });
  writeFileSync(
    path.join(sessionDirectory, "events.jsonl"),
    events.map(event => JSON.stringify(event)).join("\n") + "\n"
  );
  return sessionDirectory;
}

// Usage fixtures follow the Copilot CLI 1.0.114 session events format
// observed in real runs (~/.copilot/session-state/<sessionId>/events.jsonl):
// one JSON object per line with a top-level type, data and timestamp.
function sessionEventsFixture({ runAt, generationAt, tourAt, consolidationAt, beforeAt }) {
  return [
    {
      type: "session.start",
      id: "event-start",
      data: {
        sessionId: "session-a",
        version: 1,
        copilotVersion: "1.0.114",
        context: {
          cwd: "/tmp/whatever",
          branch: "spec-223-integration",
          headCommit: "9ef32c823585261377d1e767ac0da4637e16213b"
        }
      }
    },
    {
      type: "session.usage_record",
      id: "event-before",
      timestamp: beforeAt,
      data: { usage: { model: "gpt-5-mini", inputTokens: 1000, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, duration: 100 } }
    },
    {
      type: "session.usage_record",
      id: "event-generation",
      timestamp: generationAt,
      data: { usage: { model: "claude-sonnet-5.5", inputTokens: 364887, outputTokens: 123, cacheReadTokens: 305382, cacheWriteTokens: 59489, reasoningTokens: 0, duration: 4000 } }
    },
    {
      type: "tool.execution_start",
      id: "event-create-start",
      timestamp: new Date(Date.parse(tourAt) - 2000).toISOString(),
      data: { toolCallId: "call-1", toolName: "codetour-create_project_tour", model: "claude-sonnet-5.5" }
    },
    {
      type: "tool.execution_complete",
      id: "event-create-complete",
      timestamp: tourAt,
      data: { toolCallId: "call-1", model: "claude-sonnet-5.5", success: true }
    },
    {
      type: "session.usage_record",
      id: "event-consolidation",
      timestamp: consolidationAt,
      data: { usage: { model: "claude-sonnet-5.5", inputTokens: 124662, outputTokens: 307, cacheReadTokens: 121669, cacheWriteTokens: 2989, reasoningTokens: 0, duration: 800 } }
    },
    {
      type: "tool.execution_start",
      id: "event-save-start",
      timestamp: consolidationAt,
      data: { toolCallId: "call-2", toolName: "codetour-knowledge_save", model: "claude-sonnet-5.5" }
    },
    {
      type: "tool.execution_complete",
      id: "event-save",
      timestamp: new Date(Date.parse(consolidationAt) + 1000).toISOString(),
      data: { toolCallId: "call-2", success: true }
    }
  ];
}

test("a stop matching a session run records the usage snapshot with its phases", () => {
  const { root, workspace } = workspaceWithSpaces();
  const sessions = mkdtempSync(path.join(os.tmpdir(), "codetour-hook-events-"));
  const previousStateDir = process.env.CODETOUR_COPILOT_SESSION_STATE_DIR;
  process.env.CODETOUR_COPILOT_SESSION_STATE_DIR = sessions;
  try {
    const now = Date.now();
    const runAt = new Date(now - 120000).toISOString();
    const beforeAt = new Date(now - 3600000).toISOString();
    const state = writeState(workspace, {
      at: runAt,
      tourCreated: true,
      consolidation: { status: "completed_zero", runId: "run-0123456789abcdef", at: new Date(now - 15000).toISOString() }
    });
    writeSessionEvents(sessions, "session-a", sessionEventsFixture({
      runAt,
      beforeAt,
      generationAt: new Date(now - 90000).toISOString(),
      tourAt: new Date(now - 60000).toISOString(),
      consolidationAt: new Date(now - 30000).toISOString()
    }));
    const result = runHook(payload({ cwd: workspace }));
    assert.deepEqual(result.output, {}, "a closed run still lets the agent stop");
    const recorded = readState(workspace, state.runId).metrics;
    assert.equal(recorded.version, 1);
    const usage = recorded.usage;
    assert.equal(usage.observed, true);
    assert.equal(usage.source, "copilot-session-events-v1");
    assert.equal(usage.model, "claude-sonnet-5.5");
    assert.equal(usage.copilotVersion, "1.0.114");
    assert.equal(usage.projectState.headCommit, "9ef32c823585261377d1e767ac0da4637e16213b");
    // Records before the run stay out of the run's sums.
    assert.equal(usage.totals.records, 2);
    assert.equal(usage.totals.inputTokens, 364887 + 124662);
    assert.equal(usage.totals.outputTokens, 123 + 307);
    assert.equal(usage.totals.durationMs, 4000 + 800);
    assert.deepEqual(usage.calls, {successful: {create_project_tour: 1, knowledge_save: 1}, refused: {}});
    assert.equal(usage.windows.boundaryObserved, true);
    assert.equal(usage.windows.generation.fromAt, runAt);
    assert.equal(usage.windows.generation.inputTokens, 364887, "input tokens include the cached reads the session reported");
    assert.equal(usage.windows.generation.cacheReadTokens, 305382);
    assert.equal(usage.windows.generation.records, 1);
    assert.equal(usage.windows.consolidation.inputTokens, 124662);
    assert.equal(usage.windows.consolidation.cacheWriteTokens, 2989);
    assert.equal(usage.windows.consolidation.outputTokens, 307);
  } finally {
    if (previousStateDir === undefined) delete process.env.CODETOUR_COPILOT_SESSION_STATE_DIR; else process.env.CODETOUR_COPILOT_SESSION_STATE_DIR = previousStateDir;
    rmSync(root, { recursive: true, force: true });
    rmSync(sessions, { recursive: true, force: true });
  }
});

test("a created Tour reports its name and consumed tokens on stderr", () => {
  const { root, workspace } = workspaceWithSpaces();
  const sessions = mkdtempSync(path.join(os.tmpdir(), "codetour-hook-events-report-"));
  const previousStateDir = process.env.CODETOUR_COPILOT_SESSION_STATE_DIR;
  process.env.CODETOUR_COPILOT_SESSION_STATE_DIR = sessions;
  try {
    const now = Date.now();
    const runAt = new Date(now - 120000).toISOString();
    writeState(workspace, {
      at: runAt,
      tourCreated: true,
      tourPath: ".tours/changes.tour",
      tourTitle: "Revue critique des changements",
      consolidation: { status: "completed_zero", runId: "run-0123456789abcdef", at: new Date(now - 15000).toISOString() }
    });
    writeSessionEvents(sessions, "session-a", sessionEventsFixture({
      runAt,
      beforeAt: new Date(now - 3600000).toISOString(),
      generationAt: new Date(now - 90000).toISOString(),
      tourAt: new Date(now - 60000).toISOString(),
      consolidationAt: new Date(now - 30000).toISOString()
    }));
    const first = runHook(payload({ cwd: workspace }));
    assert.deepEqual(first.output, {});
    assert.match(
      first.stderr,
      /CodeTour usage: run run-0123456789abcdef "Revue critique des changements" \(\.tours\/changes\.tour\)/
    );
    assert.match(first.stderr, /generation 364,887 in \/ 123 out \(305,382 cached\)/);
    assert.match(first.stderr, /consolidation 124,662 in \/ 307 out \(121,669 cached\)/);
    assert.match(first.stderr, /total 489,549 in \/ 430 out \(427,051 cached\)/);
    assert.match(first.stderr, /claude-sonnet-5\.5/);
    // The newest stop recomputes the same figures: the line is not repeated.
    const second = runHook(payload({ cwd: workspace }));
    assert.deepEqual(second.output, {});
    assert.equal((second.stderr.match(/CodeTour usage:/g) || []).length, 0);
  } finally {
    if (previousStateDir === undefined) delete process.env.CODETOUR_COPILOT_SESSION_STATE_DIR; else process.env.CODETOUR_COPILOT_SESSION_STATE_DIR = previousStateDir;
    rmSync(root, { recursive: true, force: true });
    rmSync(sessions, { recursive: true, force: true });
  }
});

test("the closing line reports the Knowledge sets and never changes the decision", () => {
  const { root, workspace } = workspaceWithSpaces();
  const sessions = mkdtempSync(path.join(os.tmpdir(), "codetour-hook-events-knowledge-"));
  const previousStateDir = process.env.CODETOUR_COPILOT_SESSION_STATE_DIR;
  process.env.CODETOUR_COPILOT_SESSION_STATE_DIR = sessions;
  try {
    // A closed run is inert for the guard: this test proves the additive
    // Knowledge clause is built from the run state, not from the decision.
    writeState(workspace, {
      tourCreated: true,
      tourPath: ".tours/project.tour",
      tourTitle: "Tour du projet",
      consolidation: { status: "created", runId: "run-0123456789abcdef", at: new Date().toISOString() },
      knowledge: {
        version: 1,
        observed: true,
        at: new Date().toISOString(),
        listings: 2,
        valid: ["billing-retry", "auth-refresh"],
        validTotal: 9,
        complete: false,
        invalid: [{ name: "stale-auth", reason: "proof_hash_mismatch" }],
        used: ["billing-retry", "auth-refresh"]
      }
    });
    const first = runHook(payload({ cwd: workspace }));
    assert.deepEqual(first.output, {});
    assert.match(first.stderr, /Knowledge 9 valid \/ 1 invalid, 2 used \(billing-retry, auth-refresh\)/);
    // Invalid entries are a list of actions: always complete, with the reason.
    assert.match(first.stderr, /CodeTour knowledge invalid: stale-auth — proof_hash_mismatch/);
    const second = runHook(payload({ cwd: workspace }));
    assert.deepEqual(second.output, {});
    assert.equal((second.stderr.match(/CodeTour usage:/g) || []).length, 0);
    assert.equal((second.stderr.match(/CodeTour knowledge invalid:/g) || []).length, 0);
  } finally {
    if (previousStateDir === undefined) delete process.env.CODETOUR_COPILOT_SESSION_STATE_DIR; else process.env.CODETOUR_COPILOT_SESSION_STATE_DIR = previousStateDir;
    rmSync(root, { recursive: true, force: true });
    rmSync(sessions, { recursive: true, force: true });
  }
});

test("an unobserved usage snapshot is reported as such, never omitted", () => {
  const { root, workspace } = workspaceWithSpaces();
  const sessions = mkdtempSync(path.join(os.tmpdir(), "codetour-hook-events-unobserved-"));
  const previousStateDir = process.env.CODETOUR_COPILOT_SESSION_STATE_DIR;
  process.env.CODETOUR_COPILOT_SESSION_STATE_DIR = sessions;
  try {
    writeState(workspace, {
      tourCreated: true,
      tourPath: ".tours/project.tour",
      tourTitle: "Project Overview",
      continuationUsed: true
    });
    const result = runHook(payload({ cwd: workspace }));
    assert.deepEqual(result.output, {});
    assert.match(
      result.stderr,
      /CodeTour usage: run run-0123456789abcdef "Project Overview" \(\.tours\/project\.tour\) — usage not observed \(missing\)/
    );
  } finally {
    if (previousStateDir === undefined) delete process.env.CODETOUR_COPILOT_SESSION_STATE_DIR; else process.env.CODETOUR_COPILOT_SESSION_STATE_DIR = previousStateDir;
    rmSync(root, { recursive: true, force: true });
    rmSync(sessions, { recursive: true, force: true });
  }
});

test("another run of the same session bounds the first run's usage window", () => {

  const { root, workspace } = workspaceWithSpaces();
  const sessions = mkdtempSync(path.join(os.tmpdir(), "codetour-hook-events-"));
  const previousStateDir = process.env.CODETOUR_COPILOT_SESSION_STATE_DIR;
  process.env.CODETOUR_COPILOT_SESSION_STATE_DIR = sessions;
  try {
    const now = Date.now();
    const firstAt = new Date(now - 120000).toISOString();
    const secondAt = new Date(now - 60000).toISOString();
    const first = writeState(workspace, { runId: "run-aaaaaaaaaaaaaaaa", at: firstAt });
    const second = writeState(workspace, {
      runId: "run-bbbbbbbbbbbbbbbb",
      at: secondAt,
      tourCreated: true,
      consolidation: { status: "completed_zero", runId: "run-bbbbbbbbbbbbbbbb", at: secondAt }
    });
    writeSessionEvents(sessions, "session-a", [
      ...sessionEventsFixture({
        runAt: firstAt,
        beforeAt: new Date(now - 3600000).toISOString(),
        generationAt: new Date(now - 120000 + 10000).toISOString(),
        tourAt: new Date(now - 120000 + 20000).toISOString(),
        consolidationAt: new Date(now - 120000 + 30000).toISOString()
      }).filter(event => event.id !== "event-save"),
      {
        type: "session.usage_record",
        id: "event-second-run",
        timestamp: new Date(now - 60000 + 10000).toISOString(),
        data: { usage: { model: "claude-sonnet-5.5", inputTokens: 400, outputTokens: 20, cacheReadTokens: 380, cacheWriteTokens: 10, reasoningTokens: 0, duration: 700 } }
      },
      {
        type: "tool.execution_complete",
        id: "event-second-save",
        timestamp: new Date(now - 40000).toISOString(),
        data: { toolCallId: "call-3", toolName: "codetour-knowledge_save", success: true }
      }
    ]);
    runHook(payload({ cwd: workspace }));
    const firstUsage = readState(workspace, first.runId).metrics.usage;
    assert.equal(firstUsage.totals.inputTokens, 364887 + 124662, "the first run's window stops before the second run starts");
    assert.equal(firstUsage.windows.boundaryObserved, true);
    assert.ok(firstUsage.windows.consolidation, "the first run observed its Tour creation boundary");
    const secondUsage = readState(workspace, second.runId).metrics.usage;
    assert.equal(secondUsage.totals.inputTokens, 400);
    assert.equal(secondUsage.windows.boundaryObserved, false, "no Tour creation completion is claimed for a run that has none");
    assert.equal(secondUsage.windows.consolidation, null);
    assert.equal(secondUsage.windows.generation.inputTokens, 400, "without a boundary the window stays entirely in generation");
  } finally {
    if (previousStateDir === undefined) delete process.env.CODETOUR_COPILOT_SESSION_STATE_DIR; else process.env.CODETOUR_COPILOT_SESSION_STATE_DIR = previousStateDir;
    rmSync(root, { recursive: true, force: true });
    rmSync(sessions, { recursive: true, force: true });
  }
});

test("an unavailable session events file records an explicit unobserved report", () => {
  const { root, workspace } = workspaceWithSpaces();
  const sessions = mkdtempSync(path.join(os.tmpdir(), "codetour-hook-events-empty-"));
  const previousStateDir = process.env.CODETOUR_COPILOT_SESSION_STATE_DIR;
  process.env.CODETOUR_COPILOT_SESSION_STATE_DIR = sessions;
  try {
    const state = writeState(workspace, { tourCreated: true });
    // The guard still asks for the missing consolidation while the usage
    // snapshot cannot be observed.
    const blocked = runHook(payload({ cwd: workspace }));
    assert.deepEqual(blocked.output, {});
    const usage = readState(workspace, state.runId).metrics.usage;
    assert.equal(usage.observed, false);
    assert.equal(usage.reason, "missing");
    assert.match(usage.file, /events\.jsonl$/);
    // After the marked continuation the run lets the agent stop.
    const second = runHook(payload({ cwd: workspace }));
    assert.deepEqual(second.output, {});
  } finally {
    if (previousStateDir === undefined) delete process.env.CODETOUR_COPILOT_SESSION_STATE_DIR; else process.env.CODETOUR_COPILOT_SESSION_STATE_DIR = previousStateDir;
    rmSync(root, { recursive: true, force: true });
    rmSync(sessions, { recursive: true, force: true });
  }
});

test("malformed session events lose only the metrics, never the guard", () => {
  const { root, workspace } = workspaceWithSpaces();
  const sessions = mkdtempSync(path.join(os.tmpdir(), "codetour-hook-events-noise-"));
  const previousStateDir = process.env.CODETOUR_COPILOT_SESSION_STATE_DIR;
  process.env.CODETOUR_COPILOT_SESSION_STATE_DIR = sessions;
  try {
    const now = Date.now();
    const runAt = new Date(now - 120000).toISOString();
    const state = writeState(workspace, {
      at: runAt,
      tourCreated: true,
      consolidation: { status: "completed_zero", runId: "run-0123456789abcdef", at: new Date(now - 15000).toISOString() }
    });
    writeSessionEvents(sessions, "session-a", [
      "{not json",
      ...sessionEventsFixture({
        runAt,
        beforeAt: new Date(now - 3600000).toISOString(),
        generationAt: new Date(now - 90000).toISOString(),
        tourAt: new Date(now - 60000).toISOString(),
        consolidationAt: new Date(now - 30000).toISOString()
      })
    ]);
    const result = runHook(payload({ cwd: workspace }));
    assert.deepEqual(result.output, {}, "a closed run lets the agent stop, noise included");
    const recorded = readState(workspace, state.runId).metrics;
    assert.equal(recorded.usage.observed, true, "the noisy file does not invalidate the readable records");
    assert.equal(recorded.usage.totals.inputTokens, 364887 + 124662);
  } finally {
    if (previousStateDir === undefined) delete process.env.CODETOUR_COPILOT_SESSION_STATE_DIR; else process.env.CODETOUR_COPILOT_SESSION_STATE_DIR = previousStateDir;
    rmSync(root, { recursive: true, force: true });
    rmSync(sessions, { recursive: true, force: true });
  }
});
