import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import { workspace } from './workspace.ts';
import { scriptMemory } from './memory.ts';
import type { ConsolidationCandidate, ReplacementVerification } from './memory.ts';
import { boundedOutput, looksLikeEvidence, sampleEvidenceRefs } from './memory-output.ts';
import { DECOMPOSITION_PROMPT, PROMPT_SHA256 } from './decomposition-prompt.ts';
import { primitiveNames } from './tool-contract.ts';

const evidence = z.object({ file: z.string().min(1), startLine: z.number().int().positive(), endLine: z.number().int().positive() });
const item = z.object({ name: z.string(), evidence: z.array(evidence).min(1) });
const resultSchema = z.object({ objective: z.string(), entryPoints: z.array(item), components: z.array(item), relations: z.array(z.object({ from: z.string(), to: z.string(), evidence: z.array(evidence).min(1) })), uncertainties: z.array(z.string()) });

export { DECOMPOSITION_PROMPT, PROMPT_SHA256 };

export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type Model = { complete(messages: any[], options?: { signal: AbortSignal; maxOutputTokens: number; codeMode: boolean; memory: boolean; queryContract?: boolean }): Promise<{ toolCalls?: ToolCall[]; result?: unknown; usage?: { inputTokens: number; outputTokens: number } }> };
export type Budget = { iterations?: number; calls?: number; tokens?: number; durationMs?: number };
const State = Annotation.Root({ messages: Annotation<any[]>({ reducer: (a, b) => a.concat(b), default: () => [] }), result: Annotation<any>, stopReason: Annotation<string> });

/** Per-call usage/telemetry trace: real timestamps, real durations, provider usage. */
export interface CallTraceItem {
  seq: number;
  type: 'model' | 'tool' | 'memory_run' | 'memory_list' | 'function_try';
  name: string;
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
}

interface Attempt {
  id?: string;
  candidate?: { objective: string; description: string; name?: string; returns?: string; code: string; parameters: string[]; paramsSchema?: Array<{ name: string; type: string }>; executionMode?: 'strict' | 'legacy'; revision?: string };
  params?: Record<string, unknown>;
  output: unknown;
  proofValid?: boolean;
  proofSignature?: string[];
}

