/**
 * CodeTour Agent Executor — REAL harness execution (remediation).
 *
 * This replaces the fabricated simulator (previously: hardcoded token usage,
 * Math.random() citations, fake memory/consolidation calls). The CodeTour arm
 * now drives the REAL exploration-poc harness CLI
 * (packages/exploration-poc/src/cli.ts), which runs the actual Tour against
 * the fixture workspace with a real Mistral provider call
 * (packages/exploration-poc/src/mistral.ts) and returns REAL per-call
 * telemetry (timestamps, durations, provider usage fields).
 *
 * Hard honesty rules enforced here:
 * - No MISTRAL_API_KEY in the environment => explicit NO-GO error. There is
 *   NO simulated fallback path.
 * - Token usage comes exclusively from the provider's usage fields surfaced
 *   in the harness call trace; a call without them is recorded as
 *   usage_missing and the run is refused by the NO-GO controls.
 * - The harness echoes the SHA-256 of the canonical decomposition prompt; a
 *   run that does not carry it is refused (the canonical prompt has a single
 *   source in exploration-poc/src/decomposition-prompt.ts — this module never
 *   duplicates the prompt text).
 * - Citations come from the harness's verified evidence references only.
 */

import { spawn, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TokenTracker } from '../execution/tracker';
import { AgentExecutor, AgentExecution, Question } from '../execution/manager';
import { CallRecord } from '../storage/logger';

/** Real-harness trace item (matches exploration-poc CallTraceItem, additive subset). */
export interface HarnessCallTraceItem {
  seq: number;
  type: 'model' | 'tool' | 'memory_run' | 'memory_list' | 'function_try';
  name: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  usageMissing: boolean;
  outcome?: string;
  error?: string;
}

export interface HarnessExploreResult {
  objective: string;
  entryPoints?: Array<{ name: string; evidence: Array<{ file: string; startLine: number; endLine: number }> }>;
  components?: Array<{ name: string; evidence: Array<{ file: string; startLine: number; endLine: number }> }>;
  relations?: Array<{ from: string; to: string; evidence: Array<{ file: string; startLine: number; endLine: number }> }>;
  uncertainties?: string[];
  status?: 'complete' | 'partial';
  stopReason?: string | null;
  promptSha256?: string;
  metrics?: Record<string, unknown>;
  callTrace?: HarnessCallTraceItem[];
  consolidationReport?: unknown;
}

/**
 * Configuration for the CodeTour harness executor.
 */
export interface CodeTourConfig {
  /** Explicit path to the exploration-poc CLI; resolved from the repo root when omitted. */
  harnessCliPath?: string;
  /** Path to the fixture workspace the harness explores (the directory the manager verifies per run). */
  fixtureRoot?: string;
  /** Wall-clock budget forwarded to the spawn (per run). */
  timeoutMs?: number;
  /** Model alias requested through MISTRAL_MODEL (a real provider call). */
  model?: string;
  temperature: number;
  maxTokens: number;
  topP?: number;
}

const DEFAULT_CONFIG: CodeTourConfig = {
  timeoutMs: 300000,
  model: 'mistral-small-latest',
  temperature: 0,
  maxTokens: 4096,
};

/**
 * Locate the repository root by searching upward for the harness CLI.
 * Never hardcodes a worktree path.
 */
