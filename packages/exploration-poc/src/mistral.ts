import type { Model, ToolCall } from './explore.ts';
import { primitiveTools, primitiveNames } from './tool-contract.ts';
import { DEFAULT_CONFIG } from './config.ts';

const tools = [
  { name: 'list', description: 'List workspace files', properties: {} },
  { name: 'search', description: 'Find literal text in workspace files', properties: { query: { type: 'string' } }, required: ['query'] },
  { name: 'read', description: 'Read at most 100 numbered lines of a workspace file', properties: { file: { type: 'string' }, startLine: { type: 'integer' }, endLine: { type: 'integer' } }, required: ['file'] },
  { name: 'git', description: 'Read the latest Git commit', properties: {} }
].map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: { type: 'object', properties: t.properties, required: t.required ?? [] } } }));

export type NamedMemoryTool = { name: string; id: string; parameters: string[]; required?: string[]; description: string };

const INTEGER_PARAMS = new Set(['offset', 'start', 'end', 'startLine', 'endLine']);

export function mistral(apiKey: string, model = DEFAULT_CONFIG.mistral.model, config: { apiUrl?: string; maxRetries?: number; retryBaseDelayMs?: number; temperature?: number; reasoningEffort?: 'low' | 'medium' | 'high' | 'max'; memorySearchId?: string; memorySearchExclusive?: boolean; memorySearchScoped?: boolean; memoryTools?: NamedMemoryTool[]; removeSearch?: boolean; removeCode?: boolean } = {}): Model {
  if (!apiKey) throw new Error('MISTRAL_API_KEY is required');
  const lastRequest = { model: model as string | undefined, temperature: undefined as number | undefined, maxOutputTokens: undefined as number | undefined };
  return {
    snapshot() {
      return { model: lastRequest.model, temperature: lastRequest.temperature, maxOutputTokens: lastRequest.maxOutputTokens };
    },
    async complete(messages, options) {
    const codeTool = { type: 'function', function: { name: 'code', description: 'Evaluate a JavaScript expression using list(), read(file,start,end), search(text) and params. Return compact evidence; set remember, name and description for a reusable method.', parameters: { type: 'object', properties: { code: { type: 'string' }, params: { type: 'object' }, remember: { type: 'boolean' }, name: { type: 'string', description: 'Valid TypeScript identifier. Required when remember=true.' }, description: { type: 'string' }, returns: { type: 'string', description: 'Output contract: returned shape with item fields, e.g. "SearchMatch[] {file,line,text}".' } }, required: ['code'] } } };
    const memoryTools = [
      { type: 'function', function: { name: 'memory_list', description: 'Search canonical questions, scopes, typed parameters, output contracts and limits without reading source.', parameters: { type: 'object', properties: { query: { type: 'string' } } } } },
      { type: 'function', function: { name: 'memory_run', description: 'Run a stored script with new parameters against the current workspace.', parameters: { type: 'object', properties: { id: { type: 'string' }, params: { type: 'object' } }, required: ['id', 'params'] } } },
      { type: 'function', function: { name: 'memory_unusable', description: 'Mark a script executed in this run as unusable for its declared subject. Do not mark an unrelated topic as a failure.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } }
    ];
    const namedTools: NamedMemoryTool[] = config.memoryTools ?? (config.memorySearchId ? [{ name: 'memory_search', id: config.memorySearchId, parameters: config.memorySearchScoped ? ['query', 'pathPrefix', 'offset'] : ['query'], required: ['query'], description: config.memorySearchScoped ? 'Search literal text with optional workspace-relative pathPrefix and offset. Results are paginated; hasMore indicates another page. No prefix searches the workspace.' : 'Run a reusable literal search tested on small synthetic probes. Use it to find a symbol or text in the workspace.' }] : []);
    const namedByName = new Map(namedTools.map(tool => [tool.name, tool]));
    const namedMemory = options?.memory ? namedTools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: { type: 'object', properties: Object.fromEntries(tool.parameters.map(parameter => [parameter, { type: INTEGER_PARAMS.has(parameter) ? 'integer' : 'string' }])), required: tool.required ?? tool.parameters } } })) : [];
    const exclusive = !!(config.memorySearchExclusive && config.memorySearchId);
    const functionTry = { type: 'function', function: { name: 'function_try', description: 'Strictly check TypeScript and execute in QuickJS using only the permanent primitives. A typed function expression receives params. Trials never mutate memory. Default path when memory_list returns nothing and the procedure contributes to this research; otherwise state why not in the final result — never a quota, never a forced creation.', parameters: { type: 'object', properties: { source: { type: 'string' }, params: { type: 'object' }, remember: { type: 'boolean' }, name: { type: 'string' }, question: { type: 'string', description: 'Stable canonical repository question, independent of this Tour wording' }, description: { type: 'string' }, returns: { type: 'string' } }, required: ['source', 'params'] } } };
    // Primitives are direct tools for simple reads; function_try is reserved
    // for procedures that compose several primitives.
    const scratchTool = { type: 'function', function: { name: 'readScratch', description: 'Read a saved tool result by resultId and byte offset. Follow nextOffset for the next page; cite original source files, never scratch.', parameters: { type: 'object', properties: { resultId: { type: 'string' }, offset: { type: 'integer' } }, required: ['resultId', 'offset'] } } };
    // Spec #219: in the Knowledge run the model discovers entries by name and
    // description only and reads one validated Markdown body on request.
    // Memory Functions are absent: no memory_run, no memory_unusable and no
    // function_try tool is offered, and the harness rejects forged invocations
    // at dispatch. The plain `code` tool stays available with --code.
    const knowledgeTools = options?.knowledge ? [
      { type: 'function', function: { name: 'memory_list', description: 'Discover the available Knowledge entries: name and description only (their bodies load on request).', parameters: { type: 'object', properties: { query: { type: 'string' } } } } },
      { type: 'function', function: { name: 'memory_read', description: 'Read one Knowledge entry by exact name: the harness verifies the complete declared evidence contract and returns the validated Markdown body. Knowledge is read, never executed.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } }
    ] : [];
    const availableTools = [...(options?.memory ? primitiveTools : tools).filter(tool => !(exclusive || config.removeSearch) || !['search', 'searchText'].includes(tool.function.name)), scratchTool, ...(options?.codeMode && !exclusive && !config.removeCode ? [options.memory ? functionTry : codeTool] : []), ...(options?.memory ? memoryTools : []), ...(!options?.knowledge ? namedMemory : []), ...knowledgeTools];
    const requestMaxTokens = options?.maxOutputTokens;
    lastRequest.model = model; lastRequest.temperature = config.temperature ?? DEFAULT_CONFIG.mistral.temperature; lastRequest.maxOutputTokens = requestMaxTokens;
    const apiUrl = config.apiUrl ?? DEFAULT_CONFIG.mistral.apiUrl;
    const maxRetries = config.maxRetries ?? DEFAULT_CONFIG.mistral.maxRetries;
    const retryBaseDelayMs = config.retryBaseDelayMs ?? DEFAULT_CONFIG.mistral.retryBaseDelayMs;
    const request = { method: 'POST', signal: options?.signal, headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, ...(options?.toolsEnabled === false ? { response_format: { type: 'json_object' } } : { tools: availableTools }), reasoning_effort: config.reasoningEffort ?? DEFAULT_CONFIG.mistral.reasoningEffort, temperature: config.temperature ?? DEFAULT_CONFIG.mistral.temperature, max_tokens: requestMaxTokens }) };
    let response = await fetch(apiUrl, request);
    for (let retry = 0; response.status === 429 && retry < 3; retry++) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60000) : retryBaseDelayMs * (retry + 1);
      await new Promise<void>((resolve, reject) => {
        if (options?.signal.aborted) { reject(options.signal.reason); return; }
        const timer = setTimeout(() => { options?.signal.removeEventListener('abort', abort); resolve(); }, delay);
        const abort = () => { clearTimeout(timer); reject(options?.signal.reason); };
        options?.signal.addEventListener('abort', abort, { once: true });
      });
      response = await fetch(apiUrl, request);
    }
    if (!response.ok) throw new Error(`Mistral request failed (${response.status})`);
    const data: any = await response.json();
    const message = data.choices?.[0]?.message;
    const usage = typeof data.usage?.prompt_tokens === 'number' && typeof data.usage?.completion_tokens === 'number' ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens } : undefined;
    const reasoningTokens = typeof data.usage?.completion_tokens_details?.reasoning_tokens === 'number' ? data.usage.completion_tokens_details.reasoning_tokens : undefined;
    try {
      // Issue #184: the plan is published as a fenced block labeled `plan` inside
      // the normal reply. Extract it so the harness can record it without a
      // dedicated LLM call, and keep the block out of the final result parse.
      // A malformed block stays a string: the harness records an invalid plan
      // anomaly instead of crashing the provider call.
      const rawContent = Array.isArray(message?.content)
        ? message.content.map((part: any) => typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '').join('')
        : String(message?.content ?? '');
      // Diagnostic: when the joined content fails to parse, the shape of each
      // block and the provider stop reason say whether the model sent
      // reasoning blocks, a generation limit, or an unexpected block type —
      // without capturing or guessing the raw payload.
      const contentShape = Array.isArray(message?.content)
        ? message.content.map((part: any) => typeof part === 'string' ? 'string' : typeof part?.text === 'string' ? 'text' : `type=${String(part?.type ?? 'unknown')};keys=${Object.keys(part ?? {}).join('|')}`)
        : typeof message?.content;
      const finishReason = data.choices?.[0]?.finish_reason ?? null;
      const planBlock = /```plan\s*([\s\S]*?)```/.exec(rawContent);
      let plan: unknown;
      if (planBlock) {
        const block = planBlock[1].trim();
        try { plan = JSON.parse(block); } catch { plan = block; }
      }
      if (message?.tool_calls?.length) return { ...(plan !== undefined ? { plan } : {}), toolCalls: message.tool_calls.map((call: any): ToolCall => {
        const args = JSON.parse(call.function.arguments);
        const named = namedByName.get(call.function.name);
        return named && options?.memory
          ? { id: call.id, name: 'memory_run', arguments: { id: named.id, params: Object.fromEntries(named.parameters.filter(parameter => args[parameter] !== undefined).map(parameter => [parameter, args[parameter]])) } }
          : { id: call.id, name: call.function.name, arguments: args };
      }), usage };
      // Ticket #192: the closing-fence strip must tolerate benign whitespace
      // before the fence (a residual newline left by plan-block removal, case
      // #167) without weakening the typed FinalAnswerNotJson error: only a
      // genuinely non-JSON payload may fail.
      const content = rawContent.replace(/```plan\s*[\s\S]*?```/g, '').replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim();
      let parsedResult: unknown;
      try { parsedResult = JSON.parse(content); } catch {
        // Ten-ticket diagnostic: a bare SyntaxError hides whether the model sent
        // prose or the plan block swallowed everything. A typed error with a
        // content snippet keeps the failure diagnosable and lets the harness
        // attempt one visible recovery instead of dying opaque.
        // The raw reply and the parsed plan travel on the error: the harness
        // recovery must show the model what it actually wrote (its plan block
        // with no JSON after it) and must not lose the plan it published.
        throw Object.assign(new Error(`Final answer is not valid JSON (content after plan extraction: ${content ? JSON.stringify(content.slice(0, 200)) : 'empty'})`), { name: 'FinalAnswerNotJson', rawContent, contentShape, finishReason, reasoningTokens, ...(plan !== undefined ? { plan } : {}) });
      }
      return { ...(plan !== undefined ? { plan } : {}), result: parsedResult, usage };
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { usage });
    }
  } };
}
