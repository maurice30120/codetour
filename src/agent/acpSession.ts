import * as acp from "@agentclientprotocol/sdk";
import { readFile as readFileFromDisk } from "node:fs/promises";
import * as path from "node:path";

import type { AcpAgentTransport } from "./acpAgentProcess";

/**
 * A session layer for Tour Step Conversations over ACP. The extension side is
 * a read-only client: it never announces file writing or terminals, refuses
 * the corresponding agent requests, and checks the tools the agent actually
 * executes rather than trusting the Ask mode name alone.
 */

/** Kinds of tools an agent can execute during a session. */
export type AcpToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

/**
 * Tool kinds the reader never accepts from the agent, whatever the current
 * mode claims. A Tour Step Conversation may only read and explain code.
 */
export const FORBIDDEN_TOOL_KINDS: readonly AcpToolKind[] = [
  "edit",
  "delete",
  "move",
  "execute"
];

/** Tool kinds a read-only client may grant without user escalation. */
const ALLOWED_TOOL_KINDS: readonly AcpToolKind[] = [
  "read",
  "search",
  "fetch",
  "think"
];

const ASK_MODE_ID = "ask";
const ASK_MODE_NAME = "ask";
const CLIENT_NAME = "codetour";

/** The code, path and explanation of the Tour Step a question is about. */
export interface TourStepContext {
  /** Display path of the step's code, as shown to the reader. */
  filePath: string;
  /** The step's explanation. */
  description: string;
  /** The code exactly as displayed for this step. */
  code: string;
}

/** A tool the agent executed during a prompt turn. */
export interface ExecutedToolUse {
  toolCallId: string;
  kind?: AcpToolKind;
  status?: string;
  title?: string;
  /** True when the agent ran a forbidden tool kind despite Ask mode. */
  forbidden: boolean;
}

export type PromptStopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled";

/** What a prompt turn produced. */
export interface PromptOutcome {
  stopReason: PromptStopReason;
  /** The assistant's full answer, assembled from the streamed chunks. */
  message: string;
  /** Tools the agent actually executed during the turn. */
  tools: ExecutedToolUse[];
  /** True when at least one forbidden tool kind ran during the turn. */
  usedForbiddenTools: boolean;
}

/** Streaming callbacks for a single prompt turn. */
export interface AskSessionEvents {
  /** Called for each assistant text chunk as it arrives. */
  onAssistantText?(delta: string): void;
  /** Called each time the agent starts or updates a tool call. */
  onToolUse?(tool: ExecutedToolUse): void;
}

/** A read-only Ask conversation with an ACP agent. */
export interface AskSession {
  readonly sessionId: string;
  /** The verified current mode; prompts are refused outside Ask. */
  readonly modeId: string;
  /**
   * Sends the reader's question with the context of its Tour Step and
   * resolves once the agent's answer is complete.
   */
  prompt(
    question: string,
    context: TourStepContext,
    events?: AskSessionEvents
  ): Promise<PromptOutcome>;
  /** Interrupts the prompt turn in flight, if any. */
  cancel(): void;
  /** Cancels any in-flight turn and releases the ACP agent resources. */
  close(): Promise<void>;
}

export interface OpenAskSessionOptions {
  transport: AcpAgentTransport;
  cwd: string;
  /**
   * Serves `fs/read_text_file` requests. Defaults to reading files inside the
   * session workspace only.
   */
  readFile?(absolutePath: string): Promise<string>;
}

interface PromptTurn {
  message: string;
  tools: Map<string, ExecutedToolUse>;
  events: AskSessionEvents;
  resolve: (outcome: PromptOutcome) => void;
  reject: (error: unknown) => void;
}

function refuse(capability: string): () => never {
  return () => {
    throw new acp.RequestError(
      -32601,
      `The CodeTour reader does not provide ${capability}.`
    );
  };
}

function isAllowedToolKind(
  kind: AcpToolKind | null | undefined
): boolean {
  return kind !== undefined && kind !== null && ALLOWED_TOOL_KINDS.includes(kind);
}

/**
 * Answers permission requests without user interaction: read-like tools are
 * granted once, and anything that could write, delete or execute is refused
 * with a reject option, or cancelled when the agent offers no way to refuse.
 */
