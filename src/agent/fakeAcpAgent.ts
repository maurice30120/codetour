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

// The first launch cannot authenticate: the ACP handshake is answered with
// an authentication error, exactly like an entry whose account is not
// connected; the relaunched process succeeds.
const AUTH_ERROR_MESSAGE =
  "Authentication required: connect the Vibe account before asking (401).";
let authRequired = false;
if (behavior === "auth-fail-once") {
  let booted = false;
  try {
    booted = readFileSync(logPath, "utf8").includes('"boot"');
  } catch {
    booted = false;
  }
  if (!booted) {
    log({ method: "boot", outcome: "auth-required" });
    authRequired = true;
  }
}

// Every launch records its own process id, so a client test can prove that
// the probe released the process it started. The record's name deliberately
// avoids the `"boot"` marker the behaviours above use.
log({ method: "agent-process", pid: process.pid });

/** Safety net: never outlive a broken test run. */
setTimeout(() => process.exit(0), 120_000).unref();
process.stdin.on("end", () => process.exit(0));

interface FakeAgentLogRecord {
  method: string;
  /** The process that wrote the record, for the client's release checks. */
  pid?: number;
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
// The session configuration options this launch announces: a model selector,
// other options the client must ignore, or none at all.
let configOptions: acp.SessionConfigOption[] = modelConfigOptions();

function modelConfigOptions(): acp.SessionConfigOption[] {
  switch (behavior) {
    case "model-option":
    case "model-refused":
    case "model-notification":
      return [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "smart",
          // Grouped values: the client flattens the groups.
          options: <acp.SessionConfigSelectOptions>[
            {
              group: "standard",
              name: "Standard",
              options: [
                { value: "fast", name: "Fast" },
                { value: "balanced", name: "Balanced" }
              ]
            },
            {
              group: "premium",
              name: "Premium",
              options: [{ value: "smart", name: "Smart" }]
            }
          ]
        },
        {
          id: "model_config",
          name: "Model configuration",
          category: "model_config",
          type: "select",
          currentValue: "default",
          options: [{ value: "default", name: "Default" }]
        },
        {
          id: "thought_level",
          name: "Thought level",
          category: "thought_level",
          type: "select",
          currentValue: "medium",
          options: [{ value: "medium", name: "Medium" }]
        },
        { id: "web-search", name: "Web search", type: "boolean", currentValue: true }
      ];
    case "model-option-by-id":
      // No category: only the id "model" identifies this selector.
      return [
        {
          id: "model",
          name: "Model",
          type: "select",
          currentValue: "fast",
          options: [{ value: "fast", name: "Fast" }]
        }
      ];
    case "model-option-absent":
      // Every option but a model selector: a model configuration, a thought
      // level and a boolean toggle.
      return [
        {
          id: "model_config",
          name: "Model configuration",
          category: "model_config",
          type: "select",
          currentValue: "default",
          options: [{ value: "default", name: "Default" }]
        },
        {
          id: "thought_level",
          name: "Thought level",
          category: "thought_level",
          type: "select",
          currentValue: "medium",
          options: [{ value: "medium", name: "Medium" }]
        },
        { id: "web-search", name: "Web search", type: "boolean", currentValue: true }
      ];
    default:
      return [];
  }
}

/** Applies one value to the fake's configuration options, as an agent would. */
function applyConfigValue(configId: string, value: acp.SessionConfigValueId | boolean): void {
  configOptions = configOptions.map(option =>
    option.id !== configId || option.type !== "select"
      ? option
      : { ...option, currentValue: value as acp.SessionConfigValueId }
  );
}

