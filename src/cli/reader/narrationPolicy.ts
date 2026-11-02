import type { SpeechEngine } from "./collaborators";
import type { ReaderNarrationState } from "./viewModel";

/**
 * The home of the Step Narration policy (ADR 0029): the five crossing
 * closure variables of the old reader become one cohesive unit the reading
 * state machine reports to. This ticket owns the policy state the view
 * model carries and the mechanical half of the voice toggle — turning the
 * voice off cuts the current speech. The commit-only-displayed-Step
 * semantics (interrupt at the navigation keypress, pending narration
 * deferral, warning wiring) are the policy ticket that follows this one;
 * the triggers already have their place in the reader's render commit path.
 */
export class NarrationPolicy {
  private enabled = false;
  private speaking = false;
  private warningValue: string | undefined;
  private lastNarratedStepValue = -1;

  constructor(private readonly engine: SpeechEngine) {}

  get state(): ReaderNarrationState {
    return {
      enabled: this.enabled,
      speaking: this.speaking,
      warning: this.warningValue,
      lastNarratedStep: this.lastNarratedStepValue
    };
  }

  /**
   * Toggle the voice. Turning it off cuts the current speech inside the
   * engine immediately; turning it on re-reads the displayed Step in the
   * full policy, which the follow-up policy ticket owns.
   */
  toggleVoice(): void {
    this.enabled = !this.enabled;
    if (!this.enabled) this.engine.cancel();
  }

  /** Stop speech and release the engine's subprocess; the session is over. */
  dispose(): void {
    this.engine.cancel();
    this.engine.dispose();
  }
}
