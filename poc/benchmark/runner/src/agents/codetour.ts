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

import { spawn, execFileSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TokenTracker } from '../execution/tracker';
import { AgentExecutor, AgentExecution, Question } from '../execution/manager';
import { SeriesType, FunctionCreated } from '../storage/logger';
import { randomUUID } from 'crypto';
import { sha256 } from '../storage/provenance';

/** Real-harness trace item (matches exploration-poc CallTraceItem, additive subset). */
export interface HarnessCallTraceItem {
  seq: number;
  cachedInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  execution?: unknown;
  parameters?: unknown;
  result?: unknown;
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
  modelConfig?: Record<string, unknown>;
  modelUsed?: string;
  entryPoints?: Array<{ name: string; evidence: Array<{ file: string; startLine: number; endLine: number }> }>;
  components?: Array<{ name: string; evidence: Array<{ file: string; startLine: number; endLine: number }> }>;
  relations?: Array<{ from: string; to: string; evidence: Array<{ file: string; startLine: number; endLine: number }> }>;
  uncertainties?: string[];
  status?: 'complete' | 'partial' | 'failed';
  error?: string;
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
  memoryDir?: string;
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
  private activeSeries?: SeriesType;
  private memoryPath?: string;
  private child?: ChildProcess;

  executionConfig(): Record<string, unknown> {
    return { model: this.model, temperature: this.modelParams.temperature, maxTokens: this.modelParams.max_tokens, topP: this.modelParams.top_p };
  }

  async beginSeries(series: SeriesType): Promise<void> {
    const root = this.config.memoryDir;
    if (!root) throw new Error('NO-GO: CodeTour memoryDir must be configured outside the fixture');
    const fixture = this.fixtureRootOf();
    const resolved = path.resolve(root);
    if (resolved === fixture || resolved.startsWith(fixture + path.sep)) throw new Error('NO-GO: memory must be outside the fixture');
    this.memoryPath = path.join(resolved, `${series}-${randomUUID()}`);
    fs.mkdirSync(this.memoryPath, { recursive: true });
    this.activeSeries = series;
  }