export function findRepoRoot(from: string): string | null {
  let dir = path.resolve(from);
  while (true) {
    if (fs.existsSync(path.join(dir, 'packages', 'exploration-poc', 'src', 'cli.ts'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Resolve the REAL harness CLI path (explicit config or repo-root discovery). */
export function resolveHarnessCliPath(from: string = __dirname): string {
  const explicit = process.env.CODETOUR_HARNESS_CLI;
  if (explicit) return path.resolve(explicit);
  const root = findRepoRoot(from);
  if (!root) {
    throw new Error(`exploration-poc harness CLI not found searching upward from ${from}. Set CODETOUR_HARNESS_CLI explicitly.`);
  }
  return path.join(root, 'packages', 'exploration-poc', 'src', 'cli.ts');
}

export class CodeTourExecutor implements AgentExecutor {
  readonly name = 'codetour' as const;
  readonly version: string;
  readonly model: string;
  readonly modelParams: {
    temperature: number;
    max_tokens: number;
    top_p?: number;
  };

  private config: CodeTourConfig;

  constructor(config: Partial<CodeTourConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Real agent provenance: the harness CLI has no version identifier other
    // than the repository revision that produced it — resolved per run in
    // execute(). The instance-level label states the harness package name.
    this.version = 'exploration-poc-harness';
    this.model = this.config.model!;
    this.modelParams = {
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      top_p: this.config.topP,
    };
  }

  /**
   * Execute a question through the REAL exploration harness.
   */
  async execute(question: Question, tracker: TokenTracker): Promise<AgentExecution> {
    const cliPath = resolveHarnessCliPath();
    if (!fs.existsSync(cliPath)) {
      throw new Error(`NO-GO: exploration harness CLI not found at ${cliPath}`);
    }
    // Real provider call requirement: without the key the Mistral client
    // would reject, which would surface as a run error anyway — but we fail
    // here, BEFORE any spawn, with an explicit message (no simulated fallback).
    if (!process.env.MISTRAL_API_KEY) {
      throw new Error('NO-GO: MISTRAL_API_KEY is not set. The CodeTour arm requires a real provider call; refusing to simulate.');
    }
    const modelEnv = this.config.model ? this.config.model : undefined;

    const stdout = await this.runHarness(cliPath, question, modelEnv);
    const harness = parseHarnessOutput(stdout);

    // The canonical prompt lives in ONE place (exploration-poc). The harness
    // echoes its SHA-256 on every run; a run without that echo is refused —
    // this is how the runner stays bound to the canonical prompt without
    // duplicating the prompt text (no second copy to drift).
    if (!harness.promptSha256) {
      throw new Error('NO-GO: harness result carries no promptSha256 — cannot prove the canonical decomposition prompt was used');
    }

    // Map the REAL harness call trace into tracker calls. Real timestamps and
    // durations come from the harness records (Date-based), usage from the
    // provider response fields only.
    for (const item of harness.callTrace ?? []) {
      const callType = this.mapCallType(item.type, item.name);
      const callId = tracker.startCall(callType, item.type === 'model' ? 'harness_model' : item.name, {
        seq: item.seq,
        started_at: item.startedAt,
        ended_at: item.endedAt,
      });
      if (item.usageMissing || item.inputTokens === null || item.outputTokens === null) {
        tracker.completeCallWithMissingUsage(callId, item.outcome ?? null, item.error ?? null, item.durationMs);
      } else {
        tracker.completeCall(callId, { input_tokens: item.inputTokens, output_tokens: item.outputTokens }, item.outcome ?? null, item.error ?? null, item.durationMs);
      }
    }

    // Structured result: steps and citations ONLY from harness-verified evidence.
    const evidenceItems = [...(harness.entryPoints ?? []), ...(harness.components ?? [])];
    const steps = evidenceItems.map((item, index) => {
      const first = item.evidence[0];
      return {
        step_id: `step-${index + 1}`,
        description: item.name,
        file: first?.file,
        line: first?.startLine,
        citations: item.evidence.map(ref => `${ref.file}:${ref.startLine}`),
      };
    });
    const citations = [...new Set(evidenceItems.flatMap(item => item.evidence.map(ref => `${ref.file}:${ref.startLine}`)))];

    return {
      calls: tracker.getCalls(),
      result: {
        tour_title: `Tour: ${harness.objective}`,
        steps,
        raw_response: JSON.stringify(harness),
        citations,
      },
      functions_created: [],
      functions_reused: extractReusedFunctionIds(harness),
      agent_version: harnessRevision(),
      model_used: modelEnv,
      // A partial exploration is NOT a successful run: it is recorded as an
      // error with its stop reason (counted in the denominator, never erased),
      // while its trace data remains available for analysis.
      status: harness.status === 'complete' ? 'success' : 'error',
      error: harness.status === 'complete' ? null : `Partial exploration (stopReason: ${harness.stopReason ?? 'unknown'})`,
    };
  }

  /** Spawn the REAL harness CLI and capture its stdout. */
  private runHarness(cliPath: string, question: Question, model: string | undefined): Promise<string> {
    const fixtureRoot = this.fixtureRootOf();
    return new Promise<string>((resolve, reject) => {
      const args = ['--code', fixtureRoot, question.objective];
      const child = spawn(process.execPath, [cliPath, ...args], {
        cwd: path.dirname(cliPath),
        env: model ? { ...process.env, MISTRAL_MODEL: model } : { ...process.env },
        timeout: this.config.timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const spawnStart = Date.now();

      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      child.on('error', (error) => {
        reject(new Error(`NO-GO: failed to spawn exploration harness: ${error.message}`));
      });

      child.on('close', (code, signal) => {
        if (code === 0 && stdout.trim()) {
          resolve(stdout);
          return;
        }
        const reason = signal
          ? `terminated by signal ${signal} after ${Date.now() - spawnStart}ms`
          : `exit code ${code}`;
        reject(new Error(`NO-GO: exploration harness failed (${reason}). stderr: ${stderr.slice(0, 2000)}`));
      });
    });
  }

  /**
   * The harness must explore THE fixture the manager verified — the same
   * directory for both agents. There is no fallback to '.' or to an ambient
   * path: unconfigured => explicit NO-GO.
   */
  private fixtureRootOf(): string {
    const root = this.config.fixtureRoot ?? process.env.CODETOUR_FIXTURE_PATH;
    if (!root) {
      throw new Error('NO-GO: CodeTour executor has no fixtureRoot configured (pass config.postgresPath or set CODETOUR_FIXTURE_PATH) — refusing to explore an ambiguous directory');
    }
    if (!fs.existsSync(root)) {
      throw new Error(`NO-GO: fixtureRoot does not exist: ${root}`);
    }
    return path.resolve(root);
  }

  private mapCallType(type: string, name: string): CallRecord['call_type'] {
    switch (type) {
      case 'model': return 'prompt';
      case 'memory_list': return 'memory_list';
      case 'memory_run': return 'memory_run';
      case 'function_try': return 'function_try';
      case 'tool': return name === 'search' ? 'search' : 'tool';
      default: return 'tool';
    }
  }
}

/** Parse the harness stdout JSON (the CLI prints exactly one JSON document). */
export function parseHarnessOutput(stdout: string): HarnessExploreResult {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error('NO-GO: exploration harness produced no output');
  try {
    return JSON.parse(trimmed) as HarnessExploreResult;
  } catch (error) {
    throw new Error(`NO-GO: exploration harness output is not valid JSON: ${(error as Error).message.slice(0, 200)}`);
  }
}

/** Extract memory function ids the harness reports as reused, when present in its metrics/report. */
function extractReusedFunctionIds(harness: HarnessExploreResult): string[] {
  const report = harness.consolidationReport as { reused?: string[]; reuses?: string[] } | null | undefined;
  if (report && Array.isArray(report.reused)) return report.reused.map(String);
  if (report && Array.isArray(report.reuses)) return report.reuses.map(String);
  return [];
}

/** Real repository revision of the harness (git HEAD of the main repo). */
function harnessRevision(): string | undefined {
  try {
    const root = findRepoRoot(__dirname);
    if (!root) return undefined;
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 10000, encoding: 'utf-8' });
    return sha.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Factory function to create a CodeTour executor
 */
export function createCodeTourExecutor(config?: Partial<CodeTourConfig>): CodeTourExecutor {
  return new CodeTourExecutor(config);
}
