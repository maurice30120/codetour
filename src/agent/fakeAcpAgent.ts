#!/usr/bin/env node
import * as acp from "@agentclientprotocol/sdk";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

/**
 * A deterministic fake ACP agent used by the session-layer tests. It runs as
 * a real child process speaking ACP over NDJSON stdio, exactly like the
 * installed Vibe entry, records every request it receives into a JSON log,
 * and exposes scripted behaviors so tests can drive complete answers,
 * cancellations and forbidden requests without any real model.
 *
 * Usage: node fakeAcpAgent.js <logPath> [behavior]
 */

const logPath = process.argv[2];
const behavior = process.argv[3] ?? "default";
if (!logPath) {
  process.stderr.write("usage: fakeAcpAgent <logPath> [behavior]\n");
  process.exit(2);
}

if (behavior === "launch-fail-once") {
  // The first launch dies before speaking ACP; the retry boots normally.
  let booted = false;
  try {
    booted = readFileSync(logPath, "utf8").includes('"boot"');
  } catch {
    booted = false;
  }
  if (!booted) {
    log({ method: "boot", outcome: "failed" });
    process.exit(1);
  }
}

/** Safety net: never outlive a broken test run. */
setTimeout(() => process.exit(0), 120_000).unref();
process.stdin.on("end", () => process.exit(0));

interface FakeAgentLogRecord {
  method: string;
  params?: Record<string, unknown>;
  outcome?: string;
  refused?: { code: number; message: string };
  error?: string;
  content?: string;
}

function log(record: FakeAgentLogRecord): void {
  appendFileSync(logPath, JSON.stringify(record) + "\n");
}

interface PromptContext {
  params: acp.PromptRequest;
  client: {
    notify(
      method: "session/update",
      params: acp.SessionNotification
    ): Promise<void>;
    request<Response, Params>(
      method: string,
      params?: Params
    ): Promise<Response>;
  };
}

const agent = acp.agent({ name: "fake-acp-agent" });
let sessionId = "fake-session";
let currentModeId = "edit";
let promptAbort: AbortController | null = null;
let promptCount = 0;
let sessionCwd = "";

agent.onRequest(acp.methods.agent.initialize, context => {
  log({
    method: "initialize",
    params: context.params as unknown as Record<string, unknown>
  });
  return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: {} };
});

agent.onRequest(acp.methods.agent.session.new, context => {
  sessionCwd = context.params.cwd;
  log({
    method: "session/new",
    params: context.params as unknown as Record<string, unknown>
  });
  let availableModes = [
    { id: "edit", name: "Edit" },
    { id: "ask", name: "Ask" }
  ];
  if (behavior === "no-ask-mode") {
    availableModes = [{ id: "edit", name: "Edit" }];
  }
  if (behavior === "ask-mode-by-name") {
    availableModes = [
      { id: "edit", name: "Edit" },
      { id: "qa", name: "Ask" }
    ];
  }
  return {
    sessionId,
    modes: { availableModes, currentModeId }
  };
});

agent.onRequest(acp.methods.agent.session.setMode, async context => {
  currentModeId = context.params.modeId;
  log({
    method: "session/set_mode",
    params: context.params as unknown as Record<string, unknown>
  });
  await context.client.notify(acp.methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "current_mode_update",
      currentModeId
    }
  });
  return {};
});

agent.onRequest(acp.methods.agent.session.prompt, async context => {
  const params = context.params;
  log({
    method: "session/prompt",
    params: params as unknown as Record<string, unknown>
  });
  const abort = new AbortController();
  promptAbort = abort;
  promptCount += 1;
  const notify = (update: acp.SessionUpdate) =>
    context.client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update
    });
  const chunk = (text: string) =>
    notify({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text }
    });

  switch (behavior) {
    case "mode-drift":
      // Leaves Ask mode in the middle of a turn; the client must notice
      // from the current_mode_update, not from the mode name it selected.
      currentModeId = "edit";
      await notify({
        sessionUpdate: "current_mode_update",
        currentModeId: "edit"
      });
      await chunk("Answered from Edit mode.");
      return { stopReason: "end_turn" } as acp.PromptResponse;
    case "slow":
      if (promptCount > 1) {
        await chunk("Tour answer, ");
        await chunk("part two.");
        return { stopReason: "end_turn" } as acp.PromptResponse;
      }
      await chunk("Working");
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 15_000);
        abort.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      return {
        stopReason: abort.signal.aborted ? "cancelled" : "end_turn"
      } as acp.PromptResponse;
    case "rogue":
      return rogueTurn(context as PromptContext, notify, chunk);
    case "permission-read":
      return permissionReadTurn(context as PromptContext, notify, chunk);
    default:
      await chunk("Tour answer, ");
      await chunk("part two.");
      return { stopReason: "end_turn" } as acp.PromptResponse;
  }
});

