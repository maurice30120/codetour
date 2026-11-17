import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { explore } from './fixture-explore.ts';

const bad = { source: 'function explore(terms: string[]) { return searchText(terms[0]); }', params: { terms: ['start'] } };
const good = { source: 'function explore(p: { terms: string[] }) { return searchText(p.terms[0]); }', params: { terms: ['start'] } };
const final = { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] };

async function setup(t: import('node:test').TestContext) {
  const base = await mkdtemp(join(tmpdir(), 'repeat-invalid-'));
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'main.ts'), 'export function start() {}\n');
  t.after(() => rm(base, { recursive: true, force: true }));
  return { root, memory: { directory: join(base, 'memory') } };
}

test('repeated invalid trials prompt a change, and a corrected trial can succeed', async t => {
  const options = await setup(t);
  let step = 0;
  const feedback: string[] = [];
  const result = await explore({ ...options, objective: 'Find start', codeMode: true, model: { async complete(messages) {
    if (step) feedback.push(String(messages.at(-1)?.content));
    step++;
    if (step <= 2) return { toolCalls: [{ id: `bad${step}`, name: 'function_try', arguments: bad }] };
    if (step === 3) return { toolCalls: [{ id: 'good', name: 'function_try', arguments: good }] };
    return { result: final };
  } } });
  assert.match(feedback[1], /repeated|same.*fail/i);
  assert.match(feedback[1], /change|different/i);
  assert.equal(result.status, 'complete');
  assert.ok(result.callTrace.some(call => call.name === 'repeated_failure_guard' && call.outcome?.includes('warning')));
  assert.ok(result.callTrace.some(call => call.type === 'function_try' && !call.error));
});

test('a model that ignores the warning stops after the third identical failed trial', async t => {
  const options = await setup(t);
  let step = 0;
  const result = await explore({ ...options, objective: 'Find start', codeMode: true, model: { async complete() {
    step++;
    if (step > 5) return { result: final };
    return { toolCalls: [{ id: `bad${step}`, name: 'function_try', arguments: bad }] };
  } } });
  assert.equal(step, 3);
  assert.equal(result.status, 'partial');
  assert.equal(result.stopReason, 'repeated_tool_failure');
  assert.match(result.uncertainties.join(' '), /repeated/i);
});

test('a primitive passed as an argument receives actionable feedback and can be corrected', async t => {
  const options = await setup(t);
  let step = 0;
  let feedback = '';
  const badPrimitive = { source: 'function explore(searchText: (q: string) => unknown[], params: { terms: string[] }) { return searchText(params.terms[0]); }', params: { terms: ['start'] } };
  const result = await explore({ ...options, objective: 'Find start', codeMode: true, model: { async complete(messages) {
    step++;
    if (step === 1) return { toolCalls: [{ id: 'bad', name: 'function_try', arguments: badPrimitive }] };
    if (step === 2) {
      feedback = String(messages.at(-1)?.content);
      return { toolCalls: [{ id: 'good', name: 'function_try', arguments: good }] };
    }
    return { result: final };
  } } });
  assert.match(feedback, /searchText is available directly/);
  assert.match(feedback, /function\(params/);
  assert.equal(result.status, 'complete');
  assert.ok(result.callTrace.some(call => call.type === 'function_try' && !call.error));
});
