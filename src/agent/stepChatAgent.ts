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

  return {
    async answer(request) {
      const current = await openSession(request);
      const outcome = await current.prompt(
        request.question,
        toTourStepContext(request.context),
        undefined,
        request.history
      );
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

/**
 * Maps the resolver-captured step context onto the prompt context. An
 * unavailable target is reported as such; no other file's code is ever
 * substituted for the missing display.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toTourStepContext(context: StepChatContext): TourStepContext {
  if (context.available) {
    return {
      filePath: context.path,
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