function decidePermission(
  request: acp.RequestPermissionRequest
): acp.RequestPermissionResponse {
  const allowed = isAllowedToolKind(request.toolCall?.kind);
  const preference = allowed
    ? (["allow_once", "allow_always", "reject_once", "reject_always"] as const)
    : (["reject_once", "reject_always"] as const);
  const option = preference
    .map(kind => request.options.find(candidate => candidate.kind === kind))
    .find(candidate => candidate !== undefined);
  if (option) {
    return { outcome: { outcome: "selected", optionId: option.optionId } };
  }
  return { outcome: { outcome: "cancelled" } };
}

function buildPromptBlocks(
  question: string,
  context: TourStepContext
): acp.ContentBlock[] {
  const contextText = [
    "Tour step context the question is about:",
    `File: ${context.filePath}`,
    `Description: ${context.description}`,
    "Code:",
    "```",
    context.code,
    "```"
  ].join("\n");
  return [
    { type: "text", text: question },
    { type: "text", text: contextText }
  ];
}

/**
 * Opens a session with the ACP agent behind the given transport, selects and
 * verifies its Ask mode before any prompt, and returns the conversation.
 */
export function openAskSession(
  options: OpenAskSessionOptions
): Promise<AskSession> {
  return new Promise<AskSession>((openResolve, openReject) => {
    const readTextFile = async (
      params: acp.ReadTextFileRequest
    ): Promise<acp.ReadTextFileResponse> => {
      const base = path.resolve(options.cwd);
      const target = path.resolve(params.path);
      const relative = path.relative(base, target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new acp.RequestError(
          -32602,
          "The tour step conversation only exposes files inside the workspace."
        );
      }
      const content = options.readFile
        ? await options.readFile(target)
        : await readFileFromDisk(target, "utf8");
      return { content };
    };

    let sessionId = "";
    let askModeId = "";
    let turn: PromptTurn | null = null;
    let currentModeId: string | null = null;
    let closed = false;

    const app = acp
      .client({ name: CLIENT_NAME })
      .onRequest(
        acp.methods.client.session.requestPermission,
        requestContext => decidePermission(requestContext.params)
      )
      .onRequest(acp.methods.client.fs.readTextFile, requestContext =>
        readTextFile(requestContext.params)
      )
      .onRequest(
        acp.methods.client.fs.writeTextFile,
        refuse("file writing")
      )
      .onRequest(acp.methods.client.terminal.create, refuse("terminals"))
      .onRequest(acp.methods.client.terminal.output, refuse("terminals"))
      .onRequest(acp.methods.client.terminal.release, refuse("terminals"))
      .onRequest(acp.methods.client.terminal.waitForExit, refuse("terminals"))
      .onRequest(acp.methods.client.terminal.kill, refuse("terminals"))
      .onNotification(acp.methods.client.session.update, notificationContext =>
        handleUpdate(notificationContext.params)
      );

    const connection = app.connect(options.transport.stream);

    const failFast = options.transport.exited.then(() => {
      throw new Error("The ACP agent exited before the session could start.");
    });

    const guard = <T>(operation: Promise<T>): Promise<T> =>
      Promise.race([operation, failFast]);

    function handleUpdate(params: acp.SessionNotification) {
      if (params.sessionId !== sessionId) {
        return;
      }
      const update = params.update;
      switch (update.sessionUpdate) {
        case "agent_message_chunk":
          if (update.content.type === "text" && turn) {
            turn.message += update.content.text;
            turn.events.onAssistantText?.(update.content.text);
          }
          break;
        case "tool_call":
        case "tool_call_update":
          trackTool(update);
          break;
        case "current_mode_update":
          currentModeId = update.currentModeId;
          break;
        default:
          break;
      }
    }

    function trackTool(update: acp.ToolCallUpdate) {
      if (!turn) {
        return;
      }
      const existing = turn.tools.get(update.toolCallId) ?? {
        toolCallId: update.toolCallId,
        forbidden: false
      };
      if (update.kind !== undefined && update.kind !== null) {
        existing.kind = update.kind as AcpToolKind;
      }
      if (update.status !== undefined && update.status !== null) {
        existing.status = update.status;
      }
      if (update.title !== undefined && update.title !== null) {
        existing.title = update.title;
      }
      existing.forbidden =
        existing.kind !== undefined &&
        FORBIDDEN_TOOL_KINDS.includes(existing.kind);
      turn.tools.set(update.toolCallId, existing);
      turn.events.onToolUse?.(existing);
    }

    function finishTurn(response: acp.PromptResponse) {
      if (!turn) {
        return;
      }
      const finished = turn;
      turn = null;
      const tools = [...finished.tools.values()];
      finished.resolve({
        stopReason: response.stopReason,
        message: finished.message,
        tools,
        usedForbiddenTools: tools.some(tool => tool.forbidden)
      });
    }

    function failTurn(error: unknown) {
      if (!turn) {
        return;
      }
      const failed = turn;
      turn = null;
      failed.reject(error);
    }

    const sessionObject: AskSession = {
      get sessionId() {
        return sessionId;
      },
      get modeId() {
        return currentModeId ?? "";
      },
      prompt(question, context, events) {
        if (closed) {
          return Promise.reject(
            new Error("The tour step conversation session is closed.")
          );
        }
        if (turn) {
          return Promise.reject(
            new Error(
              "A prompt is already in flight for this tour step conversation."
            )
          );
        }
        if (currentModeId !== askModeId) {
          return Promise.reject(
            new Error(
              `The agent is in "${currentModeId}" mode; the tour step conversation only prompts in Ask mode.`
            )
          );
        }
        let resolveTurn: (outcome: PromptOutcome) => void = () => undefined;
        let rejectTurn: (error: unknown) => void = () => undefined;
        const turnPromise = new Promise<PromptOutcome>((resolve, reject) => {
          resolveTurn = resolve;
          rejectTurn = reject;
        });
        // Teardown can reject the in-flight turn before the caller attaches
        // its own handler; keep that window free of unhandled rejections.
        turnPromise.catch(() => undefined);
        turn = {
          message: "",
          tools: new Map(),
          events: events ?? {},
          resolve: resolveTurn,
          reject: rejectTurn
        };
        connection.agent
          .request(acp.methods.agent.session.prompt, {
            sessionId: sessionObject.sessionId,
            prompt: buildPromptBlocks(question, context)
          })
          .then(
            response => {
              // The agent's last session/update notifications can still be
              // in flight when the prompt response arrives. Let them drain
              // before the turn completes, so the answer is never missing
              // its final chunks.
              setImmediate(() => finishTurn(response));
            },
            error => {
              setImmediate(() => failTurn(error));
            }
          );
        return turnPromise;
      },
      cancel() {
        if (closed || !turn) {
          return;
        }
        connection.agent
          .notify(acp.methods.agent.session.cancel, {
            sessionId: sessionObject.sessionId
          })
          .catch(() => undefined);
      },
      async close() {
        if (closed) {
          return;
        }
        closed = true;
        if (turn) {
          sessionObject.cancel();
        }
        connection.close();
        await options.transport.dispose();
      }
    };
    guard(
      connection.agent
        .request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            fs: {
              readTextFile: true
            }
          }
        })
        .then(() =>
          connection.agent.request(acp.methods.agent.session.new, {
            cwd: options.cwd,
            mcpServers: []
          })
        )
    )
      .then(newSession => {
        sessionId = newSession.sessionId;
        const modes = newSession.modes;
        if (!modes) {
          throw new Error(
            "The ACP agent did not announce session modes, so the Ask mode cannot be selected or verified."
          );
        }
        const askMode =
          modes.availableModes.find(mode => mode.id === ASK_MODE_ID) ??
          modes.availableModes.find(
            mode => mode.name.toLowerCase() === ASK_MODE_NAME
          );
        if (!askMode) {
          throw new Error(
            `The ACP agent does not offer an Ask mode (offered: ${modes.availableModes
              .map(mode => mode.id)
              .join(", ")}).`
          );
        }
        askModeId = askMode.id;
        currentModeId = modes.currentModeId;
        if (modes.currentModeId !== askMode.id) {
          return guard(
            connection.agent.request(acp.methods.agent.session.setMode, {
              sessionId: newSession.sessionId,
              modeId: askMode.id
            })
          ).then(() => {
            currentModeId = askMode.id;
          });
        }
        return undefined;
      })
      .then(
        () => openResolve(sessionObject),
        (error: unknown) => {
          // A vanished entry usually surfaces first as the SDK's generic
          // connection-closed rejection; give the reader a real cause.
          if (
            error instanceof Error &&
            /ACP connection closed/.test(error.message)
          ) {
            openReject(
              new Error(
                "The ACP agent exited or closed the connection before the session could start."
              )
            );
            return;
          }
          openReject(error);
        }
      );
  });
}
