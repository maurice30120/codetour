import { createHash } from 'node:crypto';
import { cleanScratch, createScratch } from './scratch.ts';
import { maskObservations, MASK_MIN_BYTES } from './mask.ts';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { createEvidenceTracker, resultSchema } from './exploration-evidence.ts';
import { workspace } from './workspace.ts';
import { DEFAULT_CONFIG } from './config.ts';
import type { HarnessConfig } from './config.ts';
import { scriptMemory, validateDescription } from './memory.ts';
import type { ConsolidationCandidate, ReconciliationOutcome } from './memory.ts';
import { boundedOutput, looksLikeEvidence, sampleEvidenceRefs } from './memory-output.ts';
import { citationAccess, citationRepairFeedback, validateCitations } from './citation-validator.ts';
import { DECOMPOSITION_PROMPT, PROMPT_SHA256, PROMPT_VERSION } from './decomposition-prompt.ts';
import { primitiveNames } from './tool-contract.ts';
import { derivedCandidateName, citationOutcome, summarizeOutcome } from './exploration-helpers.ts';
import type { Model, Budget, PlanRecord, CallTraceItem } from './exploration-helpers.ts';
import { researchLog } from './research-log.ts';
import type { Logger } from 'pino';
export type { Model, Budget, PlanRecord, CallTraceItem, ToolCall } from './exploration-helpers.ts';

export { DECOMPOSITION_PROMPT, PROMPT_SHA256, PROMPT_VERSION };

const State = Annotation.Root({ messages: Annotation<any[]>({ reducer: (a, b) => a.concat(b), default: () => [] }), result: Annotation<any>, stopReason: Annotation<string> });


interface Attempt {
  id?: string;
  synthesized?: boolean;
  candidate?: { objective: string; description: string; name?: string; returns?: string; code: string; parameters: string[]; paramsSchema?: Array<{ name: string; type: string }>; executionMode?: 'strict' | 'legacy'; revision?: string };
  params?: Record<string, unknown>;
  output: unknown;
  /** Issue #194: the trial output was truncated (sandbox cap or bounding) — flagged, never presented as exhaustive. */
  truncated?: boolean;
  proofValid?: boolean;
  proofSignature?: string[];
}

