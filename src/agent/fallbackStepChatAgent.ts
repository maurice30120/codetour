import {
  agentCatalogueLabel,
  catalogueProfiles,
  type AcpAgentProfile
} from "./agentCatalogue";
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
   * Called when one Agent Profile failed an answer before producing any text,
   * with the failure's reason. The reading panel degrades that profile alone;
   * this responder never probes anything itself.
   */
  onProfileFailed?(profileName: string, reason: string): void;
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
 * The candidate list is the whole automatic policy: `profilesFor` returns the
 * profiles a question may try, in order — the current Agent Selection first,
 * and other profiles only while the initial automatic selection may still
 * fall through (ADR 0048). A visible answer belongs to one agent, so a
 * question that already streamed text never splices another one in. Once an
 * answer settled with a profile, that profile is the only one later questions
 * are asked to: its dead transport is retried, never replaced by the next
 * candidate.
 */
export function createFallbackStepChatResponder(
  profilesFor: (cwd: string) => AcpAgentProfile[] = catalogueProfiles,
  options: FallbackStepChatOptions = {}
): StepChatResponder {
  let active: StepChatResponder | undefined;
  let selected = 0;
  // The profile that answered: from then on a question tries it alone.
  let answered: AcpAgentProfile | undefined;
  let workspace: string | undefined;
  let generation = 0;
  // Selection, startup and fallback form one operation on the shared session.
  // Queue the whole operation, not just prompts inside an individual profile.
  let pending: Promise<void> = Promise.resolve();

  /** The Agent Profile a question would be asked to, before any session. */
  function preselection(): AcpAgentProfile | undefined {
    return answered ?? profilesFor(workspace ?? "")[selected];
  }

  return {
    async answer(request, events) {
      const attempt = generation;
      const answer = pending.then(async () => {
        if (attempt !== generation) throw new Error("Answer interrupted.");
        if (workspace !== request.workspaceRoot) {
          const previous = active;
          active = undefined;
          selected = 0;
          answered = undefined;
          workspace = request.workspaceRoot;
          await previous?.dispose?.();
        }
        await options.whenReady?.();
        // The profile that already answered is the only candidate: only the
        // initial automatic selection may fall through to another profile.
        const profiles = answered ? [answered] : profilesFor(request.workspaceRoot);
        const failed: string[] = [];
        for (let index = answered ? 0 : selected; index < profiles.length; index++) {
          if (attempt !== generation) throw new Error("Answer interrupted.");
          const profile = profiles[index];
          const current = active ?? createAcpStepChatResponder(profile, {
            ...options,
            model: options.modelFor?.(profile.name)
          });
          active = current;
          let streamed = false;
          events?.onActivity?.(`Connecting to ${profile.name}…`);
          try {
            const answer = await current.answer(request, {
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
            // The answer settled with this profile: every later question is
            // asked to it alone.
            answered = profile;
            selected = index;
            return answer;
          } catch (error) {
            if (attempt !== generation) throw error;
            // A visible answer belongs to one agent; never splice another into it.
            if (streamed) throw error;
            const reason = error instanceof Error ? error.message : String(error);
            failed.push(`${profile.name} : ${reason}`);
            active = undefined;
            await current.dispose?.();
            if (attempt !== generation) throw error;
            options.onProfileFailed?.(profile.name, reason);
            events?.onActivity?.(index + 1 < profiles.length
              ? `${profile.name} unavailable, trying the next agent…`
              : `${profile.name} unavailable.`);
          }
        }
        // A future question retries the ordered list from its first candidate:
        // nothing answered, so nothing is sticky yet.
        selected = 0;
        throw new StepChatAgentUnavailableError(
          `No ACP agent available (${agentCatalogueLabel("arrow")}). ${failed.join("\n")}`
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
      // No agent was launched yet, or the last one was released: the profile
      // that answered — or else the next candidate of the ordered list — is
      // only the preselection. Its entry is never started here.
      const candidate = preselection();
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
      options.modelFor?.(preselection()?.name ?? "")?.remember(value);
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
      answered = undefined;
      workspace = undefined;
      pending = Promise.resolve(previous?.dispose?.()).then(() => undefined, () => undefined);
      await pending;
    }
  };
}
