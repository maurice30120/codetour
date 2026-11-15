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
import { sanitizeArtifacts, sanitizeEvidence } from './evidence';
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
  maxTokens: 50000,
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
  const mergedConfig = validateVibeConfig(config);
  if (!question.trim()) throw new RangeError('question must not be empty');
  const workDir = resolveWorkDir(mergedConfig);
  const outputDir = mergedConfig.outputDir ? path.resolve(mergedConfig.outputDir) : fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-native-'));
  if (mergedConfig.outputDir) {
    fs.mkdirSync(path.dirname(outputDir), { recursive: true });
    fs.mkdirSync(outputDir, { mode: 0o700 });
  }
  const executionId = crypto.randomUUID();
  const prompt = `Use the native agents.spawn tool with these exact arguments: ${JSON.stringify({ name: 'native-research', config_name: 'explore', message: question })}. Wait for the child's result and return it. Delegate the research to that configured child.`;
  const args = [
    '-p', prompt, '--output', 'json', '--max-turns', String(mergedConfig.maxTurns),
    '--max-tokens', String(mergedConfig.maxTokens), '--time-limit', String(mergedConfig.timeoutMs! / 1000),
    '--output-dir', outputDir, '--auto-approve', '--trust',
  ];
  if (mergedConfig.model) args.push('--model', mergedConfig.model);
  const persist = (name: string, value: string): void => fs.writeFileSync(path.join(outputDir, name), String(sanitizeEvidence(value)), { mode: 0o600 });
  persist('invocation.json', JSON.stringify({ command: mergedConfig.vibeCommand, args, workDir, question, executionId }, null, 2));
  const availability = detectVibeAvailability(mergedConfig);
  persist('availability.json', JSON.stringify(availability, null, 2));
  if (!availability.available) {
    throw new VibeUnavailableError(`Vibe CLI is not available: ${availability.error}. Evidence: ${outputDir}`);
  }

  return new Promise<VibeExecution>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const spawnStarted = Date.now();

    const vibeProcess = spawn(mergedConfig.vibeCommand!, args, {
      cwd: workDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: mergedConfig.timeoutMs! + 10000,
      killSignal: 'SIGKILL',
    });

    vibeProcess.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    vibeProcess.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    let spawnError: Error | undefined;
    vibeProcess.on('error', (error) => { spawnError = error; });

    vibeProcess.on('close', (code, signal) => {
      try {
        persist('stdout.json', stdout);
        persist('stderr.txt', stderr);
        persist('process.json', JSON.stringify({ code, signal, error: spawnError?.message }, null, 2));
        sanitizeArtifacts(outputDir);
        if (spawnError) throw spawnError;
        const exportPath = path.join(outputDir, 'export.json');
        if (!fs.existsSync(exportPath)) {
          const reason = signal
            ? `terminated by signal ${signal}${code === null ? ' (likely the configured timeout was reached)' : ''}`
            : `exit code ${code}`;
          throw new Error(`Vibe invocation produced no export.json (${reason})`);
        }
        const exportData = parseJsonFile(exportPath) as Record<string, unknown>;
        if (exportData.error) {
          throw new Error(`Vibe invocation reported an error: ${JSON.stringify(exportData.error)}`);
        }
        const metaData = parseJsonFile(path.join(outputDir, 'session', 'meta.json')) as Record<string, unknown>;
        const journalRecords = readJournalRecords(outputDir);

        const execution = buildExecution({ stdout: String(sanitizeEvidence(stdout)), exportData, metaData, journalRecords, question, executionId, spawnElapsedMs: Date.now() - spawnStarted });
        execution.executionMetadata.evidenceDir = outputDir;
        execution.executionMetadata.command = mergedConfig.vibeCommand;
        execution.executionMetadata.args = args;
        execution.executionMetadata.processExitCode = code;
        execution.executionMetadata.processSignal = signal;
        persist('execution.json', JSON.stringify(execution, null, 2));
        resolve(execution);
      } catch (error) {
        sanitizeArtifacts(outputDir);
        const failure = new Error(String(sanitizeEvidence(`${error instanceof Error ? error.message : String(error)}. Evidence: ${outputDir}`)));
        persist('failure.json', JSON.stringify({ error: failure.message }, null, 2));
        reject(failure);
      }
    });
  });
}

