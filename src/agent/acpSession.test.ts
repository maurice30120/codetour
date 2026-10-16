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

test("an Ask mode is also selected by name when its id differs", async () => {
  const workspace = createWorkspace();
  const logPath = path.join(workspace.workspace, "agent.log");
  const agent = spawnAcpAgent(fakeAgentEntry(logPath, "ask-mode-by-name"));
  try {
    const session = await openAskSession({
      transport: agent,
      cwd: workspace.workspace
    });
    try {
      // The agent names its Ask mode "Ask" but identifies it as "qa": the
      // session must still select it and allow prompting against that id.
      assert.equal(session.modeId, "qa");
      const outcome = await session.prompt("Question", {
        filePath: "src/anchor.js",
        description: "Two constants",
        code: "const first = 1;"
      });
      assert.equal(outcome.stopReason, "end_turn");

      const records = await waitForLog(logPath, found =>
        found.some(record => record.method === "session/set_mode")
      );
      const setMode = records.find(
        record => record.method === "session/set_mode"
      );
      assert.equal((setMode!.params as { modeId: string }).modeId, "qa");
    } finally {
      await session.close();
    }
  } finally {
    await agent.dispose();
    workspace.cleanup();
  }
});

test("a mode change away from Ask is detected and the next question is refused", async () => {
  const workspace = createWorkspace();
  const logPath = path.join(workspace.workspace, "agent.log");
  const agent = spawnAcpAgent(fakeAgentEntry(logPath, "mode-drift"));
  try {
    const session = await openAskSession({
      transport: agent,
      cwd: workspace.workspace
    });
    try {
      assert.equal(session.modeId, "ask");
      const context = {
        filePath: "src/anchor.js",
        description: "Two constants",
        code: "const first = 1;"
      };

      const outcome = await session.prompt("Question", context);
      assert.equal(outcome.stopReason, "end_turn");
      assert.equal(outcome.message, "Answered from Edit mode.");

      // The drift was tracked from the agent's own mode update, so the
      // session refuses to prompt outside Ask even though it never saw a
      // set_mode request.
      assert.equal(session.modeId, "edit");
      await assert.rejects(
        session.prompt("Another question", context),
        /only prompts in Ask mode/
      );
    } finally {
      await session.close();
    }
  } finally {
    await agent.dispose();
    workspace.cleanup();
  }
});

test("a session refuses to open without an Ask mode", async () => {
  const workspace = createWorkspace();
  const logPath = path.join(workspace.workspace, "agent.log");
  const agent = spawnAcpAgent(fakeAgentEntry(logPath, "no-ask-mode"));
  try {
    await assert.rejects(
      openAskSession({ transport: agent, cwd: workspace.workspace }),
      /does not offer an Ask mode/
    );
  } finally {
    await agent.dispose();
    workspace.cleanup();
  }
});

test("a session fails fast when the ACP entry exits at launch", async () => {
  const workspace = createWorkspace();
  try {
    const agent = spawnAcpAgent({
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
      cwd: workspace.workspace
    });
    try {
      await assert.rejects(
        openAskSession({ transport: agent, cwd: workspace.workspace }),
        /before the session could start|ENOENT/
      );
    } finally {
      await agent.dispose();
    }
  } finally {
    workspace.cleanup();
  }
});

test("closing the session interrupts the in-flight turn and releases the agent process", async () => {
  const workspace = createWorkspace();
  const logPath = path.join(workspace.workspace, "agent.log");
  const agent = spawnAcpAgent(fakeAgentEntry(logPath, "slow"));
  try {
    const session = await openAskSession({
      transport: agent,
      cwd: workspace.workspace
    });
    const outcomePromise = session.prompt("A slow question", {
      filePath: "src/anchor.js",
      description: "Two constants",
      code: "const first = 1;"
    });
    await waitForLog(logPath, records =>
      records.some(record => record.method === "session/prompt")
    );

    await session.close();
    await assert.rejects(outcomePromise);
    await assert.rejects(
      session.prompt("After close", {
        filePath: "src/anchor.js",
        description: "Two constants",
        code: "const first = 1;"
      }),
      /closed/
    );
    // Closing twice stays a clean no-op.
    await session.close();

    // The agent process is actually released.
    await Promise.race([
      agent.exited,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("the agent process did not exit")),
          5000
        )
      )
    ]);
  } finally {
    await agent.dispose();
    workspace.cleanup();
  }
});

