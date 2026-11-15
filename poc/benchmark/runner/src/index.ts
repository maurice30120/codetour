/**
 * Benchmark Runner - Main Entry Point
 * Spec #174 - T05 (remediated)
 *
 * Main runner that orchestrates benchmark execution with:
 * - Paired agent execution (CodeTour harness and Vibe native)
 * - Session isolation
 * - Token tracking from provider-usage fields only
 * - Immutable logging
 * - NO-GO controls
 * - Per-run fixture verification (before EVERY SINGLE RUN)
 * - REAL manifest freeze (content hash + readback verification)
 *
 * Remediation notes (code-review findings):
 * - POSTGRES_SHA has ONE source (storage/logger.ts) — re-exported here.
 * - The Middle Man validators (validateProvenance/validateTokenUsage/...)
 *   are REMOVED: callers use the ImmutableLogger controls directly via
 *   getLogger() — the wrappers did no distinct work.
 * - The run-result summary type is renamed RunSummary to stop the name
 *   collision with logger.ts's RunResult (the run payload type).
 * - runPilot now defaults to FALSE (the previous literal-true default made
 *   "run only the main campaign" silently execute a pilot campaign too —
 *   the runMain()/runAll() trap). runMain() never runs the pilot and never
 *   double-executes the campaign (it no longer delegates to runAll()).
 * - freezeManifest() delegates to the real implementation in storage/logger
 *   (content hash, TBD refusal, readback verification) — no placeholder.
 */

import fs from 'fs';
import { hashFile, sha256, sourceFiles, validateTestEvidence } from './storage/provenance';
import { findRepoRoot } from './agents/codetour';
import path from 'path';
import { ImmutableLogger, RunTrace, freezeManifest, validateManifestFrozen, POSTGRES_SHA } from './storage/logger';
import { verifyFixture } from './storage/fixture-verification';
import { ExecutionManager, Question } from './execution/manager';
import { CodeTourExecutor, CodeTourConfig } from './agents/codetour';
import { VibeExecutor, VibeConfig, loadVibeConnector } from './agents/vibe';

/**
 * Configuration for the benchmark runner
 */
export interface RunnerConfig {
  /** Path to the questions JSON file */
  questionsFile: string;
  /** Path to the manifest JSON file */
  manifestFile: string;
  manifestLockFile?: string;
  /** Path to the PostgreSQL fixture clone (verified BEFORE EVERY RUN) */
  postgresPath: string;
  /** Output directory for run traces */
  outputDir: string;
  /** Maximum concurrent runs */
  maxConcurrent?: number;
  /** Timeout for each run in milliseconds */
  timeoutMs?: number;
  /** Retry policy */
  retryPolicy?: {
    maxRetries: number;
    retryDelay: number;
  };
  /**
   * Whether to run a pilot before the main execution. DEFAULT FALSE — a
   * caller who wants a pilot must ask for it explicitly (the old literal-true
   * default made every "main" invocation run a pilot first).
   */
  runPilot?: boolean;
  /** Number of questions for pilot */
  pilotCount?: number;
  /** CodeTour harness executor configuration (fixtureRoot wired from postgresPath). */
  codetour?: Partial<CodeTourConfig>;
  /** Vibe connector executor configuration (workDir wired from postgresPath). */
  vibe?: Partial<VibeConfig>;
  /**
   * Directory holding the gate-evidence files produced by REAL executions
   * (poc/benchmark/validate-gates.mjs). Every gate must find its evidence
   * here; a gate without evidence fails (spec §1: tout G0-G5 non satisfait
   * = NO-GO — no gate may be forced to true without proof).
   */
  gateEvidenceDir?: string;
}

/**
 * Summary of a single executed run (renamed from RunResult to stop the
 * collision with storage/logger's RunResult run-payload type).
 */
export interface RunSummary {
  runId: string;
  questionId: string;
  agent: 'codetour' | 'vibe-native';
  series: 'R' | 'T';
  totalTokens: { input: number; output: number; total: number };
  status: 'success' | 'error' | 'timeout';
  error?: string;
}

/** THE one trace-to-summary builder (single implementation, no duplicated literals). */
function summarizeTrace(trace: RunTrace): RunSummary {
  return {
    runId: trace.run_id,
    questionId: trace.question_id,
    agent: trace.agent,
    series: trace.series,
    totalTokens: {
      input: trace.total_tokens.input,
      output: trace.total_tokens.output,
      total: trace.total_tokens.total,
    },
    status: trace.status,
    error: trace.error !== null && trace.error !== undefined ? trace.error : undefined,
  };
}

