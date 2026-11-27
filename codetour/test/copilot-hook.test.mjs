import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  creationsDirectory,
  reportedDirectory
} from "../packages/copilot-plugin/com.github.copilot/lib/run-log.mjs";

// The Copilot plugin's end-of-response summary, exercised through the real hook
// script: a document on stdin, `{}` on stdout, one summary on stderr. The
// attribution inputs are the ones the host really provides (payload `cwd`,
// `sessionId`, `timestamp`, `transcriptPath`), the creation journal the CLI
// writes, and nothing else.

const hook = path.resolve("packages/copilot-plugin/com.github.copilot/hooks/agent-stop.mjs");

function workspaceWithSpaces() {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-hook-"));
  const workspace = path.join(root, "work space");
  mkdirSync(workspace, { recursive: true });
  return { root, workspace: realpathSync(workspace) };
}

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

// One creation record, exactly as `packages/tour-generation/src/journal.ts`
// writes it: `<createdAtMs>-<pid>-<rand>.json` under
// `<workspace>/.tours/.log/creations/`.
function writeCreation(workspace, overrides = {}) {
  const at = overrides.at ?? iso(Date.now() - 1000);
  const record = {
    version: 1,
    workspace,
    tourPath: path.join(workspace, ".tours", "project.tour"),
    tourTitle: "Project Overview",
    kind: "project",
    at,
    sessionId: "session-a",
    responseId: null,
    host: "copilot",
    ...overrides
  };
  const directory = creationsDirectory(workspace);
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${Date.parse(at)}-${process.pid}-0123abcd.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return { record, file };
}

function writeTranscript(root, events) {
  const file = path.join(root, "events.jsonl");
  writeFileSync(file, events.map(event => JSON.stringify(event)).join("\n") + "\n");
  return file;
}

function userMessage(at) {
  return { type: "user.message", timestamp: iso(at), data: { content: "explique le flux" } };
}

function sessionStart(at) {
  return { type: "session.start", timestamp: iso(at), data: { sessionId: "session-a", copilotVersion: "1.0.114" } };
}

// Copilot CLI 1.0.114 session usage record: `inputTokens` already includes the
// cache reads and writes, `reasoningTokens` is a subset of the output.
function usageRecord(at, usage) {
  return { type: "session.usage_record", timestamp: iso(at), data: { usage } };
}

