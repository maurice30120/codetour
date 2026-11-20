import { catalogueProfiles, type AcpAgentProfile } from "./agentCatalogue";
import {
  createAcpStepChatResponder,
  type AcpStepChatModelMemory,
  type AcpStepChatResponderHooks
} from "./stepChatAgent";
import {
  StepChatAgentUnavailableError,
  type StepChatAgentIdentity,
  type StepChatResponder
} from "./stepChatContract";

/** The hooks of the ordered responder, over the hooks of one profile's responder. */
export interface FallbackStepChatOptions extends AcpStepChatResponderHooks {
  /**
   * Awaited before a question chooses its Agent Profile: the reading panel's
   * initial Agent Probe is still running, and a question never starts on a
   * profile it has not verified yet.
   */
  whenReady?(): Promise<void>;
  /**
   * Called once the first answer settled: the automatic selection is over,
   * so a later failure retries the same profile instead of falling through.
   */
  onConversationStarted?(): void;
  /**
   * The reader's model choice for one Agent Profile: each profile's responder
   * replays it on every session it opens. A terminal reader has no selector
   * and passes none.
   */
  modelFor?(profileName: string): AcpStepChatModelMemory | undefined;
}

/**
 * Keeps the first answering Agent Profile for the reading session.
 *
 * The candidate list is the whole policy: `profilesFor` returns the profiles a
 * question may try, in order — the current Agent Selection first, and other
 * profiles only while the initial automatic selection may still fall through
 * (ADR 0048). A visible answer belongs to one agent, so a question that
 * already streamed text never splices another one in.
 */
export function createFallbackStepChatResponder(
  profilesFor: (cwd: string) => AcpAgentProfile[] = catalogueProfiles,
  options: FallbackStepChatOptions = {}
): StepChatResponder {
  let active: StepChatResponder | undefined;
  let selected = 0;
  let workspace: string | undefined;
  let generation = 0;
  // Selection, startup and fallback form one operation on the shared session.
  // Queue the whole operation, not just prompts inside an individual profile.
  let pending: Promise<void> = Promise.resolve();

  return {
    async answer(request, events) {
      const attempt = generation;
      const answer = pending.then(async () => {
        if (attempt !== generation) throw new Error("Answer interrupted.");
        if (workspace !== request.workspaceRoot) {
          const previous = active;
          active = undefined;
          selected = 0;
          workspace = request.workspaceRoot;
          await previous?.dispose?.();
        }
        await options.whenReady?.();
        const profiles = profilesFor(request.workspaceRoot);
        const failed: string[] = [];
        for (; selected < profiles.length; selected++) {
          if (attempt !== generation) throw new Error("Answer interrupted.");
          const profile = profiles[selected];
          const current = active ?? createAcpStepChatResponder(profile, {
            ...options,
            model: options.modelFor?.(profile.name)
          });
          active = current;
          let streamed = false;
          events?.onActivity?.(`Connecting to ${profile.name}…`);
          try {
            return await current.answer(request, {
              onAnswerDelta: delta => {
                if (attempt !== generation) return;
                streamed ||= delta.length > 0;
                events?.onAnswerDelta?.(delta);
              },
              onThoughtDelta: delta => {
                if (attempt === generation) events?.onThoughtDelta?.(delta);
              },
              onActivity: message => {
                if (attempt === generation) events?.onActivity?.(`${profile.name} — ${message}`);
              },
              onAgentIdentity: identity => {
                if (attempt === generation) events?.onAgentIdentity?.(identity);
              }
            });
          } catch (error) {
            if (attempt !== generation) throw error;
            // A visible answer belongs to one agent; never splice another into it.
            if (streamed) throw error;
            failed.push(`${profile.name} : ${error instanceof Error ? error.message : String(error)}`);
            active = undefined;
            await current.dispose?.();
            if (attempt !== generation) throw error;
            events?.onActivity?.(`${profile.name} unavailable, trying the next agent…`);
          }
        }
        selected = 0; // A future question retries the ordered list after configuration changes.
        throw new StepChatAgentUnavailableError(
          `No ACP agent available (Copilot → Vibe → Codex → Claude Code). ${failed.join("\n")}`
        );
      });
      const settled = answer.then(
        value => {
          options.onConversationStarted?.();
          return value;
        },
        (error: unknown) => {
          options.onConversationStarted?.();
          throw error;
        }
      );
      // Rejection must free the queue for the next request as well.
      pending = settled.then(() => undefined, () => undefined);
      return settled;
    },
    identity(): StepChatAgentIdentity | undefined {
      const launched = active?.identity?.();
      if (launched) {
        return launched;
      }
      // No agent was launched yet, or the last one was released: the next
      // candidate of the ordered list is only the preselection. Its entry is
      // never started here, so the unknown workspace only names it.
      const candidate = profilesFor(workspace ?? "")[selected];
      return candidate
        ? { agent: candidate.name, effective: false }
        : undefined;
    },
    async selectModel(value: string) {
      if (active?.selectModel) {
        return active.selectModel(value);
      }
      // No agent was launched yet: the choice is remembered for the profile
      // that will answer, exactly like the model it would request on open.
      const candidate = profilesFor(workspace ?? "")[selected];
      options.modelFor?.(candidate?.name ?? "")?.remember(value);
    },
    cancel() {
      generation++;
      active?.cancel?.();
      const previous = active;
      active = undefined;
      // A live agent may ignore cancel. Retire its transport before admitting
      // fresh requests; stale queued requests retain the old generation.
      pending = Promise.resolve(previous?.dispose?.()).then(() => undefined, () => undefined);
    },
    async dispose() {
      generation++;
      const previous = active;
      active = undefined;
      selected = 0;
      workspace = undefined;
      pending = Promise.resolve(previous?.dispose?.()).then(() => undefined, () => undefined);
      await pending;
    }
  };
}
