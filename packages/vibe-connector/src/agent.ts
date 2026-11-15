/**
 * Vibe Native Research Sub-Agent Connector — REAL invocation only.
 *
 * This connector invokes the actual `vibe` CLI in headless mode and captures
 * all metadata from its real outputs (export.json, meta.json, session
 * journal). There is no simulation path: when the CLI is unavailable, the
 * invocation FAILS with an explicit error that the runner must surface as
 * NO-GO/stop. No result is ever fabricated or "renamed" into validity.
 *
 * Real shapes this module relies on (verified against vibe 3.1.2):
 * - `vibe --output json`  => stdout holds the session journal projection
 *   (an array of entries with role/content blocks; the last assistant text is
 *   the response).
 * - `--output-dir` writes export.json: { outcome, stop_reason, error,
 *   session_id, usage{input_tokens, output_tokens, cached_input_tokens,
 *   total_tokens}, cost_usd, steps, config{active_model, default_agent,
 *   routed_model_config{...}, tools{...}}, vibe_version, started_at, ended_at,
 *   limits, exit_code } and session/ (meta.json + journal/*.jsonl).
 * - session journal records of type `action_result` carry ONE LLM call result:
 *   { result: { finish_reason, parts, usage{...} } } — per-call telemetry for
 *   G2 — and tool calls appear as parts with type 'tool_call'.
 */

import { spawn, spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  VibeAvailability,
  VibeCallUsage,
  VibeExecution,
  VibeNativeAgent,
  VibeConnectorConfig,
} from './types';

const DEFAULT_CONFIG: VibeConnectorConfig = {
  vibeCommand: 'vibe',
  model: 'mistral-medium-3.5',
  maxTurns: 20,
  timeoutMs: 300000,
};

/** Explicit failure type: the runner maps this to NO-GO/stop. Never swallowed. */
export class VibeUnavailableError extends Error {
  readonly code = 'VIBE_UNAVAILABLE';
  constructor(message: string) { super(message); this.name = 'VibeUnavailableError'; }
}

/** Detect the vibe CLI ON THIS MACHINE. No default version: the detected one is returned or an error. */
export function detectVibeAvailability(config: Partial<VibeConnectorConfig> = {}): VibeAvailability {
  const command = config.vibeCommand ?? DEFAULT_CONFIG.vibeCommand!;
  try {
    const probe = spawnSync(command, ['--version'], { encoding: 'utf-8', timeout: 15000 });
    if (probe.error) return { available: false, error: `${command} could not be spawned: ${probe.error.message}` };
    if (probe.status !== 0) return { available: false, error: `${command} --version exited with ${probe.status}: ${String(probe.stderr ?? '').trim()}` };
    const version = String(probe.stdout ?? '').trim();
    if (!version) return { available: false, error: `${command} --version printed no version` };
    return { available: true, version };
  } catch (error) {
    return { available: false, error: `Availability probe failed: ${String((error as Error).message ?? error)}` };
  }
}

/**
 * Default work directory: the REAL fixture `poc/benchmark/postgres` below the
 * repository root, discovered by walking up from the current directory and
 * validated (exists, is a directory, non-empty). Returns undefined when not
 * found — callers must then pass workDir EXPLICITLY; nothing is guessed.
 */
export function defaultWorkDir(startFrom: string = process.cwd()): string | undefined {
  let current = path.resolve(startFrom);
  while (true) {
    const candidate = path.join(current, 'poc', 'benchmark', 'postgres');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory() && fs.readdirSync(candidate).length > 0) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function resolveWorkDir(config: Partial<VibeConnectorConfig>): string {
  const explicit = config.workDir?.trim();
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new RangeError(`workDir does not exist: ${explicit}`);
    if (!fs.statSync(explicit).isDirectory()) throw new RangeError(`workDir is not a directory: ${explicit}`);
    return explicit;
  }
  const found = defaultWorkDir();
  if (!found) {
    throw new VibeUnavailableError(
      'No workDir configured and the default fixture poc/benchmark/postgres could not be located from the current directory. Pass an explicit validated workDir; the connector never guesses a filesystem path.'
    );
  }
  return found;
}

/**
 * Invoke the REAL vibe CLI headless on a research question.
 * Rejects with VibeUnavailableError when the CLI is missing and with Error on
 * any other real invocation failure — the runner must surface these as NO-GO.
 */
