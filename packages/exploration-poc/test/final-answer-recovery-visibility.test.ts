import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mistral } from '../src/mistral.ts';
import { explore } from './fixture-explore.ts';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Spec #183 amendment follow-up (2026-11-16 run, tickets #166/#167): the
// observed failure mode is a final reply made of a plan block with no JSON
// after it. The recovery must show the model what it actually wrote (its own
// output, not the error text), tell it the plan block was already extracted,
// and the plan published in the failed attempt must be recorded, never lost.

test('the connector attaches the raw reply and the parsed plan to FinalAnswerNotJson', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: '```plan\n{"questions":[{"id":"q1","question":"Find start","reuse":true}]}\n```' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }));
    await assert.rejects(
      () => mistral('fixture').complete([], { signal: new AbortController().signal, maxOutputTokens: 100, codeMode: true, memory: true }),
      (error: unknown) => {
        assert.equal((error as { name?: string }).name, 'FinalAnswerNotJson');
        assert.match((error as { rawContent?: string }).rawContent ?? '', /```plan/);
        assert.deepEqual((error as { plan?: unknown }).plan, { questions: [{ id: 'q1', question: 'Find start', reuse: true }] });
        return true;
      }
    );
  } finally { globalThis.fetch = original; }
});

test('the recovery shows the model its own output, records the failed plan and names the plan-block trap', async t => {
  const base = await mkdtemp(join(tmpdir(), 'recovery-visibility-'));
  const root = join(base, 'repo');
  await mkdir(root);
  t.after(() => rm(base, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export function start() { return 42; }\n');
  const validResult = { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] };
  const planOnlyReply = '```plan\n{"questions":[{"id":"q1","question":"Find start","reuse":true}]}\n```';
  let calls = 0;
  let sawOwnOutput = false;
  let sawPlanTrapWarning = false;
  const result = await explore({
    root,
    objective: 'Find start',
    codeMode: true,
    model: {
      async complete(messages: any[]) {
        calls++;
        if (calls === 1) {
          throw Object.assign(
            new Error('Final answer is not valid JSON (content after plan extraction: empty)'),
            { name: 'FinalAnswerNotJson', rawContent: planOnlyReply, plan: { questions: [{ id: 'q1', question: 'Find start', reuse: true }] } }
          );
        }
        const assistant = messages.find(message => message.role === 'assistant' && message.content === planOnlyReply);
        sawOwnOutput = assistant !== undefined;
        sawPlanTrapWarning = messages.some(message => typeof message.content === 'string' && message.content.includes('plan block, if any, was already extracted'));
        return { result: validResult, usage: { inputTokens: 50, outputTokens: 20 } };
      }
    }
  });
  assert.equal(result.status, 'complete');
  assert.equal(sawOwnOutput, true, 'the recovery injects the raw model output, not the error text');
  assert.equal(sawPlanTrapWarning, true, 'the recovery message names the plan-block trap');
  // The plan published in the failed attempt is recorded, never lost.
  assert.equal(result.plan.status, 'recorded');
  assert.deepEqual(result.plan.versions[0].questions, [{ id: 'q1', question: 'Find start', reuse: true }]);
});
