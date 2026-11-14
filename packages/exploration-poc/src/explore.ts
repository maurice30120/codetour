import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import { workspace } from './workspace.ts';
import { scriptMemory } from './memory.ts';

const evidence = z.object({ file: z.string().min(1), startLine: z.number().int().positive(), endLine: z.number().int().positive() });
const item = z.object({ name: z.string(), evidence: z.array(evidence).min(1) });
const resultSchema = z.object({ objective: z.string(), entryPoints: z.array(item), components: z.array(item), relations: z.array(z.object({ from: z.string(), to: z.string(), evidence: z.array(evidence).min(1) })), uncertainties: z.array(z.string()) });

export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type Model = { complete(messages: any[], options?: { signal: AbortSignal; maxOutputTokens: number; codeMode: boolean; memory: boolean; queryContract?: boolean }): Promise<{ toolCalls?: ToolCall[]; result?: unknown; usage?: { inputTokens: number; outputTokens: number } }> };
export type Budget = { iterations?: number; calls?: number; tokens?: number; durationMs?: number };
const State = Annotation.Root({ messages: Annotation<any[]>({ reducer: (a, b) => a.concat(b), default: () => [] }), result: Annotation<any>, stopReason: Annotation<string> });

/** An exploration returns validated references, never Tour prose. */
export async function explore({ root, objective, model, budget = {}, codeMode = false, memory }: { root: string; objective: string; model: Model; budget?: Budget; codeMode?: boolean; memory?: { directory: string; validateQuery?: boolean; queryContract?: boolean; deduplicate?: boolean; compactSearch?: boolean } }) {
  if (memory && !codeMode) throw new Error('Script memory requires Code Mode');
  const limits = { iterations: budget.iterations ?? 8, calls: budget.calls ?? 32, tokens: budget.tokens ?? 32000, durationMs: budget.durationMs ?? 60000 };
  if (Object.values(limits).some(n => !Number.isFinite(n) || n <= 0)) throw new Error('Budgets must be positive');
  const started = Date.now();
  const metrics = { inputTokens: 0, outputTokens: 0, usageAvailable: true, modelCalls: 0, toolCalls: 0, durationMs: 0, outputBytes: 0, cost: null as number | null, memoryReuses: 0, memoryPurges: 0, memoryQueryRejects: 0, memoryResultsCompacted: 0, memoryResultsRepeated: 0 };
  const tools = await workspace(root);
  const library = memory ? await scriptMemory(root, memory.directory, { deduplicate: memory.deduplicate }) : undefined;
  const attempts: { id?: string; candidate?: { objective: string; description: string; code: string; parameters: string[] }; params?: Record<string, unknown>; output: unknown }[] = [];
  const unusableIds = new Set<string>();
  const previousSearchOutputs = new Map<string, { content: string; toolCallId: string }>();
  const reason = () => Date.now() - started >= limits.durationMs ? 'duration' : metrics.inputTokens + metrics.outputTokens >= limits.tokens ? 'tokens' : metrics.modelCalls + metrics.toolCalls >= limits.calls ? 'calls' : metrics.modelCalls >= limits.iterations ? 'iterations' : undefined;
  const graph = new StateGraph(State).addNode('model', async state => {
    const stopped = reason();
    if (stopped) return { stopReason: stopped };
    const controller = new AbortController();
    const remainingMs = Math.max(1, limits.durationMs - (Date.now() - started));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: Awaited<ReturnType<Model['complete']>>;
    try {
      metrics.modelCalls++;
      response = await Promise.race([
        model.complete(state.messages, { signal: controller.signal, maxOutputTokens: Math.max(1, Math.min(4096, limits.tokens - metrics.inputTokens - metrics.outputTokens)), codeMode, memory: !!library, queryContract: memory?.queryContract }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('budget-duration')); }, remainingMs); })
      ]);
    } catch (error) {
      if (controller.signal.aborted) return { stopReason: 'duration' };
      throw error;
    } finally { if (timer) clearTimeout(timer); }
    metrics.inputTokens += response.usage?.inputTokens ?? 0;
    metrics.outputTokens += response.usage?.outputTokens ?? 0;
    if (!response.usage) metrics.usageAvailable = false;
    if (response.result !== undefined) return { result: response.result, stopReason: Date.now() - started >= limits.durationMs ? 'duration' : metrics.inputTokens + metrics.outputTokens > limits.tokens ? 'tokens' : undefined };
    if (!response.toolCalls?.length) throw new Error('Model returned neither tools nor result');
    const calls = response.toolCalls.slice(0, Math.max(0, Math.min(8, limits.calls - metrics.modelCalls - metrics.toolCalls)));
    const outputs: any[] = [{ role: 'assistant', tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) }];
    for (const call of calls) {
      if (Date.now() - started >= limits.durationMs || metrics.inputTokens + metrics.outputTokens >= limits.tokens) break;
      metrics.toolCalls++;
      let output: unknown;
      let attempt: typeof attempts[number] | undefined;
      try {
        if (call.name === 'list') output = await tools.list();
        else if (call.name === 'search' && typeof call.arguments.query === 'string') output = await tools.search(call.arguments.query);
        else if (call.name === 'read' && typeof call.arguments.file === 'string') {
          const start = Number(call.arguments.startLine ?? 1);
          output = await tools.read(call.arguments.file, start, Number(call.arguments.endLine ?? start + 99));
        }
        else if (call.name === 'git') output = await tools.git(limits.durationMs - (Date.now() - started));
        else if (library && call.name === 'memory_list') output = library.catalog();
        else if (library && call.name === 'memory_unusable' && typeof call.arguments.id === 'string') {
          const id = call.arguments.id;
          if (!attempts.some(a => a.id === id)) throw new Error('Script must have been executed in this run');
          unusableIds.add(id);
          output = { recordedAfterValidation: true };
        }
        else if (codeMode && ((call.name === 'code' && typeof call.arguments.code === 'string') || (library && call.name === 'memory_run' && typeof call.arguments.id === 'string'))) {
          const stored = call.name === 'memory_run' ? library?.get(String(call.arguments.id)) : undefined;
          if (call.name === 'memory_run' && !stored) throw new Error('Unknown script');
          const code = stored?.code ?? String(call.arguments.code);
          const params = call.arguments.params ?? {};
          if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Invalid parameters');
          const remaining = limits.durationMs - (Date.now() - started);
          if (remaining <= 0) return { messages: outputs, stopReason: 'duration' };
          const { runScript } = await import('../../exploration-sandbox/index.js');
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), remaining);
          try {
            if (stored) metrics.memoryReuses++;
            output = await runScript({ workspace: root, code, params, scripts: library?.sources(), timeoutMs: Math.min(5000, remaining), signal: controller.signal });
            if (stored && memory?.compactSearch && stored.code === 'search(params.query)' && Array.isArray(output)) {
              const matches = output.slice(0, 8).map((item: any) => ({ ...item, text: typeof item.text === 'string' ? item.text.slice(0, 240) : item.text, textTruncated: typeof item.text === 'string' && item.text.length > 240 }));
              const compact = { matches, returned: matches.length, observed: output.length, truncated: output.length > matches.length, searchIsBounded: true };
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
            let candidate = library && !stored && call.arguments.remember === true && description ? { objective: objective.slice(0, 500), description, code, parameters: Object.keys(params).slice(0, 30) } : undefined;
            if (candidate && memory?.queryContract && call.arguments.contract === 'literal_query') {
              const { probeLiteralQuery } = await import('./query-probe.mjs');
              const validation = await probeLiteralQuery(code, library!.sources(), started + limits.durationMs);
              if (validation.status !== 'pass') candidate = undefined;
              output = { result: output, memoryValidation: { status: validation.status, reason: validation.reason ?? 'Two matching queries and an absent query passed.' } };
            }
            if (library && (stored || candidate)) attempt = { id: stored?.id, candidate, params: params as Record<string, unknown>, output };
          } catch (error) {
            if (stored && !controller.signal.aborted) await library!.failure(stored.id);
            throw error;
          }
          finally { clearTimeout(timer); }
        }
        else throw new Error('Unknown tool or invalid arguments');
      } catch { output = { error: 'Tool failed or arguments rejected' }; }
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
  const memoryInstructions = library ? ` Script memory is enabled. Available scripts: ${JSON.stringify(library.catalog())}. If a listed script can help, call memory_run with its id and suitable params before using other search tools. You may compose stored scripts inside a code expression using script(id, params), e.g. script("ID", {query: params.query}); replace ID with an actual catalog id. Otherwise start by finding a relevant symbol with code, set remember=true, and give the reusable method a generic description. Use a JavaScript expression, not statements; list() returns paths, search(text) returns {file,line,text}, and read(file,start,end) returns {file,start,lines}. Make each script a small composable operation with one purpose, clear inputs and compact file/line outputs; combine operations across calls when useful. Put changing values in params AND reference them in code: for example {"code":"search(params.query)","params":{"query":"symbol"},"remember":true,"description":"Find literal occurrences"}. Replace symbol with the actual search term. Never hardcode the query in the code when it is supplied in params. You can read additional context after a search. If a stored script was selected for its declared subject but returned an unusable output, call memory_unusable; do not do so for an unrelated subject.${memory?.queryContract ? ' When remembering a generic literal search that accepts only params.query and returns source references, set contract to literal_query. Its tool output includes memoryValidation; if it fails or is inconclusive, fix the expression and try again. Other methods should not declare this contract.' : ''}` : '';
  const state = await graph.invoke({ messages: [{ role: 'system', content: `Explore the repository using the tools. Assess whether the evidence answers the objective; if essential evidence is missing, use further tools before returning. Record unresolved gaps in uncertainties. Return only JSON matching this exact shape: {"objective":"...","entryPoints":[{"name":"...","evidence":[{"file":"relative/path","startLine":1,"endLine":1}]}],"components":[{"name":"...","evidence":[{"file":"relative/path","startLine":1,"endLine":1}]}],"relations":[{"from":"...","to":"...","evidence":[{"file":"relative/path","startLine":1,"endLine":1}]}],"uncertainties":["..."]}. Use empty arrays when needed. Each evidence must be an array of objects with real file paths and integer line numbers, not a string. Do not write a tour.${memoryInstructions}` }, { role: 'user', content: objective }] });
  const result = state.result === undefined ? { objective, entryPoints: [], components: [], relations: [], uncertainties: ['Exploration stopped before a structured result was produced.'] } : resultSchema.parse(state.result);
  for (const e of [...result.entryPoints, ...result.components, ...result.relations].flatMap(x => x.evidence)) {
    const lines = await tools.read(e.file, e.startLine, e.endLine, true);
    if (lines.length !== e.endLine - e.startLine + 1) throw new Error('Evidence points outside a file');
  }
  if (library && state.result !== undefined) {
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
    for (const id of unusableIds) await library.failure(id);
    const successful = attempts.filter(a => (!a.id || !unusableIds.has(a.id)) && matches(a.output));
    const candidates: { objective: string; description: string; code: string; parameters: string[]; verified: boolean }[] = [];
    for (const attempt of attempts) {
      if (!attempt.candidate || attempt.output == null) continue;
      // Optional counterfactual check: only a nonempty unchanged result proves this
      // particular probe cannot distinguish queries. Empty/error probes are inconclusive.
      if (memory?.validateQuery && typeof attempt.params?.query === 'string' && Array.isArray(attempt.output) && attempt.output.length > 0) {
        const remaining = limits.durationMs - (Date.now() - started);
        if (remaining > 0) {
          try {
            const { runScript } = await import('../../exploration-sandbox/index.js');
            const query = `__codetour_missing_${crypto.randomUUID()}__`;
            const probe = await runScript({ workspace: root, code: attempt.candidate.code, params: { ...attempt.params, query }, scripts: library.sources(), timeoutMs: Math.min(5000, remaining) });
            if (JSON.stringify(probe) === JSON.stringify(attempt.output)) { metrics.memoryQueryRejects++; continue; }
          } catch { /* A failed probe is inconclusive, not proof of a bad script. */ }
        }
      }
      candidates.push({ ...attempt.candidate, verified: matches(attempt.output) });
    }
    await library.finish(successful.flatMap(a => a.id ? [a.id] : []), candidates);
  }
  if (library) metrics.memoryPurges = library.purges();
  metrics.durationMs = Date.now() - started;
  return { ...result, status: state.result === undefined || state.stopReason ? 'partial' : 'complete', stopReason: state.stopReason ?? null, metrics };
}