export async function invokeVibeNativeAgent(
  question: string,
  config: Partial<VibeConnectorConfig> = {}
): Promise<VibeExecution> {
  const mergedConfig: VibeConnectorConfig = { ...DEFAULT_CONFIG, ...config };
  const workDir = resolveWorkDir(mergedConfig);

  // Runtime availability check FIRST: an explicit failure, never a simulated run.
  const availability = detectVibeAvailability(mergedConfig);
  if (!availability.available) {
    throw new VibeUnavailableError(`Vibe CLI is not available in this environment: ${availability.error}`);
  }

  const executionId = crypto.randomUUID().replace(/-/g, '').substring(0, 8);
  const outputDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-native-')), executionId);
  fs.mkdirSync(outputDir, { recursive: true });

  // Build the command line for headless mode. All flags verified against
  // `vibe --help` (vibe 3.1.2). --auto-approve/--trust allow real tool execution.
  const args = [
    '-p', question,
    '--output', 'json',
    '--max-turns', String(mergedConfig.maxTurns!),
    '--output-dir', outputDir,
    '--auto-approve',
    '--trust',
  ];
  if (mergedConfig.model) args.push('--model', mergedConfig.model);

  return new Promise<VibeExecution>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const spawnStarted = Date.now();

    const vibeProcess = spawn(mergedConfig.vibeCommand!, args, {
      cwd: workDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: mergedConfig.timeoutMs,
    });

    vibeProcess.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    vibeProcess.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    vibeProcess.on('error', (error) => {
      cleanupOutputDir(outputDir);
      reject(new VibeUnavailableError(`Vibe CLI invocation failed: ${error.message}`));
    });

    vibeProcess.on('close', (code, signal) => {
      try {
        const exportPath = path.join(outputDir, 'export.json');
        if (!fs.existsSync(exportPath)) {
          cleanupOutputDir(outputDir);
          const reason = signal
            ? `terminated by signal ${signal}${code === null ? ' (likely the configured timeout was reached)' : ''}`
            : `exit code ${code}`;
          reject(new Error(`Vibe invocation produced no export.json (${reason}). stderr: ${stderr.slice(0, 2000)}`));
          return;
        }
        const exportData = parseJsonFile(exportPath) as Record<string, unknown>;
        if (exportData.error) {
          cleanupOutputDir(outputDir);
          reject(new Error(`Vibe invocation reported an error: ${String(exportData.error)}`));
          return;
        }
        const metaData = parseJsonFile(path.join(outputDir, 'session', 'meta.json')) as Record<string, unknown>;
        const journalRecords = readJournalRecords(outputDir);

        const execution = buildExecution({ stdout, exportData, metaData, journalRecords, question, executionId, spawnElapsedMs: Date.now() - spawnStarted });
        cleanupOutputDir(outputDir);
        resolve(execution);
      } catch (error) {
        cleanupOutputDir(outputDir);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

function parseJsonFile(filePath: string): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>; }
  catch { return {}; }
}

export interface JournalRecord { type?: string; payload?: Record<string, unknown>; }

/** Read every recorded journal line of the session (REAL per-call telemetry). */
export function readJournalRecords(outputDir: string): JournalRecord[] {
  const journalDir = path.join(outputDir, 'session', 'journal');
  if (!fs.existsSync(journalDir)) return [];
  const records: JournalRecord[] = [];
  for (const file of fs.readdirSync(journalDir).filter(name => name.endsWith('.jsonl')).sort()) {
    const content = fs.readFileSync(path.join(journalDir, file), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { records.push(JSON.parse(trimmed) as JournalRecord); } catch { /* a partially flushed line stays ignored; validation sees the gap via missing per-call usage */ }
    }
  }
  return records;
}

/** Extract every LLM-call usage record and every tool call from REAL journal records. */
export function extractPerCallUsageAndTools(records: JournalRecord[]): { perCallUsage: VibeCallUsage[]; toolsUsed: string[]; subagent?: string; completionsMissingUsage: number } {
  const perCallUsage: VibeCallUsage[] = [];
  const toolsUsed: string[] = [];
  let subagent: string | undefined;
  let completionsMissingUsage = 0;
  for (const record of records) {
    if (record.type !== 'action_result') continue;
    const result = (record.payload?.result ?? {}) as Record<string, unknown>;
    if (result.type && result.type !== 'completion_succeeded') continue; // failed/completed-elsewhere calls carry no usable counters
    const inner = (result.result ?? {}) as Record<string, unknown>;
    const usage = inner.usage as Record<string, unknown> | undefined;
    if (!usage) { completionsMissingUsage++; perCallUsage.push({ callIndex: perCallUsage.length, finishReason: inner.finish_reason as string | undefined, inputTokens: null, outputTokens: null, cachedInputTokens: null, totalTokens: null, usageMissing: true }); continue; }
    perCallUsage.push({
      callIndex: perCallUsage.length,
      finishReason: inner.finish_reason as string | undefined,
      inputTokens: Number(usage.input_tokens ?? 0),
      outputTokens: Number(usage.output_tokens ?? 0),
      cachedInputTokens: Number(usage.cached_input_tokens ?? 0),
      totalTokens: Number(usage.total_tokens ?? 0),
      usageMissing: false,
    });
    for (const part of (Array.isArray(inner.parts) ? inner.parts : []) as Array<Record<string, unknown>>) {
      if (part.type === 'tool_call' && typeof part.name === 'string') {
        if (!toolsUsed.includes(part.name)) toolsUsed.push(part.name);
        if (part.name === 'task') {
          const detected = detectSubagentFromArguments(String(part.arguments_json ?? ''));
          if (detected) subagent = detected;
        }
      }
    }
  }
  return { perCallUsage, toolsUsed, subagent, completionsMissingUsage };
}

/** Best-effort identification of the subagent name inside a task tool call. */
function detectSubagentFromArguments(argumentsJson: string): string | undefined {
  if (!argumentsJson) return undefined;
  try {
    const args = JSON.parse(argumentsJson) as Record<string, unknown>;
    for (const key of ['subagent', 'subagent_name', 'agent', 'agent_name', 'agentName']) {
      const value = args[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  } catch { /* fall through to regex on truncated arguments */ }
  const match = argumentsJson.match(/"(?:subagent(?:_name)?|agent(?:_name)?)\"\s*:\s*"([^"]+)"/);
  return match?.[1];
}

/** Pull the last assistant text out of the `--output json` stdout projection. */
export function extractResponseFromOutput(output: string): string {
  if (!output.trim()) return '';
  let entries: unknown = null;
  try { entries = JSON.parse(output); } catch { /* JSONL fallback below */ }
  const texts: string[] = [];
  const collect = (entry: Record<string, unknown>): void => {
    if (entry.role !== 'assistant') return;
    const content = entry.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === 'object' && typeof (block as Record<string, unknown>).text === 'string') texts.push((block as { text: string }).text);
      }
    } else if (typeof content === 'string') texts.push(content);
  };
  if (Array.isArray(entries)) {
    for (const entry of entries) if (entry && typeof entry === 'object') collect(entry as Record<string, unknown>);
  } else {
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { const item = JSON.parse(trimmed) as Record<string, unknown>; if (item && typeof item === 'object') collect(item); } catch { /* non-JSON line */ }
    }
  }
  return texts.filter(Boolean).join('\n').trim();
}

/**
 * Build a VibeExecution from REAL outputs only. Identity comes from the
 * export/journal; nothing is renamed or defaulted into validity.
 */
export function buildExecution({ stdout, exportData, metaData, journalRecords, question, executionId, spawnElapsedMs }: {
  stdout: string;
  exportData: Record<string, unknown>;
  metaData: Record<string, unknown>;
  journalRecords: JournalRecord[];
  question: string;
  executionId: string;
  spawnElapsedMs: number;
}): VibeExecution {
  const usage = (exportData.usage ?? {}) as Record<string, unknown>;
  const exportSessionId = typeof exportData.session_id === 'string' ? exportData.session_id : undefined;
  const metaSessionId = typeof metaData.session_id === 'string' ? metaData.session_id : undefined;
  const sessionId = exportSessionId ?? metaSessionId ?? executionId;
  const vibeVersion = typeof exportData.vibe_version === 'string' && exportData.vibe_version.trim() ? exportData.vibe_version : undefined;
  if (!vibeVersion) throw new Error('export.json carries no vibe_version: cannot establish the execution identity');

  const config = (exportData.config ?? {}) as Record<string, unknown>;
  const routedModelConfig = (config.routed_model_config ?? config.model_config ?? {}) as Record<string, unknown>;
  const activeModel = typeof config.active_model === 'string' && config.active_model.trim() ? config.active_model : undefined;
  if (!activeModel) throw new Error('export.json carries no config.active_model: cannot establish the executed model');

  const { perCallUsage, toolsUsed, subagent, completionsMissingUsage } = extractPerCallUsageAndTools(journalRecords);

  const startedAt = typeof exportData.started_at === 'string' ? exportData.started_at : (typeof metaData.start_time === 'string' ? metaData.start_time : undefined);
  const endedAt = typeof exportData.ended_at === 'string' ? exportData.ended_at : (typeof metaData.end_time === 'string' ? metaData.end_time : undefined);
  let durationMs = 0;
  if (startedAt && endedAt) {
    const start = Date.parse(startedAt);
    const end = Date.parse(endedAt);
    if (Number.isFinite(start) && Number.isFinite(end)) durationMs = end - start;
  }
  if (!durationMs) durationMs = spawnElapsedMs; // real measured spawn duration as fallback, never invented

  const agent: VibeNativeAgent = {
    name: subagent ?? (typeof config.default_agent === 'string' && config.default_agent.trim() ? config.default_agent : 'direct'),
    version: vibeVersion,
    model: activeModel,
    modelConfig: {
      temperature: typeof routedModelConfig.temperature === 'number' ? routedModelConfig.temperature : undefined,
      maxTokens: typeof routedModelConfig.max_output_tokens === 'number' ? routedModelConfig.max_output_tokens : undefined,
      thinking: typeof routedModelConfig.thinking === 'string' ? routedModelConfig.thinking : undefined,
    },
    tools: toolsUsed,
    agentType: subagent ? 'subagent' : 'direct',
  };

  if (completionsMissingUsage > 0) {
    console.warn(`[vibe-connector] ${completionsMissingUsage} LLM call(s) carried no usage counters (G2 will fail)`);
  }

  return {
    id: sessionId,
    agent,
    question,
    response: extractResponseFromOutput(stdout),
    tokens: {
      input: Number(usage.input_tokens ?? 0),
      output: Number(usage.output_tokens ?? 0),
      total: Number(usage.total_tokens ?? 0),
    },
    perCallUsage,
    toolsUsed,
    subagent,
    outcome: typeof exportData.outcome === 'string' ? exportData.outcome : undefined,
    stopReason: (exportData.stop_reason as string | null | undefined) ?? null,
    timestamp: startedAt ?? new Date().toISOString(),
    durationMs,
    executionMetadata: {
      sessionId,
      vibeVersion,
      model: activeModel,
      modelConfig: routedModelConfig,
      outcome: exportData.outcome,
      stopReason: exportData.stop_reason,
      exitCode: exportData.exit_code,
      costUsd: exportData.cost_usd,
      steps: exportData.steps,
      exportData,
      metaData,
    },
  };
}

function cleanupOutputDir(outputDir: string): void {
  try { if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true }); } catch { /* best effort */ }
}

