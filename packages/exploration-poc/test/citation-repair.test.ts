import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explore } from './fixture-explore.ts';
import { scriptMemory } from '../src/memory.ts';

const emptyResult = { objective: 'Inspect repository', entryPoints: [], components: [], relations: [], uncertainties: [] };

/**
 * Issue #185 (D02) end-to-end scenarios: a strict function_try trial whose
 * output carries mandatory references is exhaustively validated without any
 * LLM. Expected values come from the literal fixture files written here, never
 * from the implementation under test.
 */

// A strict trial source returning one literal citation: parameterized so the
// sandbox strict contract accepts it, with the excerpt under the model's control.
const singleCitation = (text: string) => `((input: { tag: string }) => [{ file: 'main.ts', line: 1, text: ${JSON.stringify(text)} }])`;

// A strict trial source returning ten literal citations against ten.ts, one of
// which (the given index) is tampered.
const tenCitations = (tampered: number) => `((input: { tag: string }) => [${Array.from({ length: 10 }, (_, index) =>
  `{ file: 'ten.ts', line: ${index + 1}, text: ${JSON.stringify(index === tampered ? `tampered line ${index}` : `start ${index};`)} }`).join(',')}])`;

async function fixtureRepo(base: string) {
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'main.ts'), 'export function start() { return 1; }\n');
  await writeFile(join(root, 'ten.ts'), Array.from({ length: 10 }, (_, index) => `start ${index};`).join('\n') + '\n');
  return root;
}

test('function_try fails on an invalid citation, returns structured repair feedback, and a corrected retry succeeds', async t => {
  const base = await mkdtemp(join(tmpdir(), 'd02-repair-'));
  const root = await fixtureRepo(base);
  t.after(() => rm(base, { recursive: true, force: true }));
  const memory = { directory: join(base, 'memory') };
  const realLine = 'export function start() { return 1; }';
  let step = -1;
  const result = await explore({ root, objective: emptyResult.objective, codeMode: true, memory, model: {
    async complete(messages) {
      step++;
      if (step === 0) return { toolCalls: [{ id: 'bad', name: 'function_try', arguments: { source: singleCitation('fabricated excerpt'), params: { tag: 'x' }, remember: true, name: 'traceRepoCitations', description: 'Citation trial', question: 'Which line declares start?', returns: 'Citation[]' } }] };
      if (step === 1) {
        // The failed trial returns short, structured, actionable feedback —
        // never its raw result.
        const feedback = JSON.parse(messages.at(-1).content);
        assert.equal(feedback.error, 'invalid_citation: 1 of 1 references invalid');
        assert.equal(feedback.validation.status, 'validation_failed');
        assert.deepEqual(feedback.validation.validReferences, []);
        assert.equal(feedback.validation.invalidReferences[0].file, 'main.ts');
        assert.equal(feedback.validation.invalidReferences[0].startLine, 1);
        assert.equal(feedback.validation.invalidReferences[0].endLine, 1);
        assert.match(feedback.validation.invalidReferences[0].errors.join(' '), /does not match the file content/);
        assert.match(feedback.validation.message, /call function_try again/);
        return { toolCalls: [{ id: 'fixed', name: 'function_try', arguments: { source: singleCitation(realLine), params: { tag: 'x' }, remember: true, name: 'traceRepoCitations', description: 'Citation trial', question: 'Which line declares start?', returns: 'Citation[]' } }] };
      }
      if (step === 2) {
        // The corrected trial is validated: its bounded result reaches the model.
        const fixed = JSON.parse(messages.at(-1).content);
        assert.equal(fixed.result[0].file, 'main.ts');
        assert.equal(fixed.result[0].line, 1);
        assert.equal(fixed.truncated, false);
        return { result: { ...emptyResult, entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }] } };
      }
      // Consolidation selection: nothing is selected, so nothing persists.
      assert.match(messages[0].content, /select/i);
      return { result: { selected: [] } };
    }
  } });
  assert.equal(result.status, 'complete');
  // Both attempts are counted and traced, with their params and outcomes.
  const trials = result.callTrace.filter(call => call.type === 'function_try');
  assert.equal(trials.length, 2);
  assert.match(trials[0].outcome, /citations=validation_failed \(0\/1 valid\)/);
  assert.match(trials[1].outcome, /citations=1 valid/);
  // The failed trial's diagnostics stay available in the trace.
  assert.equal(trials[0].result.status, 'validation_failed');
  assert.equal(trials[0].result.invalidReferences[0].file, 'main.ts');
  // Nothing entered memory: the failed trial is never proposed, and the
  // selection explicitly retained nothing.
  assert.equal((await scriptMemory(root, memory.directory)).catalog().length, 0);
});

