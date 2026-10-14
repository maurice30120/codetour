import { test } from "node:test";
import * as assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import type { AcpAgentEntry } from "./acpAgentProcess";
import { spawnAcpAgent } from "./acpAgentProcess";
import { openAskSession } from "./acpSession";

/**
 * Session-layer tests drive a deterministic fake ACP agent at the real
 * transport boundary: the fake agent runs as a separate process speaking
 * ACP over NDJSON stdio, exactly like the installed Vibe entry does, and
 * records every request it receives so tests can assert on the wire.
 */

interface FakeAgentLogRecord {
  method: string;
  params?: Record<string, unknown>;
  outcome?: string;
  refused?: { code: number; message: string };
  error?: string;
  content?: string;
}

const fakeAgentScript = path.join(__dirname, "fakeAcpAgent.js");

function fakeAgentEntry(logPath: string, behavior?: string): AcpAgentEntry {
  return {
    command: process.execPath,
    args: behavior
      ? [fakeAgentScript, logPath, behavior]
      : [fakeAgentScript, logPath],
    cwd: process.cwd()
  };
}

function readLog(logPath: string): FakeAgentLogRecord[] {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as FakeAgentLogRecord);
  } catch {
    return [];
  }
}

async function waitForLog(
  logPath: string,
  predicate: (records: FakeAgentLogRecord[]) => boolean
): Promise<FakeAgentLogRecord[]> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const records = readLog(logPath);
    if (predicate(records)) {
      return records;
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the fake agent log");
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

function createWorkspace(): { workspace: string; cleanup: () => void } {
  const workspace = mkdtempSync(path.join(tmpdir(), "codetour-acp-"));
  writeFileSync(
    path.join(workspace, "anchor.js"),
    "const first = 1;\nconst second = 2;\n"
  );
  return {
    workspace,
    cleanup: () => rmSync(workspace, { recursive: true, force: true })
  };
}

test("a prompt carries the tour step context and receives the complete answer", async () => {
  const workspace = createWorkspace();
  const logPath = path.join(workspace.workspace, "agent.log");
  const agent = spawnAcpAgent(fakeAgentEntry(logPath));
  try {
    const session = await openAskSession({
      transport: agent,
      cwd: workspace.workspace
    });
    try {
      const deltas: string[] = [];
      const outcome = await session.prompt(
        "What does the second constant do?",
        {
          filePath: "src/anchor.js",
          description: "Two constants",
          code: "const first = 1;\nconst second = 2;"
        },
        { onAssistantText: delta => deltas.push(delta) }
      );

      assert.equal(outcome.stopReason, "end_turn");
      assert.equal(outcome.message, "Tour answer, part two.");
      assert.deepEqual(deltas, ["Tour answer, ", "part two."]);

      const records = await waitForLog(logPath, found =>
        found.some(record => record.method === "session/prompt")
      );
      const prompt = records.find(record => record.method === "session/prompt");
      assert.ok(prompt, "session/prompt was recorded");
      const blocks = (prompt.params as { prompt: { type: string; text: string }[] })
        .prompt;
      assert.equal(blocks.length, 2);
      assert.equal(blocks[0].type, "text");
      assert.match(blocks[0].text, /second constant/);

      const contextBlock = blocks[1].text;
      assert.match(contextBlock, /src\/anchor\.js/);
      assert.match(contextBlock, /Two constants/);
      assert.match(contextBlock, /const second = 2;/);

      // Ask must still be selected and verified before the first prompt.
      assert.ok(
        records.findIndex(record => record.method === "session/set_mode") <
          records.findIndex(record => record.method === "session/prompt"),
        "Ask was selected before the prompt was sent"
      );
    } finally {
      await session.close();
    }
  } finally {
    await agent.dispose();
    workspace.cleanup();
  }
});

test("an ask session starts the ACP entry, advertises no write or terminal capability, and selects Ask", async () => {
  const workspace = createWorkspace();
  const logPath = path.join(workspace.workspace, "agent.log");
  const agent = spawnAcpAgent(fakeAgentEntry(logPath));
  try {
    const session = await openAskSession({
      transport: agent,
      cwd: workspace.workspace
    });
    try {
      // The agent starts in Edit mode, so Ask must have been actively selected.
      assert.equal(session.modeId, "ask");

      const records = await waitForLog(logPath, found =>
        found.some(record => record.method === "session/set_mode")
      );
      const initialize = records.find(record => record.method === "initialize");
      assert.ok(initialize, "initialize was recorded");
      const capabilities = initialize.params?.clientCapabilities as {
        fs?: { readTextFile?: boolean; writeTextFile?: boolean };
        terminal?: boolean;
      };
      assert.equal(capabilities.fs?.readTextFile, true);
      // Absent and false both mean the capability is not announced; the
      // client must opt into neither.
      assert.ok(
        !capabilities.fs?.writeTextFile,
        "no file write capability is announced"
      );
      assert.ok(!capabilities.terminal, "no terminal capability is announced");

      const setMode = records.find(record => record.method === "session/set_mode");
      assert.ok(setMode, "session/set_mode was recorded");
      assert.equal((setMode.params as { modeId: string }).modeId, "ask");

      // No prompt may be sent before Ask is selected and verified.
      assert.ok(
        !records.some(record => record.method === "session/prompt"),
        "no prompt was sent during session start"
      );
    } finally {
      await session.close();
    }
  } finally {
    await agent.dispose();
    workspace.cleanup();
  }
});
