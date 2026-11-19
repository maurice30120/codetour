import { test } from "node:test";
import * as assert from "node:assert";
import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { callTool, rmrf, tempDir, withServer, writeFile } from "../helpers/test-utils";
import {
  RUN_FILE_PREFIX,
  RUN_LOG_DIRECTORY,
  readRunState
} from "../../src/run-log";

// The run identity is the MCP's authenticated trace for the Copilot agentStop
// guard (spec #223, ticket #228). These tests exercise it through the public
// MCP stdio seam, then prove the plugin hook reads exactly the file the server
// wrote: no assistant text, no tool-call inference, no second server.

const RUN_ID = "run-1234567890abcdef";
const HOOK = path.resolve(
  __dirname,
  "../../../../../packages/copilot-plugin/com.github.copilot/hooks/agent-stop.mjs"
);

const sha256 = (text: string): string =>
  crypto.createHash("sha256").update(text).digest("hex");

function runLogPath(root: string, runId: string): string {
  return path.join(root, RUN_LOG_DIRECTORY, `${RUN_FILE_PREFIX}${runId}.json`);
}

function seedRunState(root: string, sessionId: string): void {
  const at = new Date().toISOString();
  const file = runLogPath(root, RUN_ID);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        version: 1,
        runId: RUN_ID,
        workspace: fs.realpathSync(root),
        sessionId,
        kind: "project",
        request: "generate project Explique le flux.",
        at,
        updatedAt: at,
        tourCreated: false,
        tourPath: null,
        consolidation: null,
        continuationUsed: false
      },
      null,
      2
    ) + "\n"
  );
}

function hookDecision(root: string, sessionId: string): Record<string, unknown> {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      sessionId,
      cwd: root,
      transcriptPath: "/tmp/transcript.jsonl",
      stopReason: "end_turn",
      stop_hook_active: false
    }),
    encoding: "utf8",
    timeout: 20000
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("prompts/get embeds the run identity only when the adapter supplies one", async () => {
  const root = tempDir("codetour-run-prompt-");
  try {
    await withServer(root, async (client) => {
      const withRun = await client.getPrompt({
        name: "generate_project_tour",
        arguments: { request: "Explique le flux.", runId: RUN_ID }
      });
      const text = withRun.messages.map((message) => {
        const content = message.content as { text?: string };
        return typeof message.content === "string" ? message.content : content.text ?? "";
      }).join("\n");
      assert.ok(text.includes(`Run identity: \`${RUN_ID}\``));
      assert.ok(text.includes("knowledge_save"));
      assert.ok(text.includes("knowledge_close_run"));
      const withoutRun = await client.getPrompt({
        name: "generate_project_tour",
        arguments: { request: "Explique le flux." }
      });
      const plain = withoutRun.messages.map((message) => {
        const content = message.content as { text?: string };
        return typeof message.content === "string" ? message.content : content.text ?? "";
      }).join("\n");
      assert.ok(!plain.includes("## Run identity"));
    });
  } finally {
    rmrf(root);
  }
});