/** An exploration returns validated references, never Tour prose. */
export async function explore({ root, objective, model, budget = {}, codeMode = false, memory }: { root: string; objective: string; model: Model; budget?: Budget; codeMode?: boolean; memory?: { directory: string; validateQuery?: boolean; queryContract?: boolean; deduplicate?: boolean; compactSearch?: boolean } }) {
  if (memory && !codeMode) throw new Error('Script memory requires Code Mode');
  const limits = { iterations: budget.iterations ?? 8, calls: budget.calls ?? 32, tokens: budget.tokens ?? 32000, durationMs: budget.durationMs ?? 60000 };
  if (Object.values(limits).some(n => !Number.isFinite(n) || n <= 0)) throw new Error('Budgets must be positive');
  const startedMs = Date.now();
  const metrics = { inputTokens: 0, outputTokens: 0, usageAvailable: true, modelCalls: 0, toolCalls: 0, durationMs: 0, outputBytes: 0, cost: null as number | null, memoryReuses: 0, memoryPurges: 0, memoryQueryRejects: 0, memoryResultsCompacted: 0, memoryResultsRepeated: 0 };
  const callTrace: CallTraceItem[] = [];
  let callSeq = 0;
  const recordCall = (base: Omit<CallTraceItem, 'seq' | 'startedAt' | 'endedAt' | 'durationMs' | 'startedAt'>, startedAt: Date, endedAt: Date): void => {
    callTrace.push({ ...base, seq: callSeq++, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationMs: endedAt.getTime() - startedAt.getTime() });
  };
  try {
  const tools = await workspace(root);
  const library = memory ? await scriptMemory(root, memory.directory, { deduplicate: memory.deduplicate }) : undefined;
  // Background revision lookup (lazily filled): used for staleness + sourcing.
  let currentRevision: string | undefined;
  const resolveRevision = async (): Promise<string> => {
    if (currentRevision !== undefined) return currentRevision;
    try { currentRevision = String(await tools.git(limits.durationMs)).split('\n')[0].trim() || 'unknown-revision'; }
    catch { currentRevision = 'unknown-revision'; }
    return currentRevision;
  };
  const attempts: Attempt[] = [];
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
      recordCall({ type: 'model', name: 'model', inputTokens: null, outputTokens: null, usageMissing: true, error: controller.signal.aborted ? 'budget-duration' : String(error) }, modelCallStarted, new Date());
      if (controller.signal.aborted) return { stopReason: 'duration' };
      throw error;
    } finally { if (timer) clearTimeout(timer); }
    const modelCallEnded = new Date();
    const inputTokens = response.usage?.inputTokens ?? null;
    const outputTokens = response.usage?.outputTokens ?? null;
    recordCall({ type: 'model', name: 'model', inputTokens, outputTokens, usageMissing: !response.usage }, modelCallStarted, modelCallEnded);
    metrics.inputTokens += inputTokens ?? 0;
    metrics.outputTokens += outputTokens ?? 0;
    if (!response.usage) metrics.usageAvailable = false;
    if (response.result !== undefined) return { result: response.result, stopReason: Date.now() - startedMs >= limits.durationMs ? 'duration' : metrics.inputTokens + metrics.outputTokens > limits.tokens ? 'tokens' : undefined };
    if (!response.toolCalls?.length) throw new Error('Model returned neither tools nor result');
    const calls = response.toolCalls.slice(0, Math.max(0, Math.min(8, limits.calls - metrics.modelCalls - metrics.toolCalls)));
    const outputs: any[] = [{ role: 'assistant', tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) }];
    for (const call of calls) {
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
          output = boundedOutput(execution.value, { revision: await resolveRevision(), sourceTruncated: execution.trace.truncated, primitiveDerived: true });
        }
        else if (call.name === 'list') output = await tools.list();
        else if (call.name === 'search' && typeof call.arguments.query === 'string') output = await tools.search(call.arguments.query);
        else if (call.name === 'read' && typeof call.arguments.file === 'string') {
          const start = Number(call.arguments.startLine ?? 1);
          output = await tools.read(call.arguments.file, start, Number(call.arguments.endLine ?? start + 99));
        }
        else if (call.name === 'git') output = await tools.git(limits.durationMs - (Date.now() - startedMs));
        else if (library && call.name === 'memory_list') output = library.memory_list(typeof call.arguments.query === 'string' ? call.arguments.query : undefined);
        else if (library && call.name === 'memory_unusable' && typeof call.arguments.id === 'string') {
          const id = call.arguments.id;
          if (!attempts.some(a => a.id === id)) throw new Error('Script must have been executed in this run');
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
            recordCall({ type: scriptCall.type, name: scriptCall.name, inputTokens: null, outputTokens: null, usageMissing: false, execution: execution.trace, outcome: `returned=${bounded.returned}${bounded.truncated ? '; TRUNCATED, not exhaustive' : ''}` }, runStarted, runEnded);
            output = output && typeof output === 'object' && 'staleness' in (output as Record<string, unknown>) ? { ...(output as Record<string, unknown>), result: bounded } : bounded;
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
            const description = typeof call.arguments.description === 'string' ? call.arguments.description.trim().slice(0, 300) : '';
            const name = typeof call.arguments.name === 'string' ? call.arguments.name.trim().slice(0, 100) : '';
            const returns = typeof call.arguments.returns === 'string' ? call.arguments.returns.trim().slice(0, 300) : undefined;
            // The model only sees the bounded output: when the bounding stage
            // truncated the raw result, references may be hidden from the proposal
            // decision — such an attempt is never offered for consolidation.
            const viewTruncated = Boolean((bounded as { truncated?: boolean } | null)?.truncated);
            let candidate = library && !stored && call.arguments.remember === true && description && !viewTruncated
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
            recordCall({ type: scriptCall?.type ?? 'function_try', name: call.name === 'memory_run' ? String(call.arguments.id ?? call.name) : 'function_try', inputTokens: null, outputTokens: null, usageMissing: false, error: String(error) }, runStarted, new Date());
            if (stored) runtimeFailures.push(stored.id);
            throw error;
          }
          finally { clearTimeout(timer); }
        }
        else throw new Error('Unknown tool or invalid arguments');
      } catch (error) { output = { error: String((error as Error).message ?? error).slice(0, 500) }; }
      if (!scriptCall) {
        // Plain primitives and memory catalogue calls: real timestamps and durations.
        const toolEnded = new Date();
        recordCall({ type: call.name === 'memory_list' ? 'memory_list' : 'tool', name: call.name, inputTokens: null, outputTokens: null, usageMissing: false, outcome: summarizeOutcome(output) }, toolStarted, toolEnded);
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
  const memoryInstructions = library ? ` Script memory is enabled. memory_list(query) returns the catalogue WITHOUT function source code: id (canonical camelCase name), objective (canonical question), description (périmètre), typed params, output contract, limits and uncertainty cases. Available entries: ${JSON.stringify(library.catalog())}. If a listed function can help, call memory_run with its id and suitable params, verify its proofs, and complete only what is missing. If a permanent primitive suffices, use it directly without creating a procedure. The ten primitives are listFiles, searchText, searchIdentifiers, readLines, readAround, listSymbols, findDefinitions, findReferences, getImports and getGitDiff. Only a missing reusable functional question warrants function_try(source, params). Use a TypeScript function expression with typed inputs; the harness passes params to it. searchText(query) returns {file,line,text}[], readLines(file,start,end) returns {file,start,lines}, and listFiles() returns paths. Name useful procedures camelCase verbe+domaine+objet and parameterize variations. Supply question as a stable canonical question independent of this Tour, description as its scope, and remember=true only to propose an executed trial for post-Tour selection. Do not wrap a primitive merely to remember it. Combine independent outputs in your Tour logic; never call one memorized procedure from another. Syntactic matches are candidates, not proven semantic relations; report missing evidence as uncertainty. If a stored function was selected for its declared subject but returned unusable output, call memory_unusable.` : '';
  const state = await graph.invoke({ messages: [{ role: 'system', content: `${DECOMPOSITION_PROMPT}

Explore the repository using the tools. Assess whether the evidence answers the objective; if essential evidence is missing, use further tools before returning. Record unresolved gaps in uncertainties. Return only JSON matching this exact shape: {"objective":"...","entryPoints":[{"name":"...","evidence":[{"file":"relative/path","startLine":1,"endLine":1}]}],"components":[{"name":"...","evidence":[{"file":"relative/path","startLine":1,"endLine":1}]}],"relations":[{"from":"...","to":"...","evidence":[{"file":"relative/path","startLine":1,"endLine":1}]}],"uncertainties":["..."]}. Use empty arrays when needed. Each evidence must be an array of objects with real file paths and integer line numbers, not a string. Do not write a tour.${memoryInstructions}` }, { role: 'user', content: objective }] });
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
    const eligible = attempts.filter(attempt => attempt.candidate?.executionMode === 'strict');
    let selected = new Set<string>();
    if (eligible.length && !reason()) {
      const selectionStarted = new Date();
      const controller = new AbortController();
      const remaining = Math.max(1, limits.durationMs - (Date.now() - startedMs));
      const timer = setTimeout(() => controller.abort(), remaining);
      try {
        metrics.modelCalls++;
        const response = await Promise.race([
          model.complete([
            { role: 'system', content: 'Select useful executed procedures for future Tours. This Tour has passed structural evidence validation only, not semantic verification. Return JSON {"selected":["canonicalName"]}; select only from the executed candidates below. You may select none. Compare canonical question, scope, inputs, output and limits with existing entries; prefer reuse over equivalent duplicates.' },
            { role: 'user', content: JSON.stringify({ tour: result, catalog: library.catalog(), executedCandidates: eligible.map(attempt => ({ name: attempt.candidate!.name, question: attempt.candidate!.objective, description: attempt.candidate!.description, paramsSchema: attempt.candidate!.paramsSchema, returns: attempt.candidate!.returns, output: boundedOutput(attempt.output, { revision: currentRevision ?? 'unknown-revision' }) })) }) }
          ], { signal: controller.signal, maxOutputTokens: Math.max(1, Math.min(1024, limits.tokens - metrics.inputTokens - metrics.outputTokens)), codeMode: false, memory: false }),
          new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('budget-duration')), { once: true }))
        ]);
        const usage = response.usage;
        metrics.inputTokens += usage?.inputTokens ?? 0;
        metrics.outputTokens += usage?.outputTokens ?? 0;
        if (!usage) metrics.usageAvailable = false;
        recordCall({ type: 'model', name: 'memory-selection', inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, usageMissing: !usage }, selectionStarted, new Date());
        const names = (response.result as { selected?: unknown })?.selected;
        if (Array.isArray(names) && !reason()) selected = new Set(names.filter((name): name is string => typeof name === 'string'));
      } catch (error) {
        metrics.usageAvailable = false;
        recordCall({ type: 'model', name: 'memory-selection', inputTokens: null, outputTokens: null, usageMissing: true, error: String(error) }, selectionStarted, new Date());
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
    const successful = attempts.filter(a => (!a.id || !unusableIds.has(a.id)) && matches(a.output));
    const candidates: ConsolidationCandidate[] = [];
    for (const attempt of attempts) {
      if (!attempt.candidate || attempt.output == null) continue;
      if (attempt.candidate.executionMode === 'strict') {
        if (!selected.has(attempt.candidate.name ?? '')) continue;
        const remaining = limits.durationMs - (Date.now() - startedMs);
        if (remaining <= 0) continue;
        const verificationStarted = new Date();
        try {
          const { runScript } = await import('../../exploration-sandbox/index.js');
          const rerun = await runScript({ workspace: root, code: attempt.candidate.code, params: attempt.params, strict: true, includeTrace: true, timeoutMs: Math.min(5000, remaining) });
          recordCall({ type: 'function_try', name: 'consolidation-validation', inputTokens: null, outputTokens: null, usageMissing: false, execution: rerun.trace, outcome: 'reexecuted' }, verificationStarted, new Date());
          if (JSON.stringify(rerun.value) !== JSON.stringify(attempt.output)) continue;
        } catch (error) {
          recordCall({ type: 'function_try', name: 'consolidation-validation', inputTokens: null, outputTokens: null, usageMissing: false, error: String(error) }, verificationStarted, new Date());
          continue;
        }
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
      // Replacement proposal: same canonical name slot, different code (the model
      // refined a procedure). The old version's behaviour must be re-proven first.
      const ownProofOk = attempt.proofValid !== false && looksLikeEvidence(attempt.output);
      const existing = attempt.candidate.name ? library.get(attempt.candidate.name) : undefined;
      const replaces = existing && existing.code !== attempt.candidate.code ? existing.id : undefined;
      let regression: ReplacementVerification | undefined;
      if (replaces) regression = await verifyRegressionCandidate({ candidate: attempt.candidate, existing, ownProofOk, remaining: limits.durationMs - (Date.now() - startedMs), root, library });
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
        replaces,
        regression,
        revision: attempt.candidate.revision
      });
    }
    consolidationReport = await library.finish(successful.flatMap(a => a.id ? [a.id] : []), candidates);
  }
  if (library) {
    // Purge counters are read once, after the single end-of-run mutation.
    metrics.memoryPurges = library.purges();
  }
  metrics.durationMs = Date.now() - startedMs;
  return { ...result, status: state.result === undefined || state.stopReason ? 'partial' : 'complete', stopReason: state.stopReason ?? null, promptSha256: PROMPT_SHA256, metrics, callTrace, consolidationReport };
  } catch (error) {
    metrics.durationMs = Date.now() - startedMs;
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      exploration: { objective, status: 'failed', error: String((error as Error).message ?? error).slice(0, 500), promptSha256: PROMPT_SHA256, metrics, callTrace }
    });
  }
}

