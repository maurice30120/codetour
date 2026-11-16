import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { explore } from '../src/explore.ts';

// Ticket #191 (spec #183): before accepting the final answer, every plan
// question marked reuse=true that neither memory_run nor function_try served
// (verifiable on the call trace via question_id) earns ONE visible reminder:
// the affected question ids, an invitation to propose a durable capability
// with function_try now, or to justify why no creation applies. Once per run,
// inside the original budget, never a loop — a second shortfall is recorded,
// never re-reminded.

const plan = { questions: [{ id: 'q1', question: 'Find the start function', reuse: true }] };
const validResult = {
  objective: 'Find start',
  entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }],
  components: [],
  relations: [],
  uncertainties: [],
};

async function setup(t: import('node:test').TestContext) {
  const base = await mkdtemp(join(tmpdir(), 'reuse-reminder-'));
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'main.ts'), 'export function start() { return 42; }\n');
  t.after(() => rm(base, { recursive: true, force: true }));
  return root;
}

test('an unserved reuse=true question receives the end-of-run reminder and the run completes after it', async t => {
  const root = await setup(t);
  let step = 0;
  let reminderSeen = false;
  const result = await explore({
    root,
    objective: 'Find start',
    codeMode: true,
    model: {
      async complete(messages: any[]) {
        step++;
        if (step === 1) return { plan, result: validResult, usage: { inputTokens: 50, outputTokens: 20 } };
        reminderSeen = messages.some(message => typeof message.content === 'string' && message.content.includes('never served by memory_run or function_try: q1'));
        return { result: { ...validResult, uncertainties: ['q1: no creation applies, a permanent primitive covers the question.'] }, usage: { inputTokens: 50, outputTokens: 20 } };
      }
    }
  });
  assert.equal(result.status, 'complete');
  assert.equal(reminderSeen, true, 'the reminder must reach the model before the final answer is accepted');
  const reminder = result.callTrace.find(call => call.type === 'reuse_reminder');
  assert.ok(reminder, 'the reminder is traced');
  assert.deepEqual(reminder.result, { unservedQuestionIds: ['q1'] });
});

test('a run where every reuse=true question is served by function_try receives no reminder', async t => {
  const root = await setup(t);
  let step = 0;
  const result = await explore({
    root,
    objective: 'Find start',
    codeMode: true,
    model: {
      async complete() {
        step++;
        if (step === 1) return {
          plan,
          toolCalls: [{ id: 'try1', name: 'function_try', arguments: { source: 'searchText(params.query)', params: { query: 'start' }, question_id: 'q1' } }],
          usage: { inputTokens: 50, outputTokens: 20 }
        };
        return { result: validResult, usage: { inputTokens: 50, outputTokens: 20 } };
      }
    }
  });
  assert.equal(result.status, 'complete');
  assert.equal(result.callTrace.some(call => call.type === 'reuse_reminder'), false, 'no reminder when the question was served');
});

test('a reuse=true question justified by id in the final uncertainties receives no reminder', async t => {
  const root = await setup(t);
  const result = await explore({
    root,
    objective: 'Find start',
    codeMode: true,
    model: {
      async complete() {
        return { plan, result: { ...validResult, uncertainties: ['q1: no creation applies, a permanent primitive covers the question.'] }, usage: { inputTokens: 50, outputTokens: 20 } };
      }
    }
  });
  assert.equal(result.status, 'complete');
  assert.equal(result.callTrace.some(call => call.type === 'reuse_reminder'), false, 'an explicit justification closes the run without a reminder');
});

test('the reminder is sent once per run: a second shortfall is recorded as an anomaly, never a loop', async t => {
  const root = await setup(t);
  let step = 0;
  const result = await explore({
    root,
    objective: 'Find start',
    codeMode: true,
    model: {
      async complete() {
        step++;
        if (step === 1) return { plan, result: validResult, usage: { inputTokens: 50, outputTokens: 20 } };
        return { result: validResult, usage: { inputTokens: 50, outputTokens: 20 } };
      }
    }
  });
  assert.equal(result.status, 'complete');
  assert.equal(step, 2, 'no loop: the model is asked exactly once more');
  assert.equal(result.callTrace.filter(call => call.type === 'reuse_reminder').length, 1, 'exactly one reminder per run');
  assert.ok(
    result.plan.anomalies.some(anomaly => /reuse=true questions still unserved after the end-of-run reminder: q1/.test(anomaly)),
    'the second shortfall is consigned as a visible anomaly'
  );
});
