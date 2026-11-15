/**
 * Execution Manager for Benchmark Runs
 * Spec #174 - T05
 * 
 * Manages the execution of benchmark runs with paired agents,
 * session isolation, and error handling.
 */

import { TokenTracker } from './tracker';
import { ImmutableLogger, RunTrace, AgentType, SeriesType, PhaseType, CallRecord } from '../storage/logger';

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
   * @param question - The question to execute
   * @param agentType - Which agent to use
   * @returns The run trace
   */
  async executeSingle(
    question: Question,
    agentType: AgentType
  ): Promise<RunTrace> {
    const executor = this.getAgentExecutor(agentType);
    const tracker = new TokenTracker();
    const runId = this.logger.generateRunId();
    const timestamp = new Date().toISOString();

    try {
      // Execute with retry policy
      const execution = await this.executeWithRetry(
        question,
        executor,
        tracker
      );

      // Calculate total tokens
      const totalTokens = tracker.calculateTotalTokens();

      // Check for missing usage
      if (tracker.hasMissingUsage()) {
        throw new Error('NO-GO: Token usage missing for some calls');
      }

      // Build run trace
      const trace: RunTrace = {
        run_id: runId,
        timestamp,
        agent: agentType,
        agent_version: executor.version,
        model: executor.model,
        model_params: executor.modelParams,
        question_id: question.id,
        series: question.series,
        phase: question.phase,
        repeat_index: question.repeat_index,
        postgres_sha: question.postgres_sha,
        calls: tracker.getCalls(),
        functions_created: execution.functions_created || [],
        functions_reused: execution.functions_reused || [],
        total_tokens: totalTokens,
        result: execution.result,
        error: execution.error ?? null,
        status: execution.status,
      };

      // Validate NO-GO controls
      const noGoResult = this.logger.validateNoGoControls(trace);
      if (!noGoResult.passed) {
        throw new Error(`NO-GO controls failed: ${noGoResult.errors.join('; ')}`);
      }

      // Save run (this will validate again and throw if NO-GO)
      this.logger.saveRun(trace);

      return trace;
    } catch (error) {
      // Build error trace
      const errorTrace: RunTrace = {
        run_id: runId,
        timestamp,
        agent: agentType,
        agent_version: executor.version,
        model: executor.model,
        model_params: executor.modelParams,
        question_id: question.id,
        series: question.series,
        phase: question.phase,
        repeat_index: question.repeat_index,
        postgres_sha: question.postgres_sha,
        calls: tracker.getCalls(),
        functions_created: [],
        functions_reused: [],
        total_tokens: {
          input: 0,
          output: 0,
          total: 0,
          verified: false,
        },
        error: error instanceof Error ? error.message : String(error),
        status: 'error',
      };

      // Validate NO-GO controls even for error traces
      const noGoResult = this.logger.validateNoGoControls(errorTrace);
      if (!noGoResult.passed) {
        // Log the NO-GO errors
        console.error('NO-GO controls failed for error trace:', noGoResult.errors);
        // Still save it so we have a record
        try {
          this.logger.saveRun(errorTrace);
        } catch {
          // Ignore save errors for error traces
        }
        throw new Error(`NO-GO controls failed: ${noGoResult.errors.join('; ')}`);
      }

      // Save error trace
      try {
        this.logger.saveRun(errorTrace);
      } catch {
        // Ignore save errors
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
        // Clear tracker for each attempt
        tracker.clear();

        // Execute with timeout
        const executionPromise = executor.execute(question, tracker);
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Execution timed out after ${this.options.timeoutMs}ms`));
          }, this.options.timeoutMs);
        });

        const execution = await Promise.race([executionPromise, timeoutPromise]);
        return execution;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries) {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    // All retries exhausted
    throw lastError ?? new Error('Execution failed after all retries');
  }

  /**
   * Execute a question with both agents (paired execution)
   */
  async executePaired(question: Question): Promise<{ codetour: RunTrace; vibe: RunTrace }> {
    const codetourPromise: Promise<RunTrace> = this.executeSingle(question, 'codetour');
    const vibePromise: Promise<RunTrace> = this.executeSingle(question, 'vibe-native');

    // Execute sequentially (concurrent execution will be added later)
    const codetourTrace = await codetourPromise;
    const vibeTrace = await vibePromise;
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