  async cancel(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => { child.once('close', () => resolve()); child.kill('SIGKILL'); });
  }

  canonicalPromptHash(): string {
    const root = findRepoRoot(__dirname);
    if (!root) throw new Error('NO-GO: canonical prompt source unavailable');
    const source = fs.readFileSync(path.join(root, 'packages/exploration-poc/src/decomposition-prompt.ts'), 'utf8');
    const literal = /export const DECOMPOSITION_PROMPT\s*=\s*("(?:[^"\\]|\\.)*")\s*;/s.exec(source)?.[1];
    if (!literal) throw new Error('NO-GO: canonical prompt cannot be verified');
    return sha256(JSON.parse(literal));
  }

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
    const cliPath = this.config.harnessCliPath ? path.resolve(this.config.harnessCliPath) : resolveHarnessCliPath();
    if (this.activeSeries !== question.series) await this.beginSeries(question.series);
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

    const catalogueFile = path.join(this.memoryPath!, `${sha256(fs.realpathSync(this.fixtureRootOf()))}.json`);
    const catalogueBefore: MemoryEntry[] = fs.existsSync(catalogueFile) ? JSON.parse(fs.readFileSync(catalogueFile, 'utf8')) : [];
    const output = await this.runHarness(cliPath, question, modelEnv);
    const harness = parseHarnessOutput(output.stdout);

    // Only model requests consume tokens. Local primitives and replays remain raw tools.
    for (const item of (harness.callTrace ?? []).filter(item => item.type === 'model')) {
      const callId = tracker.startCall(item.name.includes('consolidat') ? 'consolidation' : item.name.includes('select') ? 'memory_list' : 'prompt', item.name, {
        seq: item.seq, started_at: item.startedAt, ended_at: item.endedAt,
      });
      if (item.usageMissing || item.inputTokens == null || item.outputTokens == null) {
        tracker.completeCallWithMissingUsage(callId, item.outcome ?? null, item.error ?? null, item.durationMs);
      } else {
        tracker.completeCall(callId, {
          input_tokens: item.inputTokens, output_tokens: item.outputTokens,
          cached_input_tokens: item.cachedInputTokens, cache_creation_input_tokens: item.cacheCreationInputTokens,
          cache_included_in_input: true,
        }, item.outcome ?? null, item.error ?? null, item.durationMs);
      }
    }
    // Ingest spent tokens BEFORE rejecting invalid provenance or a failed process.
    if (harness.promptSha256 !== this.canonicalPromptHash()) throw new Error('NO-GO: harness canonical prompt hash mismatch');
    // Provenance check on the values the provider actually received (the
    // per-call max_output_tokens is harness budget accounting reported in the
    // call trace, not a fixed request parameter — so only the model id and the
    // temperature are compared against the configured execution).
    if (!harness.modelConfig || harness.modelConfig.model !== this.model ||
      harness.modelConfig.temperature !== this.modelParams.temperature) {
      throw new Error('NO-GO: harness effective model configuration differs or is unreported');
    }
    if (output.code !== 0 && !harness.callTrace?.length) throw new Error('NO-GO: child failed without provider telemetry');

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
      ...extractMemoryActivity(harness, catalogueBefore, fs.existsSync(catalogueFile) ? JSON.parse(fs.readFileSync(catalogueFile, 'utf8')) : []),
      agent_version: harnessRevision(),
      model_used: harness.modelUsed ?? modelEnv,
      system_prompt_hash: harness.promptSha256,
      tools: (harness.callTrace ?? []).filter(item => item.type !== 'model'),
      // A partial exploration is NOT a successful run: it is recorded as an
      // error with its stop reason (counted in the denominator, never erased),
      // while its trace data remains available for analysis.
      status: harness.status === 'complete' ? 'success' : 'error',
      error: harness.status === 'complete' ? null : harness.error ? `Exploration failed: ${harness.error}` : `Partial exploration (stopReason: ${harness.stopReason ?? 'unknown'})`,
    };
  }

  /** Spawn the REAL harness CLI and capture its stdout. */
  private runHarness(cliPath: string, question: Question, model: string | undefined): Promise<{stdout: string; code: number | null}> {
    const fixtureRoot = this.fixtureRootOf();
    return new Promise((resolve, reject) => {
      // Loop-guard caps, sized to be UNBINDING under the sealed fairness
      // envelope (600000 tokens / 600000 ms): the observed minimum input per
      // model call (>= 1741 tokens) bounds model calls to <= 344 before the
      // token ceiling stops a run, so 384 iterations can never fire first;
      // local primitives spend no tokens and are bounded by the same wall
      // clock, so 4096 calls stays out of reach. The BINDING limits are the
      // two pre-registered envelopes only — hidden 8/32 CLI defaults made the
      // executed protocol diverge from the manifest (observed partial
      // 'iterations' stop).
      const args = [
        '--code', '--memory', this.memoryPath!,
        '--iterations', String(384), '--calls', String(4096),
        fixtureRoot, question.objective,
      ];
      const child = spawn(process.execPath, [cliPath, ...args], {
        cwd: path.dirname(cliPath), timeout: this.config.timeoutMs,
        // Fairness envelope (spec §4): the harness must explore with the SAME
        // token and wall-clock ceilings as the native arm (600000/600000 from
        // RunnerConfig) — never the CLI's 32k default, which truncated
        // explorations (observed: stopReason 'tokens' at 35k in-run).
        env: {
          ...process.env, MISTRAL_MODEL: model,
          CODETOUR_MODEL_CONFIG: JSON.stringify(this.executionConfig()),
          CODETOUR_PROMPT_SHA256: this.canonicalPromptHash(),
          CODETOUR_TOKEN_BUDGET: String(this.config.maxTokens),
          CODETOUR_TIME_BUDGET_MS: String(this.config.timeoutMs),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      child.on('error', error => reject(new Error(`NO-GO: harness spawn failed: ${error.message}`)));
      child.on('close', (code) => {
        this.child = undefined;
        if (stdout.trim()) resolve({ stdout, code });
        else reject(new Error(`NO-GO: harness failed without a telemetry payload (exit ${code}): ${stderr.slice(0, 2000)}`));
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

interface MemoryEntry { id: string; code: string; paramsSchema?: Array<{ name: string; type: string }> }

/** Observed persistence and successful replay, independent of semantic Tour correctness. */
export function extractMemoryActivity(harness: HarnessExploreResult, before: MemoryEntry[], after: MemoryEntry[]): { functions_created: FunctionCreated[]; functions_reused: string[] } {
  const previousIds = new Set(before.map(entry => entry.id));
  const report = harness.consolidationReport as { accepted?: string[] } | undefined;
  const accepted = new Set(report?.accepted ?? []);
  return {
    functions_created: after.filter(entry => !previousIds.has(entry.id) && accepted.has(entry.id)).map(entry => ({
      function_id: entry.id, source: entry.code,
      parameters_schema: { parameters: entry.paramsSchema ?? [] },
      created_at: harness.callTrace?.at(-1)?.endedAt ?? new Date().toISOString(), reuse_count: 0,
    })),
    functions_reused: [...new Set((harness.callTrace ?? []).filter(call => call.type === 'memory_run' && !call.error && previousIds.has(call.name)).map(call => call.name))],
  };
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