test("create_project_tour records the Tour under the run identity", async () => {
  const root = tempDir("codetour-run-create-");
  try {
    writeFile(root, "hello.txt", "hello\n");
    await withServer(root, async (client) => {
      const created = await callTool(client, "create_project_tour", {
        runId: RUN_ID,
        steps: [{ file: "hello.txt", description: "Anchored step." }]
      });
      assert.equal(created.isError, false, created.text);
      assert.equal(created.structured.runId, RUN_ID);
      assert.equal(created.structured.runRecorded, true, created.text);
      const state = await readRunState(fs.realpathSync(root), RUN_ID);
      assert.ok(state);
      assert.equal(state.tourCreated, true);
      assert.equal(state.tourPath, ".tours/project.tour");
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_save persists created and completed_zero closures and returns them", async () => {
  const root = tempDir("codetour-run-save-");
  try {
    const digest = sha256("export const start = 1;\n");
    writeFile(root, "src/main.ts", "export const start = 1;\n");
    await withServer(root, async (client) => {
      const zero = await callTool(client, "knowledge_save", { runId: RUN_ID, entries: [] });
      assert.equal(zero.isError, false, zero.text);
      assert.equal(zero.structured.status, "completed_zero");
      assert.equal(zero.structured.consolidationPersisted, true, zero.text);
      assert.equal(
        (zero.structured.consolidation as { status: string }).status,
        "completed_zero"
      );
      let state = await readRunState(fs.realpathSync(root), RUN_ID);
      assert.equal(state?.consolidation?.status, "completed_zero");

      const saved = await callTool(client, "knowledge_save", {
        runId: RUN_ID,
        entries: [
          {
            name: "dispatch_flow",
            description: "How dispatch works",
            body: "The dispatch flow.\n",
            evidence: [{ path: "src/main.ts", sha256: digest }]
          }
        ]
      });
      assert.equal(saved.isError, false, saved.text);
      assert.equal(saved.structured.status, "created");
      assert.equal(
        (saved.structured.consolidation as { status: string }).status,
        "created"
      );
      assert.deepEqual(
        (saved.structured.consolidation as { created: string[] }).created,
        ["dispatch_flow"]
      );
      state = await readRunState(fs.realpathSync(root), RUN_ID);
      assert.equal(state?.consolidation?.status, "created");
    });
  } finally {
    rmrf(root);
  }
});

test("a refused consolidation is a failed closure, not an omission", async () => {
  const root = tempDir("codetour-run-failed-");
  try {
    writeFile(root, "src/main.ts", "export const start = 1;\n");
    await withServer(root, async (client) => {
      const invalid = await callTool(client, "knowledge_save", {
        runId: RUN_ID,
        entries: [
          {
            name: "missing_file",
            description: "Cites a missing file",
            body: "Body.\n",
            evidence: [{ path: "src/missing.ts" }]
          }
        ]
      });
      assert.equal(invalid.isError, true);
      assert.equal(
        (invalid.structured.consolidation as { status: string }).status,
        "failed"
      );
      assert.equal(
        (invalid.structured.consolidation as { outcome: string }).outcome,
        "invalid"
      );
      const state = await readRunState(fs.realpathSync(root), RUN_ID);
      assert.equal(state?.consolidation?.status, "failed");
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_close_run records an explicit skipped closure", async () => {
  const root = tempDir("codetour-run-skipped-");
  try {
    await withServer(root, async (client) => {
      const closed = await callTool(client, "knowledge_close_run", {
        runId: RUN_ID,
        reason: "Tour creation failed before any reusable finding."
      });
      assert.equal(closed.isError, false, closed.text);
      assert.equal(closed.structured.status, "skipped");
      assert.equal(closed.structured.consolidationPersisted, true, closed.text);
      const state = await readRunState(fs.realpathSync(root), RUN_ID);
      assert.equal(state?.consolidation?.status, "skipped");
      assert.match(state?.consolidation?.reason ?? "", /Tour creation failed/);
    });
  } finally {
    rmrf(root);
  }
});

test("a malformed runId is refused without writing a run log", async () => {
  const root = tempDir("codetour-run-invalid-");
  try {
    await withServer(root, async (client) => {
      const created = await callTool(client, "create_project_tour", {
        runId: "../../escape",
        steps: [{ description: "No locator." }]
      });
      assert.equal(created.isError, true);
      assert.match(created.text, /runId/);
    });
  } finally {
    rmrf(root);
  }
});

test("without a runId the tools keep their previous behavior and write no run log", async () => {
  const root = tempDir("codetour-run-absent-");
  try {
    writeFile(root, "hello.txt", "hello\n");
    await withServer(root, async (client) => {
      const created = await callTool(client, "create_project_tour", {
        steps: [{ file: "hello.txt", description: "Anchored step." }]
      });
      assert.equal(created.isError, false, created.text);
      const saved = await callTool(client, "knowledge_save", { entries: [] });
      assert.equal(saved.isError, false, saved.text);
      assert.equal(saved.structured.runId, undefined);
      assert.ok(!fs.existsSync(path.join(root, RUN_LOG_DIRECTORY)));
    });
  } finally {
    rmrf(root);
  }
});

test("the plugin hook turns the server-written closure into an inert stop", async () => {
  const root = tempDir("codetour-run-hook-");
  const sessionId = "session-0123456789abcdef";
  try {
    writeFile(root, "hello.txt", "hello\n");
    seedRunState(root, sessionId);
    await withServer(root, async (client) => {
      const created = await callTool(client, "create_project_tour", {
        runId: RUN_ID,
        steps: [{ file: "hello.txt", description: "Anchored step." }]
      });
      assert.equal(created.isError, false, created.text);
      // A Tour exists but no closure yet: the hook asks for one continuation.
      const blocked = hookDecision(root, sessionId);
      assert.equal(blocked.decision, "block");
      assert.match(String(blocked.reason), new RegExp(RUN_ID));

      const saved = await callTool(client, "knowledge_save", {
        runId: RUN_ID,
        entries: []
      });
      assert.equal(saved.isError, false, saved.text);
      // The same run is now closed with completed_zero: no second block.
      assert.deepEqual(hookDecision(root, sessionId), {});
      const state = await readRunState(fs.realpathSync(root), RUN_ID);
      assert.equal(state?.continuationUsed, true);
      assert.equal(state?.consolidation?.status, "completed_zero");
    });
  } finally {
    rmrf(root);
  }
});
