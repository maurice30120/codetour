import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mistral } from '../src/mistral.ts';
import { explore } from '../src/explore.ts';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Spec #183 ten-ticket diagnostic follow-up: four of ten real runs died on the
// first model call with `SyntaxError: Unexpected end of JSON input` because the
// provider strict-parses the final answer and the model sometimes publishes only
// a plan block (empty content after extraction) or truncated JSON. The failure
// must be diagnosable (typed error with a content snippet) and recoverable once
// inside the run (the same repair philosophy as citation validation), never a
// silent success.

test('the provider throws a typed error carrying a content snippet when the final answer is not valid JSON', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: '```plan\n{"questions":[]}\n```\nI explored the repository by hand.' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }));
    await assert.rejects(
      () => mistral('fixture').complete([], { signal: new AbortController().signal, maxOutputTokens: 100, codeMode: true, memory: true }),
      (error: unknown) => {
        assert.equal((error as { name?: string }).name, 'FinalAnswerNotJson');
        assert.match((error as Error).message, /Final answer is not valid JSON/);
        assert.match((error as Error).message, /I explored the repository by hand/);
        return true;
      }
    );
  } finally { globalThis.fetch = original; }
});

test('an empty final answer after plan extraction reports the empty content instead of a bare SyntaxError', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: '```plan\n{"questions":[]}\n```' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }));
    await assert.rejects(
      () => mistral('fixture').complete([], { signal: new AbortController().signal, maxOutputTokens: 100, codeMode: true, memory: true }),
      (error: unknown) => {
        assert.equal((error as { name?: string }).name, 'FinalAnswerNotJson');
        assert.match((error as Error).message, /empty/);
        return true;
      }
    );
  } finally { globalThis.fetch = original; }
});

test('explore recovers once from a non-JSON final answer and completes when the retry is valid', async t => {
  const base = await mkdtemp(join(tmpdir(), 'json-recovery-'));
  const root = join(base, 'repo');
  await mkdir(root);
  t.after(() => rm(base, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export function start() { return 42; }\n');
  const validResult = { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] };
  let calls = 0;
  let recoveryPromptSeen = false;
  const model = {
    async complete(messages: unknown[]) {
      calls++;
      if (calls === 1) {
        throw Object.assign(new Error('Final answer is not valid JSON (content after plan extraction: "I explored by hand.")'), { name: 'FinalAnswerNotJson' });
      }
      recoveryPromptSeen = JSON.stringify(messages).includes('not valid JSON');
      return { result: validResult, usage: { inputTokens: 50, outputTokens: 20 } };
    }
  };
  const result = await explore({ root, objective: 'Find start', codeMode: true, model });
  assert.equal(result.status, 'complete');
  assert.equal(calls, 2);
  assert.equal(recoveryPromptSeen, true);
  const failedCall = result.callTrace.find(call => call.type === 'model' && call.error?.includes('Final answer is not valid JSON'));
  assert.ok(failedCall, 'the failed model call stays recorded in the trace');
});

test('a second non-JSON final answer is fatal: only one recovery per run', async t => {
  const base = await mkdtemp(join(tmpdir(), 'json-recovery-twice-'));
  const root = join(base, 'repo');
  await mkdir(root);
  t.after(() => rm(base, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export function start() { return 42; }\n');
  let calls = 0;
  const model = {
    async complete() {
      calls++;
      throw Object.assign(new Error('Final answer is not valid JSON (content after plan extraction: "still prose.")'), { name: 'FinalAnswerNotJson' });
    }
  };
  await assert.rejects(() => explore({ root, objective: 'Find start', codeMode: true, model }), /Final answer is not valid JSON/);
  assert.equal(calls, 2);
});
