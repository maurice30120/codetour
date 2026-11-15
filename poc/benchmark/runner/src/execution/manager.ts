/**
 * Execution Manager for Benchmark Runs
 * Spec #174 - T05 (remediated)
 *
 * Manages the execution of benchmark runs with paired agents,
 * session isolation, and error handling.
 *
 * Remediation notes (code-review findings):
 * - Fixture verification (git HEAD + clean tree) runs BEFORE EVERY SINGLE
 *   RUN — per run, not per campaign — and its observed evidence is recorded
 *   in the run trace. A failing verification fails the run (NO-GO).
 * - The success and error paths build their RunTrace through ONE builder
 *   (no duplicated trace literals that could drift).
 * - No Math.random, no simulated usage: token counters come from the
 *   executors' provider-side records, or the run is refused.
 */

import * as fs from 'fs';
import { TokenTracker } from './tracker';
import { AgentType, CallRecord, FixtureEvidence, ImmutableLogger, RunTrace, SeriesType, PhaseType } from '../storage/logger';
import { verifyFixture } from '../storage/fixture-verification';
import { shouldRetry } from '../failure-handler';

/**
 * Interface for a question to be executed
 */
export interface Question {
  id: string;
  objective: string;
  series: SeriesType;
  phase: PhaseType;
  repeat_index: number;
  postgres_sha: string;
  expected_areas?: string[];
  criteria?: string[];
  relations_to_verify?: Array<{
    from: string;
    to: string;
    type: string;
    file: string;
  }>;
}

/**
 * Interface for agent execution result
 */
export interface AgentExecution {
  calls: CallRecord[];
  result?: {
    tour_title?: string;
    steps?: Array<{
      step_id: string;
      description: string;
      file?: string;
      line?: number;
      citations?: string[];
    }>;
    raw_response?: string;
    citations?: string[];
  };
  functions_created?: Array<{
    function_id: string;
    source: string;
    parameters_schema?: Record<string, unknown>;
    created_at: string;
    reuse_count: number;
  }>;
  functions_reused?: string[];
  /** Real model that executed this run (provider-reported), when known. */
  agent_version?: string;
  model_used?: string;
  status: 'success' | 'error' | 'timeout';
  error?: string | null;
}

/**
 * Interface for execution options
 */
export interface ExecutionOptions {
  maxConcurrent?: number;
  timeoutMs?: number;
  retryPolicy?: {
    maxRetries: number;
    retryDelay: number;
  };
  /**
   * Path to the PostgreSQL fixture clone. REQUIRED: it is verified before
   * every single run. There is no default because there is nothing real to
   * default to — the caller must point at the actual fixture.
   */
  fixturePath?: string;
}

/**
 * Interface for agent executor
 * This is a strategy pattern for different agent types
 */
export interface AgentExecutor {
  readonly name: AgentType;
  readonly version: string;
  readonly model: string;
  readonly modelParams: {
    temperature: number;
    max_tokens: number;
    top_p?: number;
  };

  /**
   * Execute a question
   * @param question - The question to execute
   * @param tracker - Token tracker for this execution
   */
  execute(question: Question, tracker: TokenTracker): Promise<AgentExecution>;
}

/**
 * THE single RunTrace builder — the success and error paths of executeSingle
 * both go through this, so no field can drift between the two paths.
 */
function buildRunTrace(params: {
  runId: string;
  timestamp: string;
  agent: AgentType;
  agentVersion?: string;
  model?: string;
  modelParams?: { temperature: number; max_tokens: number; top_p?: number };
  question: Question;
  calls: CallRecord[];
  functionsCreated?: AgentExecution['functions_created'];
  functionsReused?: string[];
  totalTokens: RunTrace['total_tokens'];
  fixtureVerification?: FixtureEvidence;
  result?: AgentExecution['result'];
  error?: string | null;
  status: RunTrace['status'];
}): RunTrace {
  const trace: RunTrace = {
    run_id: params.runId,
    timestamp: params.timestamp,
    agent: params.agent,
    agent_version: params.agentVersion,
    model: params.model,
    model_params: params.modelParams,
    question_id: params.question.id,
    series: params.question.series,
    phase: params.question.phase,
    repeat_index: params.question.repeat_index,
    postgres_sha: params.question.postgres_sha,
    calls: params.calls,
    functions_created: params.functionsCreated ?? [],
    functions_reused: params.functionsReused ?? [],
    total_tokens: params.totalTokens,
    result: params.result,
    error: params.error ?? null,
    status: params.status,
  };
  if (params.fixtureVerification) {
    trace.fixture_verification = params.fixtureVerification;
  }
  return trace;
}

/**
 * Execution Manager class
 * Manages benchmark runs with isolation and error handling
 */
