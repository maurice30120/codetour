import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mistral } from '../src/mistral.ts';
import { explore } from '../src/explore.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

test('memory exploration exposes canonical function_try and query discovery with configured temperature', async () => {
  const original = globalThis.fetch;
  let body: any;
  try {
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 2, completion_tokens: 1 } }));
    };
    await mistral('test-key', 'fixture-model', { temperature: 0.4 }).complete([], { signal: new AbortController().signal, maxOutputTokens: 123, codeMode: true, memory: true });
    assert.equal(body.temperature, 0.4);
    assert.equal(body.max_tokens, 123);
    const available = new Map(body.tools.map((tool: any) => [tool.function.name, tool.function]));
    assert.deepEqual((available.get('function_try') as any).parameters.required, ['source', 'params']);
    assert.equal((available.get('memory_list') as any).parameters.properties.query.type, 'string');
    // Wrapping obligation (spec #183 amendment): in memory + Code Mode the ten
    // primitives are NOT exposed as direct tools — only memory_list,
    // memory_run, memory_unusable and function_try are.
    for (const name of ['listFiles', 'searchText', 'searchIdentifiers', 'readLines', 'readAround', 'listSymbols', 'findDefinitions', 'findReferences', 'getImports', 'getGitDiff']) assert.equal(available.has(name), false, `${name} must not be exposed directly`);
    for (const name of ['function_try', 'memory_list', 'memory_run', 'memory_unusable']) assert.ok(available.has(name), name);
  } finally { globalThis.fetch = original; }
});

test('malformed provider output keeps reported usage in the exploration failure trace', async t => {
  const root = await mkdtemp(join(tmpdir(), 't02-provider-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'invalid JSON' } }], usage: { prompt_tokens: 23, completion_tokens: 4 } }));
    await assert.rejects(explore({ root, objective: 'inspect', model: mistral('fixture') }), (error: any) => {
      // The harness grants one visible JSON recovery, so the run consumes two
      // model calls (both malformed) before the second failure stays fatal.
      assert.equal(error.exploration.metrics.inputTokens, 46);
      assert.equal(error.exploration.metrics.outputTokens, 8);
      assert.equal(error.exploration.callTrace[0].usageMissing, false);
      assert.equal(error.exploration.callTrace[0].inputTokens, 23);
      return true;
    });
  } finally { globalThis.fetch = original; }
});
