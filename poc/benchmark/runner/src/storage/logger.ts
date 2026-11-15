/**
 * Immutable Logger for Benchmark Runs
 * Spec #174 - T05
 * 
 * Provides append-only, immutable logging of run traces.
 * Once a run is saved, it cannot be modified or deleted.
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Constants for PostgreSQL benchmark
const POSTGRES_SHA = '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5';
const VALID_AGENTS = ['codetour', 'vibe-native'] as const;
const VALID_SERIES = ['R', 'T'] as const;
const VALID_STATUS = ['success', 'error', 'timeout'] as const;
const VALID_PHASES = ['repetition', 'transfer', 'priming'] as const;

// Types
export type AgentType = typeof VALID_AGENTS[number];
export type SeriesType = typeof VALID_SERIES[number];
export type StatusType = typeof VALID_STATUS[number];
export type PhaseType = typeof VALID_PHASES[number];

export interface CallRecord {
  call_id: string;
  call_type: 'prompt' | 'search' | 'tool' | 'memory_list' | 'memory_run' | 'function_try' | 'consolidation' | 'retry' | 'correction';
  input_tokens: number;
  output_tokens: number;
  duration_ms?: number;
  tool_name?: string;
  parameters?: Record<string, unknown>;
  result?: string | Record<string, unknown> | null;
  error?: string | null;
  usage_missing: boolean;
}

export interface FunctionCreated {
  function_id: string;
  source: string;
  parameters_schema?: Record<string, unknown>;
  created_at: string;
  reuse_count: number;
}

export interface RunResult {
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
}

export interface TotalTokens {
  input: number;
  output: number;
  total: number;
  verified: boolean;
}

export interface RunTrace {
  run_id: string;
  timestamp: string;
  agent: AgentType;
  agent_version?: string;
  model?: string;
  model_params?: {
    temperature: number;
    max_tokens: number;
    top_p?: number;
  };
  question_id: string;
  series: SeriesType;
  phase?: PhaseType;
  repeat_index?: number;
  postgres_sha: string;
  manifest_hash?: string;
  prompt_hash?: string;
  calls: CallRecord[];
  functions_created?: FunctionCreated[];
  functions_reused?: string[];
  total_tokens: TotalTokens;
  result?: RunResult;
  error?: string | null;
  status: StatusType;
}

/**
 * Configuration for the immutable logger
 */
export interface LoggerConfig {
  outputDir: string;
  resultsDir?: string;
  /** If true, validates schema before saving */
  validateSchema?: boolean;
  /** If true, makes files read-only after write */
  immutable?: boolean;
}

/**
 * Interface for NO-GO validation result
 */
export interface NoGoResult {
  passed: boolean;
  errors: string[];
}

/**
 * Immutable Logger class
 * Ensures run traces are saved atomically and cannot be modified
 */
export class ImmutableLogger {
  private readonly outputDir: string;
  private readonly resultsDir: string;
  private readonly immutable: boolean;

  constructor(config: LoggerConfig) {
    this.outputDir = path.resolve(config.outputDir);
    this.resultsDir = path.resolve(
      config.resultsDir || path.join(this.outputDir, 'results/runs')
    );
    this.immutable = config.immutable ?? true;

    // Ensure directories exist
    this.ensureDirectories();
  }

