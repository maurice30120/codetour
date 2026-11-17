import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explore } from './fixture-explore.ts';
import { scriptMemory } from '../src/memory.ts';
import { parseConfig } from '../src/config.ts';

test('successful memory reuse does not synthesize another function after direct reads', async t => {
  const base = await mkdtemp(join(tmpdir(), 'memory-reuse-no-synthesis-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'main.ts'), 'export function start() { return 1; }\n');
  const memory = { directory: join(base, 'memory') };
  const answer = { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] };
  let step = 0;
  await explore({ root, memory, codeMode: true, objective: 'Find start', model: { async complete() {
    if (step++ === 0) return { toolCalls: [{ id: 'trial', name: 'function_try', arguments: { source: '((p: { query: string }) => searchText(p.query))', params: { query: 'start' }, name: 'findStartLines', question: 'Where is start?', description: 'Searches for a symbol and returns matching source lines with file and line numbers.' } }] };
    if (step === 2) return { result: answer };
    return { result: { selected: ['findStartLines'] } };
  } } });
  assert.ok((await scriptMemory(root, memory.directory)).get('findStartLines'));
  step = 0;
  const result = await explore({ root, memory, codeMode: true, objective: 'Find start', model: { async complete() {
    if (step++ === 0) return { toolCalls: [{ id: 'reuse', name: 'memory_run', arguments: { id: 'findStartLines', params: { query: 'start' } } }, { id: 'read', name: 'readLines', arguments: { file: 'main.ts', startLine: 1, endLine: 1 } }] };
    if (step === 2) return { result: answer };
    throw new Error('unnecessary synthesis after useful reuse');
  } } });
  assert.equal(result.status, 'complete');
  assert.equal(result.metrics.memoryReuses, 1);
  assert.equal(result.callTrace.some(call => call.name === 'memory-synthesis'), false);
  await writeFile(join(root, 'main.ts'), 'export function start() { return 1; }\nexport function other() { return 2; }\n');
  step = 0;
  const unrelated = await explore({ root, memory, codeMode: true, objective: 'Find other', model: { async complete() {
    if (step++ === 0) return { toolCalls: [{ id: 'reuse', name: 'memory_run', arguments: { id: 'findStartLines', params: { query: 'start' } } }, { id: 'read', name: 'readLines', arguments: { file: 'main.ts', startLine: 2, endLine: 2 } }] };
    if (step === 2) return { result: { objective: 'Find other', entryPoints: [{ name: 'other', evidence: [{ file: 'main.ts', startLine: 2, endLine: 2 }] }], components: [], relations: [], uncertainties: [] } };
    return { result: { candidate: null } };
  } } });
  assert.equal(unrelated.status, 'complete');
  assert.ok(unrelated.callTrace.some(call => call.name === 'memory-synthesis'), 'an unrelated reuse must not suppress synthesis');
});

test('direct research can synthesize, validate and persist a reusable procedure', async t => {
  const base = await mkdtemp(join(tmpdir(), 'memory-synthesis-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'main.ts'), 'export function start() { return 1; }\n');
  const memory = { directory: join(base, 'memory') };
  let step = 0;
  const result = await explore({ root, memory, codeMode: true, objective: 'Find the entry point', budget: { iterations: 12, calls: 48, tokens: 60000, durationMs: 60000 }, model: {
    async complete(messages) {
      const usage = { inputTokens: 10, outputTokens: 10 };
      if (step++ === 0) return { usage, toolCalls: [{ id: 'search', name: 'searchText', arguments: { query: 'start' } }] };
      if (step === 2) return { usage, result: { objective: 'Find the entry point', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
      if (step === 3) {
        assert.match(messages[0].content, /Review the completed research/);
        assert.match(messages[1].content, /searchText/);
        return { usage, result: { candidate: { name: 'findEntryContext', question: 'Where are entry point declarations?', description: 'Searches entry point declarations and returns cited matching lines within search limits.', source: '((input: { query: string }) => searchText(input.query).map(hit => ({ ...hit, startLine: hit.line, endLine: hit.line })))', params: { query: 'start' } } } };
      }
      return { usage, result: { selected: ['findEntryContext'] } };
    }
  } });
  assert.equal(result.status, 'complete');
  assert.ok(result.callTrace.some(call => call.name === 'memory-synthesis-trial' && /citations=1 valid/.test(call.outcome ?? '')));
  assert.ok(result.callTrace.some(call => call.name === 'consolidation-validation'));
  assert.equal((await scriptMemory(root, memory.directory)).memory_list('entry point')[0]?.id, 'findEntryContext');
});

test('a synthesized procedure with invalid citations never reaches memory', async t => {
  const base = await mkdtemp(join(tmpdir(), 'memory-synthesis-invalid-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'main.ts'), 'export function start() { return 1; }\n');
  const memory = { directory: join(base, 'memory') };
  let step = 0;
  const result = await explore({ root, memory, config: parseConfig({ limits: { memorySynthesisAttempts: 2 } }), codeMode: true, objective: 'Find start', budget: { iterations: 12, calls: 48, tokens: 60000, durationMs: 60000 }, model: {
    async complete() {
      const usage = { inputTokens: 10, outputTokens: 10 };
      if (step++ === 0) return { usage, toolCalls: [{ id: 'search', name: 'searchText', arguments: { query: 'start' } }] };
      if (step === 2) return { usage, result: { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
      return { usage, result: { candidate: { name: 'badContext', question: 'Where is start?', description: 'Searches declarations and returns matching lines within search limits.', source: '((input: { query: string }) => searchText(input.query).map(hit => ({ file: hit.file, startLine: hit.line, endLine: hit.line + 5 })))', params: { query: 'start' } } } };
    }
  } });
  assert.equal(result.status, 'complete');
  assert.match(result.callTrace.find(call => call.name === 'memory-synthesis-trial')?.outcome ?? '', /citations=validation_failed/);
  assert.equal(result.callTrace.filter(call => call.name === 'memory-synthesis-trial').length, 2);
  assert.equal(result.callTrace.some(call => call.name === 'memory-selection'), false);
  assert.equal((await scriptMemory(root, memory.directory)).memory_list('').length, 0);
});

test('synthesis repairs an invalid citation using its diagnostic and persists the corrected procedure', async t => {
  const base = await mkdtemp(join(tmpdir(), 'memory-synthesis-repair-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'main.ts'), 'export function start() { return 1; }\n');
  const memory = { directory: join(base, 'memory') };
  let step = 0;
  const result = await explore({ root, memory, codeMode: true, objective: 'Find start', budget: { iterations: 12, calls: 48, tokens: 60000, durationMs: 60000 }, model: {
    async complete(messages) {
      const usage = { inputTokens: 10, outputTokens: 10 };
      const current = step++;
      if (current === 0) return { usage, toolCalls: [{ id: 'search', name: 'searchText', arguments: { query: 'start' } }] };
      if (current === 1) return { usage, result: { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
      if (current === 4) return { usage, result: { selected: ['findEntryContext'] } };
      if (current === 3) assert.match(messages[1].content, /beyond the end of the file/);
      const end = current === 2 ? 'hit.line + 5' : 'hit.line';
      return { usage, result: { candidate: { name: 'findEntryContext', question: 'Where are entry point declarations?', description: 'Searches entry point declarations and returns cited matching lines within search limits.', source: `((input: { query: string }) => searchText(input.query).map(hit => ({ file: hit.file, startLine: hit.line, endLine: ${end} })))`, params: { query: 'start' } } } };
    }
  } });
  const trials = result.callTrace.filter(call => call.name === 'memory-synthesis-trial');
  assert.equal(trials.length, 2);
  assert.match(trials[0].outcome ?? '', /validation_failed/);
  assert.match(trials[1].outcome ?? '', /1 valid/);
  assert.equal((await scriptMemory(root, memory.directory)).memory_list('entry point')[0]?.id, 'findEntryContext');
});
