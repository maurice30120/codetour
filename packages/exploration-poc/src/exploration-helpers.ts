import { createHash } from 'node:crypto';
import { looksLikeEvidence } from './memory-output.ts';
import type { CitationValidation } from './citation-validator.ts';

export function derivedCandidateName(question: string, code: string): string {
  const words = (question.toLowerCase().match(/[a-z]+/g) ?? [])
    .filter(word => word.length > 2 && !new Set(['what', 'where', 'which', 'how', 'the', 'are', 'and', 'for', 'does', 'from', 'with', 'this', 'that']).has(word))
    .slice(0, 5).map(word => word.slice(0, 12));
  const subject = (words.length ? words : ['procedure']).map(word => word[0].toUpperCase() + word.slice(1)).join('');
  const suffix = createHash('sha256').update(code).digest('hex').slice(0, 8);
  return `inspectRepo${subject}Code${suffix}`;
}


export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type PlanRecord = { status: 'recorded' | 'invalid' | 'missing'; runId: string; initial?: unknown; error?: string };
export type Model = {
  complete(messages: any[], options?: { signal: AbortSignal; maxOutputTokens: number; codeMode: boolean; memory: boolean; knowledge?: boolean; toolsEnabled?: boolean }): Promise<{ plan?: unknown; toolCalls?: ToolCall[]; result?: unknown; usage?: { inputTokens: number; outputTokens: number } }>;
  /** Actual provider parameters of the last request (real provenance, no defaults). */
  snapshot?(): { model?: string; temperature?: number; maxOutputTokens?: number };
};
export type Budget = { iterations?: number; calls?: number; tokens?: number; durationMs?: number };

/** Per-call usage/telemetry trace: real timestamps, real durations, provider usage. */
export interface CallTraceItem {
  seq: number;
  runId: string;
  type: 'model' | 'tool' | 'memory_run' | 'memory_list' | 'knowledge_read' | 'knowledge_available' | 'function_try' | 'decomposition_plan' | 'decomposition_decision' | 'run_end';
  name: string;
  /** Provider tool-call id (observed calls), absent on model/plan entries. */
  callId?: string;
  /** Declared question id carried by the call (question_id argument). */
  questionId?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /** True when the provider response carried no usage fields — never fabricated after the fact. */
  usageMissing: boolean;
  outcome?: string;
  error?: string;
  finishReason?: string | null;
  contentShape?: string | string[];
  reasoningTokens?: number;
  maxOutputTokens?: number;
  execution?: unknown;
  parameters?: Record<string, unknown>;
  result?: unknown;
  /** Per-call reuse outcome of a stored procedure (memory_run only). */
  memory?: { id: string; stale: boolean; proofValid: boolean | null };
  /** Per-call Knowledge outcome (spec #219): availability vs read vs refusal. */
  knowledge?: { name: string; status: 'available' | 'read' | 'refused'; reason?: string };
}


/**
 * Citation outcome summary shared by the trial-time trace and the
 * consolidation replay trace (single source for the duplicated mapping).
 */
export function citationOutcome(citations?: CitationValidation): string {
  if (!citations) return '';
  const summary = citations.status === 'valid' ? `${citations.validCount} valid` : citations.status === 'validation_failed' ? `validation_failed (${citations.validCount}/${citations.references} valid)` : 'none';
  return `; citations=${summary}`;
}


export function summarizeOutcome(output: unknown): string {
  if (output && typeof output === 'object' && 'error' in (output as Record<string, unknown>)) return 'error';
  if (Array.isArray(output)) return `returned=${output.length}`;
  if (output && typeof output === 'object') {
    if ('truncated' in (output as Record<string, unknown>) && (output as Record<string, unknown>).truncated === true) return 'truncated';
    if (looksLikeEvidence(output)) return 'evidence';
    const keys = Object.keys(output as Record<string, unknown>).slice(0, 4);
    return `keys=${keys.join(',')}`;
  }
  return typeof output === 'string' ? `text=${output.length}` : 'ok';
}
