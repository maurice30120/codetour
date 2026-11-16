import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import { workspace } from './workspace.ts';
import { scriptMemory } from './memory.ts';
import type { ConsolidationCandidate, ReconciliationOutcome } from './memory.ts';
import { boundedOutput, looksLikeEvidence, sampleEvidenceRefs } from './memory-output.ts';
import { citationAccess, citationRepairFeedback, validateCitations } from './citation-validator.ts';
import type { CitationValidation } from './citation-validator.ts';
import { DECOMPOSITION_PROMPT, PROMPT_SHA256, PROMPT_VERSION } from './decomposition-prompt.ts';
import { primitiveNames } from './tool-contract.ts';

const evidence = z.object({ file: z.string().min(1), startLine: z.number().int().positive(), endLine: z.number().int().positive() });
const item = z.object({ name: z.string(), evidence: z.array(evidence).min(1) });
const resultSchema = z.object({ objective: z.string(), entryPoints: z.array(item), components: z.array(item), relations: z.array(z.object({ from: z.string(), to: z.string(), evidence: z.array(evidence).min(1) })), uncertainties: z.array(z.string()) });

export { DECOMPOSITION_PROMPT, PROMPT_SHA256, PROMPT_VERSION };

export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type PlanQuestion = { id: string; question: string; reuse?: boolean };
export type PlanVersion = { questions: PlanQuestion[]; reason?: string; error?: string };
export type PlanRecord = { status: 'recorded' | 'invalid' | 'missing'; runId: string; versions: PlanVersion[]; anomalies: string[] };
export type Model = {
  complete(messages: any[], options?: { signal: AbortSignal; maxOutputTokens: number; codeMode: boolean; memory: boolean; queryContract?: boolean }): Promise<{ plan?: unknown; toolCalls?: ToolCall[]; result?: unknown; usage?: { inputTokens: number; outputTokens: number } }>;
  /** Actual provider parameters of the last request (real provenance, no defaults). */
  snapshot?(): { model?: string; temperature?: number; maxOutputTokens?: number };
};
export type Budget = { iterations?: number; calls?: number; tokens?: number; durationMs?: number };
const State = Annotation.Root({ messages: Annotation<any[]>({ reducer: (a, b) => a.concat(b), default: () => [] }), result: Annotation<any>, stopReason: Annotation<string> });

/** Per-call usage/telemetry trace: real timestamps, real durations, provider usage. */
export interface CallTraceItem {
  seq: number;
  runId: string;
  type: 'model' | 'tool' | 'memory_run' | 'memory_list' | 'function_try' | 'decomposition_plan' | 'plan_revised' | 'decomposition_decision' | 'reuse_reminder' | 'run_end';
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
  execution?: unknown;
  parameters?: Record<string, unknown>;
  result?: unknown;
}

interface Attempt {
  id?: string;
  candidate?: { objective: string; description: string; name?: string; returns?: string; code: string; parameters: string[]; paramsSchema?: Array<{ name: string; type: string }>; executionMode?: 'strict' | 'legacy'; revision?: string };
  params?: Record<string, unknown>;
  output: unknown;
  proofValid?: boolean;
  proofSignature?: string[];
}

/**
 * Citation outcome summary shared by the trial-time trace and the
 * consolidation replay trace (single source for the duplicated mapping).
 */
function citationOutcome(citations?: CitationValidation): string {
  if (!citations) return '';
  const summary = citations.status === 'valid' ? `${citations.validCount} valid` : citations.status === 'validation_failed' ? `validation_failed (${citations.validCount}/${citations.references} valid)` : 'none';
  return `; citations=${summary}`;
}

/**
 * An exploration returns validated references, never Tour prose.
 *
 * Deliberate single-function seam (review note — divergent change): explore()
 * absorbs the plan protocol, citation gating, reconciliation and budgets
 * because they all share the same closure state (metrics, the trace recorder,
 * budget clocks, workspace tools and the memory catalogue handle). Extracting
 * a mid-run module would mean threading that state through new seams for no
 * behavioural gain in this diagnostic phase, and the seam under test is the
 * explore() entry point itself (spec #183: use the existing harness seam).
 */