/**
 * Replacement gate (issue #174 complement): before replacing a stored function,
 * the candidate must be verified on its OWN params (already executed during
 * this run — its spot-checked proofs drive candidateProofOk) AND on a
 * representative reference test set covering the old version's behaviour.
 * Every execution must produce valid structural proofs. The old entry is
 * retained (rollback) until all of them pass.
 */
async function verifyRegressionCandidate({ candidate, existing, ownProofOk, remaining, root, library }: { candidate: { code: string; parameters: string[] }; existing: { id: string; referenceCases: Array<{ params: Record<string, unknown>; ok: boolean }> }; ownProofOk: boolean; remaining: number; root: string; library: { sources: () => Record<string, string> } }): Promise<ReplacementVerification> {
  const referenceCases = (existing.referenceCases ?? []).filter(referenceCase => referenceCase.ok !== false).slice(0, 3);
  if (remaining <= 0 || referenceCases.length === 0) {
    return { candidateProofOk: ownProofOk, referenceProofOk: false, executedParamSets: ownProofOk ? 1 : 0, noReferenceCases: referenceCases.length === 0 };
  }
  const { runScript } = await import('../../exploration-sandbox/index.js');
  let referenceProofOk = true;
  let executedParamSets = 0;
  for (const referenceCase of referenceCases) {
    try {
      const probe = await runScript({ workspace: root, code: candidate.code, params: referenceCase.params, scripts: library.sources(), timeoutMs: 5000 });
      executedParamSets++;
      const ok = probe !== undefined && probe !== null && looksLikeEvidence(probe);
      if (!ok) referenceProofOk = false;
    } catch {
      executedParamSets++;
      referenceProofOk = false;
    }
  }
  return { candidateProofOk: ownProofOk, referenceProofOk: referenceProofOk && executedParamSets === referenceCases.length, executedParamSets: executedParamSets + (ownProofOk ? 1 : 0), noReferenceCases: false };
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