export class ExecutionManager {
  private readonly logger: ImmutableLogger;
  private readonly options: ExecutionOptions;
  private readonly agentExecutors: Map<AgentType, AgentExecutor> = new Map();

  constructor(
    logger: ImmutableLogger,
    options: ExecutionOptions = {}
  ) {
    this.logger = logger;
    this.options = {
      maxConcurrent: options.maxConcurrent ?? 1,
      timeoutMs: options.timeoutMs ?? 300000, // 5 minutes default
      retryPolicy: options.retryPolicy ?? { maxRetries: 0, retryDelay: 0 },
      fixturePath: options.fixturePath,
    };
  }

  /**
   * Register an agent executor
   */
  registerAgentExecutor(executor: AgentExecutor): void {
    this.agentExecutors.set(executor.name, executor);
  }

  /**
   * Get an agent executor by type
   */
  getAgentExecutor(agentType: AgentType): AgentExecutor {
    const executor = this.agentExecutors.get(agentType);
    if (!executor) {
      throw new Error(`Agent executor not registered: ${agentType}`);
    }
    return executor;
  }

  /**
   * Execute a single question with a specific agent
   *
   * Per-run fixture verification runs BEFORE EVERY SINGLE RUN — a mismatching
   * or dirty fixture fails the run; the failure itself is recorded as an
   * error trace with the observed (non-matching) evidence.
   *
   * @param question - The question to execute
   * @param agentType - Which agent to use
   * @returns The run trace
   */
  async executeSingle(
    question: Question,
    agentType: AgentType
  ): Promise<RunTrace> {
    const executor = this.getAgentExecutor(agentType);
    const runId = this.logger.generateRunId();
    const timestamp = new Date().toISOString();

    if (!this.options.fixturePath) {
      throw new Error('NO-GO: ExecutionManager has no fixturePath configured — per-run fixture verification cannot run. Refusing to execute.');
    }

    // NO-GO control, executed BEFORE EVERY SINGLE RUN (not once per campaign).
    const verification = await verifyFixture(this.options.fixturePath, question.postgres_sha);
    const fixtureEvidence: FixtureEvidence | undefined = verification.observedSha || verification.cleanTree !== null
      ? {
          head_sha: verification.observedSha ?? 'unavailable',
          clean_tree: verification.cleanTree === true,
          verified_at: verification.verifiedAt,
        }
      : undefined;

    // Provider-usage tracking spans ALL attempts of this run: costs of failed
    // attempts accumulate (never reset or lost) and land in the run trace.
    let tracker: TokenTracker | undefined;

    try {
      if (!verification.ok) {
        throw new Error(`NO-GO: fixture verification failed before run: ${verification.errors.join('; ')}`);
      }

      tracker = new TokenTracker();

      // Execute with retry policy
      const execution = await this.executeWithRetry(question, executor, tracker);

      // Check for missing usage — the tracker records reality; this run is
      // refused unless every call carried provider-side usage.
      if (tracker.hasMissingUsage()) {
        throw new Error('NO-GO: Token usage missing for some calls');
      }

      // Calculate total tokens (single shared implementation)
      const totalTokens = tracker.calculateTotalTokens();

      // Build run trace — ONE builder for both success and error paths.
      const trace = buildRunTrace({
        runId,
        timestamp,
        agent: agentType,
        agentVersion: execution.agent_version ?? executor.version,
        model: execution.model_used ?? executor.model,
        modelParams: executor.modelParams,
        question,
        calls: tracker.getCalls(),
        functionsCreated: execution.functions_created,
        functionsReused: execution.functions_reused,
        totalTokens,
        fixtureVerification: fixtureEvidence,
        result: execution.result,
        error: execution.error ?? null,
        status: execution.status,
      });

      // Validate NO-GO controls
      const noGoResult = this.logger.validateNoGoControls(trace);
      if (!noGoResult.passed) {
        throw new Error(`NO-GO controls failed: ${noGoResult.errors.join('; ')}`);
      }

      // Save run (this will validate again and throw if NO-GO)
      this.logger.saveRun(trace);

      return trace;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Build error trace through the SAME builder as the success path; the
      // accumulated usage of all attempts is preserved (never reset).
      const errorTrace = buildRunTrace({
        runId,
        timestamp,
        agent: agentType,
        agentVersion: executor.version,
        model: executor.model,
        modelParams: executor.modelParams,
        question,
        calls: tracker ? tracker.getCalls() : [],
        totalTokens: tracker
          ? tracker.calculateTotalTokens()
          : { input: 0, output: 0, total: 0, verified: false },
        fixtureVerification: fixtureEvidence,
        error: errorMessage,
        status: 'error',
      });
      // The error trace legitimately records WHY the run failed (including
      // fixture-verification failures). validateNoGoControls would refuse it
      // (no calls, unverified tokens), so error traces bypass saveRun but are
      // still persisted to disk for the audit trail.
      try {
        const tempPath = `${this.logger.getResultsDir()}/${errorTrace.run_id}.error.json`;
        fs.writeFileSync(tempPath, JSON.stringify(errorTrace, null, 2), 'utf-8');
      } catch {
        // Persisting the failure record is best-effort; the original error propagates.
      }

      throw error;
    }
  }

