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

for (const status of ["created", "completed_zero", "partial", "failed", "skipped"]) {
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

test("an incomplete run receives exactly one bounded continuation", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const state = writeState(workspace, { tourCreated: true, tourPath: ".tours/project.tour" });
    const first = runHook(payload({ cwd: workspace }));
    assert.equal(first.output.decision, "block");
    assert.match(first.output.reason, new RegExp(state.runId));
    assert.match(first.output.reason, /knowledge_save/);
    assert.match(first.output.reason, /knowledge_close_run/);
    assert.match(first.output.reason, /Do not create the Tour again/);
    assert.equal(readState(workspace, state.runId).continuationUsed, true);

    // The host re-enters with stop_hook_active; the counter alone is enough.
    assert.deepEqual(runHook(payload({ cwd: workspace })).output, {});
    assert.deepEqual(runHook(payload({ cwd: workspace, stop_hook_active: true })).output, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two concurrent hook invocations produce at most one block", async () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const state = writeState(workspace, { tourCreated: true });
    const invoke = () => new Promise(resolve => {
      const child = spawn(process.execPath, [hook], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.once("close", code => resolve({ code, output: JSON.parse(stdout) }));
      child.stdin.end(JSON.stringify(payload({ cwd: workspace })));
    });
    const results = await Promise.all([invoke(), invoke(), invoke()]);
    assert.equal(results.filter(result => result.output.decision === "block").length, 1);
    assert.equal(readState(workspace, state.runId).continuationUsed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two runs in one session each get their own single continuation", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const older = writeState(workspace, {
      runId: "run-aaaaaaaaaaaaaaaa",
      tourCreated: true,
      at: "2026-11-19T08:00:00.000Z",
      updatedAt: "2026-11-19T08:00:00.000Z"
    });
    const newer = writeState(workspace, {
      runId: "run-bbbbbbbbbbbbbbbb",
      tourCreated: true,
      at: "2026-11-19T09:00:00.000Z",
      updatedAt: "2026-11-19T09:00:00.000Z"
    });
    const first = runHook(payload({ cwd: workspace }));
    assert.equal(first.output.decision, "block");
    assert.match(first.output.reason, new RegExp(newer.runId), "the newest run is chosen first");
    // The second run remains open and can be closed by the agent or by a later
    // generation; this stop does not block twice.
    assert.equal(readState(workspace, older.runId).continuationUsed, false);
    assert.equal(readState(workspace, newer.runId).continuationUsed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a resumed session keeps its run state and bounds the continuation", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const state = writeState(workspace, {
      tourCreated: true,
      at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
    });
    assert.equal(runHook(payload({ cwd: workspace })).output.decision, "block");
    assert.equal(readState(workspace, state.runId).continuationUsed, true);
    assert.deepEqual(runHook(payload({ cwd: workspace })).output, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an expired run and a symlinked workspace path are handled deterministically", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    writeState(workspace, {
      runId: "run-cccccccccccccccc",
      tourCreated: true,
      at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    });
    assert.deepEqual(runHook(payload({ cwd: workspace })).output, {});
    const link = path.join(root, "linked workspace");
    symlinkSync(workspace, link, "dir");
    writeState(workspace, {
      runId: "run-dddddddddddddddd",
      tourCreated: true,
      at: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    assert.equal(runHook(payload({ cwd: link })).output.decision, "block");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
    // lets the agent stop instead of blocking without its bound.
    const state = writeState(workspace, { tourCreated: true });
    chmodSync(runLogDirectory(workspace), 0o555);
    const unwritable = runHook(payload({ cwd: workspace }));
    assert.deepEqual(unwritable.output, {});
    assert.equal(readState(workspace, state.runId).continuationUsed, false);
    chmodSync(runLogDirectory(workspace), 0o755);
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