function payload(overrides = {}) {
  return {
    sessionId: "session-a",
    timestamp: Date.now(),
    cwd: overrides.cwd,
    transcriptPath: overrides.transcriptPath,
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
  assert.equal(result.status, 0, `the hook always exits 0: ${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout), {}, "the hook always answers {}");
  return result.stderr;
}

function summaryLines(stderr) {
  return stderr.split("\n").filter(line => line.startsWith("CodeTour:"));
}

test("a response without a creation prints nothing", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const now = Date.now();
    const transcriptPath = writeTranscript(root, [sessionStart(now - 60000), userMessage(now - 30000)]);
    const stderr = runHook(payload({ cwd: workspace, timestamp: now, transcriptPath }));
    assert.equal(stderr.trim(), "", "no attributed creation and no reading: silence, diagnostics included");
    // Nothing to attribute is decided from the journal alone: an unreadable
    // transcript never reaches the ordinary conversation as a diagnostic.
    assert.equal(
      runHook(payload({ cwd: workspace, timestamp: now, transcriptPath: path.join(root, "absent.jsonl") })).trim(),
      ""
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed payloads, an unusable workspace and a missing transcript stay silent", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const now = Date.now();
    writeCreation(workspace, { at: iso(now - 20000) });
    const transcriptPath = writeTranscript(root, [userMessage(now - 40000)]);
    for (const input of [
      "not json",
      "",
      "null",
      JSON.stringify({ sessionId: "session-a" }),
      JSON.stringify({ timestamp: now, cwd: workspace, transcriptPath })
    ]) {
      assert.deepEqual(summaryLines(runHook(input)), []);
    }
    assert.deepEqual(
      summaryLines(runHook(payload({ cwd: path.join(workspace, "missing"), timestamp: now, transcriptPath }))),
      []
    );
    const missing = runHook(
      payload({ cwd: workspace, timestamp: now, transcriptPath: path.join(root, "absent.jsonl") })
    );
    assert.deepEqual(summaryLines(missing), [], "no transcript, no response boundary, no attribution");
    assert.match(missing, /CodeTour agentStop: tokens not observed/, "the limit is reported as a diagnostic");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a hook-triggered re-entry never repeats the summary", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const now = Date.now();
    writeCreation(workspace, { at: iso(now - 5000) });
    const transcriptPath = writeTranscript(root, [userMessage(now - 30000)]);
    assert.equal(
      runHook(payload({ cwd: workspace, timestamp: now, transcriptPath, stop_hook_active: true })).trim(),
      ""
    );
    assert.equal(
      runHook(payload({ cwd: workspace, timestamp: now, transcriptPath, stopHookActive: true })).trim(),
      "",
      "the SDK spelling is honored too"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("one creation of the current response is reported with its title, path and tokens", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const now = Date.now();
    const { record } = writeCreation(workspace, {
      at: iso(now - 20000),
      tourPath: path.join(workspace, ".tours", "flux.tour"),
      tourTitle: "Flux de facturation"
    });
    const transcriptPath = writeTranscript(root, [
      sessionStart(now - 600000),
      userMessage(now - 40000),
      usageRecord(now - 35000, {
        inputTokens: 18821,
        outputTokens: 1160,
        cacheReadTokens: 18818,
        cacheWriteTokens: 966,
        reasoningTokens: 868
      })
    ]);
    const stderr = runHook(payload({ cwd: workspace, timestamp: now, transcriptPath }));
    assert.deepEqual(summaryLines(stderr), [
      "CodeTour: 1 Tour created in this response",
      `CodeTour: "${record.tourTitle}" — ${record.tourPath}`,
      "CodeTour: tokens 18,821 in (of which 18,818 cached reads, 966 cached writes), 1,160 out"
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("several creations of the response are all reported, in creation order", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const now = Date.now();
    writeCreation(workspace, {
      at: iso(now - 30000),
      tourPath: path.join(workspace, ".tours", "project.tour"),
      tourTitle: "Project Overview"
    });
    writeCreation(workspace, {
      at: iso(now - 20000),
      tourPath: path.join(workspace, ".tours", "review.tour"),
      tourTitle: "Revue critique des changements",
      kind: "changes"
    });
    const transcriptPath = writeTranscript(root, [
      userMessage(now - 40000),
      usageRecord(now - 30000, { inputTokens: 100, outputTokens: 10 })
    ]);
    const stderr = runHook(payload({ cwd: workspace, timestamp: Date.now(), transcriptPath }));
    assert.deepEqual(summaryLines(stderr), [
      "CodeTour: 2 Tours created in this response",
      `CodeTour: "Project Overview" — ${path.join(workspace, ".tours", "project.tour")}`,
      `CodeTour: "Revue critique des changements" — ${path.join(workspace, ".tours", "review.tour")}`,
      "CodeTour: tokens 100 in, 10 out"
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a creation of another session, another workspace or before the response is excluded", () => {
  const { root, workspace } = workspaceWithSpaces();
  const other = path.join(root, "other workspace");
  mkdirSync(other, { recursive: true });
  try {
    const now = Date.now();
    const transcriptPath = writeTranscript(root, [userMessage(now - 40000)]);
    // Another session, a record without a session identity, a record of another
    // host, a creation older than this response and one from the future.
    writeCreation(workspace, { at: iso(now - 20000), sessionId: "session-b", tourTitle: "Autre session" });
    writeCreation(workspace, { at: iso(now - 20000), sessionId: null, tourTitle: "Sans session" });
    writeCreation(workspace, { at: iso(now - 20000), host: "pi", tourTitle: "Autre hôte" });
    writeCreation(workspace, { at: iso(now - 90000), tourTitle: "Réponse précédente" });
    writeCreation(workspace, { at: iso(now + 60000), tourTitle: "Horloge en avance" });
    assert.equal(
      runHook(payload({ cwd: workspace, timestamp: now, transcriptPath })).trim(),
      "",
      "none of those creations is attributed to this response"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a creation of the same session in another workspace is excluded", () => {
  const { root, workspace } = workspaceWithSpaces();
  const other = path.join(root, "other workspace");
  mkdirSync(other, { recursive: true });
  try {
    const now = Date.now();
    // A record that names this session but another workspace root.
    writeCreation(workspace, { at: iso(now - 20000), workspace: realpathSync(other), tourTitle: "Ailleurs" });
    const transcriptPath = writeTranscript(root, [userMessage(now - 40000)]);
    assert.equal(runHook(payload({ cwd: workspace, timestamp: now, transcriptPath })).trim(), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the response boundary is the last user message before the stop", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const now = Date.now();
    // Created in the previous response: before the last user message.
    writeCreation(workspace, { at: iso(now - 50000), tourTitle: "Réponse précédente" });
    writeCreation(workspace, { at: iso(now - 20000), tourTitle: "Réponse courante" });
    const transcriptPath = writeTranscript(root, [
      userMessage(now - 90000),
      usageRecord(now - 60000, { inputTokens: 5000, outputTokens: 50 }),
      userMessage(now - 40000),
      usageRecord(now - 30000, { inputTokens: 400, outputTokens: 40 })
    ]);
    const stderr = runHook(payload({ cwd: workspace, timestamp: now, transcriptPath }));
    assert.deepEqual(summaryLines(stderr), [
      "CodeTour: 1 Tour created in this response",
      `CodeTour: "Réponse courante" — ${path.join(workspace, ".tours", "project.tour")}`,
      "CodeTour: tokens 400 in, 40 out"
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a response without a user message falls back to the session start and says it is approximate", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const now = Date.now();
    writeCreation(workspace, { at: iso(now - 20000), tourTitle: "Project Overview" });
    const transcriptPath = writeTranscript(root, [
      sessionStart(now - 60000),
      usageRecord(now - 30000, { inputTokens: 300, outputTokens: 30 })
    ]);
    const stderr = runHook(payload({ cwd: workspace, timestamp: now, transcriptPath }));
    assert.deepEqual(summaryLines(stderr), [
      "CodeTour: 1 Tour created in this response (approximate)",
      `CodeTour: "Project Overview" — ${path.join(workspace, ".tours", "project.tour")}`,
      "CodeTour: tokens 300 in, 30 out (approximate)"
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing usage is reported as unavailable, never as zero", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const now = Date.now();
    writeCreation(workspace, { at: iso(now - 20000) });
    const transcriptPath = writeTranscript(root, [userMessage(now - 40000)]);
    const stderr = runHook(payload({ cwd: workspace, timestamp: now, transcriptPath }));
    assert.deepEqual(summaryLines(stderr), [
      "CodeTour: 1 Tour created in this response",
      `CodeTour: "Project Overview" — ${path.join(workspace, ".tours", "project.tour")}`,
      "CodeTour: tokens unavailable (no usage records in this response)"
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("partial usage reports only the figures the session recorded", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const now = Date.now();
    writeCreation(workspace, { at: iso(now - 20000) });
    const transcriptPath = writeTranscript(root, [
      userMessage(now - 40000),
      usageRecord(now - 30000, { inputTokens: 2500, cacheReadTokens: 2400 })
    ]);
    const stderr = runHook(payload({ cwd: workspace, timestamp: now, transcriptPath }));
    assert.deepEqual(summaryLines(stderr), [
      "CodeTour: 1 Tour created in this response",
      `CodeTour: "Project Overview" — ${path.join(workspace, ".tours", "project.tour")}`,
      "CodeTour: tokens 2,500 in (of which 2,400 cached reads)"
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("usage records without token figures are unavailable, not a zero reading", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const now = Date.now();
    writeCreation(workspace, { at: iso(now - 20000) });
    const transcriptPath = writeTranscript(root, [
      userMessage(now - 40000),
      usageRecord(now - 30000, { model: "claude-sonnet-5.5", duration: 400 })
    ]);
    const stderr = runHook(payload({ cwd: workspace, timestamp: now, transcriptPath }));
    assert.deepEqual(summaryLines(stderr), [
      "CodeTour: 1 Tour created in this response",
      `CodeTour: "Project Overview" — ${path.join(workspace, ".tours", "project.tour")}`,
      "CodeTour: tokens unavailable (no token figures in this response)"
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cache is shown as a part of the input total, never added to it", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const now = Date.now();
    writeCreation(workspace, { at: iso(now - 20000) });
    const transcriptPath = writeTranscript(root, [
      userMessage(now - 40000),
      usageRecord(now - 35000, { inputTokens: 18821, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 18818 }),
      usageRecord(now - 30000, { inputTokens: 19787, outputTokens: 20, cacheReadTokens: 18818, cacheWriteTokens: 966 })
    ]);
    const stderr = runHook(payload({ cwd: workspace, timestamp: now, transcriptPath }));
    assert.deepEqual(summaryLines(stderr), [
      "CodeTour: 1 Tour created in this response",
      `CodeTour: "Project Overview" — ${path.join(workspace, ".tours", "project.tour")}`,
      // 18,821 + 19,787 in; 18,818 read; 18,818 + 966 written. The input total
      // already contains both cache figures (recon §5.c).
      "CodeTour: tokens 38,608 in (of which 18,818 cached reads, 19,784 cached writes), 23 out"
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a second stop of the same response prints no second reading", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const now = Date.now();
    writeCreation(workspace, { at: iso(now - 20000) });
    const transcriptPath = writeTranscript(root, [
      userMessage(now - 40000),
      usageRecord(now - 30000, { inputTokens: 700, outputTokens: 70 })
    ]);
    const first = runHook(payload({ cwd: workspace, timestamp: now, transcriptPath }));
    assert.equal(summaryLines(first).length, 3);
    const second = runHook(payload({ cwd: workspace, timestamp: now + 500, transcriptPath }));
    assert.equal(second.trim(), "", "the response was already reported");
    const sentinels = readdirSync(reportedDirectory(workspace));
    assert.deepEqual(sentinels, [`session-a-${now - 40000}`], "the marker names the session and the response start");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a later response of the same session reports its own creation again", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const now = Date.now();
    const transcriptPath = writeTranscript(root, [
      userMessage(now - 40000),
      usageRecord(now - 35000, { inputTokens: 700, outputTokens: 70 })
    ]);
    writeCreation(workspace, { at: iso(now - 30000), tourTitle: "Première réponse" });
    assert.equal(summaryLines(runHook(payload({ cwd: workspace, timestamp: now, transcriptPath }))).length, 3);
    // A new user message opens a new response, the transcript grows with it.
    writeTranscript(root, [
      userMessage(now - 40000),
      usageRecord(now - 35000, { inputTokens: 700, outputTokens: 70 }),
      userMessage(now - 5000),
      usageRecord(now - 2000, { inputTokens: 1500, outputTokens: 150 })
    ]);
    writeCreation(workspace, { at: iso(now - 1000), tourTitle: "Seconde réponse" });
    const stderr = runHook(payload({ cwd: workspace, timestamp: now + 100, transcriptPath }));
    assert.deepEqual(summaryLines(stderr), [
      "CodeTour: 1 Tour created in this response",
      `CodeTour: "Seconde réponse" — ${path.join(workspace, ".tours", "project.tour")}`,
      "CodeTour: tokens 1,500 in, 150 out"
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("one creation of many responses in the same second uses the millisecond boundary", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const boundary = Date.parse("2026-01-02T03:04:05.678Z");
    // Exactly on the boundary: attributed, the window is [start, stop].
    writeCreation(workspace, { at: iso(boundary), tourTitle: "À la frontière" });
    writeCreation(workspace, { at: iso(boundary - 1), tourTitle: "Juste avant" });
    const transcriptPath = writeTranscript(root, [userMessage(boundary)]);
    const stderr = runHook(payload({ cwd: workspace, timestamp: boundary + 10000, transcriptPath }));
    assert.deepEqual(summaryLines(stderr), [
      "CodeTour: 1 Tour created in this response",
      `CodeTour: "À la frontière" — ${path.join(workspace, ".tours", "project.tour")}`,
      "CodeTour: tokens unavailable (no usage records in this response)"
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unreadable journal or an unwritable marker never fails the stop", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const now = Date.now();
    const transcriptPath = writeTranscript(root, [userMessage(now - 40000)]);
    // The creation directory is a file: the journal cannot be enumerated.
    mkdirSync(path.join(workspace, ".tours", ".log"), { recursive: true });
    writeFileSync(creationsDirectory(workspace), "not a directory\n");
    const unreadable = runHook(payload({ cwd: workspace, timestamp: now, transcriptPath }));
    assert.deepEqual(summaryLines(unreadable), []);
    assert.match(unreadable, /CodeTour agentStop: ignored creation record/);

    // A corrupt record is ignored, a readable one is still reported.
    rmSync(creationsDirectory(workspace), { force: true });
    writeCreation(workspace, { at: iso(now - 20000), tourTitle: "Lisible" });
    writeFileSync(path.join(creationsDirectory(workspace), `${now - 25000}-1-deadbeef.json`), "{not json");
    assert.deepEqual(summaryLines(runHook(payload({ cwd: workspace, timestamp: now, transcriptPath }))).slice(1, 2), [
      `CodeTour: "Lisible" — ${path.join(workspace, ".tours", "project.tour")}`
    ]);

    // The marker directory cannot be created: the summary is still printed.
    const blocked = path.join(workspace, ".tours", ".log", "creations", ".reported");
    rmSync(blocked, { recursive: true, force: true });
    writeFileSync(blocked, "not a directory\n");
    const stderr = runHook(payload({ cwd: workspace, timestamp: now + 1, transcriptPath }));
    assert.equal(summaryLines(stderr).length, 3, "the summary does not depend on the marker");
    assert.ok(statSync(blocked).isFile());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// End to end: the command the skill documents, run by the agent with the session
// identity the Copilot CLI exports to tool processes, then the hook on the very
// response that ran it. This is the whole path — proposal on standard input, one
// JSON document back, one journal record, one summary — and not a fixture.
const cli = path.resolve("dist/cli.js");

function cleanCreationEnv(extra = {}) {
  const { CODETOUR_SESSION_ID, CODETOUR_RESPONSE_ID, CODETOUR_HOST, PI_SESSION_ID, ...rest } = process.env;
  return { ...rest, ...extra };
}

function runCreation(cwd, args, input, env) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    input,
    env: cleanCreationEnv(env),
    timeout: 120000
  });
  return result;
}

test("the command from the skill creates a Tour that the hook then reports", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const now = Date.now();
    const transcriptPath = writeTranscript(root, [
      userMessage(now - 40000),
      usageRecord(now - 30000, { inputTokens: 2400, outputTokens: 240, cacheReadTokens: 2000 })
    ]);
    const created = runCreation(
      workspace,
      ["create-project-tour", "--workspace", workspace],
      JSON.stringify({
        title: "Flux de facturation",
        steps: [{ title: "Vue d'ensemble", description: "Où le travail se trouve." }]
      }),
      { COPILOT_AGENT_SESSION_ID: "session-a" }
    );
    assert.equal(created.status, 0, created.stderr);
    const result = JSON.parse(created.stdout);
    assert.equal(result.ok, true);
    // The stop happens after the creation: the payload stamp is the end of the
    // response window.
    const stderr = runHook(payload({ cwd: workspace, timestamp: Date.now(), transcriptPath }));
    assert.deepEqual(summaryLines(stderr), [
      "CodeTour: 1 Tour created in this response",
      `CodeTour: "Flux de facturation" — ${result.tourPath}`,
      "CodeTour: tokens 2,400 in (of which 2,000 cached reads), 240 out"
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a critical Changes Tour created by the CLI in the same response is reported too", () => {
  const { root, workspace } = workspaceWithSpaces();
  try {
    const git = (...args) => execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test User");
    git("config", "commit.gpgsign", "false");
    writeFileSync(path.join(workspace, "base.txt"), "base\n");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    const baseRef = git("rev-parse", "HEAD");
    writeFileSync(path.join(workspace, "feature.ts"), "export function feature() {}\n");
    git("add", "-A");
    git("commit", "-q", "-m", "feature");
    const headRef = git("rev-parse", "HEAD");

    const now = Date.now();
    const transcriptPath = writeTranscript(root, [
      userMessage(now - 60000),
      usageRecord(now - 50000, { inputTokens: 900, outputTokens: 90 })
    ]);
    const env = { COPILOT_AGENT_SESSION_ID: "session-a" };
    const project = runCreation(
      workspace,
      ["create-project-tour", "--workspace", workspace],
      JSON.stringify({ title: "Architecture", steps: [{ description: "Vue d'ensemble." }] }),
      env
    );
    assert.equal(project.status, 0, project.stderr);
    const changes = runCreation(
      workspace,
      ["create-changes-tour", "--workspace", workspace],
      JSON.stringify({
        baseRef,
        headRef,
        reviewMode: "critical",
        title: "Revue critique des changements",
        steps: [{ description: "Constat : la fonction n'est jamais appelée.", file: "feature.ts", line: 1 }]
      }),
      env
    );
    assert.equal(changes.status, 0, changes.stderr);

    const stderr = runHook(payload({ cwd: workspace, timestamp: Date.now(), transcriptPath }));
    assert.deepEqual(summaryLines(stderr), [
      "CodeTour: 2 Tours created in this response",
      `CodeTour: "Architecture" — ${JSON.parse(project.stdout).tourPath}`,
      `CodeTour: "Revue critique des changements" — ${JSON.parse(changes.stdout).tourPath}`,
      "CodeTour: tokens 900 in, 90 out"
    ]);

    // Reading is untouched by this ticket: the Tours the documented command
    // created are the ones the existing reader discovers.
    const listed = spawnSync(process.execPath, [cli, "--internal-list-tours"], {
      cwd: workspace,
      encoding: "utf8"
    });
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(
      JSON.parse(listed.stdout).map(tour => tour.title).sort(),
      ["Architecture", "Revue critique des changements"]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
