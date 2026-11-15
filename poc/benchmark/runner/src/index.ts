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
import path from 'path';
import { ImmutableLogger, RunTrace, freezeManifest, validateManifestFrozen, POSTGRES_SHA } from './storage/logger';
import { verifyFixture } from './storage/fixture-verification';
import { ExecutionManager, Question } from './execution/manager';
import { CodeTourExecutor, CodeTourConfig } from './agents/codetour';
import { VibeExecutor, VibeConfig } from './agents/vibe';

/**
 * Configuration for the benchmark runner
 */
export interface RunnerConfig {
  /** Path to the questions JSON file */
  questionsFile: string;
  /** Path to the manifest JSON file */
  manifestFile: string;
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
      resultsDir: path.join(config.outputDir, 'results/runs'),
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
    });

    // Initialize REAL agent executors: both arms explore THE fixture
    // directory that the manager verifies per run (same_tree_for_both_agents).
    this.codeTourExecutor = new CodeTourExecutor({
      ...config.codetour,
      fixtureRoot: config.postgresPath,
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
  async validateGates(): Promise<boolean> {
    const readGateEvidence = (file: string): Record<string, unknown> | null => {
      try {
        const filePath = path.join(this.gateEvidenceDir(), file);
        return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
      } catch {
        return null;
      }
    };

    const checks: Record<string, boolean> = {};

    const g0 = readGateEvidence('g0-conformance.json');
    checks.G0 = g0 !== null
      && g0['passed'] === true
      && g0['failed_count'] === 0
      && typeof g0['total_tests'] === 'number'
      && (g0['total_tests'] as number) > 0
      && typeof g0['command'] === 'string'
      && (g0['command'] as string).length > 0;

    const g1 = readGateEvidence('g1-sentinel.json');
    checks.G1 = g1 !== null
      && g1['g1_passed'] === true
      && typeof g1['session_id'] === 'string' && (g1['session_id'] as string).length > 0
      && typeof g1['vibe_version'] === 'string' && (g1['vibe_version'] as string).length > 0
      && typeof g1['model'] === 'string' && (g1['model'] as string).length > 0
      && g1['subagent_detected'] === true
      && typeof g1['tools_count'] === 'number' && (g1['tools_count'] as number) > 0;

    const g2 = readGateEvidence('g2-instrumentation.json');
    checks.G2 = g2 !== null
      && g2['g2_passed'] === true
      && typeof g2['calls_total'] === 'number' && (g2['calls_total'] as number) > 0
      && g2['calls_without_usage'] === 0;

    // G3: REAL on-disk verification NOW (git HEAD + clean tree), plus the
    // question-carried SHAs (both checks must hold).
    checks.G3 = this.validatePostgresSha() && await this.verifyFixtureOnDisk();

    const g4 = readGateEvidence('g4-evaluator.json');
    checks.G4 = g4 !== null
      && g4['criteria_registered'] === true
      && g4['adversarial_case_rejected'] === true;

    // G5: pre-registration — REAL check: lock exists and the current manifest
    // content hashes to the recorded digest.
    try {
      await this.loadManifest();
      checks.G5 = validateManifestFrozen(this.config.manifestFile);
    } catch {
      checks.G5 = false;
    }

    const allPassed = Object.values(checks).every(v => v);

    if (!allPassed) {
      const failed = Object.entries(checks)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      console.error(`NO-GO: Failed gates (no valid evidence): ${failed.join(', ')}`);
    }

    return allPassed;
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

    const pilotCount = this.config.pilotCount ?? 2;
    const pilotQuestions = this.questions.slice(0, Math.min(pilotCount, this.questions.length));

    if (pilotQuestions.length === 0) {
      throw new Error('No questions available for pilot');
    }

    console.log(`Running pilot with ${pilotQuestions.length} question(s)... (NOT counted in the main benchmark)`);

    for (const question of pilotQuestions) {
      console.log(`Pilot: Running question ${question.id}...`);

      try {
        await this.executionManager.executeSingle(question, 'codetour');
        await this.executionManager.executeSingle(question, 'vibe-native');
      } catch (error) {
        console.error(`  - Pilot error for ${question.id}:`, error);
      }
    }

    console.log('Pilot completed');
  }

  /**
   * Freeze the manifest with the REAL implementation (content hash, TBD
   * refusal, readback verification). After this, the campaign must refuse to
   * run if the manifest changes (validated by validateGates / campaign checks).
   */
  async freezeManifest(): Promise<void> {
    await this.loadManifest();
    freezeManifest(this.config.manifestFile, path.join(this.config.outputDir, 'manifest-lock.json'));
    console.log('Manifest frozen (real content hash verified by readback)');
  }

  /**
   * Execute every loaded question with paired agents. THE shared
   * orchestration used by runAll/post-pilot flows (no duplicated loops).
   */
  private async executeAllQuestions(): Promise<RunSummary[]> {
    const results: RunSummary[] = [];

    for (let i = 0; i < this.questions.length; i++) {
      const question = this.questions[i];
      console.log(`Running question ${i + 1}/${this.questions.length}: ${question.id}...`);

      try {
        const { codetour, vibe } = await this.executionManager.executePaired(question);
        results.push(summarizeTrace(codetour), summarizeTrace(vibe));
        console.log(`  Completed: CodeTour (${codetour.total_tokens.total} tokens) and Vibe (${vibe.total_tokens.total} tokens)`);
      } catch (error) {
        // Agent/infrastructure failures are recorded and count in the
        // denominator (never erased, never replaced with fabricated runs).
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  Error executing question ${question.id}:`, message);
        results.push(
          { runId: '', questionId: question.id, agent: 'codetour', series: question.series, totalTokens: { input: 0, output: 0, total: 0 }, status: 'error', error: message },
          { runId: '', questionId: question.id, agent: 'vibe-native', series: question.series, totalTokens: { input: 0, output: 0, total: 0 }, status: 'error', error: message }
        );
      }
    }

    return results;
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

    if (!(await this.validateGates())) {
      throw new Error('NO-GO: Gates G0-G5 not all satisfied');
    }

    console.log('All gates G0-G5 validated.');

    await this.runPilot();
    await this.freezeManifest();

    console.log('Starting main benchmark execution...');
    return this.executeAllQuestions();
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

    await this.freezeManifest();

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