test("the client refuses write and terminal requests and verifies the tools the agent really ran", async () => {
  const workspace = createWorkspace();
  const logPath = path.join(workspace.workspace, "agent.log");
  const agent = spawnAcpAgent(fakeAgentEntry(logPath, "rogue"));
  try {
    const session = await openAskSession({
      transport: agent,
      cwd: workspace.workspace
    });
    try {
      const tools: {
        toolCallId: string;
        kind?: string;
        forbidden: boolean;
      }[] = [];
      const outcome = await session.prompt(
        "Rogue question",
        {
          filePath: "src/anchor.js",
          description: "Two constants",
          code: "const first = 1;"
        },
        { onToolUse: tool => tools.push(tool) }
      );

      // The turn completes even though the agent misbehaved, and every
      // forbidden action is visible beyond the Ask mode name.
      assert.equal(outcome.stopReason, "end_turn");
      assert.equal(outcome.message, "I did it anyway.");
      assert.ok(outcome.usedForbiddenTools);
      const editTool = outcome.tools.find(tool => tool.toolCallId === "rogue-edit");
      assert.ok(editTool, "the executed edit tool was tracked");
      assert.equal(editTool!.kind, "edit");
      assert.equal(editTool!.status, "completed");
      assert.equal(editTool!.forbidden, true);
      assert.ok(
        tools.some(tool => tool.toolCallId === "rogue-edit" && tool.forbidden),
        "the tool event reported the forbidden use"
      );

      const records = await waitForLog(logPath, found =>
        found.some(record => record.method === "terminal/create")
      );
      const writeRefusal = records.find(
        record => record.method === "fs/write_text_file"
      );
      assert.ok(writeRefusal, "the write request was recorded");
      assert.ok(writeRefusal!.refused, "the write request was refused");
      assert.equal(writeRefusal!.refused!.code, -32601);
      assert.match(
        writeRefusal!.refused!.message,
        /does not provide file writing/
      );

      const terminalRefusal = records.find(
        record => record.method === "terminal/create"
      );
      assert.ok(terminalRefusal, "the terminal request was recorded");
      assert.ok(terminalRefusal!.refused, "the terminal request was refused");

      const executePermission = records.find(
        record =>
          record.method === "session/request_permission" &&
          record.params?.kind === "execute"
      );
      assert.ok(executePermission, "the execute permission request was recorded");
      assert.equal(executePermission!.outcome, "reject");
    } finally {
      await session.close();
    }
  } finally {
    await agent.dispose();
    workspace.cleanup();
  }
});

test("read-only tool use is granted once, served inside the workspace only, and reported as allowed", async () => {
  const workspace = createWorkspace();
  const logPath = path.join(workspace.workspace, "agent.log");
  const agent = spawnAcpAgent(fakeAgentEntry(logPath, "permission-read"));
  try {
    const session = await openAskSession({
      transport: agent,
      cwd: workspace.workspace
    });
    try {
      const outcome = await session.prompt("Read question", {
        filePath: "src/anchor.js",
        description: "Two constants",
        code: "const first = 1;"
      });

      assert.equal(outcome.stopReason, "end_turn");
      assert.equal(outcome.message, "Read allowed.");
      assert.ok(!outcome.usedForbiddenTools);
      const readTool = outcome.tools.find(
        tool => tool.toolCallId === "read-tool"
      );
      assert.ok(readTool, "the read tool was tracked");
      assert.equal(readTool!.kind, "read");
      assert.equal(readTool!.status, "completed");
      assert.equal(readTool!.forbidden, false);

      const records = await waitForLog(logPath, found =>
        found.some(
          record =>
            record.method === "fs/read_text_file" &&
            record.params?.path === "anchor.js"
        )
      );
      const permission = records.find(
        record => record.method === "session/request_permission"
      );
      assert.ok(permission, "the read permission request was recorded");
      assert.equal(permission!.outcome, "allow");

      const outsideRead = records.find(
        record =>
          record.method === "fs/read_text_file" &&
          record.params?.path === "/etc/hostname"
      );
      assert.ok(outsideRead, "the outside read was recorded");
      assert.ok(outsideRead!.refused, "the outside read was refused");

      const insideRead = records.find(
        record =>
          record.method === "fs/read_text_file" &&
          record.params?.path === "anchor.js"
      );
      assert.ok(insideRead, "the inside read was recorded");
      assert.equal(insideRead!.outcome, "allowed");
      assert.match(insideRead!.content ?? "", /const first = 1;/);
    } finally {
      await session.close();
    }
  } finally {
    await agent.dispose();
    workspace.cleanup();
  }
});

