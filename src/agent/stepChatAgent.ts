import type { AcpAgentEntry, AcpAgentProcess } from "./acpAgentProcess";
import { spawnAcpAgent } from "./acpAgentProcess";
import type { AskSession, TourStepContext } from "./acpSession";
import { openAskSession } from "./acpSession";
import {
  StepChatAgentUnavailableError,
  type StepChatContext,
  type StepChatRequest,
  type StepChatResponder
} from "../player/stepChat";

/**
 * The Tour Step Conversation agent: the webview chat's responder built on
 * the ACP session layer. The agent is launched lazily by its installed ACP
 * entry on the first question — Vibe in production, the deterministic fake
 * agent at the same process boundary in tests — kept for the whole reading
 * session, and its Ask mode is selected and verified by the session layer
 * before the first prompt.
 */

export interface AcpStepChatResponderHooks {
  /**
   * Observes every spawned ACP agent process. The deterministic tests use it
   * to watch the transport; production passes no hooks.
   */
  onProcess?(agent: AcpAgentProcess): void;
}

export interface AcpStepChatResponder extends StepChatResponder {
  /** Cancels any in-flight turn and releases the ACP agent resources. */
  dispose(): Promise<void>;
}

export function createAcpStepChatResponder(
  entryFor: (request: StepChatRequest) => AcpAgentEntry,
  hooks: AcpStepChatResponderHooks = {}
): AcpStepChatResponder {
  let session: AskSession | undefined;
  let agent: AcpAgentProcess | undefined;
  let opening: Promise<AskSession> | undefined;
  // Bumped by dispose so a launch racing the close of the reading webview
  // can never install a leaked session on a fresh conversation.
  let epoch = 0;

  async function openSession(request: StepChatRequest): Promise<AskSession> {
    if (session) {
      return session;
    }
    if (!opening) {
      const myEpoch = epoch;
      const entry = entryFor(request);
      const spawned = spawnAcpAgent(entry);
      agent = spawned;
      hooks.onProcess?.(spawned);
      opening = openAskSession({ transport: spawned, cwd: entry.cwd }).then(
        opened => {
          if (myEpoch !== epoch) {
            opened.close().catch(() => undefined);
            throw new Error(
              "The tour step conversation closed while the agent was starting."
            );
          }
          session = opened;
          return opened;
        },
        error => {
          if (myEpoch === epoch) {
            opening = undefined;
            spawned.dispose().catch(() => undefined);
          }
          throw new StepChatAgentUnavailableError(
            `Impossible de lancer l'agent de conversation : ${messageOf(error)}`
          );
        }
      );
      // Teardown can reject the launch before the caller attaches its own
      // handler; keep that window free of unhandled rejections.
      opening.catch(() => undefined);
    }
    return opening;
  }

  /** True when the agent process behind the session is already gone. */
  async function transportGone(): Promise<boolean> {
    const currentAgent = agent;
    if (!currentAgent) {
      return false;
    }
    return Promise.race([
      currentAgent.exited.then(
        () => true,
        () => true
      ),
      new Promise<boolean>(resolve => setImmediate(() => resolve(false)))
    ]);
  }

  /** Drops a dead session so the next question relaunches the agent. */
  function releaseBrokenSession(): void {
    const currentSession = session;
    const currentAgent = agent;
    session = undefined;
    agent = undefined;
    opening = undefined;
    if (currentAgent) {
      currentAgent.dispose().catch(() => undefined);
    } else if (currentSession) {
      currentSession.close().catch(() => undefined);
    }
  }

  return {
    async answer(request, events) {
      const current = await openSession(request);
      let outcome;
      try {
        // A crashed agent must never leave the reader waiting on a prompt
        // that can no longer be answered.
        const crashed = agent!.exited.then(
          () => {
            throw new Error("The ACP agent exited during the answer.");
          },
          () => {
            throw new Error("The ACP agent connection broke during the answer.");
          }
        );
        outcome = await Promise.race([
          current.prompt(
            request.question,
            toTourStepContext(request.context),
            // Every streamed chunk of the agent's answer is handed to the
            // chat as it arrives, so the reader never waits for the whole
            // generation to finish.
            events?.onAnswerDelta
              ? { onAssistantText: delta => events.onAnswerDelta?.(delta) }
              : undefined,
            request.history
          ),
          crashed
        ]);
      } catch (error) {
        if (await transportGone()) {
          releaseBrokenSession();
          throw new StepChatAgentUnavailableError(
            `La connexion à l'agent de conversation a été perdue : ${messageOf(error)}`
          );
        }
        throw error;
      }
      if (outcome.usedForbiddenTools) {
        return (
          outcome.message +
          "\n\n> ⚠️ L'agent a exécuté un outil interdit (écriture, suppression ou exécution) pendant cette réponse."
        );
      }
      return outcome.message;
    },
    async dispose() {
      epoch++;
      const currentSession = session;
      const currentAgent = agent;
      session = undefined;
      agent = undefined;
      opening = undefined;
      if (currentSession) {
        await currentSession.close().catch(() => undefined);
      } else if (currentAgent) {
        await currentAgent.dispose().catch(() => undefined);
      }
    }
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Maps the resolver-captured step context onto the prompt context. An
 * unavailable target is reported as such; no other file's code is ever
 * substituted for the missing display.
 */
function toTourStepContext(context: StepChatContext): TourStepContext {
  if (context.available) {
    // A diff step shows two snapshots: both sides are transmitted, each
    // identified with its own path and Git commit, so the agent discusses
    // the comparison the reader actually sees.
    if ("diff" in context) {
      const { original, modified } = context.diff;
      return {
        filePath: context.path,
        description: context.description,
        code: [
          `Original (${original.ref}) ${original.path}:`,
          "```",
          original.code,
          "```",
          `Modified (${modified.ref}) ${modified.path}:`,
          "```",
          modified.code,
          "```"
        ].join("\n")
      };
    }
    return {
      filePath: context.path ?? "",
      description: context.description,
      code: context.code
    };
  }
  return {
    filePath: context.path ?? "",
    description: context.description,
    code: "",
    codeUnavailable: true
  };
}