  /**
   * Ensure required directories exist
   */
  private ensureDirectories(): void {
    const dirs = [this.outputDir, this.resultsDir];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Generate a unique run ID
   */
  generateRunId(): string {
    return uuidv4();
  }

  /**
   * Validate that PostgreSQL SHA is correct
   */
  validatePostgresSha(sha: string): boolean {
    return sha === POSTGRES_SHA;
  }

  /**
   * Validate agent type
   */
  validateAgent(agent: string): agent is AgentType {
    return VALID_AGENTS.includes(agent as AgentType);
  }

  /**
   * Validate series type
   */
  validateSeries(series: string): series is SeriesType {
    return VALID_SERIES.includes(series as SeriesType);
  }

  /**
   * Validate status type
   */
  validateStatus(status: string): status is StatusType {
    return VALID_STATUS.includes(status as StatusType);
  }

  /**
   * NO-GO Control: Check provenance - agent and question must be specified
   */
  validateProvenance(trace: Partial<RunTrace>): NoGoResult {
    const errors: string[] = [];

    // Check agent
    if (!trace.agent) {
      errors.push('NO-GO: Missing agent');
    } else if (!this.validateAgent(trace.agent)) {
      errors.push(`NO-GO: Invalid agent "${trace.agent}". Must be one of: ${VALID_AGENTS.join(', ')}`);
    }

    // Check question_id
    if (!trace.question_id) {
      errors.push('NO-GO: Missing question_id');
    }

    // Check series
    if (trace.series && !this.validateSeries(trace.series)) {
      errors.push(`NO-GO: Invalid series "${trace.series}". Must be one of: ${VALID_SERIES.join(', ')}`);
    }

    return {
      passed: errors.length === 0,
      errors,
    };
  }

  /**
   * NO-GO Control: Check token usage - all calls must have token counters
   */
  validateTokenUsage(trace: Partial<RunTrace>): NoGoResult {
    const errors: string[] = [];

    if (!trace.calls || trace.calls.length === 0) {
      errors.push('NO-GO: No calls recorded');
      return { passed: false, errors };
    }

    for (const call of trace.calls) {
      // Check for missing usage
      if (call.usage_missing) {
        errors.push(`NO-GO: Usage missing for call ${call.call_id} (type: ${call.call_type})`);
      }

      // Check for negative token counts
      if (call.input_tokens < 0 || call.output_tokens < 0) {
        errors.push(`NO-GO: Negative token count for call ${call.call_id}`);
      }
    }

    // Check total_tokens
    if (!trace.total_tokens) {
      errors.push('NO-GO: Missing total_tokens');
    } else {
      if (trace.total_tokens.input < 0 || 
          trace.total_tokens.output < 0 || 
          trace.total_tokens.total < 0) {
        errors.push('NO-GO: Negative total token count');
      }

      if (!trace.total_tokens.verified) {
        errors.push('NO-GO: Total tokens not verified');
      }
    }

    return {
      passed: errors.length === 0,
      errors,
    };
  }

  /**
   * NO-GO Control: Check PostgreSQL SHA
   */
  validatePostgresShaCheck(trace: Partial<RunTrace>): NoGoResult {
    const errors: string[] = [];

    if (!trace.postgres_sha) {
      errors.push('NO-GO: Missing postgres_sha');
    } else if (!this.validatePostgresSha(trace.postgres_sha)) {
      errors.push(`NO-GO: Wrong PostgreSQL SHA. Expected: ${POSTGRES_SHA}, Got: ${trace.postgres_sha}`);
    }

    return {
      passed: errors.length === 0,
      errors,
    };
  }

  /**
   * NO-GO Control: Check fixture integrity (placeholder - would verify actual fixture)
   */
  validateFixtureIntegrity(trace: Partial<RunTrace>): NoGoResult {
    const errors: string[] = [];

    // In a real implementation, this would verify the fixture hash
    // For now, we just check that we have the expected SHA
    if (!trace.postgres_sha) {
      errors.push('NO-GO: Cannot verify fixture - missing postgres_sha');
    }

    return {
      passed: errors.length === 0,
      errors,
    };
  }

  /**
   * Run all NO-GO controls
   * If any control fails, the runner MUST refuse to produce main results
   */
  validateNoGoControls(trace: Partial<RunTrace>): NoGoResult {
    const allErrors: string[] = [];

    // Run all controls
    const provenance = this.validateProvenance(trace);
    const usage = this.validateTokenUsage(trace);
    const sha = this.validatePostgresShaCheck(trace);
    const fixture = this.validateFixtureIntegrity(trace);

    allErrors.push(...provenance.errors);
    allErrors.push(...usage.errors);
    allErrors.push(...sha.errors);
    allErrors.push(...fixture.errors);

    return {
      passed: allErrors.length === 0,
      errors: allErrors,
    };
  }

  /**
   * Calculate total tokens from calls
   */
  calculateTotalTokens(calls: CallRecord[]): TotalTokens {
    let input = 0;
    let output = 0;

    for (const call of calls) {
      input += call.input_tokens;
      output += call.output_tokens;
    }

    const total = input + output;

    // Check if any call has usage_missing
    const hasMissingUsage = calls.some(call => call.usage_missing);

    return {
      input,
      output,
      total,
      verified: !hasMissingUsage,
    };
  }

  /**
   * Save a run trace atomically and immutably
   * 
   * @param trace - The run trace to save
   * @returns The path where the trace was saved
   * @throws Error if NO-GO controls fail
   */
  saveRun(trace: RunTrace): string {
    // Run NO-GO controls
    const noGoResult = this.validateNoGoControls(trace);
    if (!noGoResult.passed) {
      throw new Error(
        `NO-GO controls failed. Cannot save run. Errors:\n${noGoResult.errors.join('\n')}`
      );
    }

    // Calculate total tokens if not already set
    if (!trace.total_tokens) {
      trace.total_tokens = this.calculateTotalTokens(trace.calls);
    }

    // Generate filename
    const filename = `${trace.run_id}.json`;
    const filepath = path.join(this.resultsDir, filename);

    // Write atomically using temp file
    const tempPath = `${filepath}.tmp`;
    
    try {
      // Write to temp file first
      const content = JSON.stringify(trace, null, 2);
      fs.writeFileSync(tempPath, content, 'utf-8');

      // Make read-only if immutable mode
      if (this.immutable) {
        fs.chmodSync(tempPath, 0o444); // Read-only for everyone
      }

      // Atomic rename
      fs.renameSync(tempPath, filepath);

      // Make final file read-only if immutable
      if (this.immutable) {
        fs.chmodSync(filepath, 0o444);
      }

      return filepath;
    } catch (error) {
      // Clean up temp file if it exists
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw error;
    }
  }

  /**
   * Load a run trace by ID
   */
  loadRun(runId: string): RunTrace | null {
    const filepath = path.join(this.resultsDir, `${runId}.json`);
    
    if (!fs.existsSync(filepath)) {
      return null;
    }

    const content = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(content) as RunTrace;
  }

  /**
   * List all run IDs
   */
  listRunIds(): string[] {
    const files = fs.readdirSync(this.resultsDir);
    return files
      .filter(file => file.endsWith('.json') && !file.endsWith('.tmp'))
      .map(file => file.replace('.json', ''));
  }

  /**
   * List all run traces
   */
  listRuns(): RunTrace[] {
    const runIds = this.listRunIds();
    const runs: RunTrace[] = [];

    for (const runId of runIds) {
      const trace = this.loadRun(runId);
      if (trace) {
        runs.push(trace);
      }
    }

    return runs;
  }

  /**
   * Get runs for a specific agent
   */
  getRunsByAgent(agent: AgentType): RunTrace[] {
    return this.listRuns().filter(run => run.agent === agent);
  }

  /**
   * Get runs for a specific question
   */
  getRunsByQuestion(questionId: string): RunTrace[] {
    return this.listRuns().filter(run => run.question_id === questionId);
  }

  /**
   * Get runs for a specific series
   */
  getRunsBySeries(series: SeriesType): RunTrace[] {
    return this.listRuns().filter(run => run.series === series);
  }
}

// Export constants
export { POSTGRES_SHA, VALID_AGENTS, VALID_SERIES, VALID_STATUS, VALID_PHASES };