/** An exploration returns validated references, never Tour prose. */
export async function explore({ root, objective, model, budget = {}, codeMode = false, memory, config = DEFAULT_CONFIG, onProgress }: { onProgress?: (event: Record<string, unknown>) => void; root: string; objective: string; model: Model; budget?: Budget; codeMode?: boolean; memory?: { directory: string }; config?: HarnessConfig }) {
  if (memory && !codeMode) throw new Error('Script memory requires Code Mode');
  const limits = { iterations: budget.iterations ?? config.budget.iterations, calls: budget.calls ?? config.budget.calls, tokens: budget.tokens ?? config.budget.tokens, durationMs: budget.durationMs ?? config.budget.durationMs };
  const { scriptTimeoutMs, maxOutputTokens, planMaxOutputTokens } = config.limits;
  if (Object.values(limits).some(n => !Number.isFinite(n) || n <= 0)) throw new Error('Budgets must be positive');
  const startedMs = Date.now();
  const runId = crypto.randomUUID();
  cleanScratch(root);
  const scratch = createScratch(root, runId);
  let plan: PlanRecord = { status: 'missing', runId };
  const metrics = { inputTokens: 0, outputTokens: 0, usageAvailable: true, modelCalls: 0, toolCalls: 0, durationMs: 0, outputBytes: 0, cost: null as number | null, memoryReuses: 0, functionTries: 0, memoryPurges: 0, memoryQueryRejects: 0, memoryResultsCompacted: 0, memoryResultsRepeated: 0, autoAttachedEvidence: 0, selectionSkip: null as string | null };
  const callTrace: CallTraceItem[] = [];
  let callSeq = 0;
  let logger: Logger | undefined;
  let requestedEvidenceRecovery = false;
  let requestedJsonRecovery = false;
  let nextOutputLimit = maxOutputTokens;
  let requestedSchemaRecovery = false;
  // Ticket #190: on the 2026-11-16 run the model called memory_list six times
  // with returned=0 and revised its plan seven times without ever reaching
  // function_try — it treats an empty catalogue as a dead end instead of a
  // creation trigger. After two empty memory_list results in the same run, the
  // tool result itself carries a visible note inviting function_try for
  // durably reusable questions (once per run, traced, no extra LLM call).
  let emptyMemoryListCount = 0;
  let emptyMemoryListNoteEmitted = false;
  const progress = (phase: string, detail: Record<string, unknown> = {}): void => {
    try { onProgress?.({ at: new Date().toISOString(), runId, phase, elapsedMs: Date.now() - startedMs, inputTokens: metrics.inputTokens, outputTokens: metrics.outputTokens, modelCalls: metrics.modelCalls, toolCalls: metrics.toolCalls, ...detail }); }
    catch { /* progress reporting never affects the run */ }
  };
  const recordCall = (base: Omit<CallTraceItem, 'seq' | 'runId' | 'startedAt' | 'endedAt' | 'durationMs'>, startedAt: Date, endedAt: Date): void => {
    const entry = { ...base, runId, seq: callSeq++, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationMs: endedAt.getTime() - startedAt.getTime() };
    callTrace.push(entry);
    logger?.info({ event: 'trace', trace: entry });
    const brief = (value: unknown): string | undefined => value === undefined ? undefined : JSON.stringify(value)?.slice(0, 200);
    const initial = (entry.result as { initial?: unknown } | undefined)?.initial;
    progress(entry.type === 'run_end' ? 'end' : 'step', { type: entry.type, name: entry.name, outcome: entry.outcome, params: brief(entry.parameters), error: entry.error, ...(entry.type === 'decomposition_plan' ? { plan: initial } : {}) });
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
  const tools = await workspace(root, { exclude: config.search.exclude });
  logger = researchLog(root, runId, config.log);
  logger.info({ event: 'research_start', objective, root, budget: limits, codeMode, memoryEnabled: !!memory, model: model.snapshot?.() });
  const complete: Model['complete'] = async (messages, options) => {
    logger!.info({ event: 'model_request', messages, options: { maxOutputTokens: options?.maxOutputTokens, codeMode: options?.codeMode, memory: options?.memory, toolsEnabled: options?.toolsEnabled } });
    try {
      const response = await model.complete(messages, options);
      logger!.info({ event: 'model_response', response, model: model.snapshot?.() });
      return response;
    } catch (error) {
      logger!.error({ event: 'model_error', error: String(error), model: model.snapshot?.() });
      throw error;
    }
  };
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
  const unusableIds = new Set<string>();
  const abandonedAttempts = new Set<Attempt>();
  const { noteEvidence, attachEvidence } = createEvidenceTracker();
  let previousFailedCall: string | undefined;
  // Identical successful calls (same tool, params and result) across the whole run, not only consecutive ones.
  const identicalResults = new Map<string, number>();
  const observedReadLines = new Map<string, Map<number, string>>();
  let consecutiveOverlappingReads = 0;
  let overlappingReadWarningEmitted = false;
  let finalizingAfterLoop = false;
  let loopStopReason: 'repeated_call' | 'repeated_tool_failure' = 'repeated_call';
  const spilled = new Map<string, string>();
  let maxIdenticalResults = 0;
  let consecutiveFailures = 0;
  const stableValue = (value: unknown): unknown => Array.isArray(value) ? value.map(stableValue) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)])) : value;
  const reason = () => Date.now() - startedMs >= limits.durationMs ? 'duration' : metrics.inputTokens + metrics.outputTokens >= limits.tokens ? 'tokens' : metrics.modelCalls + metrics.toolCalls >= limits.calls ? 'calls' : metrics.modelCalls >= limits.iterations ? 'iterations' : undefined;
  const graph = new StateGraph(State).addNode('model', async state => {
    const stopped = reason();
    if (stopped) return { stopReason: stopped };
    const controller = new AbortController();
    const remainingMs = Math.max(1, limits.durationMs - (Date.now() - startedMs));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: Awaited<ReturnType<Model['complete']>>;
    const outputLimit = Math.max(1, Math.min(nextOutputLimit, limits.tokens - metrics.inputTokens - metrics.outputTokens));
    nextOutputLimit = maxOutputTokens;
    const modelCallStarted = new Date();
    try {
      metrics.modelCalls++;
      progress('investigate');
      response = await Promise.race([
        complete(maskObservations(state.messages, config.context.keepToolResults, spilled), { signal: controller.signal, maxOutputTokens: outputLimit, codeMode, memory: !!library, ...(finalizingAfterLoop ? { toolsEnabled: false } : {}) }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('budget-duration')); }, remainingMs); })
      ]);
    } catch (error) {
      const usage: { inputTokens: number; outputTokens: number } | undefined = (error as { usage?: { inputTokens: number; outputTokens: number } })?.usage;
      const diagnostic = error as { finishReason?: unknown; contentShape?: unknown; reasoningTokens?: unknown };
      recordCall({ type: 'model', name: 'model', maxOutputTokens: outputLimit, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, usageMissing: !usage, error: controller.signal.aborted ? 'budget-duration' : String(error), ...(typeof diagnostic.finishReason === 'string' || diagnostic.finishReason === null ? { finishReason: diagnostic.finishReason } : {}), ...(typeof diagnostic.contentShape === 'string' || (Array.isArray(diagnostic.contentShape) && diagnostic.contentShape.every(item => typeof item === 'string')) ? { contentShape: diagnostic.contentShape } : {}), ...(typeof diagnostic.reasoningTokens === 'number' ? { reasoningTokens: diagnostic.reasoningTokens } : {}) }, modelCallStarted, new Date());
      metrics.inputTokens += usage?.inputTokens ?? 0;
      metrics.outputTokens += usage?.outputTokens ?? 0;
      if (!usage) metrics.usageAvailable = false;
      if (controller.signal.aborted) return { stopReason: 'duration' };
      if (finalizingAfterLoop) return { stopReason: loopStopReason };
      // A non-JSON final answer (often an empty reply after plan extraction)
      // gets one visible recovery inside the original budget, mirroring the
      // citation repair path. A repeated failure stays fatal: no hidden retry.
      if ((error as { name?: string })?.name === 'FinalAnswerNotJson' && !requestedJsonRecovery && !reason()) {
        requestedJsonRecovery = true;
        if (diagnostic.finishReason === 'length' && (error as { rawContent?: unknown }).rawContent === '' && typeof diagnostic.reasoningTokens === 'number' && usage && usage.outputTokens > 1 && diagnostic.reasoningTokens >= usage.outputTokens - 1) nextOutputLimit = 32768;
        // The model must see what it actually wrote, not the error text: the
        // observed failure mode (2026-11-16 run, #166/#167) is a reply made of
        // a plan block with no JSON after it — shown its own output, the model
        // can correct the formatting instead of resuming exploration. The plan
        // published in the failed attempt is recorded too, never lost.
        const rawOutput = String((error as { rawContent?: string }).rawContent ?? '');
        return { messages: [
          { role: 'assistant', content: rawOutput || String((error as Error).message ?? '') },
          { role: 'user', content: (error as { rawContent?: unknown }).rawContent === '' && metrics.toolCalls === 0 ? 'Your previous response was empty. Use the available tools to explore the repository and gather evidence before returning the required JSON; report any unresolved gaps.' : 'Your final answer was not valid JSON. Your plan block, if any, was already extracted and recorded. Reply again with the final result as a single JSON object matching the required schema, outside any fenced code block, with no prose outside the JSON.' },
        ] };
      }
      throw error;
    } finally { if (timer) clearTimeout(timer); }
    const modelCallEnded = new Date();
    const inputTokens = response.usage?.inputTokens ?? null;
    const outputTokens = response.usage?.outputTokens ?? null;
    recordCall({ type: 'model', name: 'model', maxOutputTokens: outputLimit, inputTokens, outputTokens, usageMissing: !response.usage }, modelCallStarted, modelCallEnded);
    metrics.inputTokens += inputTokens ?? 0;
    metrics.outputTokens += outputTokens ?? 0;
    if (!response.usage) metrics.usageAvailable = false;
    if (response.result !== undefined) {
      const parsed = resultSchema.safeParse(response.result);
      if (!parsed.success) {
        if (finalizingAfterLoop) return { stopReason: loopStopReason };
        if (!requestedSchemaRecovery && !reason()) {
          requestedSchemaRecovery = true;
          const issues = parsed.error.issues.map(issue => `${issue.path.join('.') || 'result'}: ${issue.message}`).join('; ');
          return { messages: [
            { role: 'assistant', content: JSON.stringify(response.result) },
            { role: 'user', content: `The final JSON does not match the required schema: ${issues}. Return the complete corrected JSON, preserving supported evidence and using empty arrays where appropriate. The original run budget still applies.` }
          ] };
        }
        throw parsed.error;
      }
      const result = parsed.data;
      metrics.autoAttachedEvidence += attachEvidence(result);
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
        if (finalizingAfterLoop) return { stopReason: loopStopReason };
        if (reason()) throw error;
        return { messages: [
          { role: 'assistant', content: JSON.stringify(result) },
          { role: 'user', content: `Source citation validation failed: ${String(error)}. Inspect the source with repository tools and correct the references. Do not invent line numbers. The original run budget still applies.` },
        ] };
      }
      return { result, stopReason: Date.now() - startedMs >= limits.durationMs ? 'duration' : metrics.inputTokens + metrics.outputTokens > limits.tokens ? 'tokens' : undefined };
    }
    if (finalizingAfterLoop) return { stopReason: loopStopReason };
    if (!response.toolCalls?.length) throw new Error('Model returned neither tools nor result');
    const calls = response.toolCalls.slice(0, Math.max(0, Math.min(8, limits.calls - metrics.modelCalls - metrics.toolCalls)));
    const outputs: any[] = [{ role: 'assistant', tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) }];
    for (const originalCall of calls) {
      // Optional caller metadata is retained in the trace, but never gates exploration.
      const questionId = typeof originalCall.arguments.question_id === 'string' ? originalCall.arguments.question_id : undefined;
      const call = { ...originalCall, arguments: { ...originalCall.arguments } };
      delete call.arguments.question_id;
      if (Date.now() - startedMs >= limits.durationMs || metrics.inputTokens + metrics.outputTokens >= limits.tokens) break;
      metrics.toolCalls++;
      const toolStarted = new Date();
      let output: unknown;
      let scratchRaw: unknown;
      let sourceIncomplete = false;
      let failed = false;
      let attempt: Attempt | undefined;
      let scriptCall: { type: 'memory_run' | 'function_try'; name: string } | undefined;
      try {
        if (call.name === 'readScratch') {
          if (typeof call.arguments.resultId !== 'string' || typeof call.arguments.offset !== 'number') throw new Error('resultId and offset are required');
          output = scratch.read(call.arguments.resultId, call.arguments.offset);
        }
        else if (primitiveNames.has(call.name)) {
          const { runScript } = await import('codetour-exploration-sandbox');
          const args = call.arguments;
          const expressions: Record<string, string> = {
            listFiles: 'listFiles(params.maxFiles)', searchText: 'searchText(params.query)', searchIdentifiers: 'searchIdentifiers(params.identifier)',
            readLines: 'readLines(params.file, params.startLine, params.endLine)', readLineFragment: 'readLineFragment(params.file, params.line, params.offset)', readAround: 'readAround(params.file, params.line, params.contextLines)',
            listSymbols: 'listSymbols()', findDefinitions: 'findDefinitions(params.symbol)', findReferences: 'findReferences(params.symbol)',
            getImports: 'getImports(params.file)', getGitDiff: 'getGitDiff(params.revision1, params.revision2)'
          };
          const defaults = { listFiles: { maxFiles: 500 }, readAround: { contextLines: 5 }, getGitDiff: { revision2: 'HEAD' } };
          // Models often send start/end instead of startLine/endLine; the
          // typed expression would otherwise fail identically on every retry.
          if (call.name === 'readLines') {
            if (args.startLine === undefined && args.start !== undefined) args.startLine = args.start;
            if (args.endLine === undefined && args.end !== undefined) args.endLine = args.end;
            delete args.start;
            delete args.end;
          }
          const params = { ...(defaults[call.name as keyof typeof defaults] ?? {}), ...args };
          const execution = await runScript({ workspace: root, searchExclude: config.search.exclude, code: expressions[call.name], params, strict: true, includeTrace: true, timeoutMs: Math.min(scriptTimeoutMs, Math.max(1, limits.durationMs - (Date.now() - startedMs))) });
          let value = execution.value;
          // Direct model-facing reads show absolute line numbers. The sandbox
          // primitive contract used by procedures keeps its original string[].
          if ((call.name === 'readLines' || call.name === 'readAround') && value && typeof value === 'object') {
            const read = value as { file: string; start: number; lines: string[] };
            value = { ...read, lines: read.lines.map((text, index) => ({ line: read.start + index, text })) };
          }
          const revision = await resolveRevision();
          const bounded = () => boundedOutput(value, { maxItems: config.memoryOutput.maxItems, maxBytes: config.memoryOutput.maxBytes, revision, sourceTruncated: execution.trace.truncated, primitiveDerived: true });
          if ((call.name === 'readLines' || call.name === 'readLineFragment') && value && typeof value === 'object') {
            const page = value as { start?: number; lines?: Array<{ line: number; text: string }>; nextLine?: number | null; truncatedLines?: number[]; offset?: number; content?: string; nextOffset?: number | null };
            while (bounded().truncated || Buffer.byteLength(JSON.stringify(bounded())) > config.context.maxResultBytes) {
              if (call.name === 'readLines' && page.lines?.length) {
                if (page.lines.length > 1) {
                  page.nextLine = page.lines.pop()!.line;
                  page.truncatedLines = page.truncatedLines?.filter(line => line < page.nextLine!);
                } else if (page.lines[0].text.length > 500) {
                  let end = 500;
                  const text = page.lines[0].text;
                  if (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
                  page.lines[0].text = text.slice(0, end);
                  page.truncatedLines = [...new Set([...(page.truncatedLines ?? []), page.lines[0].line])];
                } else throw new Error('Configured output limit is too small for a readLines page');
              } else if (call.name === 'readLineFragment' && page.content?.length) {
                const chars = Array.from(page.content);
                page.content = chars.slice(0, Math.floor(chars.length * 0.8)).join('');
                page.nextOffset = page.offset! + Buffer.byteLength(page.content);
                if (!page.content) throw new Error('Configured output limit is too small for a line fragment');
              } else throw new Error('Configured output limit is too small for a read page');
            }
          }
          output = bounded();
          sourceIncomplete = execution.trace.truncated;
          if ((output as { truncated?: boolean }).truncated && !execution.trace.truncated) scratchRaw = value;
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
          const available = listed.length === 0 ? library.catalog() : [];
          if (listed.length === 0 && available.length > 0) {
            output = { results: [], available, note: 'No entries match the exact query. The catalogue is not empty; inspect the available entries or retry with a shorter literal query.' };
          } else if (listed.length === 0 && ++emptyMemoryListCount >= 2 && !emptyMemoryListNoteEmitted) {
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
          for (const previous of attempts) if (previous.candidate?.name === id) abandonedAttempts.add(previous);
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
          const { runScript } = await import('codetour-exploration-sandbox');
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), remaining);
          scriptCall = { type: stored ? 'memory_run' : 'function_try', name: stored ? stored.id : 'function_try' };
          if (call.name === 'function_try') metrics.functionTries++;
          // Ticket #191: any memory_run/function_try call — accepted or failed —
          // counts as having served its declared question; the trace carries the
          // outcome, the reminder only targets questions never attempted.
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
            const execution = await runScript({ workspace: root, searchExclude: config.search.exclude, code, params, scripts: strict ? undefined : library?.sources(), strict, includeTrace: true, timeoutMs: Math.min(scriptTimeoutMs, remaining), signal: controller.signal });
            raw = execution.value;
            sourceIncomplete = execution.trace.truncated;
            const runEnded = new Date();
            // Compact, structured, bounded, sourced output for memory_run AND function_try.
            const bounded = boundedOutput(raw, { revision: await resolveRevision(), maxItems: stored?.limits?.maxItems ?? config.memoryOutput.maxItems, maxBytes: stored?.limits?.maxBytes ?? config.memoryOutput.maxBytes, sourceTruncated: execution.trace.truncated, primitiveDerived: execution.trace.executedCalls.length > 0 });
            // Issue #185 (D02): every mandatory reference a strict trial emits is
            // exhaustively validated without any LLM — no sample, no judge. A
            // citation-invalid trial returns short structured repair feedback
            // instead of its result, is never proposed for consolidation, and
            // leaves its code and diagnostics in the trace only.
            const citations = call.name === 'function_try' ? await validateCitations(raw, { maxReferences: config.citations.maxReferences, access: citationAccess(tools), revision: await resolveRevision() }) : undefined;
            const citationFailure = citations?.status === 'validation_failed' ? citationRepairFeedback(citations) : undefined;
            recordCall({ type: scriptCall.type, name: scriptCall.name, callId: call.id, questionId, parameters: call.name === 'function_try' ? { remember: call.arguments.remember === true, name: call.arguments.name, question: call.arguments.question, description: call.arguments.description } : { id: stored?.id, params }, inputTokens: null, outputTokens: null, usageMissing: false, execution: execution.trace, result: stored ? bounded : citationFailure?.validation, outcome: `returned=${bounded.returned}${bounded.truncated ? '; TRUNCATED, not exhaustive' : ''}${citationOutcome(citations)}` }, runStarted, runEnded);
            const memoryTraceEntry = callTrace[callTrace.length - 1];
            output = citationFailure ?? (output && typeof output === 'object' && 'staleness' in (output as Record<string, unknown>) ? { ...(output as Record<string, unknown>), result: bounded } : bounded);
            if (!citationFailure && bounded.truncated && !execution.trace.truncated) scratchRaw = raw;
            // The description is kept whole: a deterministic gate at consolidation
            // refuses off-format or oversized descriptions with a precise reason
            // instead of silently truncating them (issue #187).
            const description = typeof call.arguments.description === 'string' ? call.arguments.description.trim() : '';
            const name = typeof call.arguments.name === 'string' ? call.arguments.name.trim().slice(0, 100) : '';
            const returns = typeof call.arguments.returns === 'string' ? call.arguments.returns.trim().slice(0, 300) : undefined;
            // Surface the description gate now, while the model can still resubmit.
            if (library && !stored && !citationFailure && output && typeof output === 'object') {
              const descriptionCheck = validateDescription(description);
              if (!descriptionCheck.ok) output = { ...(output as Record<string, unknown>), descriptionWarning: `${descriptionCheck.reason} Resubmit this function_try with a corrected ASCII-only English description or the trial will be refused at consolidation.` };
            }
            // Issue #194: every successfully-executed strict function_try trial
            // is automatically submitted to post-Tour selection — the model
            // never has to flag it with remember. Failed trials (the sandbox
            // throw above) and citation-invalid trials (citationFailure) never
            // become candidates; a truncated view is still submitted but
            // flagged as such in the selection input, and the deterministic
            // replay still validates the full raw output.
            const viewTruncated = Boolean((bounded as { truncated?: boolean } | null)?.truncated);
            let candidate = !citationFailure && library && !stored
              ? { objective: String(call.arguments.question ?? objective).slice(0, 500), description, name: name || derivedCandidateName(String(call.arguments.question ?? objective), code), returns: strict ? execution.trace.contract.returns : returns, code, parameters: Object.keys(params).slice(0, 30), paramsSchema: execution.trace.contract?.paramsSchema, executionMode: strict ? 'strict' as const : 'legacy' as const, revision: await resolveRevision() }
              : undefined;
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
              if (stored && memoryTraceEntry) memoryTraceEntry.memory = { id: stored.id, stale: Boolean(output && typeof output === 'object' && 'staleness' in (output as Record<string, unknown>)), proofValid: refs.length === 0 ? null : proofOk };
              attempt = { id: stored?.id, candidate, params: params as Record<string, unknown>, output: raw, truncated: viewTruncated, proofValid: refs.length === 0 ? undefined : proofOk, proofSignature };
            }
          } catch (error) {
            recordCall({ type: scriptCall?.type ?? 'function_try', name: call.name === 'memory_run' ? String(call.arguments.id ?? call.name) : 'function_try', callId: call.id, questionId, parameters: stored ? { id: stored.id, params } : undefined, inputTokens: null, outputTokens: null, usageMissing: false, error: String(error) }, runStarted, new Date());
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
      } catch (error) { failed = true; output = { error: String((error as Error).message ?? error).slice(0, 500) }; }
      const identity = call.name === 'function_try' ? { source: call.arguments.source, params: call.arguments.params }
        : call.name === 'code' ? { code: call.arguments.code, params: call.arguments.params }
        : call.name === 'memory_run' ? { id: call.arguments.id, params: call.arguments.params }
        : call.arguments;
      const failureKey = JSON.stringify(stableValue([call.name, identity, failed ? (output as { error: string }).error : null]));
      consecutiveFailures = failed ? (failureKey === previousFailedCall ? consecutiveFailures + 1 : 1) : 0;
      previousFailedCall = failed ? failureKey : undefined;
      if (consecutiveFailures === 2) {
        output = { ...(output as object), note: 'The same tool call has failed twice. Change the source or parameters, use a different approach, or return a partial result with uncertainties. Do not repeat the same failed call.' };
        const guardAt = new Date();
        recordCall({ type: 'tool', name: 'repeated_failure_guard', callId: call.id, inputTokens: null, outputTokens: null, usageMissing: false, outcome: 'warning: same tool call failed twice' }, guardAt, guardAt);
      }
      if (!failed) {
        const key = createHash('sha256').update(JSON.stringify(stableValue([call.name, identity, output]))).digest('hex');
        const count = (identicalResults.get(key) ?? 0) + 1;
        identicalResults.set(key, count);
        maxIdenticalResults = Math.max(maxIdenticalResults, count);
        if (count === 2) {
          const note = 'This exact call already returned the same result. Do not repeat it: change the query or parameters, use a different approach, or conclude with what you have and list the gaps as uncertainties.';
          output = Array.isArray(output) ? { results: output, note } : { ...(output as object), note };
          const guardAt = new Date();
          recordCall({ type: 'tool', name: 'repeated_call_guard', callId: call.id, inputTokens: null, outputTokens: null, usageMissing: false, outcome: `warning: ${call.name} returned an identical result twice` }, guardAt, guardAt);
        }
      }
      // Compare lines actually delivered to the model, not requested ranges:
      // pagination, truncation and failed reads must not count as observations.
      const readResult = (output as { result?: { file?: unknown; lines?: unknown; truncatedLines?: unknown } } | undefined)?.result;
      if (!failed && (call.name === 'readLines' || call.name === 'readAround') && readResult && typeof readResult.file === 'string' && Array.isArray(readResult.lines) && !(output as { truncated?: boolean }).truncated && !scratchRaw && Buffer.byteLength(JSON.stringify(output)) <= config.context.maxResultBytes) {
        const incomplete = new Set(Array.isArray(readResult.truncatedLines) ? readResult.truncatedLines : []);
        const lines = readResult.lines.filter((line): line is { line: number; text: string } => !!line && typeof line.line === 'number' && typeof line.text === 'string' && !incomplete.has(line.line));
        const seen = observedReadLines.get(readResult.file) ?? new Map<number, string>();
        const overlap = lines.filter(line => seen.get(line.line) === line.text).length;
        consecutiveOverlappingReads = lines.length >= 5 && overlap / lines.length >= 0.8 ? consecutiveOverlappingReads + 1 : 0;
        if (!consecutiveOverlappingReads) overlappingReadWarningEmitted = false;
        for (const line of lines) seen.set(line.line, line.text);
        observedReadLines.set(readResult.file, seen);
        if (consecutiveOverlappingReads >= 2 && !overlappingReadWarningEmitted) {
          const warned = { ...(output as object), note: 'These reads overlap heavily with earlier source reads. Avoid repeating them; use available evidence or recover a masked result from scratch, then conclude or explain the remaining gap.' };
          // Never make an otherwise complete page overflow merely to add a warning.
          if (Buffer.byteLength(JSON.stringify(warned)) <= config.context.maxResultBytes) {
            output = warned;
            overlappingReadWarningEmitted = true;
            const guardAt = new Date();
            recordCall({ type: 'tool', name: 'overlapping_read_guard', callId: call.id, inputTokens: null, outputTokens: null, usageMissing: false, outcome: 'warning: consecutive source reads overlap earlier lines' }, guardAt, guardAt);
          }
        }
      } else { consecutiveOverlappingReads = 0; overlappingReadWarningEmitted = false; }
      if (!scriptCall) {
        // Plain primitives and memory catalogue calls: real timestamps and durations.
        const toolEnded = new Date();
        recordCall({ type: call.name === 'memory_list' ? 'memory_list' : 'tool', name: call.name, callId: call.id, questionId, parameters: call.arguments, result: output, inputTokens: null, outputTokens: null, usageMissing: false, outcome: summarizeOutcome(output) }, toolStarted, toolEnded);
      }
      noteEvidence(output);
      const serialized = JSON.stringify(output);
      const shouldSave = !sourceIncomplete && call.name !== 'readScratch' && (scratchRaw !== undefined || Buffer.byteLength(serialized) > config.context.maxResultBytes || (config.context.keepToolResults > 0 && Buffer.byteLength(serialized) > MASK_MIN_BYTES));
      const saved = shouldSave && scratch.save(call.id, scratchRaw === undefined ? serialized : JSON.stringify(scratchRaw));
      if (saved) spilled.set(call.id, call.id);
      let content = scratchRaw === undefined ? serialized : JSON.stringify({ ...(output as object), scratch: saved ? `Full result available via readScratch with resultId ${call.id} and offset 0; cite original sources.` : 'Full result unavailable in scratch.' });
      if (Buffer.byteLength(content) > config.context.maxResultBytes) {
        let preview = serialized.slice(0, 8000);
        const note = saved ? `Full result available via readScratch with resultId ${call.id} and offset 0; cite original sources.` : 'Full result unavailable in scratch.';
        content = JSON.stringify({ truncated: true, preview, note });
        while (preview.length && Buffer.byteLength(content) > config.context.maxResultBytes) {
          preview = preview.slice(0, Math.floor(preview.length * 0.8));
          content = JSON.stringify({ truncated: true, preview, note });
        }
      }
      if (attempt) attempts.push(attempt);
      metrics.outputBytes += Buffer.byteLength(content);
      outputs.push({ role: 'tool', tool_call_id: call.id, content });
      if (consecutiveFailures >= 3 || maxIdenticalResults >= 3) {
        loopStopReason = consecutiveFailures >= 3 ? 'repeated_tool_failure' : 'repeated_call';
        const cited = attempts.filter(item => item.proofValid && (item.candidate || item.id));
        if (!finalizingAfterLoop && cited.length && !reason()) {
          finalizingAfterLoop = true;
          const evidence = cited.slice(-2).map(item => boundedOutput(item.output, { revision: 'unknown-revision', maxItems: 5, maxBytes: 3000, primitiveDerived: true }));
          const guardAt = new Date();
          recordCall({ type: 'tool', name: 'loop_finalization', inputTokens: null, outputTokens: null, usageMissing: false, outcome: `one tool-free finalization requested after ${loopStopReason}` }, guardAt, guardAt);
          return { messages: [...outputs, { role: 'user', content: `The same call repeated three times (${loopStopReason}). Stop using tools and return the required JSON using only evidence already observed. Report any missing or uncertain findings in uncertainties; do not invent claims. Recent cited outputs: ${JSON.stringify(evidence)}` }] };
        }
        return { messages: outputs, stopReason: loopStopReason };
      }
    }
    return { messages: outputs, stopReason: reason() };
  }).addEdge(START, 'model').addConditionalEdges('model', state => state.result !== undefined || state.stopReason ? END : 'model').compile();
  const memoryInstructions = library ? ` Script memory is enabled. memory_list(query) returns the catalogue WITHOUT function source code: id (TypeScript identifier), objective (canonical question), description (scope), typed params, output contract, limits and uncertainty cases. Available entries: ${JSON.stringify(library.catalog())}. If a listed function can help, call memory_run with its id and suitable params, verify its proofs, and complete only what is missing. The permanent primitives (listFiles, searchText, searchIdentifiers, readLines, readLineFragment, readAround, listSymbols, findDefinitions, findReferences, getImports, getGitDiff) are available as direct tools: use them for simple reads and searches. When a reusable procedure would add value and no stored procedure or primitive already covers it, try function_try to compose primitives into structured, cited evidence. Do not create a function merely to satisfy a quota; conclude when the evidence is sufficient. Use a TypeScript function expression with typed inputs; the harness passes params to it. searchText(query) returns {file,line,text}[], readLines(file,start,end) returns {file,start,lines,nextLine,truncatedLines}; continue with nextLine and the same end, and recover truncated lines with readLineFragment(file,line,offset), starting at offset 0 and continuing with nextOffset. listFiles() returns paths. Give useful procedures a valid TypeScript identifier and parameterize variations. When a stored procedure fails or is unusable for its declared subject, you may submit a corrected function_try under its existing id only if its purpose and contract remain unchanged; otherwise use a new name. Supply question as a stable canonical question independent of this Tour and a non-empty English description (ASCII only: no accented characters, even when the question is in French) stating what the procedure does, its scope, the shape of its result and its key limits. Every successfully executed function_try trial is automatically submitted to post-Tour selection — no remember flag is needed; the selection step considers actual contribution, correctness, documentation and duplication, and consolidation re-executes the exact code and params and re-checks every citation, so only deterministically validated selections persist. Do not wrap a primitive merely to remember it. Combine independent outputs in your Tour logic; never call one memorized procedure from another. Syntactic matches are candidates, not proven semantic relations; report missing evidence as uncertainty. If a stored function was selected for its declared subject but returned unusable output, call memory_unusable. The catalogue above is already complete: do not call memory_list to rediscover it. If no entry fits, build the missing procedure with function_try early instead of repeating searches.` : '';
  // A separate model call creates a local guide before any workspace tool runs.
  // It shares the exploration budgets and never dictates subsequent tool calls.
  const planningStarted = new Date();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, limits.durationMs - (Date.now() - startedMs)));
  try {
    metrics.modelCalls++;
    progress('plan');
    const response = await Promise.race([
      complete([
        { role: 'system', content: 'Plan the investigation of exactly one technical question. Return JSON with arrays "understand", "investigate", and "reuse" (potentially useful catalogue functions). This is a flexible initial guide, not a Tour plan. Do not call tools.' },
        { role: 'user', content: JSON.stringify({ question: objective, catalog: library?.catalog() ?? [] }) }
      ], { signal: controller.signal, maxOutputTokens: Math.max(1, Math.min(planMaxOutputTokens, limits.tokens)), codeMode: false, memory: false, toolsEnabled: false }),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('budget-duration')), { once: true }))
    ]);
    const usage = response.usage;
    metrics.inputTokens += usage?.inputTokens ?? 0;
    metrics.outputTokens += usage?.outputTokens ?? 0;
    if (!usage) metrics.usageAvailable = false;
    const value = response.result;
    if (value && typeof value === 'object' && !Array.isArray(value) && ['understand', 'investigate', 'reuse'].every(key => Array.isArray((value as Record<string, unknown>)[key]))) {
      plan = { status: 'recorded', runId, initial: value };
    } else {
      plan = { status: 'invalid', runId, error: 'Initial planning response did not contain the expected arrays' };
    }
    recordCall({ type: 'decomposition_plan', name: 'initial-research-plan', inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, usageMissing: !usage, result: plan }, planningStarted, new Date());
  } catch (error) {
    const usage = (error as { usage?: { inputTokens: number; outputTokens: number } }).usage;
    metrics.inputTokens += usage?.inputTokens ?? 0;
    metrics.outputTokens += usage?.outputTokens ?? 0;
    if (!usage) metrics.usageAvailable = false;
    plan = { status: 'invalid', runId, error: String(error) };
    recordCall({ type: 'decomposition_plan', name: 'initial-research-plan', inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, usageMissing: !usage, error: String(error) }, planningStarted, new Date());
    if (controller.signal.aborted) throw error;
  } finally { clearTimeout(timer); }
  const state = await graph.invoke({ messages: [{ role: 'system', content: `${DECOMPOSITION_PROMPT} Initial research plan: ${JSON.stringify(plan.initial ?? null)}

Explore the repository using the tools. Assess whether the evidence answers the objective; if essential evidence is missing, use further tools before returning. Record unresolved gaps in uncertainties. Return only JSON matching this exact shape: {"objective":"...","entryPoints":[{"name":"...","evidence":[{"file":"relative/path","startLine":1,"endLine":1}]}],"components":[{"name":"...","evidence":[{"file":"relative/path","startLine":1,"endLine":1}]}],"relations":[{"from":"...","to":"...","evidence":[{"file":"relative/path","startLine":1,"endLine":1}]}],"uncertainties":["..."]}. Use empty arrays when needed. Each evidence must be an array of objects with real file paths and integer line numbers, not a string. Copy line numbers exactly from tool output (each numbered line, match or range); never estimate, recompute or round them. Do not write a tour.${memoryInstructions}` }, { role: 'user', content: objective }] }, { recursionLimit: Math.ceil(limits.iterations) + 2 });
  const result = state.result === undefined ? { objective, entryPoints: [], components: [], relations: [], uncertainties: [state.stopReason === 'repeated_tool_failure' ? 'Exploration stopped after the same tool call repeatedly failed; no structured result was produced.' : 'Exploration stopped before a structured result was produced.'] } : resultSchema.parse(state.result);
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
  }
  // A direct-primitive investigation can leave no executed procedure to select.
  // Offer bounded synthesis and repair attempts under the same
  // strict sandbox and citation checks as an in-investigation function_try.
  const directCalls = callTrace.filter(call => call.type === 'tool' && primitiveNames.has(call.name) && call.outcome !== 'error');
  const finalRefs = [...result.entryPoints, ...result.components, ...result.relations].flatMap(item => item.evidence);
  const usefulReuse = attempts.some(attempt => attempt.id && attempt.proofValid && !unusableIds.has(attempt.id) && sampleEvidenceRefs(attempt.output, 50).some(ref => finalRefs.some(finalRef => finalRef.file === ref.file && finalRef.startLine <= ref.line && ref.line <= finalRef.endLine)));
  if (library && state.result !== undefined && !state.stopReason && !attempts.some(a => a.candidate?.executionMode === 'strict') && !usefulReuse && directCalls.length && !reason()) {
    const repairs: Array<{ candidate: unknown; error: unknown }> = [];
    for (let round = 0; round < config.limits.memorySynthesisAttempts && !reason(); round++) {
    const started = new Date();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, limits.durationMs - (Date.now() - startedMs)));
    try {
      metrics.modelCalls++;
      progress('consolidate');
      const response = await Promise.race([
        complete([
          { role: 'system', content: 'Review the completed research and direct primitive calls. If a useful reusable procedure can reproduce relevant cited evidence, propose one typed TypeScript function expression using only the ten sandbox primitives. Parameterize meaningful variations; do not merely wrap one primitive. Return JSON {"candidate":null} if none is appropriate, otherwise {"candidate":{"name":"TypeScriptIdentifier","question":"canonical question","description":"ASCII English purpose, scope, output and limits","source":"typed function expression","params":{}}}. Do not invent evidence. The procedure will be executed and validated before selection.' },
          { role: 'user', content: JSON.stringify({ objective, result, catalog: library.catalog(), calls: directCalls.slice(-20).map(call => ({ name: call.name, parameters: call.parameters, result: call.result })), previousAttempts: repairs }) }
        ], { signal: controller.signal, maxOutputTokens: Math.max(1, Math.min(maxOutputTokens, limits.tokens - metrics.inputTokens - metrics.outputTokens)), codeMode: false, memory: false, toolsEnabled: false }),
        new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('budget-duration')), { once: true }))
      ]);
      metrics.inputTokens += response.usage?.inputTokens ?? 0;
      metrics.outputTokens += response.usage?.outputTokens ?? 0;
      if (!response.usage) metrics.usageAvailable = false;
      const proposal = (response.result as { candidate?: unknown } | undefined)?.candidate;
      recordCall({ type: 'model', name: 'memory-synthesis', inputTokens: response.usage?.inputTokens ?? null, outputTokens: response.usage?.outputTokens ?? null, usageMissing: !response.usage, result: { proposed: !!proposal } }, started, new Date());
      if (proposal === null) break;
      if (reason()) break;
      if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
        repairs.push({ candidate: proposal, error: 'Return a candidate object or null.' });
        continue;
      }
      {
        const p = proposal as Record<string, unknown>;
        if (typeof p.source !== 'string' || typeof p.name !== 'string' || typeof p.question !== 'string' || typeof p.description !== 'string' || !p.params || typeof p.params !== 'object' || Array.isArray(p.params)) {
          repairs.push({ candidate: p, error: 'Invalid candidate: name, question, description and source must be strings, and params must be an object.' });
          continue;
        }
        const descriptionCheck = validateDescription(p.description.trim());
        if (!descriptionCheck.ok) {
          repairs.push({ candidate: p, error: descriptionCheck.reason });
          continue;
        }
        const trialStarted = new Date();
        metrics.toolCalls++;
        metrics.functionTries++;
        try {
          const { runScript } = await import('codetour-exploration-sandbox');
          const execution = await runScript({ workspace: root, searchExclude: config.search.exclude, code: p.source, params: p.params, strict: true, includeTrace: true, timeoutMs: Math.min(scriptTimeoutMs, Math.max(1, limits.durationMs - (Date.now() - startedMs))), signal: controller.signal });
          const revision = await resolveRevision();
          const citations = await validateCitations(execution.value, { maxReferences: config.citations.maxReferences, access: citationAccess(tools), revision });
          recordCall({ type: 'function_try', name: 'memory-synthesis-trial', parameters: { name: p.name, question: p.question }, inputTokens: null, outputTokens: null, usageMissing: false, execution: execution.trace, result: citations.status === 'validation_failed' ? citationRepairFeedback(citations).validation : citations, outcome: `executed${citationOutcome(citations)}` }, trialStarted, new Date());
          if (citations.status !== 'valid') {
            repairs.push({ candidate: p, error: citations.status === 'validation_failed' ? citationRepairFeedback(citations) : 'The procedure returned no source references; return cited evidence.' });
          } else {
            const refs = sampleEvidenceRefs(execution.value, 3);
            const proofSignature: string[] = [];
            let proofOk = refs.length > 0;
            for (const ref of refs) {
              try {
                const lines = await tools.read(ref.file, ref.line, ref.line, true);
                const valid = lines.length === 1 && typeof lines[0]?.text === 'string';
                proofSignature.push(`${ref.file}:${ref.line}:${valid ? 'ok' : 'empty'}`);
                if (!valid) proofOk = false;
              } catch { proofSignature.push(`${ref.file}:${ref.line}:unreadable`); proofOk = false; }
            }
            const bounded = boundedOutput(execution.value, { revision, maxItems: config.memoryOutput.maxItems, maxBytes: config.memoryOutput.maxBytes, sourceTruncated: execution.trace.truncated, primitiveDerived: execution.trace.executedCalls.length > 0 });
            attempts.push({ synthesized: true, candidate: { objective: p.question.slice(0, 500), description: p.description.trim(), name: p.name.trim().slice(0, 100), returns: execution.trace.contract.returns, code: p.source, parameters: Object.keys(p.params).slice(0, 30), paramsSchema: execution.trace.contract.paramsSchema, executionMode: 'strict', revision }, params: p.params as Record<string, unknown>, output: execution.value, truncated: Boolean(bounded.truncated), proofValid: refs.length ? proofOk : undefined, proofSignature });
            break;
          }
        } catch (error) {
          recordCall({ type: 'function_try', name: 'memory-synthesis-trial', inputTokens: null, outputTokens: null, usageMissing: false, error: String(error) }, trialStarted, new Date());
          repairs.push({ candidate: p, error: String(error).slice(0, 2000) });
        }
      }
    } catch (error) {
      recordCall({ type: 'model', name: 'memory-synthesis', inputTokens: null, outputTokens: null, usageMissing: true, error: String(error) }, started, new Date());
      break;
    } finally { clearTimeout(timer); }
    }
  }
  // Selection is only attempted when the Tour produced a structured result
  // with valid evidence, no stop reason, at least one admissible candidate and
  // budget left. Record why it was not attempted instead of leaving the
  // reader to re-derive the path through the code.
  const selectionSkip = !library ? null
    : state.stopReason ? `stop_${state.stopReason}`
    : state.result === undefined ? 'no_structured_result'
    : !attempts.some(attempt => attempt.candidate?.executionMode === 'strict' && !abandonedAttempts.has(attempt)) ? 'no_eligible_candidate'
    : reason() ? `budget_${reason()}`
    : null;
  metrics.selectionSkip = selectionSkip;
  let consolidationReport: unknown;
  if (library && state.result !== undefined && !state.stopReason) {
    // Issue #194: every successfully-executed strict function_try trial is
    // auto-submitted to selection — the model considers their contribution and
    // never has to propose with remember. Legacy candidates are refused in the
    // reconciliation loop below and never enter the selection pool.
    const eligible = attempts.filter(attempt => attempt.candidate?.executionMode === 'strict' && !abandonedAttempts.has(attempt));
    let selected = new Set<string>();
    if (eligible.length && !reason()) {
      const selectionStarted = new Date();
      // Issue #194: each auto-submitted candidate carries its code, its output
      // contract and a summary of its result (bounded, truncation flagged).
      const selectionInput = { tour: result, catalog: library.catalog(), executedCandidates: eligible.map(attempt => ({ origin: attempt.synthesized ? 'post-research synthesis' : 'research trial', name: attempt.candidate!.name, question: attempt.candidate!.objective, description: attempt.candidate!.description, paramsSchema: attempt.candidate!.paramsSchema, returns: attempt.candidate!.returns, code: attempt.candidate!.code, output: boundedOutput(attempt.output, { revision: currentRevision ?? 'unknown-revision', sourceTruncated: attempt.truncated }) })) };
      const controller = new AbortController();
      const remaining = Math.max(1, limits.durationMs - (Date.now() - startedMs));
      const timer = setTimeout(() => controller.abort(), remaining);
      try {
        metrics.modelCalls++;
        progress('consolidate');
        const response = await Promise.race([
          complete([
            { role: 'system', content: 'Select executed procedures that contributed to this research or, for post-research synthesis, reproduce relevant cited evidence from it, worked correctly, are clearly documented (purpose, parameters, return and limits), and do not duplicate an existing procedure. Synthesized procedures were not used during research. Project-specific procedures are welcome; do not predict future utility. This result has structural evidence validation only, not semantic verification. Return JSON {"selected":["name"]}; select only from the executed candidates below. You may select none. Compare question, scope, inputs, output and limits with existing entries; prefer reuse over duplicates.' },

            { role: 'user', content: JSON.stringify(selectionInput) }
          ], { signal: controller.signal, maxOutputTokens: Math.max(1, Math.min(maxOutputTokens, limits.tokens - metrics.inputTokens - metrics.outputTokens)), codeMode: false, memory: false, toolsEnabled: false }),
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
    const successful = attempts.filter(a => (!a.id || !unusableIds.has(a.id)) && !abandonedAttempts.has(a) && matches(a.output));
    const candidates: ConsolidationCandidate[] = [];
    for (const attempt of attempts) {
      if (!attempt.candidate || attempt.output == null) continue;
      const candidateName = attempt.candidate.name ?? '';
      if (abandonedAttempts.has(attempt)) {
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
        unreconciled.push({ name: candidateName, proposed: false, replayed: false, accepted: false, reason: 'Not selected by the model for consolidation' });
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
        const { runScript } = await import('codetour-exploration-sandbox');
        const rerun = await runScript({ workspace: root, searchExclude: config.search.exclude, code: attempt.candidate.code, params: attempt.params, strict: true, includeTrace: true, timeoutMs: Math.min(scriptTimeoutMs, remaining) });
        // Every citation is re-checked exactly as it was checked at trial time:
        // every candidate reaching this replay is a strict function_try trial
        // whose output carries mandatory references validated by the #185
        // validator, and the replay re-runs that same exhaustive check. Legacy
        // candidates are refused above, before any replay.
        const citations = await validateCitations(rerun.value, { maxReferences: config.citations.maxReferences, access: citationAccess(tools), revision: await resolveRevision() });
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
        // Only retain candidates whose output contributed to the final evidence.
        verified: matches(attempt.output),
        consolidationSignal: { executedSuccessfully: true, proofAvailable: structuralProof, contractRespected },
        replay,
        revision: attempt.candidate.revision
      });
    }
    const report = await library.finish(successful.flatMap(a => a.id ? [a.id] : []), candidates);
    // The reconciliation log distinguishes proposed, replayed, accepted and
    // rejected with a reason — including candidates the model never selected
    // or that could not be replayed (issues #187 and #194).
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
  if (consolidationReport) {
    const report = consolidationReport as { accepted?: unknown[]; rejected?: unknown[]; reconciliation?: unknown[] };
    progress('consolidation_result', { accepted: report.accepted, rejected: report.rejected, reconciliation: report.reconciliation });
  }
  if (library && metrics.functionTries + metrics.memoryReuses === 0) progress('memory_unused', { note: 'memory enabled but no function_try or memory_run was attempted: nothing can be consolidated' });
  metrics.durationMs = Date.now() - startedMs;
  const stopReason = state.stopReason ?? (plan.status !== 'recorded' ? 'planning_failed' : null);
  const status = state.result === undefined || stopReason ? 'partial' as const : 'complete' as const;
  recordRunEnd(status, stopReason);
  const final = { ...result, runId, plan, status, stopReason, promptSha256: PROMPT_SHA256, modelConfig: model.snapshot?.(), metrics, callTrace, consolidationReport };
  logger.info({ event: 'research_end', result: final });
  return final;
  } catch (error) {
    metrics.durationMs = Date.now() - startedMs;
    recordRunEnd('failed', null);
    logger?.error({ event: 'research_failed', error: String(error), metrics, plan });
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      exploration: { objective, runId, plan, status: 'failed', error: String((error as Error).message ?? error).slice(0, 500), promptSha256: PROMPT_SHA256, modelConfig: model.snapshot?.(), metrics, callTrace }
    });
  } finally { scratch.cleanup(); }
}