export async function explore({ root, objective, model, budget = {}, codeMode = false, memory }: { root: string; objective: string; model: Model; budget?: Budget; codeMode?: boolean; memory?: { directory: string; validateQuery?: boolean; queryContract?: boolean; compactSearch?: boolean } }) {
  if (memory && !codeMode) throw new Error('Script memory requires Code Mode');
  const limits = { iterations: budget.iterations ?? 8, calls: budget.calls ?? 32, tokens: budget.tokens ?? 32000, durationMs: budget.durationMs ?? 60000 };
  if (Object.values(limits).some(n => !Number.isFinite(n) || n <= 0)) throw new Error('Budgets must be positive');
  const startedMs = Date.now();
  // Correlation backbone (issue #184): one run id links plan versions, declared
  // decisions and observed tool calls; question ids come from the plan, call ids
  // from the provider. Observed calls are recorded by the harness, never deduced
  // from model text.
  const runId = crypto.randomUUID();
  const planVersions: PlanVersion[] = [];
  const planAnomalies = new Set<string>();
  let planStatus: 'recorded' | 'invalid' | 'missing' = 'missing';
  let planPublished = false;
  const knownQuestionIds = new Set<string>();
  // Spec #183 trace vocabulary: declared plan questions already linked to an
  // observed call — one decomposition_decision entry per question.
  const correlatedDecisions = new Set<string>();
  // Ticket #191: reuse=true questions served by memory_run or function_try —
  // the end-of-run reminder targets the complement of this set.
  const servedByCreation = new Set<string>();
  let reuseReminderEmitted = false;
  const metrics = { inputTokens: 0, outputTokens: 0, usageAvailable: true, modelCalls: 0, toolCalls: 0, durationMs: 0, outputBytes: 0, cost: null as number | null, memoryReuses: 0, memoryPurges: 0, memoryQueryRejects: 0, memoryResultsCompacted: 0, memoryResultsRepeated: 0 };
  const callTrace: CallTraceItem[] = [];
  let callSeq = 0;
  let requestedEvidenceRecovery = false;
  let requestedJsonRecovery = false;
  // Ticket #190: on the 2026-11-16 run the model called memory_list six times
  // with returned=0 and revised its plan seven times without ever reaching
  // function_try — it treats an empty catalogue as a dead end instead of a
  // creation trigger. After two empty memory_list results in the same run, the
  // tool result itself carries a visible note inviting function_try for
  // durably reusable questions (once per run, traced, no extra LLM call).
  let emptyMemoryListCount = 0;
  let emptyMemoryListNoteEmitted = false;
  const recordCall = (base: Omit<CallTraceItem, 'seq' | 'startedAt' | 'endedAt' | 'durationMs' | 'startedAt'>, startedAt: Date, endedAt: Date): void => {
    callTrace.push({ ...base, runId, seq: callSeq++, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationMs: endedAt.getTime() - startedAt.getTime() });
  };
  // A published plan becomes an immutable version: valid plans update the known
  // question ids, invalid or missing plans stay visible anomalies — never a
  // presumed success. History is appended, never rewritten.
  const recordPlan = (raw: unknown): void => {
    const validation = validatePlan(raw);
    const now = new Date();
    const type = planPublished ? 'plan_revised' : 'decomposition_plan';
    if (validation.ok) {
      const version: PlanVersion = validation.reason === undefined ? { questions: validation.questions } : { questions: validation.questions, reason: validation.reason };
      planVersions.push(version);
      planStatus = 'recorded';
      for (const question of validation.questions) knownQuestionIds.add(question.id);
      for (const anomaly of validation.anomalies) planAnomalies.add(anomaly);
      recordCall({ type, name: type, inputTokens: null, outputTokens: null, usageMissing: false, result: version }, now, now);
    } else {
      planVersions.push({ questions: [], error: validation.error });
      planStatus = 'invalid';
      recordCall({ type, name: type, inputTokens: null, outputTokens: null, usageMissing: false, error: validation.error }, now, now);
    }
    planPublished = true;
  };
  // Spec #183 trace vocabulary: every run — complete, partial or failed — ends
  // with a run_end entry carrying the stop reason and the final usage.
  const recordRunEnd = (status: 'complete' | 'partial' | 'failed', stopReason: string | null): void => {
    const now = new Date();
    recordCall({
      type: 'run_end', name: 'run_end', inputTokens: metrics.inputTokens, outputTokens: metrics.outputTokens, usageMissing: !metrics.usageAvailable,
      outcome: `status=${status}; stopReason=${stopReason ?? 'none'}`,
      result: { status, stopReason, inputTokens: metrics.inputTokens, outputTokens: metrics.outputTokens, modelCalls: metrics.modelCalls, toolCalls: metrics.toolCalls, durationMs: metrics.durationMs }
    }, now, now);
  };
  try {
  const tools = await workspace(root);
  const library = memory ? await scriptMemory(root, memory.directory) : undefined;
  // Background revision lookup (lazily filled): used for staleness + sourcing.
  let currentRevision: string | undefined;
  const resolveRevision = async (): Promise<string> => {
    if (currentRevision !== undefined) return currentRevision;
    try { currentRevision = String(await tools.git(limits.durationMs)).split('\n')[0].trim() || 'unknown-revision'; }
    catch { currentRevision = 'unknown-revision'; }
    return currentRevision;
  };
  const attempts: Attempt[] = [];
  // Issue #187 (D04) + #188 (D05): per-candidate reconciliation log. Filled
  // during the run for proposals that never reach the deterministic validator,
  // and during consolidation for the ones that do.
  const unreconciled: ReconciliationOutcome[] = [];
  // In-session traces only: the catalogue is mutated once, at the end of the run (correction 3).
  const runtimeFailures: string[] = [];
  const runtimeObservations: Array<{ id: string; params: Record<string, unknown>; ok: boolean }> = [];
  const unusableIds = new Set<string>();
  const previousSearchOutputs = new Map<string, { content: string; toolCallId: string }>();
  const reason = () => Date.now() - startedMs >= limits.durationMs ? 'duration' : metrics.inputTokens + metrics.outputTokens >= limits.tokens ? 'tokens' : metrics.modelCalls + metrics.toolCalls >= limits.calls ? 'calls' : metrics.modelCalls >= limits.iterations ? 'iterations' : undefined;
  const graph = new StateGraph(State).addNode('model', async state => {
    const stopped = reason();
    if (stopped) return { stopReason: stopped };
    const controller = new AbortController();
    const remainingMs = Math.max(1, limits.durationMs - (Date.now() - startedMs));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: Awaited<ReturnType<Model['complete']>>;
    const modelCallStarted = new Date();
    try {
      metrics.modelCalls++;
      response = await Promise.race([
        model.complete(state.messages, { signal: controller.signal, maxOutputTokens: Math.max(1, Math.min(4096, limits.tokens - metrics.inputTokens - metrics.outputTokens)), codeMode, memory: !!library, queryContract: memory?.queryContract }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('budget-duration')); }, remainingMs); })
      ]);
    } catch (error) {
      const usage: { inputTokens: number; outputTokens: number } | undefined = (error as { usage?: { inputTokens: number; outputTokens: number } })?.usage;
      recordCall({ type: 'model', name: 'model', inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, usageMissing: !usage, error: controller.signal.aborted ? 'budget-duration' : String(error) }, modelCallStarted, new Date());
      metrics.inputTokens += usage?.inputTokens ?? 0;
      metrics.outputTokens += usage?.outputTokens ?? 0;
      if (!usage) metrics.usageAvailable = false;
      if (controller.signal.aborted) return { stopReason: 'duration' };
      // A non-JSON final answer (often an empty reply after plan extraction)
      // gets one visible recovery inside the original budget, mirroring the
      // citation repair path. A repeated failure stays fatal: no hidden retry.
      if ((error as { name?: string })?.name === 'FinalAnswerNotJson' && !requestedJsonRecovery && !reason()) {
        requestedJsonRecovery = true;
        // The model must see what it actually wrote, not the error text: the
        // observed failure mode (2026-11-16 run, #166/#167) is a reply made of
        // a plan block with no JSON after it — shown its own output, the model
        // can correct the formatting instead of resuming exploration. The plan
        // published in the failed attempt is recorded too, never lost.
        const rawOutput = String((error as { rawContent?: string }).rawContent ?? '');
        const failedPlan = (error as { plan?: unknown }).plan;
        if (failedPlan !== undefined) recordPlan(failedPlan);
        return { messages: [
          { role: 'assistant', content: rawOutput || String((error as Error).message ?? '') },
          { role: 'user', content: 'Your final answer was not valid JSON. Your plan block, if any, was already extracted and recorded. Reply again with the final result as a single JSON object matching the required schema, outside any fenced code block, with no prose outside the JSON.' },
        ] };
      }
      throw error;
    } finally { if (timer) clearTimeout(timer); }
    const modelCallEnded = new Date();
    const inputTokens = response.usage?.inputTokens ?? null;
    const outputTokens = response.usage?.outputTokens ?? null;
    recordCall({ type: 'model', name: 'model', inputTokens, outputTokens, usageMissing: !response.usage }, modelCallStarted, modelCallEnded);
    // The plan travels in the normal generation (no dedicated LLM call) and is
    // recorded before this response's tool calls can be observed.
    if (response.plan !== undefined) recordPlan(response.plan);
    metrics.inputTokens += inputTokens ?? 0;
    metrics.outputTokens += outputTokens ?? 0;
    if (!response.usage) metrics.usageAvailable = false;
    if (response.result !== undefined) {
      const result = resultSchema.parse(response.result);
      const hasEvidence = [...result.entryPoints, ...result.components, ...result.relations].some(item => item.evidence.length > 0);
      if (!hasEvidence) {
        // One recovery inside the original budget; no extra run or hidden retry.
        if (metrics.toolCalls === 0 && !requestedEvidenceRecovery && !reason()) {
          requestedEvidenceRecovery = true;
          return { messages: [
            { role: 'assistant', content: JSON.stringify(result) },
            { role: 'user', content: 'No source evidence was returned. Use the repository tools to inspect the workspace and gather evidence before answering. If evidence remains unavailable, report the unresolved gaps explicitly.' }
          ] };
        }
        return { result, stopReason: reason() ?? 'evidence_missing' };
      }
      try {
        for (const ref of [...result.entryPoints, ...result.components, ...result.relations].flatMap(item => item.evidence)) {
          const lines = await tools.read(ref.file, ref.startLine, ref.endLine, true);
          if (lines.length !== ref.endLine - ref.startLine + 1) throw new Error(`Evidence points outside a file: ${ref.file}:${ref.startLine}-${ref.endLine}. This range contains ${lines.length} existing lines${lines.length ? ` (${lines[0].line}-${lines[lines.length - 1].line})` : ''}.`);
        }
      } catch (error) {
        if (reason()) throw error;
        return { messages: [
          { role: 'assistant', content: JSON.stringify(result) },
          { role: 'user', content: `Source citation validation failed: ${String(error)}. Inspect the source with repository tools and correct the references. Do not invent line numbers. The original run budget still applies.` },
        ] };
      }
      // Ticket #191: before accepting the final answer, every reuse=true
      // question of the current plan that neither memory_run nor function_try
      // served (and that the result does not explicitly justify by id in its
      // uncertainties) earns ONE visible reminder — same philosophy as the
      // citation and JSON recoveries: once per run, inside the original
      // budget, never a hidden retry loop. A second shortfall is recorded as
      // an anomaly, never re-reminded.
      const unservedReuse = [...(planVersions.at(-1)?.questions ?? [])].filter(question =>
        question.reuse === true
        && !servedByCreation.has(question.id)
        && !result.uncertainties.some(uncertainty => uncertainty.includes(question.id))
      );
      if (unservedReuse.length > 0) {
        const ids = unservedReuse.map(question => question.id).join(', ');
        if (!reuseReminderEmitted && !reason()) {
          reuseReminderEmitted = true;
          const now = new Date();
          recordCall({ type: 'reuse_reminder', name: 'reuse_reminder', inputTokens: null, outputTokens: null, usageMissing: false, result: { unservedQuestionIds: unservedReuse.map(question => question.id) } }, now, now);
          return { messages: [
            { role: 'assistant', content: JSON.stringify(result) },
            { role: 'user', content: `Reminder: plan question(s) marked reuse=true were never served by memory_run or function_try: ${ids}. Either propose the missing durable capability now with function_try(source, params), or justify in the uncertainties of your final result why no creation applies (mention the question id). The original run budget still applies; this reminder is sent once.` },
          ] };
        }
        if (reuseReminderEmitted) planAnomalies.add(`reuse=true questions still unserved after the end-of-run reminder: ${ids}`);
      }
      return { result, stopReason: Date.now() - startedMs >= limits.durationMs ? 'duration' : metrics.inputTokens + metrics.outputTokens > limits.tokens ? 'tokens' : undefined };
    }
    if (!response.toolCalls?.length) throw new Error('Model returned neither tools nor result');
    const calls = response.toolCalls.slice(0, Math.max(0, Math.min(8, limits.calls - metrics.modelCalls - metrics.toolCalls)));
    const outputs: any[] = [{ role: 'assistant', tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) }];
    for (const originalCall of calls) {
      // question_id is harness correlation metadata, not a tool argument: it is
      // traced on the call and stripped before dispatch. An id no plan ever
      // declared is an explicit anomaly, not a silent success.
      const questionId = typeof originalCall.arguments.question_id === 'string' ? originalCall.arguments.question_id : undefined;
      // Issue #184: the prompt requires a question_id on every call — a call
      // carrying none is a visible anomaly, never a silent acceptance.
      if (questionId === undefined) planAnomalies.add(`missing question id on '${originalCall.name}' call`);
      else if (!knownQuestionIds.has(questionId)) planAnomalies.add(`unknown question id '${questionId}'`);
      // Spec #183 trace vocabulary: a declared decision (plan question) is
      // linked to the first observed call that serves it — declared
      // intentions stay traceable to real observed calls, never inferred from
      // model prose.
      if (questionId !== undefined && knownQuestionIds.has(questionId) && !correlatedDecisions.has(questionId)) {
        correlatedDecisions.add(questionId);
        const declared = [...planVersions].reverse().flatMap(version => version.questions).find(question => question.id === questionId);
        const decisionAt = new Date();
        recordCall({ type: 'decomposition_decision', name: 'decomposition_decision', callId: originalCall.id, questionId, inputTokens: null, outputTokens: null, usageMissing: false, result: { question: declared?.question, reuse: declared?.reuse ?? false, servedBy: originalCall.name } }, decisionAt, decisionAt);
      }
      const call = { ...originalCall, arguments: { ...originalCall.arguments } };
      delete call.arguments.question_id;
      if (Date.now() - startedMs >= limits.durationMs || metrics.inputTokens + metrics.outputTokens >= limits.tokens) break;
      metrics.toolCalls++;
      const toolStarted = new Date();
      let output: unknown;
      let attempt: Attempt | undefined;
      let scriptCall: { type: 'memory_run' | 'function_try'; name: string } | undefined;
      try {
        if (primitiveNames.has(call.name)) {
          const { runScript } = await import('../../exploration-sandbox/index.js');
          const args = call.arguments;
          const expressions: Record<string, string> = {
            listFiles: 'listFiles(params.maxFiles)', searchText: 'searchText(params.query)', searchIdentifiers: 'searchIdentifiers(params.identifier)',
            readLines: 'readLines(params.file, params.startLine, params.endLine)', readAround: 'readAround(params.file, params.line, params.contextLines)',
            listSymbols: 'listSymbols()', findDefinitions: 'findDefinitions(params.symbol)', findReferences: 'findReferences(params.symbol)',
            getImports: 'getImports(params.file)', getGitDiff: 'getGitDiff(params.revision1, params.revision2)'
          };
          const defaults = { listFiles: { maxFiles: 500 }, readAround: { contextLines: 5 }, getGitDiff: { revision2: 'HEAD' } };
          const params = { ...(defaults[call.name as keyof typeof defaults] ?? {}), ...args };
          const execution = await runScript({ workspace: root, code: expressions[call.name], params, strict: true, includeTrace: true, timeoutMs: Math.min(5000, Math.max(1, limits.durationMs - (Date.now() - startedMs))) });
          let value = execution.value;
          // Direct model-facing reads show absolute line numbers. The sandbox
          // primitive contract used by procedures keeps its original string[].
          if ((call.name === 'readLines' || call.name === 'readAround') && value && typeof value === 'object') {
            const read = value as { file: string; start: number; lines: string[] };
            value = { ...read, lines: read.lines.map((text, index) => ({ line: read.start + index, text })) };
          }
          output = boundedOutput(value, { revision: await resolveRevision(), sourceTruncated: execution.trace.truncated, primitiveDerived: true });
        }
        else if (call.name === 'list') output = await tools.list();
        else if (call.name === 'search' && typeof call.arguments.query === 'string') output = await tools.search(call.arguments.query);
        else if (call.name === 'read' && typeof call.arguments.file === 'string') {
          const start = Number(call.arguments.startLine ?? 1);
          output = await tools.read(call.arguments.file, start, Number(call.arguments.endLine ?? start + 99));
        }
        else if (call.name === 'git') output = await tools.git(limits.durationMs - (Date.now() - startedMs));
        else if (library && call.name === 'memory_list') {
          const listed = library.memory_list(typeof call.arguments.query === 'string' ? call.arguments.query : undefined);
          if (Array.isArray(listed) && listed.length === 0) emptyMemoryListCount++;
          if (Array.isArray(listed) && listed.length === 0 && emptyMemoryListCount >= 2 && !emptyMemoryListNoteEmitted) {
            emptyMemoryListNoteEmitted = true;
            output = { results: [], note: 'The catalogue is empty again. Revising the plan in a loop will not fill it: if the question you are serving is durably reusable and no permanent primitive covers it, build the missing capability once with function_try(source, params) instead of revising the plan again; otherwise state why not in the final result.' };
          } else {
            output = listed;
          }
        }
        else if (library && call.name === 'memory_unusable' && typeof call.arguments.id === 'string') {
          const id = call.arguments.id;
          // Issue #187: a proposed candidate may also be abandoned by name —
          // a candidate marked unusable never reaches the catalogue.
          if (!attempts.some(a => a.id === id || a.candidate?.name === id)) throw new Error('Script must have been executed in this run');
          unusableIds.add(id);
          output = { recordedAfterValidation: true };
        }
        else if (codeMode && ((call.name === 'code' && typeof call.arguments.code === 'string') || (call.name === 'function_try' && typeof call.arguments.source === 'string') || (library && call.name === 'memory_run' && typeof call.arguments.id === 'string'))) {
          const stored = call.name === 'memory_run' ? library?.get(String(call.arguments.id)) : undefined;
          if (call.name === 'memory_run' && !stored) throw new Error('Unknown script');
          const code = stored?.code ?? String(call.arguments.source ?? call.arguments.code);
          const params = call.arguments.params ?? {};
          if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Invalid parameters');
          const remaining = limits.durationMs - (Date.now() - startedMs);
          if (remaining <= 0) return { messages: outputs, stopReason: 'duration' };
          const { runScript } = await import('../../exploration-sandbox/index.js');
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), remaining);
          scriptCall = { type: stored ? 'memory_run' : 'function_try', name: stored ? stored.id : 'function_try' };
          // Ticket #191: any memory_run/function_try call — accepted or failed —
          // counts as having served its declared question; the trace carries the
          // outcome, the reminder only targets questions never attempted.
          if (questionId !== undefined) servedByCreation.add(questionId);
          const runStarted = new Date();
          try {
            let raw: unknown;
            if (stored) {
              metrics.memoryReuses++;
              // Issue #174 complement (B-verification): stored revision + proof validity
              // checked against the fixture — uncertain/obsolete proofs are signalled
              // explicitly, never returned silently as fresh.
              const revision = await resolveRevision();
              if (stored.revision && revision !== 'unknown-revision' && !revision.startsWith(stored.revision.slice(0, 12))) {
                output = { staleness: { signal: 'stored-revision-differs', storedRevision: stored.revision, currentRevision: revision, note: `Proofs were consolidated at revision ${stored.revision}. Re-verify before relying on them; prefer re-exploring with the permanent primitives if the references below look obsolete.` } };
              }
            }
            const strict = call.name === 'function_try' || stored?.executionMode === 'strict';
            const execution = await runScript({ workspace: root, code, params, scripts: strict ? undefined : library?.sources(), strict, includeTrace: true, timeoutMs: Math.min(5000, remaining), signal: controller.signal });
            raw = execution.value;
            const runEnded = new Date();
            // Compact, structured, bounded, sourced output for memory_run AND function_try.
            const bounded = boundedOutput(raw, { revision: await resolveRevision(), maxItems: stored?.limits?.maxItems, maxBytes: stored?.limits?.maxBytes, sourceTruncated: execution.trace.truncated, primitiveDerived: execution.trace.executedCalls.length > 0 });
            // Issue #185 (D02): every mandatory reference a strict trial emits is
            // exhaustively validated without any LLM — no sample, no judge. A
            // citation-invalid trial returns short structured repair feedback
            // instead of its result, is never proposed for consolidation, and
            // leaves its code and diagnostics in the trace only.
            const citations = call.name === 'function_try' ? await validateCitations(raw, { access: citationAccess(tools), revision: await resolveRevision() }) : undefined;
            const citationFailure = citations?.status === 'validation_failed' ? citationRepairFeedback(citations) : undefined;
            recordCall({ type: scriptCall.type, name: scriptCall.name, callId: call.id, questionId, parameters: call.name === 'function_try' ? { remember: call.arguments.remember === true, name: call.arguments.name, question: call.arguments.question, description: call.arguments.description } : undefined, inputTokens: null, outputTokens: null, usageMissing: false, execution: execution.trace, result: citationFailure?.validation, outcome: `returned=${bounded.returned}${bounded.truncated ? '; TRUNCATED, not exhaustive' : ''}${citationOutcome(citations)}` }, runStarted, runEnded);
            output = citationFailure ?? (output && typeof output === 'object' && 'staleness' in (output as Record<string, unknown>) ? { ...(output as Record<string, unknown>), result: bounded } : bounded);
            if (stored && memory?.compactSearch && stored.code === 'search(params.query)' && Array.isArray(raw)) {
              const matches = raw.slice(0, 8).map((match: any) => ({ ...match, text: typeof match.text === 'string' ? match.text.slice(0, 240) : match.text, textTruncated: typeof match.text === 'string' && match.text.length > 240 }));
              const compact = { matches, returned: matches.length, observed: raw.length, truncated: raw.length > matches.length, searchIsBounded: true };
              const key = JSON.stringify([stored.id, params]);
              const serialized = JSON.stringify(compact);
              const previous = previousSearchOutputs.get(key);
              if (previous?.content === serialized) {
                output = { repeated: true, query: (params as Record<string, unknown>).query, previousToolCallId: previous.toolCallId, message: 'The visible results are identical to the previous call; refer to that output.' };
                metrics.memoryResultsRepeated++;
              } else {
                output = compact;
                previousSearchOutputs.set(key, { content: serialized, toolCallId: call.id });
                metrics.memoryResultsCompacted++;
              }
            }
            // The description is kept whole: a deterministic gate at consolidation
            // refuses off-format or oversized descriptions with a precise reason
            // instead of silently truncating them (issue #187).
            const description = typeof call.arguments.description === 'string' ? call.arguments.description.trim() : '';
            const name = typeof call.arguments.name === 'string' ? call.arguments.name.trim().slice(0, 100) : '';
            const returns = typeof call.arguments.returns === 'string' ? call.arguments.returns.trim().slice(0, 300) : undefined;
            // The model only sees the bounded output: when the bounding stage
            // truncated the raw result, references may be hidden from the proposal
            // decision — such an attempt is never offered for consolidation.
            const viewTruncated = Boolean((bounded as { truncated?: boolean } | null)?.truncated);
            let candidate = !citationFailure && library && !stored && call.arguments.remember === true && description && !viewTruncated
              ? { objective: String(call.arguments.question ?? objective).slice(0, 500), description, name: name || undefined, returns: strict ? execution.trace.contract.returns : returns, code, parameters: Object.keys(params).slice(0, 30), paramsSchema: execution.trace.contract?.paramsSchema, executionMode: strict ? 'strict' as const : 'legacy' as const, revision: await resolveRevision() }
              : undefined;
            if (candidate && memory?.queryContract && call.arguments.contract === 'literal_query') {
              const { probeLiteralQuery } = await import('./query-probe.mjs');
              // probeLiteralQuery(code, deadline) — a synthetic fixture proves a
              // declared literal-query contract (two distinguishable matches + absent
              // query). Previously a sources object was passed as the deadline by
              // mistake, turning every probe 'inconclusive'.
              const validation = await probeLiteralQuery(code, startedMs + limits.durationMs);
              if (validation.status !== 'pass') {
                if (stored) runtimeFailures.push(stored.id);
                candidate = undefined;
              }
              output = { result: output, memoryValidation: { status: validation.status, reason: validation.reason ?? 'Two matching queries and an absent query passed.' } };
            }
            if (library && (stored || candidate)) {
              // Proof spot-check: verify a sample of (file,line) references against the
              // actual fixture. Invalid proofs are explicit — contractRespected=false in
              // the consolidation signal — and never silently trusted.
              const refs = sampleEvidenceRefs(raw, 3);
              let proofOk = refs.length > 0;
              const proofSignature: string[] = [];
              for (const ref of refs.slice(0, 3)) {
                try {
                  const lines = await tools.read(ref.file, ref.line, ref.line, true);
                  const valid = Array.isArray(lines) && lines.length === 1 && typeof lines[0]?.text === 'string';
                  proofSignature.push(`${ref.file}:${ref.line}:${valid ? 'ok' : 'empty'}`);
                  if (!valid) proofOk = false;
                } catch { proofSignature.push(`${ref.file}:${ref.line}:unreadable`); proofOk = false; }
              }
              attempt = { id: stored?.id, candidate, params: params as Record<string, unknown>, output: raw, proofValid: refs.length === 0 ? undefined : proofOk, proofSignature };
              runtimeObservations.push({ id: String(stored?.id ?? candidate?.name ?? ''), params: params as Record<string, unknown>, ok: proofOk });
            }
          } catch (error) {
            recordCall({ type: scriptCall?.type ?? 'function_try', name: call.name === 'memory_run' ? String(call.arguments.id ?? call.name) : 'function_try', callId: call.id, questionId, inputTokens: null, outputTokens: null, usageMissing: false, error: String(error) }, runStarted, new Date());
            if (stored) runtimeFailures.push(stored.id);
            // Issue #188 (D05): a proposal (remember=true) whose trial never
            // executed is an explicit reconciliation outcome — proposed but not
            // tried — never a silent gap between the plan and the catalogue.
            if (!stored && call.arguments.remember === true) {
              unreconciled.push({ name: typeof call.arguments.name === 'string' ? call.arguments.name.trim().slice(0, 100) : '', proposed: true, replayed: false, accepted: false, reason: `Trial failed before execution: ${String((error as Error)?.message ?? error).slice(0, 200)}` });
            }
            throw error;
          }
          finally { clearTimeout(timer); }
        }
        else throw new Error('Unknown tool or invalid arguments');
      } catch (error) { output = { error: String((error as Error).message ?? error).slice(0, 500) }; }
      if (!scriptCall) {
        // Plain primitives and memory catalogue calls: real timestamps and durations.
        const toolEnded = new Date();
        recordCall({ type: call.name === 'memory_list' ? 'memory_list' : 'tool', name: call.name, callId: call.id, questionId, parameters: call.arguments, result: output, inputTokens: null, outputTokens: null, usageMissing: false, outcome: summarizeOutcome(output) }, toolStarted, toolEnded);
      }
      const serialized = JSON.stringify(output);
      let content = serialized;
      if (Buffer.byteLength(content) > 12000) {
        let preview = serialized.slice(0, 8000);
        content = JSON.stringify({ truncated: true, preview });
        while (Buffer.byteLength(content) > 12000) {
          preview = preview.slice(0, Math.floor(preview.length * 0.8));
          content = JSON.stringify({ truncated: true, preview });
        }
      }
      else if (attempt) attempts.push(attempt);
      metrics.outputBytes += Buffer.byteLength(content);
      outputs.push({ role: 'tool', tool_call_id: call.id, content });
    }
    return { messages: outputs, stopReason: reason() };
  }).addEdge(START, 'model').addConditionalEdges('model', state => state.result !== undefined || state.stopReason ? END : 'model').compile();
  const memoryInstructions = library ? ` Script memory is enabled. memory_list(query) returns the catalogue WITHOUT function source code: id (canonical camelCase name), objective (canonical question), description (scope), typed params, output contract, limits and uncertainty cases. Available entries: ${JSON.stringify(library.catalog())}. If a listed function can help, call memory_run with its id and suitable params, verify its proofs, and complete only what is missing. Wrapping obligation: the ten permanent primitives (listFiles, searchText, searchIdentifiers, readLines, readAround, listSymbols, findDefinitions, findReferences, getImports, getGitDiff) are NOT exposed as direct tools — they are only callable inside a function_try source. Wrap the primitives a question needs in one TypeScript function expression with typed inputs and try it with function_try(source, params); direct primitive calls are impossible in this mode. Use a TypeScript function expression with typed inputs; the harness passes params to it. searchText(query) returns {file,line,text}[], readLines(file,start,end) returns {file,start,lines}, and listFiles() returns paths. Name useful procedures camelCase verb+domain+object and parameterize variations. Supply question as a stable canonical question independent of this Tour, description as one or two English sentences stating what the procedure does, its scope, the shape of its result and its key limits, and remember=true only to propose an executed trial for post-Tour selection. Consolidation re-executes the exact code and params and re-checks every citation; only deterministically validated proposals persist. Do not wrap a primitive merely to remember it. Combine independent outputs in your Tour logic; never call one memorized procedure from another. Syntactic matches are candidates, not proven semantic relations; report missing evidence as uncertainty. If a stored function was selected for its declared subject but returned unusable output, call memory_unusable.` : '';
  const state = await graph.invoke({ messages: [{ role: 'system', content: `${DECOMPOSITION_PROMPT}

Explore the repository using the tools. Assess whether the evidence answers the objective; if essential evidence is missing, use further tools before returning. Record unresolved gaps in uncertainties. Return only JSON matching this exact shape: {"objective":"...","entryPoints":[{"name":"...","evidence":[{"file":"relative/path","startLine":1,"endLine":1}]}],"components":[{"name":"...","evidence":[{"file":"relative/path","startLine":1,"endLine":1}]}],"relations":[{"from":"...","to":"...","evidence":[{"file":"relative/path","startLine":1,"endLine":1}]}],"uncertainties":["..."]}. Use empty arrays when needed. Each evidence must be an array of objects with real file paths and integer line numbers, not a string. Do not write a tour.${memoryInstructions}` }, { role: 'user', content: objective }] }, { recursionLimit: Math.ceil(limits.iterations) + 2 });
  const result = state.result === undefined ? { objective, entryPoints: [], components: [], relations: [], uncertainties: ['Exploration stopped before a structured result was produced.'] } : resultSchema.parse(state.result);
  for (const e of [...result.entryPoints, ...result.components, ...result.relations].flatMap(x => x.evidence)) {
    const lines = await tools.read(e.file, e.startLine, e.endLine, true);
    if (lines.length !== e.endLine - e.startLine + 1) throw new Error('Evidence points outside a file');
  }
  // Traces recorded during the run are applied in one end-of-run mutation,
  // BEFORE consolidation consumes the catalogue: failures and reference cases
  // recorded by THIS run must count in its own finish pass (correction 3 —
  // the catalogue is only ever mutated in finish).
  if (library) {
    for (const failureId of new Set([...runtimeFailures, ...unusableIds])) library.recordFailure(failureId);
    for (const observation of runtimeObservations) library.observeRun(observation.id, observation.params, observation.ok);
  }
  let consolidationReport: unknown;
  if (library && state.result !== undefined && !state.stopReason) {
    // The model only selects among candidates that can persist: strict
    // function_try trials — legacy candidates are refused in the
    // reconciliation loop below and never enter the selection pool.
    const eligible = attempts.filter(attempt => attempt.candidate?.executionMode === 'strict' && !unusableIds.has(attempt.candidate?.name ?? ''));
    let selected = new Set<string>();
    if (eligible.length && !reason()) {
      const selectionStarted = new Date();
      const selectionInput = { tour: result, catalog: library.catalog(), executedCandidates: eligible.map(attempt => ({ name: attempt.candidate!.name, question: attempt.candidate!.objective, description: attempt.candidate!.description, paramsSchema: attempt.candidate!.paramsSchema, returns: attempt.candidate!.returns, output: boundedOutput(attempt.output, { revision: currentRevision ?? 'unknown-revision' }) })) };
      const controller = new AbortController();
      const remaining = Math.max(1, limits.durationMs - (Date.now() - startedMs));
      const timer = setTimeout(() => controller.abort(), remaining);
      try {
        metrics.modelCalls++;
        const response = await Promise.race([
          model.complete([
            { role: 'system', content: 'Select useful executed procedures for future Tours. This Tour has passed structural evidence validation only, not semantic verification. Return JSON {"selected":["canonicalName"]}; select only from the executed candidates below. You may select none. Compare canonical question, scope, inputs, output and limits with existing entries; prefer reuse over equivalent duplicates.' },
            { role: 'user', content: JSON.stringify(selectionInput) }
          ], { signal: controller.signal, maxOutputTokens: Math.max(1, Math.min(1024, limits.tokens - metrics.inputTokens - metrics.outputTokens)), codeMode: false, memory: false }),
          new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('budget-duration')), { once: true }))
        ]);
        const usage = response.usage;
        metrics.inputTokens += usage?.inputTokens ?? 0;
        metrics.outputTokens += usage?.outputTokens ?? 0;
        if (!usage) metrics.usageAvailable = false;
        const names = (response.result as { selected?: unknown })?.selected;
        const stopped = reason();
        if (Array.isArray(names) && !stopped) selected = new Set(names.filter((name): name is string => typeof name === 'string'));
        recordCall({ type: 'model', name: 'memory-selection', parameters: selectionInput, result: { response: response.result, toolCalls: response.toolCalls, selected: [...selected], budgetStop: stopped ?? null }, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, usageMissing: !usage }, selectionStarted, new Date());
      } catch (error) {
        metrics.usageAvailable = false;
        recordCall({ type: 'model', name: 'memory-selection', parameters: selectionInput, inputTokens: null, outputTokens: null, usageMissing: true, error: String(error) }, selectionStarted, new Date());
      } finally { clearTimeout(timer); }
    }
    const retained = [...result.entryPoints, ...result.components, ...result.relations].flatMap(x => x.evidence);
    const matches = (value: any): boolean => {
      if (!value || typeof value !== 'object') return false;
      if (Array.isArray(value)) return value.some(matches);
      if (typeof value.file === 'string') {
        const first = value.line ?? value.startLine ?? value.start;
        const last = value.endLine ?? (Array.isArray(value.lines) ? Number(first) + value.lines.length - 1 : first);
        if (retained.some(e => e.file === value.file && Number.isInteger(first) && Number.isInteger(last) && e.startLine <= last && e.endLine >= first)) return true;
      }
      return Object.values(value).some(matches);
    };
    const successful = attempts.filter(a => (!a.id || !unusableIds.has(a.id)) && (!a.candidate?.name || !unusableIds.has(a.candidate.name)) && matches(a.output));
    const candidates: ConsolidationCandidate[] = [];
    for (const attempt of attempts) {
      if (!attempt.candidate || attempt.output == null) continue;
      const candidateName = attempt.candidate.name ?? '';
      if (unusableIds.has(candidateName)) {
        unreconciled.push({ name: candidateName, proposed: false, replayed: false, accepted: false, reason: 'Marked unusable by memory_unusable during the Tour' });
        continue;
      }
      // Issue #187: a legacy candidate — the pre-#185 `code` protocol, reachable
      // only through a directly injected tool call since the provider offers
      // strict function_try instead of `code` whenever memory is on — can never
      // be consolidated silently: its citations were never validated at trial
      // time and cannot be re-validated deterministically on replay. Only
      // strict function_try candidates may persist; the refusal carries an
      // explicit reason in the reconciliation log.
      if (attempt.candidate.executionMode !== 'strict') {
        unreconciled.push({ name: candidateName, proposed: false, replayed: false, accepted: false, reason: 'Legacy candidate refused: its citations were never validated at trial time and cannot be re-validated deterministically on replay; only strict function_try trials may be consolidated' });
        continue;
      }
      if (!selected.has(candidateName)) {
        unreconciled.push({ name: candidateName, proposed: false, replayed: false, accepted: false, reason: 'Not proposed by the model for consolidation' });
        continue;
      }
      // Issue #187 (D04): deterministic reconciliation replay — the exact same
      // code and the exact same params are re-executed, and every citation is
      // re-checked on the replayed output. No second LLM judge decides anything.
      const remaining = limits.durationMs - (Date.now() - startedMs);
      if (remaining <= 0) {
        unreconciled.push({ name: candidateName, proposed: true, replayed: false, accepted: false, reason: 'Budget exhausted before the reconciliation replay' });
        continue;
      }
      const verificationStarted = new Date();
      let replay: ConsolidationCandidate['replay'];
      try {
        const { runScript } = await import('../../exploration-sandbox/index.js');
        const rerun = await runScript({ workspace: root, code: attempt.candidate.code, params: attempt.params, strict: true, includeTrace: true, timeoutMs: Math.min(5000, remaining) });
        // Every citation is re-checked exactly as it was checked at trial time:
        // every candidate reaching this replay is a strict function_try trial
        // whose output carries mandatory references validated by the #185
        // validator, and the replay re-runs that same exhaustive check. Legacy
        // candidates are refused above, before any replay.
        const citations = await validateCitations(rerun.value, { access: citationAccess(tools), revision: await resolveRevision() });
        recordCall({ type: 'function_try', name: 'consolidation-validation', inputTokens: null, outputTokens: null, usageMissing: false, execution: rerun.trace, result: citations?.status === 'validation_failed' ? citationRepairFeedback(citations).validation : citations, outcome: `reexecuted${citationOutcome(citations)}` }, verificationStarted, new Date());
        if (JSON.stringify(rerun.value) !== JSON.stringify(attempt.output)) {
          replay = { ok: false, reason: 'the re-execution did not reproduce the exact original output with the same code and params', citations: citations?.status };
        } else if (citations?.status === 'validation_failed') {
          replay = { ok: false, reason: `citation re-validation failed on the replayed output: ${citations.invalidReferences.length} of ${citations.references} references invalid`, citations: citations.status };
        } else {
          replay = { ok: true, citations: citations?.status };
        }
      } catch (error) {
        recordCall({ type: 'function_try', name: 'consolidation-validation', inputTokens: null, outputTokens: null, usageMissing: false, error: String(error) }, verificationStarted, new Date());
        replay = { ok: false, reason: `the re-execution failed: ${String((error as Error)?.message ?? error).slice(0, 200)}` };
      }
      // Optional counterfactual check: only a nonempty unchanged result proves this
      // particular probe cannot distinguish queries. Empty/error probes are inconclusive.
      if (memory?.validateQuery && typeof attempt.params?.query === 'string' && Array.isArray(attempt.output) && attempt.output.length > 0) {
        const remaining = limits.durationMs - (Date.now() - startedMs);
        if (remaining > 0) {
          try {
            const { runScript } = await import('../../exploration-sandbox/index.js');
            const query = `__codetour_missing_${crypto.randomUUID()}__`;
            const probe = await runScript({ workspace: root, code: attempt.candidate.code, params: { ...attempt.params, query }, scripts: library.sources(), timeoutMs: Math.min(5000, remaining) });
            if (JSON.stringify(probe) === JSON.stringify(attempt.output)) { metrics.memoryQueryRejects++; continue; }
          } catch { /* A failed probe is inconclusive, not proof of a bad script. */ }
        }
      }
      // Consolidation trigger (correction 3): a concrete operational signal —
      // execution status success + structural proof availability + contract
      // respected. NEVER a blind benchmark judge. Partial/failed Tours never
      // reach this point (consolidation only runs for a complete structured
      // result), and traces recorded mid-run never mutate the catalogue.
      const structuralProof = looksLikeEvidence(attempt.output) || matches(attempt.output);
      const contractRespected = attempt.proofValid !== false;
      candidates.push({
        objective: attempt.candidate.objective,
        description: attempt.candidate.description,
        name: attempt.candidate.name ?? '',
        returns: attempt.candidate.returns,
        code: attempt.candidate.code,
        parameters: attempt.candidate.parameters,
        paramsSchema: attempt.candidate.paramsSchema,
        executionMode: attempt.candidate.executionMode,
        verified: matches(attempt.output),
        consolidationSignal: { executedSuccessfully: true, proofAvailable: structuralProof, contractRespected },
        replay,
        revision: attempt.candidate.revision
      });
    }
    const report = await library.finish(successful.flatMap(a => a.id ? [a.id] : []), candidates);
    // The reconciliation log distinguishes proposed, replayed, accepted and
    // rejected with a reason — including candidates the model never proposed
    // or that could not be replayed (issue #187).
    report.reconciliation.push(...unreconciled);
    consolidationReport = report;
  } else if (library) {
    // Persist observed failures even when the exploration is partial; never
    // consolidate new candidates from a result without evidence.
    const partialReport = await library.finish([], []);
    // Issue #188 (D05): proposals that never executed stay visible in the
    // reconciliation log even when the Tour itself is not validated.
    partialReport.reconciliation.push(...unreconciled);
    consolidationReport = partialReport;
  }
  if (library) {
    // Purge counters are read once, after the single end-of-run mutation.
    metrics.memoryPurges = library.purges();
  }
  metrics.durationMs = Date.now() - startedMs;
  if (!planPublished) planAnomalies.add('no plan was published before the structured result');
  const plan: PlanRecord = { status: planStatus, runId, versions: planVersions, anomalies: [...planAnomalies] };
  const status = state.result === undefined || state.stopReason ? 'partial' as const : 'complete' as const;
  recordRunEnd(status, state.stopReason ?? null);
  return { ...result, runId, plan, status, stopReason: state.stopReason ?? null, promptSha256: PROMPT_SHA256, modelConfig: model.snapshot?.(), metrics, callTrace, consolidationReport };
  } catch (error) {
    metrics.durationMs = Date.now() - startedMs;
    const plan: PlanRecord = { status: planStatus, runId, versions: planVersions, anomalies: [...planAnomalies] };
    recordRunEnd('failed', null);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      exploration: { objective, runId, plan, status: 'failed', error: String((error as Error).message ?? error).slice(0, 500), promptSha256: PROMPT_SHA256, modelConfig: model.snapshot?.(), metrics, callTrace }
    });
  }
}