agent.onNotification(acp.methods.agent.session.cancel, context => {
  log({
    method: "session/cancel",
    params: context.params as unknown as Record<string, unknown>
  });
  promptAbort?.abort();
});

async function rogueTurn(
  context: PromptContext,
  notify: (update: acp.SessionUpdate) => Promise<void>,
  chunk: (text: string) => Promise<void>
): Promise<acp.PromptResponse> {
  // Executes a forbidden edit tool directly, without asking permission.
  await notify({
    sessionUpdate: "tool_call",
    toolCallId: "rogue-edit",
    title: "Editing the workspace anyway",
    kind: "edit",
    status: "completed"
  });
  // Asks the client to write a file even though no write capability exists.
  try {
    await context.client.request(acp.methods.client.fs.writeTextFile, {
      sessionId: context.params.sessionId,
      path: "/tmp/acp-rogue-write.txt",
      content: "rogue"
    });
    log({ method: "fs/write_text_file", outcome: "allowed" });
  } catch (error) {
    log({ method: "fs/write_text_file", refused: toRefusal(error) });
  }
  // Requests permission for an execute tool the client must refuse.
  const permission = await context.client.request<
    acp.RequestPermissionResponse,
    acp.RequestPermissionRequest
  >(
    acp.methods.client.session.requestPermission,
    {
      sessionId: context.params.sessionId,
      toolCall: {
        toolCallId: "rogue-execute",
        title: "Running a command",
        kind: "execute",
        status: "pending"
      },
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "reject", name: "Reject", kind: "reject_once" }
      ]
    }
  );
  log({
    method: "session/request_permission",
    params: { kind: "execute" },
    outcome:
      permission.outcome.outcome === "selected"
        ? permission.outcome.optionId
        : permission.outcome.outcome
  });
  // Asks for a terminal even though the client announces none.
  try {
    await context.client.request(acp.methods.client.terminal.create, {
      sessionId: context.params.sessionId,
      command: "echo rogue"
    });
    log({ method: "terminal/create", outcome: "allowed" });
  } catch (error) {
    log({ method: "terminal/create", refused: toRefusal(error) });
  }
  await chunk("I did it anyway.");
  return { stopReason: "end_turn" };
}

async function permissionReadTurn(
  context: PromptContext,
  notify: (update: acp.SessionUpdate) => Promise<void>,
  chunk: (text: string) => Promise<void>
): Promise<acp.PromptResponse> {
  await notify({
    sessionUpdate: "tool_call",
    toolCallId: "read-tool",
    title: "Reading the displayed file",
    kind: "read",
    status: "in_progress"
  });
  const permission = await context.client.request<
    acp.RequestPermissionResponse,
    acp.RequestPermissionRequest
  >(
    acp.methods.client.session.requestPermission,
    {
      sessionId: context.params.sessionId,
      toolCall: {
        toolCallId: "read-tool",
        title: "Reading the displayed file",
        kind: "read",
        status: "in_progress"
      },
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "reject", name: "Reject", kind: "reject_once" }
      ]
    }
  );
  // A read outside the session workspace must be refused.
  try {
    await context.client.request<acp.ReadTextFileResponse, acp.ReadTextFileRequest>(
      acp.methods.client.fs.readTextFile,
      {
        sessionId: context.params.sessionId,
        path: "/etc/hostname"
      }
    );
    log({ method: "fs/read_text_file", params: { path: "/etc/hostname" }, outcome: "allowed" });
  } catch (error) {
    log({
      method: "fs/read_text_file",
      params: { path: "/etc/hostname" },
      refused: toRefusal(error)
    });
  }
  // A read inside the workspace must be served.
  try {
    const file = await context.client.request<
      acp.ReadTextFileResponse,
      acp.ReadTextFileRequest
    >(acp.methods.client.fs.readTextFile, {
      sessionId: context.params.sessionId,
      path: join(sessionCwd, "anchor.js")
    });
    log({
      method: "fs/read_text_file",
      params: { path: "anchor.js" },
      outcome: "allowed",
      content: file.content
    });
  } catch (error) {
    log({
      method: "fs/read_text_file",
      params: { path: "anchor.js" },
      refused: toRefusal(error)
    });
  }
  log({
    method: "session/request_permission",
    params: { kind: "read" },
    outcome:
      permission.outcome.outcome === "selected"
        ? permission.outcome.optionId
        : permission.outcome.outcome
  });
  await notify({
    sessionUpdate: "tool_call_update",
    toolCallId: "read-tool",
    status: "completed"
  });
  await chunk("Read allowed.");
  return { stopReason: "end_turn" };
}

function toRefusal(error: unknown): { code: number; message: string } {
  if (error instanceof acp.RequestError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: -1,
    message: error instanceof Error ? error.message : String(error)
  };
}

agent.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout) as unknown as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>
  )
);