/**
 * Benchmark Runner class
 * Main orchestrator for the benchmark
 */
export class BenchmarkRunner {
  private readonly config: RunnerConfig;
  private readonly logger: ImmutableLogger;
  private readonly executionManager: ExecutionManager;
  private readonly codeTourExecutor: CodeTourExecutor;
  private readonly vibeExecutor: VibeExecutor;
  private questions: Question[] = [];

  constructor(config: RunnerConfig) {
    this.config = {
      // Deliberate default: NO pilot unless asked for.
      runPilot: false,
      pilotCount: 2,
      ...config,
    };

    // Initialize logger
    this.logger = new ImmutableLogger({
      outputDir: config.outputDir,
      resultsDir: path.join(config.outputDir, 'runs'),
      validateSchema: true,
      immutable: true,
    });

    // Initialize execution manager — the fixture path is REQUIRED: it is
    // verified against the pre-registered SHA before every single run.
    this.executionManager = new ExecutionManager(this.logger, {
      maxConcurrent: config.maxConcurrent ?? 1,
      timeoutMs: config.timeoutMs ?? 300000, // 5 minutes
      retryPolicy: config.retryPolicy ?? { maxRetries: 0, retryDelay: 0 },
      fixturePath: config.postgresPath,
      beforeRun: (question) => {
        if (fs.existsSync(this.manifestLockFile())) {
          if (!validateManifestFrozen(this.config.manifestFile, this.manifestLockFile())) throw new Error('NO-GO: sealed manifest artifacts changed');
          const lock = JSON.parse(fs.readFileSync(this.manifestLockFile(), 'utf8'));
          if (lock.execution_config_sha256 !== sha256(JSON.stringify(this.executionConfig()))) throw new Error('NO-GO: execution configuration changed after freeze');
        }
        return {
          manifest_hash: hashFile(this.config.manifestFile).sha256,
          config_hash: sha256(JSON.stringify(this.executionConfig())),
          execution_config: this.executionConfig(),
          prompt_hash: sha256(question.objective),
          question_hash: sha256(JSON.stringify({ id: question.id, objective: question.objective, series: question.series, phase: question.phase, repeat_index: question.repeat_index, postgres_sha: question.postgres_sha })),
          fixture_hash: sha256(question.postgres_sha),
        };
      },
    });

    // Initialize REAL agent executors: both arms explore THE fixture
    // directory that the manager verifies per run (same_tree_for_both_agents).
    this.codeTourExecutor = new CodeTourExecutor({
      ...config.codetour,
      fixtureRoot: config.postgresPath,
      memoryDir: config.codetour?.memoryDir ?? path.join(config.outputDir, 'memory'),
      timeoutMs: config.timeoutMs ?? 300000,
    });
    this.vibeExecutor = new VibeExecutor({
      ...config.vibe,
      workDir: config.postgresPath,
      timeoutMs: config.timeoutMs ?? 300000,
    });

    // Register executors
    this.executionManager.registerAgentExecutor(this.codeTourExecutor);
    this.executionManager.registerAgentExecutor(this.vibeExecutor);
  }

  /**
   * Direct access to the immutable logger (NO-GO controls and storage are
   * used directly by callers — no Middle Man wrappers).
   */
  getLogger(): ImmutableLogger {
    return this.logger;
  }

  /**
   * Load questions from file
   */
  async loadQuestions(): Promise<Question[]> {
    const filePath = path.resolve(this.config.questionsFile);
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Parse questions from both series
    const questions: Question[] = [];

    // Series R questions
    if (data.series_R && Array.isArray(data.series_R)) {
      for (const q of data.series_R) {
        questions.push({
          id: q.id,
          objective: q.objective,
          series: 'R',
          phase: q.phase || 'repetition',
          repeat_index: q.repeat_index || 0,
          postgres_sha: q.postgres_sha || POSTGRES_SHA,
          expected_areas: q.expected_areas,
          criteria: q.criteria,
          relations_to_verify: q.relations_to_verify,
        });
      }
    }

    // Series T questions
    if (data.series_T && Array.isArray(data.series_T)) {
      for (const q of data.series_T) {
        questions.push({
          id: q.id,
          objective: q.objective,
          series: 'T',
          phase: q.phase || 'transfer',
          repeat_index: q.repeat_index || 0,
          postgres_sha: q.postgres_sha || POSTGRES_SHA,
          expected_areas: q.expected_areas,
          criteria: q.criteria,
          relations_to_verify: q.relations_to_verify,
        });
      }
    }

    this.questions = questions;
    return questions;
  }

