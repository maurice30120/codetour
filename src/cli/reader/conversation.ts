import type { CodeTour } from "../../store";
import { buildStepChatContext, StepConversations, type ChatExchange } from "../stepChatSupport";
import type { CommitFileReader, ConversationResponder, StepContextResolver } from "./collaborators";

export interface TourStepConversationOptions {
  tour: CodeTour;
  root: string;
  responder: ConversationResponder | undefined;
  resolveStepContext: StepContextResolver;
  readCommitFile: CommitFileReader;
  /** Notified after every exchange update, so the adapter repaints the panel. */
  onChange?: () => void;
}

/**
 * The Tour Step Conversation of the reader (ADR 0026): per-Step exchanges
 * kept in memory until the Tour ends, and the responding state that allows
 * one in-flight answer at a time. The exchange is recorded under its own
 * Step even when the reader navigates away mid-answer; the grounding
 * context is built once, at question time, from the Step the reader sees.
 */
export class TourStepConversation {
  private readonly exchanges = new StepConversations();
  private responding = false;

  constructor(private readonly options: TourStepConversationOptions) {}

  get hasResponder(): boolean {
    return this.options.responder !== undefined;
  }

  /** The agent's lowercase provider name, for the status line and the role line. */
  get providerName(): string | undefined {
    return this.options.responder?.providerName;
  }

  get isResponding(): boolean {
    return this.responding;
  }

  exchangesFor(step: number): readonly ChatExchange[] {
    return this.exchanges.exchanges(step);
  }

  /** Ask one Step's question; nothing happens for a missing Step or an
   *  already-streaming answer (only one answer is in flight at a time). */
  async ask(step: number, question: string): Promise<void> {
    const { tour, root, responder, resolveStepContext, readCommitFile } = this.options;
    const notify = this.options.onChange;
    const stepData = tour.steps[step];
    if (!stepData || this.responding) return;
    const exchange = this.exchanges.begin(step, question);
    if (!responder) {
      // The reader stays usable without an agent (ADR 0026): the exchange
      // explains why there is no answer.
      this.exchanges.fail(step, exchange,
        "No ACP agent is installed to answer this question.");
      notify?.();
      return;
    }
    this.responding = true;
    notify?.();
    try {
      const answer = await responder.answer({
        question,
        context: buildStepChatContext(tour, stepData,
          resolveStepContext(root, tour, stepData), readCommitFile),
        history: this.exchanges.history(step),
        workspaceRoot: root
      }, {
        // Deltas are always recorded — even when the reader navigated away,
        // the exchange belongs to the Step it was asked about.
        onAnswerDelta: delta => {
          this.exchanges.append(step, exchange, delta);
          notify?.();
        },
        onActivity: message => {
          exchange.tools.push(message);
          notify?.();
        },
        onToolUse: tool => {
          const label = (tool.forbidden ? "refused " : "") +
            (tool.kind || "tool") + (tool.title ? ": " + tool.title : "");
          if (!exchange.tools.includes(label)) exchange.tools.push(label);
          notify?.();
        }
      });
      this.exchanges.complete(step, exchange, answer);
    } catch (error) {
      this.exchanges.fail(step, exchange,
        error instanceof Error ? error.message : String(error));
    } finally {
      this.responding = false;
      notify?.();
    }
  }

  /** Release the responder's agent resources; the session is over. */
  async dispose(): Promise<void> {
    await this.options.responder?.dispose?.();
  }
}