agent.onRequest(acp.methods.agent.initialize, context => {
  log({
    method: "initialize",
    params: context.params as unknown as Record<string, unknown>,
    outcome: authRequired ? "auth-failed" : undefined,
    error: authRequired ? AUTH_ERROR_MESSAGE : undefined
  });
  if (behavior === "silent-start") return new Promise<acp.InitializeResponse>(() => undefined);
  if (authRequired) {
    throw new acp.RequestError(-32001, AUTH_ERROR_MESSAGE);
  }
  if (behavior === "auth-required" || behavior === "auth-text-only") {
    // An agent that requires authentication announces how to get one; the
    // catalogue keeps these methods with the probed state.
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {},
      authMethods: [
        { id: "copilot-login", name: "Copilot login", description: null }
      ]
    };
  }
  return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: {} };
});

agent.onRequest(acp.methods.agent.session.new, context => {
  // "auth-required" signals it with the ACP authentication error code, the
  // only signal the client reads; "auth-text-only" only says it in words, so
  // a client sniffing the message would be wrong.
  if (behavior === "auth-required") {
    log({ method: "session/new", outcome: "auth-required" });
    throw acp.RequestError.authRequired(undefined, "Connect the account before asking.");
  }
  if (behavior === "auth-text-only") {
    log({ method: "session/new", outcome: "auth-text-only" });
    throw new acp.RequestError(-32001, AUTH_ERROR_MESSAGE);
  }
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
  if (behavior === "read-only-mode") {
    availableModes = [{ id: "edit", name: "Edit" }, { id: "read-only", name: "Read-only" }];
  }
  if (behavior === "ask-mode-by-name") {
    availableModes = [
      { id: "edit", name: "Edit" },
      { id: "qa", name: "Ask" }
    ];
  }
  return {
    sessionId,
    modes: { availableModes, currentModeId },
    ...(configOptions.length ? { configOptions } : {})
  };
});

agent.onRequest(acp.methods.agent.session.setConfigOption, context => {
  const params = context.params;
  if (behavior === "model-refused") {
    // The agent refuses the value: the client must keep the value the agent
    // already confirms, never display the refused one.
    log({
      method: "session/set_config_option",
      params: params as unknown as Record<string, unknown>,
      outcome: "refused"
    });
    throw new acp.RequestError(-32603, "This model is not available on your plan.");
  }
  log({
    method: "session/set_config_option",
    params: params as unknown as Record<string, unknown>
  });
  applyConfigValue(params.configId, params.value);
  // The response carries the full set of options and their confirmed values.
  return { configOptions };
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

  if (behavior === "model-notification") {
    // The agent changes model by itself, in the middle of a turn, and reports
    // the whole set of options: the client must follow the agent's value.
    applyConfigValue("model", "fast");
    await notify({ sessionUpdate: "config_option_update", configOptions });
  }

  switch (behavior) {
    case "ignore-cancel-once": {
      const prompts = readFileSync(logPath, "utf8").split("\n")
        .filter(line => line.includes('"session/prompt"')).length;
      if (prompts === 1) await new Promise<never>(() => undefined);
      await chunk("Tour answer after restart.");
      return { stopReason: "end_turn" } as acp.PromptResponse;
    }
    case "prompt-fails":
      throw new acp.RequestError(-32001, "Authentication required at prompt time");
    case "partial-fails":
      await chunk("Partial answer");
      throw new acp.RequestError(-32001, "Connection lost after partial answer");
    case "thinking":
      await notify({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Analyse de la constante <script>unsafe</script>" } });
      await chunk("Réponse finale.");
      return { stopReason: "end_turn" } as acp.PromptResponse;
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
    case "close-stream-mid-prompt-once":
    case "exit-mid-prompt-once": {
      // The first prompt kills the agent process before answering; the
      // relaunched process answers the retry.
      let prompts = 0;
      try {
        prompts = readFileSync(logPath, "utf8")
          .split("\n")
          .filter(line => line.includes('"session/prompt"')).length;
      } catch {
        prompts = 1;
      }
      if (prompts < 2) {
        if (behavior === "close-stream-mid-prompt-once") {
          process.stdout.end();
          // Keep the process alive after EOF to expose stream/exit ordering.
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        process.exit(3);
      }
      await chunk("Tour answer, ");
      await chunk("part two.");
      return { stopReason: "end_turn" } as acp.PromptResponse;
    }
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
