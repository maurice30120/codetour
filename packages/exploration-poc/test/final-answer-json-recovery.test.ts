import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mistral } from '../src/mistral.ts';
import { explore } from './fixture-explore.ts';
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

test('a length-limited empty answer records diagnostics and retries exploration when no tools ran', async t => {
  const base = await mkdtemp(join(tmpdir(), 'length-recovery-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  await writeFile(join(base, 'main.ts'), 'export function start() {}\n');
  let calls = 0;
  let retry = '';
  const result = await explore({ root: base, objective: 'Find start', model: { async complete(messages) {
    calls++;
    if (calls === 1) throw Object.assign(new Error('empty'), { name: 'FinalAnswerNotJson', rawContent: '', finishReason: 'length', contentShape: ['type=thinking'], reasoningTokens: 90, usage: { inputTokens: 10, outputTokens: 100 } });
    retry = JSON.stringify(messages);
    return { result: { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
  } } });
  assert.match(retry, /use.*tools|explor/i);
  const failed = result.callTrace.find(call => call.error === 'FinalAnswerNotJson: empty');
  assert.equal(failed?.finishReason, 'length');
  assert.equal(failed?.reasoningTokens, 90);
  assert.deepEqual(failed?.contentShape, ['type=thinking']);
});

test('provider exposes reported reasoning tokens on a failed response', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: null } }], usage: { prompt_tokens: 1, completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 97 } } }));
    await assert.rejects(() => mistral('fixture').complete([], { signal: new AbortController().signal, maxOutputTokens: 100, codeMode: true, memory: true }), (error: any) => error.finishReason === 'length' && error.reasoningTokens === 97);
  } finally { globalThis.fetch = original; }
});

test('reasoning exhausting a length-limited response raises only the recovery output cap within the run budget', async t => {
  const root = await mkdtemp(join(tmpdir(), 'reasoning-limit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export function start() {}\n');
  const caps: number[] = [];
  await explore({ root, objective: 'Find start', budget: { tokens: 50000 }, model: { async complete(_messages, options) {
    caps.push(options!.maxOutputTokens);
    if (caps.length === 1) throw Object.assign(new Error('empty'), { name: 'FinalAnswerNotJson', rawContent: '', finishReason: 'length', reasoningTokens: 16384, usage: { inputTokens: 100, outputTokens: 16384 } });
    return { result: { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
  } } });
  assert.deepEqual(caps, [16384, 32768]);
});