/**
 * Validate G1 (Authentic Vibe) against REAL evidence:
 * a real session id, the REAL vibe version from the export, the REAL model
 * from the export, tools extracted from the actual execution, and a non-empty
 * response. No renaming, no defaults.
 */
export function validateG1(execution: VibeExecution): boolean {
  const exportData = (execution.executionMetadata?.exportData ?? null) as Record<string, unknown> | null;
  const checks = [
    Boolean(execution.id?.trim()),
    // Version is the one the CLI reported in export.json for THIS run.
    Boolean(execution.agent.version?.trim()) && (!exportData || exportData.vibe_version === execution.agent.version),
    Boolean(execution.agent.model?.trim()) && (!exportData || (exportData.config as Record<string, unknown> | undefined)?.active_model === execution.agent.model),
    // Tools were extracted from the real execution (journal tool_call parts).
    Array.isArray(execution.toolsUsed) && execution.toolsUsed.length > 0 && execution.toolsUsed.every(tool => typeof tool === 'string' && tool.trim() !== ''),
    Boolean(execution.response?.trim()),
    Boolean(exportData && typeof exportData.session_id === 'string'),
  ];
  return checks.every(Boolean);
}

/**
 * Validate G2 (Total instrumentation) against REAL per-call telemetry:
 * export-level counters positive AND every recorded LLM call of the session
 * carries usage counters (usage_missing=false for all calls). Calls without
 * counters make G2 FAIL — positive totals alone are NOT sufficient evidence.
 */
export function validateG2(execution: VibeExecution): boolean {
  const exportData = (execution.executionMetadata?.exportData ?? null) as Record<string, unknown> | null;
  const exportUsage = (exportData?.usage ?? null) as Record<string, unknown> | null;
  const checks = [
    execution.tokens.input > 0,
    execution.tokens.output > 0,
    execution.tokens.total > 0,
    !!exportUsage && Number(exportUsage.input_tokens ?? 0) > 0 && Number(exportUsage.output_tokens ?? 0) > 0,
    // Per-call proof on THIS sentinel run:
    execution.perCallUsage.length > 0,
    execution.perCallUsage.every(call => !call.usageMissing && call.inputTokens !== null && call.outputTokens !== null),
  ];
  return checks.every(Boolean);
}
