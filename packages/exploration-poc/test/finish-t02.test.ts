import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explore } from '../src/explore.ts';
import { scriptMemory } from '../src/memory.ts';

const emptyResult = { objective: 'Inspect repository', entryPoints: [], components: [], relations: [], uncertainties: [] };

test('explore bounds a single oversized item and an escaped multibyte object', async t => {
  const root = await mkdtemp(join(tmpdir(), 't02-output-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const code of ['["x".repeat(20000)]', `({text:${JSON.stringify('😀"'.repeat(2000))}})`]) {
    let step = 0;
    await explore({ root, objective: emptyResult.objective, codeMode: true, model: { async complete(messages) {
      if (step++ === 0) return { toolCalls: [{ id: 'large', name: 'code', arguments: { code } }] };
      const output = JSON.parse(messages.at(-1).content);
      assert.equal(output.truncated, true);
      assert.ok(Buffer.byteLength(JSON.stringify(output.result)) <= 8000);
      assert.equal(output.bytes, Buffer.byteLength(JSON.stringify(output.result)));
      assert.match(output.uncertainty.join(' '), /not exhaustive/i);
      return { result: emptyResult };
    } } });
  }
});

test('scriptMemory retains more than twenty independent procedures across reloads', async t => {
  const root = await mkdtemp(join(tmpdir(), 't02-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'memory');
  const store = await scriptMemory(root, directory);
  for (let i = 0; i < 21; i++) {
    await store.finish([], [{
      objective: `Locate domain ${i}`, description: `Domain ${i}`, name: `traceRepoDomain${i}`,
      code: 'search(params.query)', parameters: ['query'], returns: 'SearchMatch[]', verified: true,
      consolidationSignal: { executedSuccessfully: true, proofAvailable: true, contractRespected: true }
    }]);
  }
  const reloaded = await scriptMemory(root, directory);
  assert.equal(reloaded.catalog().length, 21);
  assert.equal(store.purges(), 0);
});

test('explore executes function_try source with typed params and canonical primitives', async t => {
  const base = await mkdtemp(join(tmpdir(), 't02-function-try-'));
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'main.ts'), 'export function start() { return 1; }\n');
  t.after(() => rm(base, { recursive: true, force: true }));
  let step = 0;
  const result = await explore({ root, objective: emptyResult.objective, codeMode: true, memory: { directory: join(base, 'memory') }, model: { async complete(messages) {
    if (step++ === 0) return { toolCalls: [{ id: 'try', name: 'function_try', arguments: {
      source: '((input: { query: string }) => searchText(input.query))', params: { query: 'start' }
    } }] };
    const output = JSON.parse(messages.at(-1).content);
    assert.equal(output.result[0].file, 'main.ts');
    assert.equal(output.result[0].line, 1);
    return { result: emptyResult };
  } } });
  assert.equal(result.callTrace.find(call => call.type === 'function_try')?.outcome, 'returned=1');
});

test('explore preserves measured calls when final evidence validation fails', async t => {
  const root = await mkdtemp(join(tmpdir(), 't02-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(explore({ root, objective: emptyResult.objective, model: { async complete() {
    return { result: { ...emptyResult, entryPoints: [{ name: 'missing', evidence: [{ file: 'missing.ts', startLine: 1, endLine: 1 }] }] }, usage: { inputTokens: 31, outputTokens: 7 } };
  } } }), (error: any) => {
    assert.equal(error.exploration.status, 'failed');
    assert.equal(error.exploration.metrics.inputTokens, 31);
    assert.equal(error.exploration.metrics.outputTokens, 7);
    assert.equal(error.exploration.callTrace[0].inputTokens, 31);
    return true;
  });
});

test('a validated Tour selects an executed strict procedure and reuses its typed canonical contract', async t => {
  const base = await mkdtemp(join(tmpdir(), 't02-promotion-'));
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'main.ts'), 'export function start() { return 1; }\n');
  t.after(() => rm(base, { recursive: true, force: true }));
  const memory = { directory: join(base, 'memory') };
  const source = '((input: { query: string }) => searchText(input.query).map(hit => ({ ...hit, context: readLines(hit.file, hit.line, hit.line) })))';
  const question = 'Where is an entry point declared and what is its source context?';
  let step = 0;
  const first = await explore({ root, objective: 'Explain start', codeMode: true, memory, model: { async complete(messages) {
    if (step++ === 0) return { toolCalls: [{ id: 'trial', name: 'function_try', arguments: { source, params: { query: 'start' }, remember: true, name: 'traceRepoEntryPoints', question, description: 'Declarations with their source context' } }] };
    if (step === 2) return { result: { ...emptyResult, entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }] } };
    assert.match(messages[0].content, /select.*executed/i);
    return { result: { selected: ['traceRepoEntryPoints'] }, usage: { inputTokens: 10, outputTokens: 3 } };
  } } });
  assert.equal(step, 3, 'utility selection happens after Tour validation');
  assert.ok(first.callTrace.some(call => call.name === 'consolidation-validation'));
  const store = await scriptMemory(root, memory.directory);
  const entry = store.memory_list('entry point')[0];
  assert.equal(entry.objective, question);
  assert.deepEqual(entry.paramsSchema, [{ name: 'query', type: 'string' }]);
  assert.match(entry.outputContract?.returns ?? '', /SourceMatch|context|ReadResult/);
  assert.equal('code' in entry, false);
  let reuseStep = 0;
  const second = await explore({ root, objective: 'Show the implementation of the start entry point', codeMode: true, memory, model: { async complete(messages) {
    if (reuseStep++ === 0) return { toolCalls: [{ id: 'reuse', name: 'memory_run', arguments: { id: entry.id, params: { query: 'start' } } }] };
    assert.equal(JSON.parse(messages.at(-1).content).result[0].file, 'main.ts');
    return { result: emptyResult };
  } } });
  assert.equal(second.metrics.memoryReuses, 1);
  assert.equal((await scriptMemory(root, memory.directory)).catalog().length, 1);
});

test('primitive truncation is explicit and fabricated relation output is not labelled primitive-derived', async t => {
  const root = await mkdtemp(join(tmpdir(), 't02-provenance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), Array.from({ length: 51 }, () => 'start();').join('\n'));
  let step = 0;
  await explore({ root, objective: emptyResult.objective, codeMode: true, model: { async complete(messages) {
    if (step++ === 0) return { toolCalls: [{ id: 'search', name: 'function_try', arguments: { source: 'searchText(params.query)', params: { query: 'start' } } }] };
    if (step === 2) {
      assert.equal(JSON.parse(messages.at(-1).content).truncated, true);
      return { toolCalls: [{ id: 'relation', name: 'function_try', arguments: { source: '({from: "A", to: "B"})', params: {} } }] };
    }
    const relation = JSON.parse(messages.at(-1).content);
    assert.equal(relation.provenance, 'unverified');
    assert.match(relation.uncertainty.join(' '), /evidence|syntactic|semantic/i);
    return { result: emptyResult };
  } } });
});
