import { test } from "node:test";
import * as assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "os";
import * as path from "path";
import {
  isLegacyCodetourMcpEntry,
  isLegacyPiLauncher,
  isLegacyRunState,
  isLegacyRunStateName,
  removeLegacyCopilotExtension,
  removeLegacyRunStates,
  scanLegacyCopilotExtension
} from "./agentMigration";
import { LEGACY_COPILOT_EXTENSION_FILES } from "./legacyCopilotExtension";

function temporaryDirectory(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

// The frozen launch shapes an older CodeTour CLI registered for its server: the
// documented `codetour mcp` command, and its own runtime with the absolute CLI
// bundle and the subcommand.
test("the frozen ownership predicate recognizes both retired launch shapes", () => {
  assert.equal(
    isLegacyCodetourMcpEntry({ type: "local", command: "codetour", args: ["mcp"], tools: ["*"] }),
    true
  );
  // The `local` transport is the default when `type` is absent.
  assert.equal(isLegacyCodetourMcpEntry({ command: "codetour", args: ["mcp"] }), true);
  assert.equal(
    isLegacyCodetourMcpEntry({
      type: "local",
      command: process.execPath,
      args: [path.join(path.sep, "opt", "codetour", "dist", "cli.js"), "mcp"],
      tools: ["*"]
    }),
    true
  );
  // A native `codetour` executable addressed directly is the same shape.
  assert.equal(
    isLegacyCodetourMcpEntry({
      command: path.join(path.sep, "usr", "local", "bin", "node"),
      args: [path.join(path.sep, "srv", "codetour", "cli.js"), "mcp"],
      tools: ["*"]
    }),
    true
  );
});

test("the frozen ownership predicate preserves every server it cannot prove", () => {
  for (const entry of [
    // A same-named server launched another way belongs to another installation.
    { type: "local", command: "someone-elses-codetour", args: ["--stdio", "mcp"], tools: ["*"] },
    // A remote transport is never ours.
    { type: "http", command: "codetour", args: ["mcp"] },
    // The retired subcommand without an absolute CodeTour CLI bundle.
    { command: process.execPath, args: ["server.js", "mcp"], tools: ["*"] },
    { command: process.execPath, args: ["mcp"], tools: ["*"] },
    // A subset of tools is not the launch contract this CLI wrote.
    { command: process.execPath, args: [path.join(path.sep, "opt", "cli.js"), "mcp"], tools: ["create_project_tour"] },
    // A relative CLI path.
    { command: process.execPath, args: ["cli.js", "mcp"], tools: ["*"] },
    { command: "codetour", args: ["mcp", "--workspace-root", "/tmp"] },
    { args: ["mcp"] },
    null,
    undefined,
    "codetour"
  ]) {
    assert.equal(isLegacyCodetourMcpEntry(entry), false, JSON.stringify(entry));
  }
});

test("the frozen run-state predicates accept only the retired on-disk contract", () => {
  assert.equal(isLegacyRunStateName("codetour-run-abcdefgh.json"), true);
  assert.equal(isLegacyRunStateName("codetour-run-a.json"), false);
  assert.equal(isLegacyRunStateName("codetour-run-abcdefgh.json.lock"), false);
  assert.equal(isLegacyRunStateName("creations"), false);
  assert.equal(isLegacyRunStateName("unrelated.json"), false);

  const state = {
    version: 1,
    runId: "abcdefgh",
    workspace: "/tmp/workspace",
    at: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sessionId: null,
    kind: "project",
    request: null,
    tourCreated: false,
    tourPath: null,
    consolidation: null,
    continuationUsed: false
  };
  assert.equal(isLegacyRunState(state), true);
  assert.equal(isLegacyRunState({ ...state, version: 2 }), false);
  assert.equal(isLegacyRunState({ ...state, runId: "bad id" }), false);
  assert.equal(isLegacyRunState({ ...state, continuationUsed: undefined }), false);
  assert.equal(isLegacyRunState({ ...state, workspace: 3 }), false);
  assert.equal(isLegacyRunState({}), false);
  assert.equal(isLegacyRunState(null), false);
});

test("a recorded Pi launcher is retired only when it carries the subcommand", () => {
  assert.equal(isLegacyPiLauncher('{\n  "command": "node",\n  "args": ["/opt/cli.js", "mcp"]\n}\n'), true);
  assert.equal(isLegacyPiLauncher('{\n  "command": "node",\n  "args": ["/opt/cli.js"]\n}\n'), false);
  assert.equal(isLegacyPiLauncher('{\n  "command": "codetour",\n  "args": []\n}\n'), false);
  assert.equal(isLegacyPiLauncher("not json"), false);
});

test("the retired adapter is removed byte for byte and its directory with it", async () => {
  const workspace = temporaryDirectory("codetour-legacy-adapter-");
  try {
    const directory = path.join(workspace, "extensions", "codetour");
    mkdirSync(directory, { recursive: true });
    for (const [name, content] of Object.entries(LEGACY_COPILOT_EXTENSION_FILES)) {
      writeFileSync(path.join(directory, name), content);
    }
    const scan = await scanLegacyCopilotExtension(directory);
    assert.equal(scan.owned.length, Object.keys(LEGACY_COPILOT_EXTENSION_FILES).length);
    assert.deepEqual(scan.preserved, []);

    const outcome = await removeLegacyCopilotExtension(directory);
    assert.equal(outcome.removed.length, scan.owned.length);
    assert.deepEqual(outcome.preserved, []);
    assert.equal(existsSync(directory), false);

    // A directory that is already gone is not an error: the migration runs on
    // every install and uninstall.
    const again = await removeLegacyCopilotExtension(directory);
    assert.deepEqual(again, { removed: [], preserved: [] });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a retired adapter file that is not the frozen snapshot is preserved", async () => {
  const workspace = temporaryDirectory("codetour-legacy-adapter-edited-");
  try {
    const directory = path.join(workspace, "extensions", "codetour");
    mkdirSync(path.join(directory, "patches"), { recursive: true });
    writeFileSync(path.join(directory, "adapter.mjs"), "// an edit of the user\n");
    writeFileSync(path.join(directory, "notes.txt"), "user notes\n");
    writeFileSync(path.join(directory, "patches", "mine.mjs"), "// a patch\n");
    writeFileSync(
      path.join(directory, "extension.mjs"),
      LEGACY_COPILOT_EXTENSION_FILES["extension.mjs"]
    );

    const outcome = await removeLegacyCopilotExtension(directory);
    assert.deepEqual(outcome.removed, [path.join(directory, "extension.mjs")]);
    assert.deepEqual(outcome.preserved.sort(), [
      path.join(directory, "adapter.mjs"),
      path.join(directory, "notes.txt"),
      path.join(directory, "patches")
    ]);
    assert.equal(existsSync(path.join(directory, "adapter.mjs")), true);
    assert.equal(existsSync(path.join(directory, "patches", "mine.mjs")), true);
    assert.equal(existsSync(path.join(directory, "extension.mjs")), false);
    assert.equal(existsSync(directory), true, "a directory with preserved files stays");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("the retired run states go with their locks and nothing else in the log directory", async () => {
  const workspace = temporaryDirectory("codetour-legacy-run-states-");
  try {
    const logDirectory = path.join(workspace, ".tours", ".log");
    mkdirSync(path.join(logDirectory, "creations"), { recursive: true });
    const state = {
      version: 1,
      runId: "abcdefgh",
      workspace,
      at: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      sessionId: null,
      kind: "changes",
      request: null,
      tourCreated: true,
      tourPath: null,
      consolidation: null,
      continuationUsed: false
    };
    const owned = path.join(logDirectory, "codetour-run-abcdefgh.json");
    writeFileSync(owned, JSON.stringify(state));
    writeFileSync(`${owned}.lock`, "");
    const corrupt = path.join(logDirectory, "codetour-run-zzzzzzzz.json");
    writeFileSync(corrupt, "{ not json");
    // Live input of the current flow, and a user's own file in the same place.
    writeFileSync(path.join(logDirectory, "creations", "1700000000000-1-abcd.json"), "{}\n");
    writeFileSync(path.join(logDirectory, "research.log"), "a log line\n");

    const outcome = await removeLegacyRunStates(logDirectory);
    assert.deepEqual(outcome.removed.sort(), [`${owned}.lock`, owned].sort());
    assert.deepEqual(outcome.preserved, [corrupt]);
    assert.equal(existsSync(owned), false);
    assert.equal(existsSync(`${owned}.lock`), false);
    assert.equal(existsSync(corrupt), true);
    assert.equal(existsSync(path.join(logDirectory, "creations", "1700000000000-1-abcd.json")), true);
    assert.equal(readFileSync(path.join(logDirectory, "research.log"), "utf8"), "a log line\n");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a missing log directory is not an error", async () => {
  const workspace = temporaryDirectory("codetour-legacy-run-states-absent-");
  try {
    const outcome = await removeLegacyRunStates(path.join(workspace, ".tours", ".log"));
    assert.deepEqual(outcome, { removed: [], preserved: [] });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
