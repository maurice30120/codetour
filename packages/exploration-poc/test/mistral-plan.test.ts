import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mistral } from '../src/mistral.ts';
import { explore } from '../src/explore.ts';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// §D01 (#184): the plan is published as a fenced block labeled `plan` inside the
// normal reply. The provider must extract it — no dedicated LLM call — both when
// the reply carries tool calls and when it carries the final result.
test('the provider extracts the plan block published alongside tool calls', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: {
        content: 'Before exploring, my plan:\n```plan\n{"questions":[{"id":"q1","question":"Where is the entry point declared?","reuse":false}]}\n```\n',
        tool_calls: [{ id: 'call1', function: { name: 'searchText', arguments: '{"query":"start","question_id":"q1"}' } }]
      } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }));
    const response = await mistral('fixture').complete([], { signal: new AbortController().signal, maxOutputTokens: 100, codeMode: true, memory: true });
    assert.deepEqual(response.plan, { questions: [{ id: 'q1', question: 'Where is the entry point declared?', reuse: false }] });
    assert.deepEqual(response.toolCalls, [{ id: 'call1', name: 'searchText', arguments: { query: 'start', question_id: 'q1' } }]);
  } finally { globalThis.fetch = original; }
});

test('a real-shaped Tour records the provider plan and still parses the final result', async () => {
  const base = await mkdtemp(join(tmpdir(), 'mistral-plan-tour-'));
  const root = join(base, 'repo');
  await mkdir(root);
  try {
    await writeFile(join(root, 'main.ts'), 'export function start() { return 42; }\n');
    const original = globalThis.fetch;
    let calls = 0;
    try {
      globalThis.fetch = async () => {
        calls++;
        if (calls === 1) return new Response(JSON.stringify({
          choices: [{ message: {
            content: '```plan\n{"questions":[{"id":"q1","question":"Where is the entry point declared?","reuse":false}]}\n```',
            tool_calls: [{ id: 'search-1', function: { name: 'search', arguments: '{"query":"start","question_id":"q1"}' } }]
          } }],
          usage: { prompt_tokens: 100, completion_tokens: 40 }
        }));
        return new Response(JSON.stringify({
          choices: [{ message: { content: '```plan\n{"questions":[{"id":"q1","question":"Where is the entry point declared?","reuse":false}],"reason":"the entry point is confirmed"}\n```\n{\"objective\":\"Find start\",\"entryPoints\":[{\"name\":\"start\",\"evidence\":[{\"file\":\"main.ts\",\"startLine\":1,\"endLine\":1}]}],\"components\":[],\"relations\":[],\"uncertainties\":[]}' } }],
          usage: { prompt_tokens: 80, completion_tokens: 30 }
        }));
      };
      const result = await explore({ root, objective: 'Find start', codeMode: true, model: mistral('fixture') });
      assert.equal(result.plan.status, 'recorded');
      assert.equal(result.plan.versions.length, 2);
      assert.equal(result.plan.versions[1].reason, 'the entry point is confirmed');
      assert.equal(result.status, 'complete');
      assert.deepEqual(result.entryPoints[0].evidence, [{ file: 'main.ts', startLine: 1, endLine: 1 }]);
      const searchEntry = result.callTrace.find(call => call.name === 'search');
      assert.equal(searchEntry?.questionId, 'q1');
      assert.equal(searchEntry?.callId, 'search-1');
      // The plan-bearing generations are fully counted in the run accounting.
      assert.equal(result.metrics.inputTokens, 180);
      assert.equal(result.metrics.outputTokens, 70);
    } finally { globalThis.fetch = original; }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// A malformed plan block is an invalid plan anomaly, never a provider crash.
test('a malformed plan block surfaces as an invalid plan, not a provider failure', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: {
        content: '```plan\nnot json at all\n```\n{\"objective\":\"o\",\"entryPoints\":[],\"components\":[],\"relations\":[],\"uncertainties\":[]}',
        tool_calls: [{ id: 'call1', function: { name: 'search', arguments: '{"query":"x"}' } }]
      } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }));
    const response = await mistral('fixture').complete([], { signal: new AbortController().signal, maxOutputTokens: 100, codeMode: true, memory: true });
    assert.equal(typeof response.plan, 'string');
  } finally { globalThis.fetch = original; }
});
