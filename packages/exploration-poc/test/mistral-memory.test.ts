import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mistral } from '../src/mistral.ts';

test('named memory tool maps its parameters to the selected memory script', async () => {
  const original = globalThis.fetch;
  let body: any;
  try {
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'call1', function: { name: 'memory_search', arguments: '{"query":"alpha"}' } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    };
    const model = mistral('test-key', 'test-model', { memorySearchId: '1234567890abcdef', memorySearchExclusive: true });
    const response = await model.complete([], { signal: new AbortController().signal, maxOutputTokens: 100, codeMode: true, memory: true });
    assert.ok(body.tools.some((tool: any) => tool.function.name === 'memory_search'));
    assert.ok(!body.tools.some((tool: any) => ['search', 'code'].includes(tool.function.name)));
    assert.deepEqual(response.toolCalls, [{ id: 'call1', name: 'memory_run', arguments: { id: '1234567890abcdef', params: { query: 'alpha' } } }]);
  } finally { globalThis.fetch = original; }
});

test('scoped named search forwards prefix and pagination to the stored function', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'call1', function: { name: 'memory_search', arguments: '{"query":"alpha","pathPrefix":"src/","offset":10}' } }] } }] }));
    const model = mistral('test-key', 'test-model', { memorySearchId: '1234567890abcdef', memorySearchScoped: true });
    const response = await model.complete([], { signal: new AbortController().signal, maxOutputTokens: 100, codeMode: true, memory: true });
    assert.deepEqual(response.toolCalls?.[0].arguments, { id: '1234567890abcdef', params: { query: 'alpha', pathPrefix: 'src/', offset: 10 } });
  } finally { globalThis.fetch = original; }
});