test('a partially valid trial keeps the valid references visible and identifies only the faulty one', async t => {
  const base = await mkdtemp(join(tmpdir(), 'd02-partial-'));
  const root = await fixtureRepo(base);
  t.after(() => rm(base, { recursive: true, force: true }));
  const memory = { directory: join(base, 'memory') };
  let step = 0;
  const result = await explore({ root, objective: emptyResult.objective, codeMode: true, memory, model: {
    async complete(messages) {
      if (step++ === 0) return { toolCalls: [{ id: 'partial', name: 'function_try', arguments: { source: tenCitations(9), params: { tag: 'x' }, remember: true, name: 'traceRepoTenLines', description: 'Ten-line citation trial' } }] };
      const feedback = JSON.parse(messages.at(-1).content);
      assert.equal(feedback.error, 'invalid_citation: 1 of 10 references invalid');
      assert.equal(feedback.validation.status, 'validation_failed');
      assert.equal(feedback.validation.validCount, 9);
      assert.equal(feedback.validation.validReferences.length, 9);
      assert.equal(feedback.validation.invalidReferences.length, 1);
      assert.equal(feedback.validation.invalidReferences[0].file, 'ten.ts');
      assert.equal(feedback.validation.invalidReferences[0].startLine, 10);
      assert.equal(feedback.validation.invalidReferences[0].endLine, 10);
      return { result: { ...emptyResult, entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }] } };
    }
  } });
  assert.equal(result.status, 'complete');
  const trial = result.callTrace.find(call => call.type === 'function_try');
  assert.match(trial.outcome, /citations=validation_failed \(9\/10 valid\)/);
  assert.equal(trial.result.validCount, 9);
  // The model abandoned the candidate: the Tour continues, nothing persists.
  assert.equal((await scriptMemory(root, memory.directory)).catalog().length, 0);
});

test('an abandoned citation-invalid candidate leaves diagnostics in the trace only and the Tour continues with primitives', async t => {
  const base = await mkdtemp(join(tmpdir(), 'd02-abandon-'));
  const root = await fixtureRepo(base);
  t.after(() => rm(base, { recursive: true, force: true }));
  const memory = { directory: join(base, 'memory') };
  let step = 0;
  const result = await explore({ root, objective: emptyResult.objective, codeMode: true, memory, model: {
    async complete(messages) {
      if (step++ === 0) return { toolCalls: [{ id: 'doomed', name: 'function_try', arguments: { source: singleCitation('fabricated excerpt'), params: { tag: 'x' }, remember: true, name: 'traceRepoDoomed', description: 'Unrecoverable trial' } }] };
      // The model reads the feedback, abandons the candidate and finishes the
      // Tour with evidence gathered through the permanent primitives instead.
      const feedback = JSON.parse(messages.at(-1).content);
      assert.equal(feedback.validation.status, 'validation_failed');
      return { result: { ...emptyResult, entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }] } };
    }
  } });
  assert.equal(result.status, 'complete');
  const trial = result.callTrace.find(call => call.type === 'function_try');
  assert.match(trial.outcome, /citations=validation_failed/);
  // The abandoned candidate's source execution and faulty reference remain in the trace.
  assert.ok(trial.execution, 'the sandbox execution trace stays in the diagnostic');
  assert.equal(trial.result.invalidReferences[0].file, 'main.ts');
  assert.equal((await scriptMemory(root, memory.directory)).catalog().length, 0);
});