/**
 * Plan validation (issue #184): a published plan must be an object with a
 * non-empty questions array of independent functional questions, each carrying
 * a non-empty string id and canonical question (reuse marker optional boolean,
 * reason optional string, meaningful on revisions). Anything else is an
 * explicit, visible anomaly — the harness never presumes a success.
 *
 * Practicable French screen for plan questions (issue #184): accented
 * characters plus a few unambiguous French tokens flag a non-English plan as
 * a visible anomaly — a heuristic screen, never proof of language, and never
 * a hard failure on its own.
 */
const FRENCH_ACCENTS = /[éèêëàâçôûîüöÉÈÊËÀÂÇÔÛÎÜÖœŒ]/;
const FRENCH_TOKENS = /\b(le|la|les|des|du|une|est|sont|dans|avec|pour|quel|quelle|quels|quelles|fonction|fichier)\b/i;
function validatePlan(raw: unknown): { ok: true; questions: PlanQuestion[]; reason?: string; anomalies: string[] } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid plan: expected an object with a questions array' };
  const { questions, reason } = raw as Record<string, unknown>;
  if (!Array.isArray(questions) || questions.length === 0) return { ok: false, error: 'invalid plan: questions must be a non-empty array' };
  const anomalies: string[] = [];
  for (const [index, question] of questions.entries()) {
    if (!question || typeof question !== 'object' || Array.isArray(question)) return { ok: false, error: `invalid plan: question ${index} must be an object` };
    const candidate = question as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) return { ok: false, error: `invalid plan: question ${index} needs a non-empty string id` };
    if (typeof candidate.question !== 'string' || candidate.question.length === 0) return { ok: false, error: `invalid plan: question ${index} needs a non-empty string question` };
    if (candidate.reuse !== undefined && typeof candidate.reuse !== 'boolean') return { ok: false, error: `invalid plan: question ${index} reuse must be a boolean` };
    // Issue #184: the initial plan must be in English — a practicable screen
    // flags French questions as a visible anomaly, never a hard failure.
    if (FRENCH_ACCENTS.test(candidate.question) || FRENCH_TOKENS.test(candidate.question)) anomalies.push(`plan not in English: question '${candidate.id}' looks French`);
  }
  if (reason !== undefined && typeof reason !== 'string') return { ok: false, error: 'invalid plan: reason must be a string' };
  return { ok: true, questions: questions as PlanQuestion[], reason: reason as string | undefined, anomalies };
}

function summarizeOutcome(output: unknown): string {
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