export function validateVibeConfig(config: Partial<VibeConnectorConfig> = {}): VibeConnectorConfig {
  const merged = { ...DEFAULT_CONFIG, ...config };
  for (const key of ['maxTurns', 'maxTokens', 'timeoutMs'] as const) {
    if (typeof merged[key] !== 'number' || !Number.isSafeInteger(merged[key]) || merged[key]! <= 0) {
      throw new RangeError(`${key} must be a positive safe integer`);
    }
  }
  if (!merged.vibeCommand?.trim()) throw new RangeError('vibeCommand must not be empty');
  return merged;
}

function parseJsonFile(filePath: string): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>; }
  catch { return {}; }
}

export interface JournalRecord { type?: string; payload?: Record<string, unknown>; sessionId?: string; }

function counter(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Read every recorded journal line of the session (REAL per-call telemetry). */
export function readJournalRecords(outputDir: string): JournalRecord[] {
  const baseDir = fs.realpathSync(outputDir);
  const exportData = parseJsonFile(path.join(outputDir, 'export.json'));
  const children = Array.isArray(exportData.subagents) ? exportData.subagents as Record<string, unknown>[] : [];
  const sessions = [{ session_id: exportData.session_id, journal_dir: exportData.journal_dir ?? 'session' }, ...children];
  const records: JournalRecord[] = [];
  for (const session of sessions) {
    const sessionId = typeof session.session_id === 'string' ? session.session_id : undefined;
    const invalid = (): void => { records.push({ type: 'journal_invalid', sessionId }); };
    if (typeof session.journal_dir !== 'string') { invalid(); continue; }
    const sessionDir = path.resolve(baseDir, session.journal_dir);
    const relative = path.relative(baseDir, sessionDir);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) { invalid(); continue; }
    const journalDir = path.join(sessionDir, 'journal');
    if (!fs.existsSync(journalDir) || fs.realpathSync(journalDir) !== journalDir) { invalid(); continue; }
    const files = fs.readdirSync(journalDir).filter(name => name.endsWith('.jsonl')).sort();
    if (!files.length) invalid();
    for (const file of files) {
      const journalPath = path.join(journalDir, file);
      if (!fs.lstatSync(journalPath).isFile()) { invalid(); continue; }
      const content = fs.readFileSync(journalPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const record = JSON.parse(trimmed);
          if (!record || typeof record !== 'object' || Array.isArray(record)) { invalid(); continue; }
          records.push({ ...record, sessionId });
        } catch { invalid(); }
      }
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
    if (result.type !== 'completion_succeeded' && result.type !== 'completion_failed') continue;
    const inner = (result.result ?? {}) as Record<string, unknown>;
    const usage = inner.usage as Record<string, unknown> | undefined;
    const inputTokens = counter(usage?.input_tokens);
    const outputTokens = counter(usage?.output_tokens);
    const cachedInputTokens = counter(usage?.cached_input_tokens);
    const totalTokens = counter(usage?.total_tokens);
    const usageMissing = inputTokens === null || outputTokens === null || cachedInputTokens === null || totalTokens === null ||
      totalTokens !== inputTokens + outputTokens || cachedInputTokens > inputTokens;
    if (usageMissing) completionsMissingUsage++;
    perCallUsage.push({
      callIndex: perCallUsage.length,
      sessionId: record.sessionId,
      finishReason: inner.finish_reason as string | undefined,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      totalTokens,
      usageMissing,
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
  const sessions = [exportData, ...(Array.isArray(exportData.subagents) ? exportData.subagents as Record<string, unknown>[] : [])];
  const total = (key: string): number => sessions.reduce((sum, session) => {
    const value = counter((session.usage as Record<string, unknown> | undefined)?.[key]);
    if (value === null) throw new Error(`Missing or invalid ${key} for session ${session.session_id}`);
    return sum + value;
  }, 0);
  const exportSessionId = typeof exportData.session_id === 'string' ? exportData.session_id : undefined;
  const metaSessionId = typeof metaData.session_id === 'string' ? metaData.session_id : undefined;
  const sessionId = exportSessionId ?? metaSessionId ?? executionId;
  const vibeVersion = typeof exportData.vibe_version === 'string' && exportData.vibe_version.trim() ? exportData.vibe_version : undefined;
  if (!vibeVersion) throw new Error('export.json carries no vibe_version: cannot establish the execution identity');

  const config = (exportData.config ?? {}) as Record<string, unknown>;
  const routedModelConfig = (config.routed_model_config ?? config.model_config ?? {}) as Record<string, unknown>;
  const activeModel = typeof config.active_model === 'string' && config.active_model.trim() ? config.active_model : undefined;
  if (!activeModel) throw new Error('export.json carries no config.active_model: cannot establish the executed model');

  const { perCallUsage, toolsUsed, completionsMissingUsage } = extractPerCallUsageAndTools(journalRecords);
  const researchChild = observedResearchChild(exportData, journalRecords, question);
  const subagent = researchChild ? 'explore' : undefined;

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
    name: researchChild ? String(researchChild.agent_name) : (typeof config.default_agent === 'string' && config.default_agent.trim() ? config.default_agent : 'direct'),
    version: vibeVersion,
    model: researchChild ? String(researchChild.model) : activeModel,
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
      input: total('input_tokens'),
      output: total('output_tokens'),
      total: total('total_tokens'),
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
      journalRecords,
    },
  };
}

function spawnArgumentsMatch(args: unknown, child: Record<string, unknown>, question: string): boolean {
  if (!args || typeof args !== 'object') return false;
  const argumentsRecord = args as Record<string, unknown>;
  return argumentsRecord.config_name === 'explore' && argumentsRecord.name === child.agent_name && argumentsRecord.message === question && !('instructions' in argumentsRecord);
}

function resultParts(records: JournalRecord[], sessionId: string | undefined): Record<string, unknown>[] {
  return records.flatMap(record => {
    if (record.sessionId && record.sessionId !== sessionId) return [];
    const result = record.payload?.result as Record<string, unknown> | undefined;
    if (record.type !== 'action_result' || result?.type !== 'completion_succeeded') return [];
    const parts = (result.result as Record<string, unknown>)?.parts;
    return Array.isArray(parts) ? parts as Record<string, unknown>[] : [];
  });
}

function observedResearchChild(exportData: Record<string, unknown>, records: JournalRecord[], question: string): Record<string, unknown> | undefined {
  const children = Array.isArray(exportData.subagents) ? exportData.subagents as Record<string, unknown>[] : [];
  return children.find(child => {
    if (child.agent_type !== 'explore' || child.parent_session_id !== exportData.session_id ||
      child.root_session_id !== exportData.session_id || typeof child.agent_name !== 'string' ||
      typeof child.model !== 'string' || !child.model.trim() || !child.journal_dir) return false;
    const childCalls = records.filter(record => record.sessionId === child.session_id);
    if (!extractPerCallUsageAndTools(childCalls).perCallUsage.length || !extractPerCallUsageAndTools(childCalls).toolsUsed.length) return false;
    const parts = resultParts(records, typeof exportData.session_id === 'string' ? exportData.session_id : undefined);
    if (parts.some(part => {
      if (part.type !== 'tool_call' || part.name !== 'agents.spawn' || !part.id || part.id !== child.spawn_call_id) return false;
      try {
        return spawnArgumentsMatch(JSON.parse(String(part.arguments_json)), child, question);
      } catch { return false; }
    })) return true;
    // Spawn executed through a program call (e.g. run_typescript): the native
    // runtime journal records the spawn as an action intent, correlated with
    // the program's tool_call part through the parent call id.
    return records.some(record => {
      if (record.sessionId && record.sessionId !== exportData.session_id) return false;
      if (record.type !== 'action_intent') return false;
      const request = record.payload?.request as Record<string, unknown> | undefined;
      if (request?.type !== 'runtime_builtin_tool_call') return false;
      const call = request.call as Record<string, unknown> | undefined;
      if (call?.type !== 'runtime_builtin' || call.name !== 'agents.spawn' || request.call_id !== child.spawn_call_id) return false;
      const args = typeof call.arguments === 'string' ? safeParse(call.arguments) : call.arguments;
      if (!spawnArgumentsMatch(args, child, question)) return false;
      const parentCallId = request.parent_call_id;
      if (typeof parentCallId !== 'string' || !parentCallId) return false;
      return parts.some(part => part.type === 'tool_call' && part.id === parentCallId);
    });
  });
}

function safeParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return undefined; }
}