  /**
   * Execute with retry policy
   */
  private async executeWithRetry(
    question: Question,
    executor: AgentExecutor,
    tracker: TokenTracker
  ): Promise<AgentExecution> {
    let lastError: Error | undefined;
    const { maxRetries, retryDelay } = this.options.retryPolicy ?? { maxRetries: 0, retryDelay: 0 };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // NOTE: the tracker is deliberately NOT cleared between attempts —
        // costs incurred by failed attempts accumulate into the same run
        // trace (no token loss, no fabricated zero-cost run).
        const executionPromise = executor.execute(question, tracker);
        let timer: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`timeout: execution timed out after ${this.options.timeoutMs}ms`));
          }, this.options.timeoutMs);
          // Don't hold the process open once the execution has finished.
          if (timer && typeof timer.unref === 'function') {
            timer.unref();
          }
        });

        const execution = await Promise.race([executionPromise, timeoutPromise]).finally(() => {
          if (timer) {
            clearTimeout(timer);
          }
        });
        return execution;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Documented replay rule applies ONLY to infrastructure failures
        // (network_error / service_unavailable / timeout). Agent failures are
        // recorded immediately and counted in the denominator — never
        // retried, never erased, never replaced.
        if (!shouldRetry(lastError)) {
          throw lastError;
        }

        console.warn(
          `[manager] infrastructure failure on attempt ${attempt + 1}/${maxRetries + 1} — replay per documented rule (attempt costs kept): ${lastError.message}`
        );

        if (attempt < maxRetries) {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    // All retries exhausted — the accumulated attempt costs remain in the
    // tracker and land in the recorded run trace.
    throw lastError ?? new Error('Execution failed after all retries');
  }

  /**
   * Execute a question with both agents (paired execution)
   */
  async executePaired(question: Question): Promise<{ codetour: RunTrace; vibe: RunTrace }> {
    // Execute sequentially (concurrent execution will be added later)
    const codetourTrace = await this.executeSingle(question, 'codetour');
    const vibeTrace = await this.executeSingle(question, 'vibe-native');
    return { codetour: codetourTrace, vibe: vibeTrace };
  }

  /**
   * Execute all questions with paired agents
   */
  async executeAll(questions: Question[]): Promise<RunTrace[]> {
    const results: RunTrace[] = [];

    for (const question of questions) {
      try {
        const { codetour, vibe } = await this.executePaired(question);
        results.push(codetour, vibe);
      } catch (error) {
        console.error(`Error executing question ${question.id}:`, error);
        // Continue with next question
      }
    }

    return results;
  }

  /**
   * Run a pilot execution (1-2 questions for connectivity testing)
   * These runs are NOT counted in the main benchmark
   */
  async runPilot(questions: Question[]): Promise<RunTrace[]> {
    console.log('Running pilot execution (not counted in main benchmark)...');

    // Limit to 2 questions for pilot
    const pilotQuestions = questions.slice(0, Math.min(2, questions.length));

    return this.executeAll(pilotQuestions);
  }

  /**
   * Get summary of all runs
   */
  getSummary(): {
    total_runs: number;
    by_agent: Record<AgentType, number>;
    by_series: Record<SeriesType, number>;
    by_status: Record<'success' | 'error' | 'timeout', number>;
    total_input_tokens: number;
    total_output_tokens: number;
    total_tokens: number;
  } {
    const runs = this.logger.listRuns();

    const byAgent: Record<AgentType, number> = { codetour: 0, 'vibe-native': 0 };
    const bySeries: Record<SeriesType, number> = { R: 0, T: 0 };
    const byStatus: Record<'success' | 'error' | 'timeout', number> = {
      success: 0,
      error: 0,
      timeout: 0,
    };

    let totalInput = 0;
    let totalOutput = 0;

    for (const run of runs) {
      byAgent[run.agent]++;
      bySeries[run.series]++;
      byStatus[run.status]++;
      totalInput += run.total_tokens.input;
      totalOutput += run.total_tokens.output;
    }

    return {
      total_runs: runs.length,
      by_agent: byAgent,
      by_series: bySeries,
      by_status: byStatus,
      total_input_tokens: totalInput,
      total_output_tokens: totalOutput,
      total_tokens: totalInput + totalOutput,
    };
  }
}
