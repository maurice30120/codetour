import type { Model, ToolCall } from './explore.ts';
import { primitiveTools } from './tool-contract.ts';

const tools = [
  { name: 'list', description: 'List workspace files', properties: {} },
  { name: 'search', description: 'Find literal text in workspace files', properties: { query: { type: 'string' } }, required: ['query'] },
  { name: 'read', description: 'Read at most 100 numbered lines of a workspace file', properties: { file: { type: 'string' }, startLine: { type: 'integer' }, endLine: { type: 'integer' } }, required: ['file'] },
  { name: 'git', description: 'Read the latest Git commit', properties: {} }
].map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: { type: 'object', properties: t.properties, required: t.required ?? [] } } }));

export type NamedMemoryTool = { name: string; id: string; parameters: string[]; required?: string[]; description: string };

const INTEGER_PARAMS = new Set(['offset', 'start', 'end', 'startLine', 'endLine']);

export function mistral(apiKey: string, model = 'mistral-small-latest', config: { temperature?: number; memorySearchId?: string; memorySearchExclusive?: boolean; memorySearchScoped?: boolean; memoryTools?: NamedMemoryTool[]; removeSearch?: boolean; removeCode?: boolean } = {}): Model {
  if (!apiKey) throw new Error('MISTRAL_API_KEY is required');
  const lastRequest = { model: model as string | undefined, temperature: undefined as number | undefined, maxOutputTokens: undefined as number | undefined };
  return {
    snapshot() {
      return { model: lastRequest.model, temperature: lastRequest.temperature, maxOutputTokens: lastRequest.maxOutputTokens };
    },
    async complete(messages, options) {
    const codeTool = { type: 'function', function: { name: 'code', description: 'Evaluate a JavaScript expression using list(), read(file,start,end), search(text) and params. Return compact evidence; set remember, name and description for a reusable method.', parameters: { type: 'object', properties: { code: { type: 'string' }, params: { type: 'object' }, remember: { type: 'boolean' }, name: { type: 'string', description: 'Canonical name, camelCase verbe+domaine+objet (e.g. searchPostgresSymbols). Required when remember=true.' }, description: { type: 'string' }, returns: { type: 'string', description: 'Output contract: returned shape with item fields, e.g. "SearchMatch[] {file,line,text}".' }, ...(options?.queryContract ? { contract: { type: 'string', enum: ['literal_query'], description: 'Declare only for a generic literal search taking params.query and returning file and line references.' } } : {}) }, required: ['code'] } } };
    const memoryTools = [
      { type: 'function', function: { name: 'memory_list', description: 'Search canonical questions, scopes, typed parameters, output contracts and limits without reading source.', parameters: { type: 'object', properties: { query: { type: 'string' } } } } },
      { type: 'function', function: { name: 'memory_run', description: 'Run a stored script with new parameters against the current workspace.', parameters: { type: 'object', properties: { id: { type: 'string' }, params: { type: 'object' } }, required: ['id', 'params'] } } },
      { type: 'function', function: { name: 'memory_unusable', description: 'Mark a script executed in this run as unusable for its declared subject. Do not mark an unrelated topic as a failure.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } }
    ];
    const namedTools: NamedMemoryTool[] = config.memoryTools ?? (config.memorySearchId ? [{ name: 'memory_search', id: config.memorySearchId, parameters: config.memorySearchScoped ? ['query', 'pathPrefix', 'offset'] : ['query'], required: ['query'], description: config.memorySearchScoped ? 'Search literal text with optional workspace-relative pathPrefix and offset. Results are paginated; hasMore indicates another page. No prefix searches the workspace.' : 'Run a reusable literal search tested on small synthetic probes. Use it to find a symbol or text in the workspace.' }] : []);
    const namedByName = new Map(namedTools.map(tool => [tool.name, tool]));
    const namedMemory = options?.memory ? namedTools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: { type: 'object', properties: Object.fromEntries(tool.parameters.map(parameter => [parameter, { type: INTEGER_PARAMS.has(parameter) ? 'integer' : 'string' }])), required: tool.required ?? tool.parameters } } })) : [];
    const exclusive = !!(config.memorySearchExclusive && config.memorySearchId);
    const functionTry = { type: 'function', function: { name: 'function_try', description: 'Strictly check TypeScript and execute in QuickJS using only the ten permanent primitives. A typed function expression receives params. Trials never mutate memory.', parameters: { type: 'object', properties: { source: { type: 'string' }, params: { type: 'object' }, remember: { type: 'boolean' }, name: { type: 'string' }, question: { type: 'string', description: 'Stable canonical repository question, independent of this Tour wording' }, description: { type: 'string' }, returns: { type: 'string' } }, required: ['source', 'params'] } } };
    const availableTools = [...(options?.memory ? primitiveTools : tools).filter(tool => !(exclusive || config.removeSearch) || !['search', 'searchText'].includes(tool.function.name)), ...(options?.codeMode && !exclusive && !config.removeCode ? [options.memory ? functionTry : codeTool] : []), ...(options?.memory ? memoryTools : []), ...namedMemory];
    const requestMaxTokens = options?.maxOutputTokens;
    lastRequest.model = model; lastRequest.temperature = config.temperature ?? 0; lastRequest.maxOutputTokens = requestMaxTokens;
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', { method: 'POST', signal: options?.signal, headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, tools: availableTools, temperature: config.temperature ?? 0, max_tokens: requestMaxTokens }) });
    if (!response.ok) throw new Error(`Mistral request failed (${response.status})`);
    const data: any = await response.json();
    const message = data.choices?.[0]?.message;
    const usage = typeof data.usage?.prompt_tokens === 'number' && typeof data.usage?.completion_tokens === 'number' ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens } : undefined;
    try {
      if (message?.tool_calls?.length) return { toolCalls: message.tool_calls.map((call: any): ToolCall => {
        const args = JSON.parse(call.function.arguments);
        const named = namedByName.get(call.function.name);
        return named && options?.memory
          ? { id: call.id, name: 'memory_run', arguments: { id: named.id, params: Object.fromEntries(named.parameters.filter(parameter => args[parameter] !== undefined).map(parameter => [parameter, args[parameter]])) } }
          : { id: call.id, name: call.function.name, arguments: args };
      }), usage };
      const content = String(message?.content ?? '').replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      return { result: JSON.parse(content), usage };
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { usage });
    }
  } };
}