/**
 * Validate G1 (Authentic Vibe) against REAL evidence:
 * a real session id, the REAL vibe version from the export, the REAL model
 * from the export, tools extracted from the actual execution, and a non-empty
 * response. No renaming, no defaults.
 */
export function validateG1(execution: VibeExecution): boolean {
  const exportData = (execution.executionMetadata?.exportData ?? null) as Record<string, unknown> | null;
  const child = exportData && observedResearchChild(exportData, execution.executionMetadata.journalRecords as JournalRecord[] ?? [], execution.question);
  const checks = [
    execution.agent.agentType === 'subagent' && execution.subagent === 'explore',
    !!child && child.agent_name === execution.agent.name,
    Boolean(execution.id?.trim()),
    // Version is the one the CLI reported in export.json for THIS run.
    Boolean(execution.agent.version?.trim()) && (!exportData || exportData.vibe_version === execution.agent.version),
    Boolean(execution.agent.model?.trim()) && child?.model === execution.agent.model,
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
  if (!exportData || execution.tokens.total <= 0) return false;
  const records = execution.executionMetadata.journalRecords as JournalRecord[] ?? [];
  if (records.some(record => record.type === 'journal_invalid')) return false;
  const children = Array.isArray(exportData.subagents) ? exportData.subagents as Record<string, unknown>[] : [];
  const sessions = [exportData, ...children];
  const ids = sessions.map(session => session.session_id);
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) return false;
  if (records.some(record => record.sessionId && !ids.includes(record.sessionId))) return false;
  const totals = { input: 0, output: 0, total: 0 };
  for (const session of sessions) {
    const calls = extractPerCallUsageAndTools(records.filter(record => (record.sessionId ?? exportData.session_id) === session.session_id)).perCallUsage;
    const usage = session.usage as Record<string, unknown> | undefined;
    if (!calls.length || calls.some(call => call.usageMissing)) return false;
    const pairs = [
      ['input_tokens', 'inputTokens'], ['output_tokens', 'outputTokens'],
      ['cached_input_tokens', 'cachedInputTokens'], ['total_tokens', 'totalTokens'],
    ] as const;
    for (const [key, field] of pairs) {
      const expected = counter(usage?.[key]);
      if (expected === null || calls.some(call => counter(call[field]) === null) ||
        calls.reduce((sum, call) => sum + call[field]!, 0) !== expected) return false;
    }
    if (usage!.total_tokens !== Number(usage!.input_tokens) + Number(usage!.output_tokens) ||
      Number(usage!.cached_input_tokens) > Number(usage!.input_tokens)) return false;
    if (session.steps !== undefined && session.steps !== null && session.steps !== calls.length) return false;
    totals.input += Number(usage!.input_tokens);
    totals.output += Number(usage!.output_tokens);
    totals.total += Number(usage!.total_tokens);
  }
  return execution.tokens.input === totals.input && execution.tokens.output === totals.output && execution.tokens.total === totals.total;
}