  /**
   * Load manifest file
   */
  async loadManifest(): Promise<Record<string, unknown>> {
    const filePath = path.resolve(this.config.manifestFile);
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  }

  /**
   * Validate PostgreSQL SHA across loaded questions
   */
  validatePostgresSha(): boolean {
    if (!this.questions.length) {
      throw new Error('Questions not loaded yet');
    }

    return this.questions.every(q => q.postgres_sha === POSTGRES_SHA);
  }

  /**
   * Validate all gates G0-G5 against REAL, verifiable evidence. Every gate
   * must point at evidence produced by an actual execution BEFORE the
   * campaign (see poc/benchmark/validate-gates.mjs, the evidence producer):
   *
   * G0: the real #172-conformance test suite ran and passed.
   * G1: the real sentinel executed the native Vibe research sub-agent —
   *     real CLI version, real active model, observed subagent, non-empty tools.
   * G2: that sentinel trace carries per-call provider usage and no call is
   *     missing counters.
   * G3: the fixture is verified ON DISK right now (git HEAD + clean tree)
   *     and every question carries the pre-registered SHA.
   * G4: the evaluator's pre-registered criteria exist and its adversarial
   *     regression case (fabricated citation + unproven relation) is rejected.
   * G5: the pre-registration manifest is frozen (content hash verified).
   *
   * Forcing any gate to true without its evidence file is a protocol
   * violation (spec §0/§7: a NO-GO must never be dressed up as a pass).
   */
  async validateGates(options: { requireFrozenManifest?: boolean } = {}): Promise<boolean> {
    if (!this.questions.length) await this.loadQuestions();
    const evidenceDir = this.gateEvidenceDir();
    const root = findRepoRoot(__dirname);
    const read = (file: string): Record<string, unknown> | null => {
      try { return JSON.parse(fs.readFileSync(path.join(evidenceDir, file), 'utf8')); } catch { return null; }
    };
    const checks: Record<string, boolean> = {
      G0: !!root && validateTestEvidence(read('g0-conformance.json'), root, evidenceDir),
      G1: false, G2: false,
      G3: this.validatePostgresSha() && await this.verifyFixtureOnDisk(),
      G4: !!root && validateTestEvidence(read('g4-evaluator.json'), root, evidenceDir),
    };
    try {
      const sentinel = read('sentinel.json');
      const execution = sentinel?.execution ?? sentinel;
      const connector = loadVibeConnector(__dirname, this.config.vibe?.connectorModulePath);
      checks.G1 = !!execution && connector.validateG1(execution);
      checks.G2 = !!execution && connector.validateG2(execution);
    } catch { /* unavailable proof is a closed gate */ }
    if (options.requireFrozenManifest !== false) {
      checks.G5 = this.validateFrozenConfiguration();
    }
    const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([gate]) => gate);
    if (failed.length) console.error(`NO-GO: Failed gates (no valid evidence): ${failed.join(', ')}`);
    return failed.length === 0;
  }

  private validateFrozenConfiguration(): boolean {
    try {
      if (!validateManifestFrozen(this.config.manifestFile, this.manifestLockFile())) return false;
      const lock = JSON.parse(fs.readFileSync(this.manifestLockFile(), 'utf8'));
      return lock.execution_config_sha256 === sha256(JSON.stringify(this.executionConfig()));
    } catch { return false; }
  }

  /** Directory holding gate evidence files (produced by validate-gates.mjs). */
  private gateEvidenceDir(): string {
    return this.config.gateEvidenceDir
      ?? path.join(process.cwd(), 'poc', 'benchmark', 'gate-evidence');
  }

  /** REAL fixture verification on disk: actual git HEAD plus clean tree. */
  private async verifyFixtureOnDisk(): Promise<boolean> {
    try {
      const verification = await verifyFixture(this.config.postgresPath, POSTGRES_SHA);
      if (!verification.ok) {
        console.error(`NO-GO G3: fixture verification failed on disk: ${verification.errors.join('; ')}`);
      }
      return verification.ok;
    } catch (error) {
      console.error(`NO-GO G3: fixture verification could not run: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Run the pilot (1-2 questions for connectivity testing). Runs only when
   * explicitly configured (runPilot: true).
   */
  async runPilot(): Promise<void> {
    if (!this.config.runPilot) {
      console.log('Pilot skipped (runPilot is not enabled)');
      return;
    }

    throw new Error('NO-GO: use the separate pilot.ts with pilot questions and separate outputDir; measured questions cannot be pilots');
  }

  /**
   * Freeze the manifest with the REAL implementation (content hash, TBD
   * refusal, readback verification). After this, the campaign must refuse to
   * run if the manifest changes (validated by validateGates / campaign checks).
   */
  async freezeManifest(): Promise<void> {
    await this.loadManifest();
    const root = findRepoRoot(__dirname);
    const sourcePaths = root ? [
      ...sourceFiles(path.join(root, 'packages/exploration-poc/src')),
      ...sourceFiles(path.join(root, 'packages/vibe-connector/src')),
      ...sourceFiles(path.join(root, 'poc/benchmark/runner/src')),
    ] : sourceFiles(path.join(__dirname));
    freezeManifest(this.config.manifestFile, this.manifestLockFile(), {
      executionConfig: this.executionConfig(),
      artifacts: [this.config.questionsFile, ...sourcePaths].map(hashFile),
    });
    console.log('Manifest frozen (real content hash verified by readback)');
  }

  private manifestLockFile(): string {
    return this.config.manifestLockFile ?? path.join(path.dirname(this.config.manifestFile), 'manifest-lock.json');
  }

  private executionConfig(): Record<string, unknown> {
    return {
      fixture_sha: POSTGRES_SHA,
      codetour: { model: this.codeTourExecutor.model, params: this.codeTourExecutor.modelParams, ...this.config.codetour },
      vibe: { model: this.vibeExecutor.model, params: this.vibeExecutor.modelParams, ...this.config.vibe },
      timeout_ms: this.config.timeoutMs ?? 300000,
      retry_policy: this.config.retryPolicy ?? { maxRetries: 0, retryDelay: 0 },
    };
  }

  /**
   * Execute every loaded question with paired agents. THE shared
   * orchestration used by runAll/post-pilot flows (no duplicated loops).
   */
  private async executeAllQuestions(): Promise<RunSummary[]> {
    return (await this.executionManager.executeAll(this.questions)).map(summarizeTrace);
  }

  async beginSeries(series: 'R' | 'T'): Promise<void> {
    await this.executionManager.beginSeries(series);
  }

  /**
   * Run only a single run with one agent
   */
  async runSingle(params: {
    question: Question;
    agent: 'codetour' | 'vibe-native';
  }): Promise<RunSummary> {
    const trace = await this.executionManager.executeSingle(params.question, params.agent);
    return summarizeTrace(trace);
  }

  /**
   * Full execution flow: gates -> (optional pilot, only when explicitly
   * enabled) -> freeze -> main execution.
   */
  async runAll(): Promise<RunSummary[]> {
    if (this.questions.length === 0) {
      await this.loadQuestions();
    }

    if (this.config.runPilot) {
      if (!(await this.validateGates({ requireFrozenManifest: false }))) throw new Error('NO-GO: pilot prerequisites failed');
      await this.runPilot();
    }
    return this.runMain();
  }

  /**
   * Run the MAIN benchmark only: gates -> freeze -> main runs. NO pilot is
   * executed and the campaign is NOT run twice (the previous implementation
   * delegated to runAll(), which re-ran the pilot and executed everything a
   * second time).
   */
  async runMain(): Promise<RunSummary[]> {
    if (this.questions.length === 0) {
      await this.loadQuestions();
    }

    if (!(await this.validateGates())) {
      throw new Error('NO-GO: Gates G0-G5 not all satisfied');
    }

    console.log('Starting main benchmark execution (pilot skipped in runMain)...');

    return this.executeAllQuestions();
  }

  /**
   * Get summary of all logged runs
   */
  getSummary(): ReturnType<ExecutionManager['getSummary']> {
    return this.executionManager.getSummary();
  }

  /**
   * Get all run traces
   */
  getAllRuns(): RunTrace[] {
    return this.logger.listRuns();
  }
}

// Export types
export type { Question };
export { POSTGRES_SHA, freezeManifest, validateManifestFrozen };
