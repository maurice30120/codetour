/**
 * Immutable Logger for Benchmark Runs
 * Spec #174 - T05 (remediated)
 *
 * Provides append-only, immutable logging of run traces.
 * Once a run is saved, it cannot be modified or deleted.
 *
 * Remediation notes (code-review findings):
 * - POSTGRES_SHA lives HERE and ONLY here; every other module imports it.
 * - Token summing lives in ONE exported function (sumCallTokens); the tracker
 *   and the logger both use it (no duplicate implementations).
 * - validateFixtureIntegrity is no longer a placeholder: it validates the
 *   per-run fixture verification EVIDENCE (observed HEAD SHA + clean tree)
 *   that the execution manager records before every single run.
 */

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Constants for PostgreSQL benchmark — SINGLE SOURCE (import elsewhere).
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

/**
 * Evidence recorded by the per-run fixture verification (executed BEFORE every
 * single run, see storage/fixture-verification.ts). ImmutableLogger validates
 * its presence and coherence on every save.
 */
export interface FixtureEvidence {
  /** Observed fixture clone HEAD (`git rev-parse HEAD`). */
  head_sha: string;
  /** True when the fixture working tree was clean (untracked-only allowed). */
  clean_tree: boolean;
  /** Real timestamp of the verification (ISO-8601). */
  verified_at: string;
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
  /** Per-run fixture verification evidence recorded BEFORE this run started. */
  fixture_verification?: FixtureEvidence;
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
 * THE single token-summing implementation. Both the token tracker and this
 * logger aggregate call usage through it — no duplicate copies anywhere.
 */
export function sumCallTokens(calls: CallRecord[]): TotalTokens {
  let input = 0;
  let output = 0;

  for (const call of calls) {
    input += call.input_tokens;
    output += call.output_tokens;
  }

  const total = input + output;
  const hasMissingUsage = calls.some(call => call.usage_missing);

  return {
    input,
    output,
    total,
    verified: !hasMissingUsage,
  };
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
   * Directory where run traces are written (also used for error-trace records).
   */
  getResultsDir(): string {
    return this.resultsDir;
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
   * NO-GO Control: Check fixture integrity — REAL implementation.
   *
   * The execution manager verifies the fixture on disk BEFORE EVERY SINGLE RUN
   * (fixture-verification.ts: git HEAD + clean tree) and records the observed
   * evidence in the trace. This control refuses any trace without that
   * evidence, or whose evidence contradicts the pre-registered SHA — a run
   * whose fixture was never verified, or was verified dirty/wrong, cannot be
   * saved.
   */
  validateFixtureIntegrity(trace: Partial<RunTrace>): NoGoResult {
    const errors: string[] = [];

    if (!trace.postgres_sha) {
      errors.push('NO-GO: Cannot verify fixture - missing postgres_sha');
    }

    if (!trace.fixture_verification) {
      errors.push('NO-GO: Fixture not verified for this run (per-run verification evidence missing)');
    } else {
      if (!trace.fixture_verification.head_sha) {
        errors.push('NO-GO: Fixture verification carries no observed HEAD SHA');
      } else if (trace.postgres_sha && trace.fixture_verification.head_sha !== trace.postgres_sha) {
        errors.push(`NO-GO: Fixture verification observed a different HEAD (${trace.fixture_verification.head_sha}) than the run's postgres_sha (${trace.postgres_sha})`);
      } else if (trace.postgres_sha && !this.validatePostgresSha(trace.postgres_sha)) {
        errors.push(`NO-GO: Fixture verification compared against wrong SHA: ${trace.postgres_sha}`);
      }

      if (trace.fixture_verification.clean_tree !== true) {
        errors.push('NO-GO: Fixture working tree was not clean at run start');
      }

      if (!trace.fixture_verification.verified_at) {
        errors.push('NO-GO: Fixture verification carries no timestamp');
      }
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
   * Calculate total tokens from calls (delegates to the single implementation)
   */
  calculateTotalTokens(calls: CallRecord[]): TotalTokens {
    return sumCallTokens(calls);
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

// Export constants — POSTGRES_SHA is single-sourced here.
export { POSTGRES_SHA, VALID_AGENTS, VALID_SERIES, VALID_STATUS, VALID_PHASES };

/**
 * REAL manifest freeze — the ONE freeze implementation for the campaign
 * (replaces the previous placeholder that logged "frozen", invented a hash,
 * and had three copy-pasted variants across the JS wrappers).
 *
 * Guarantees:
 * - The lock hash is computed FROM THE EXACT MANIFEST FILE CONTENT (never
 *   copied from a self-declared field inside the manifest).
 * - No TBD/placeholder values: any "TBD" or placeholder string found while
 *   walking the manifest aborts the freeze with an explicit error (e.g. the
 *   committed manifest's models.* fields literally contain "TBD_by_availability"
 *   until executor availability is known — that manifest CANNOT be frozen).
 * - The lock file is written atomically, made read-only, and VERIFIED BY
 *   READBACK; any mismatch aborts with an error and removes the lock.
 */
export interface ManifestFreezeOptions {
  /** SHA-256 of the canonical decomposition prompt, recorded in the lock when provided. */
  promptSha256?: string;
}

export interface ManifestFreezeResult {
  lockPath: string;
  manifestSha256: string;
  frozenAt: string;
}

/**
 * Collect the JSON paths of string fields that still carry TBD/placeholder
 * markers. Freeze must refuse such a manifest: a pre-registration with
 * unknown models/params is not an experiment protocol yet.
 */
export function findPlaceholderFields(value: unknown, prefix = ''): string[] {
  const found: string[] = [];
  const walk = (node: unknown, pathSoFar: string): void => {
    if (typeof node === 'string') {
      if (node === 'TBD' || /TBD/.test(node) || /placeholder/i.test(node)) {
        found.push(pathSoFar || '<root>');
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${pathSoFar}[${index}]`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        walk(child, pathSoFar ? `${pathSoFar}.${key}` : key);
      }
    }
  };
  walk(value, prefix);
  return found;
}

export function freezeManifest(manifestPath: string, lockPath?: string, options?: ManifestFreezeOptions): ManifestFreezeResult {
  const manifestFile = path.resolve(manifestPath);
  const lockFile = path.resolve(lockPath ?? path.join(path.dirname(manifestFile), 'manifest-lock.json'));

  if (!fs.existsSync(manifestFile)) {
    throw new Error(`NO-GO: cannot freeze — manifest file does not exist: ${manifestFile}`);
  }

  // Read the manifest content and compute the hash FROM THE CONTENT.
  const content = fs.readFileSync(manifestFile, 'utf-8');
  let manifestData: unknown;
  try {
    manifestData = JSON.parse(content);
  } catch (error) {
    throw new Error(`NO-GO: cannot freeze — manifest is not valid JSON: ${(error as Error).message}`);
  }

  const placeholders = findPlaceholderFields(manifestData);
  if (placeholders.length > 0) {
    throw new Error(
      `NO-GO: cannot freeze — manifest still carries TBD/placeholder fields (resolve them before freezing, e.g. record the models/params actually available): ${placeholders.join(', ')}`
    );
  }

  const manifestSha256 = createHash('sha256').update(content, 'utf-8').digest('hex');
  const frozenAt = new Date().toISOString();

  const lockData = {
    manifest_file: path.basename(manifestFile),
    manifest_sha256: manifestSha256,
    prompt_sha256: options?.promptSha256,
    frozen_at: frozenAt,
    locked: true,
    note: 'FROZEN — hash computed from the exact manifest file content; any later modification of the manifest invalidates this lock.',
    warnings: [
      'This manifest is locked and must not be modified',
      'Any modification will invalidate the benchmark',
      'All gates G0-G5 must remain satisfied',
    ],
  };

  // Atomic write, then read-only.
  const tempPath = `${lockFile}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(lockData, null, 2), 'utf-8');
  try {
    fs.renameSync(tempPath, lockFile);
    fs.chmodSync(lockFile, 0o444);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw error;
  }

  // VERIFY READBACK: the lock on disk must carry exactly the computed hash
  // and timestamp, and the manifest must be unchanged since the freeze.
  const readBack = JSON.parse(fs.readFileSync(lockFile, 'utf-8')) as Record<string, unknown>;
  const readBackOk =
    readBack.manifest_sha256 === manifestSha256 &&
    readBack.frozen_at === frozenAt &&
    createHash('sha256').update(fs.readFileSync(manifestFile, 'utf-8'), 'utf-8').digest('hex') === manifestSha256;
  if (!readBackOk) {
    try { fs.chmodSync(lockFile, 0o644); fs.unlinkSync(lockFile); } catch { /* best effort cleanup */ }
    throw new Error('NO-GO: manifest-lock readback verification failed — lock removed, freeze refused');
  }

  return { lockPath: lockFile, manifestSha256, frozenAt };
}

/**
 * Validate that the manifest is frozen AND still authentic: the lock exists,
 * is marked locked, carries a freeze timestamp, and the CURRENT manifest file
 * content hashes to the recorded digest (tamper detection).
 */
export function validateManifestFrozen(manifestPath: string, lockPath?: string): boolean {
  const manifestFile = path.resolve(manifestPath);
  const lockFile = path.resolve(lockPath ?? path.join(path.dirname(manifestFile), 'manifest-lock.json'));

  if (!fs.existsSync(lockFile)) {
    console.error('NO-GO: Manifest lock file does not exist');
    return false;
  }
  if (!fs.existsSync(manifestFile)) {
    console.error('NO-GO: Manifest file does not exist');
    return false;
  }

  try {
    const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8')) as Record<string, unknown>;

    if (lockData.locked !== true) {
      console.error('NO-GO: Manifest lock file is not marked locked');
      return false;
    }
    if (typeof lockData.frozen_at !== 'string' || !lockData.frozen_at) {
      console.error('NO-GO: Manifest lock file has no freeze timestamp');
      return false;
    }
    if (typeof lockData.manifest_sha256 !== 'string' || !lockData.manifest_sha256) {
      console.error('NO-GO: Manifest lock file carries no content hash');
      return false;
    }

    // Tamper detection: recompute the hash from the CURRENT manifest content.
    const currentSha256 = createHash('sha256').update(fs.readFileSync(manifestFile, 'utf-8'), 'utf-8').digest('hex');
    if (currentSha256 !== lockData.manifest_sha256) {
      console.error(`NO-GO: Manifest content changed after freeze (expected ${lockData.manifest_sha256}, current ${currentSha256})`);
      return false;
    }

    console.error(`Manifest frozen at: ${lockData.frozen_at}`);
    return true;
  } catch (error) {
    console.error(`NO-GO: Failed to read manifest lock file: ${(error as Error).message}`);
    return false;
  }
}