test("cancelling interrupts an in-flight answer and frees the session for the next question", async () => {
  const workspace = createWorkspace();
  const logPath = path.join(workspace.workspace, "agent.log");
  const agent = spawnAcpAgent(fakeAgentEntry(logPath, "slow"));
  try {
    const session = await openAskSession({
      transport: agent,
      cwd: workspace.workspace
    });
    try {
      const context = {
        filePath: "src/anchor.js",
        description: "Two constants",
        code: "const first = 1;"
      };
      const outcomePromise = session.prompt("A slow question", context);

      // A second prompt must not start while a turn is in flight.
      await assert.rejects(
        session.prompt("An overlapping question", context),
        /already in flight/
      );

      await waitForLog(logPath, records =>
        records.some(record => record.method === "session/prompt")
      );
      session.cancel();

      const outcome = await outcomePromise;
      assert.equal(outcome.stopReason, "cancelled");
      assert.equal(outcome.message, "Working");

      const records = await waitForLog(logPath, found =>
        found.some(record => record.method === "session/cancel")
      );
      assert.ok(
        records.some(record => record.method === "session/cancel"),
        "the agent received the cancellation"
      );

      // The session is cleanly released: the next question gets a full answer.
      const followUp = await session.prompt("A follow-up question", context);
      assert.equal(followUp.stopReason, "end_turn");
      assert.equal(followUp.message, "Tour answer, part two.");
    } finally {
      await session.close();
    }
  } finally {
    await agent.dispose();
    workspace.cleanup();
  }
});

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


test("an unresponsive agent fails startup within the deadline", async () => {
  const workspace = createWorkspace();
  const agent = spawnAcpAgent(fakeAgentEntry(path.join(workspace.workspace, "agent.log"), "silent-start"));
  try {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await assert.rejects(Promise.race([
        openAskSession({ transport: agent, cwd: workspace.workspace, startupTimeoutMs: 100 }),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("startup hung")), 1000); })
      ]), /démarrage.*délai/i);
    } finally {
      clearTimeout(deadline);
    }
  } finally {
    await agent.dispose();
    workspace.cleanup();
  }
});


test("a provider selects its exact read-only mode", async () => {
  const workspace = createWorkspace();
  const agent = spawnAcpAgent(fakeAgentEntry(path.join(workspace.workspace, "agent.log"), "read-only-mode"));
  try {
    const session = await openAskSession({ transport: agent, cwd: workspace.workspace, modeId: "read-only" });
    assert.equal(session.modeId, "read-only");
    const result = await session.prompt("Explain", { filePath: "anchor.js", description: "Constants", code: "const first = 1;" });
    assert.match(result.message, /Tour answer/);
    await session.close();
  } finally { await agent.dispose(); workspace.cleanup(); }
});


for (const behavior of ["default", "rogue"]) {
  test(`Copilot default mode preserves read-only checks (${behavior})`, async () => {
    const workspace = createWorkspace();
    const logPath = path.join(workspace.workspace, "agent.log");
    const agent = spawnAcpAgent(fakeAgentEntry(logPath, behavior));
    try {
      const session = await openAskSession({ transport: agent, cwd: workspace.workspace,
        useDefaultMode: true });
      assert.equal(session.modeId, "edit");
      const outcome = await session.prompt("Explain", { filePath: "anchor.js", description: "Constants", code: "const first = 1;" });
      if (behavior === "rogue") {
        assert.equal(outcome.usedForbiddenTools, true);
        const records = readLog(logPath);
        assert.ok(records.some(row => row.refused?.message.includes("file writing")));
        assert.ok(records.some(row => row.refused?.message.includes("terminals")));
      }
      assert.equal(readLog(logPath).some(row => row.method === "session/set_mode"), false);
      await session.close();
    } finally { await agent.dispose(); workspace.cleanup(); }
  });
}
