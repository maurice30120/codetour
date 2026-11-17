import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explore } from './fixture-explore.ts';
import { workspace } from '../src/workspace.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

test('memory instructions do not require an unnecessary new function before every answer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-optional-function-'));
  try {
    await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
    let step = 0;
    const result = await explore({ root, objective: 'Find start', codeMode: true, memory: { directory: join(root, '.memory') }, model: { async complete(messages) {
      assert.doesNotMatch(messages[0].content, /before concluding, run at least one function_try/i);
      assert.match(messages[0].content, /do not create.*function.*quota/i);
      if (step++ === 0) return { toolCalls: [{ id: 'read', name: 'readLines', arguments: { file: 'main.ts', startLine: 1, endLine: 1 } }] };
      return { result: { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
    } } });
    assert.equal(result.status, 'complete');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a truncated tool result can be retrieved from scratch and is cleaned on a partial run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-'));
  try {
    let step = 0;
    const result = await explore({ root, objective: 'Inspect output', codeMode: true, budget: { iterations: 3 }, model: {
      async complete(messages: any[]) {
        if (step++ === 0) return { toolCalls: [{ id: 'large', name: 'code', arguments: { code: '"x".repeat(9000) + "THE_END"' } }] };
        if (step === 2) {
          assert.match(messages.at(-1).content, /readScratch/);
          return { toolCalls: [{ id: 'page', name: 'readScratch', arguments: { resultId: 'large', offset: 8000 } }] };
        }
        assert.match(messages.at(-1).content, /THE_END/);
        return { toolCalls: [{ id: 'other', name: 'list', arguments: {} }] };
      }
    } });
    assert.equal(result.status, 'partial');
    assert.deepEqual(await readdir(join(root, '.tours', '.scratch')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the model receives the complete structured evidence contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-'));
  try {
    await writeFile(join(root, 'main.ts'), 'const start = 1;');
    await explore({ root, objective: 'Find start', model: { async complete(messages: any[]) {
      const prompt = messages[0].content;
      assert.match(prompt, /"name"\s*:/);
      assert.match(prompt, /"evidence"\s*:\s*\[/);
      assert.match(prompt, /"from"\s*:/);
      assert.match(prompt, /"endLine"\s*:/);
      return { result: { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
    } } });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an exploration returns a verified entry point from a workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-'));
  try {
    await writeFile(join(root, 'main.ts'), 'export function start() { return 42; }\n');
    const model = {
      async complete(messages: unknown[]) {
        if (messages.length === 2) return { toolCalls: [{ id: '1', name: 'search', arguments: { query: 'start' } }] };
        return { result: { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
      }
    };
    const result = await explore({ root, objective: 'Find start', model });
    assert.equal(result.entryPoints[0].evidence[0].file, 'main.ts');
    assert.equal(result.entryPoints[0].evidence[0].startLine, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a run stopped by its iteration budget returns an explicit partial result and metrics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-'));
  try {
    await writeFile(join(root, 'main.ts'), 'const start = 1;\n');
    const result = await explore({ root, objective: 'Find start', budget: { iterations: 2 }, model: {
      async complete() { return { toolCalls: [{ id: '1', name: 'search', arguments: { query: 'start' } }], usage: { inputTokens: 20, outputTokens: 5 } }; }
    } });
    assert.equal(result.status, 'partial');
    assert.equal(result.stopReason, 'iterations');
    assert.equal(result.metrics.inputTokens, 20);
    assert.equal(result.metrics.outputTokens, 5);
    assert.equal(result.metrics.modelCalls, 2);
    assert.equal(result.metrics.toolCalls, 1);
    assert.deepEqual(result.entryPoints, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a model cannot cite a line outside the workspace file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-'));
  try {
    await writeFile(join(root, 'main.ts'), 'const start = 1;');
    await assert.rejects(explore({ root, objective: 'Find start', model: { async complete() {
      return { result: { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 5, endLine: 5 }] }], components: [], relations: [], uncertainties: [] } };
    } } }), /outside a file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('code mode lets the model filter workspace evidence before receiving it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-'));
  try {
    await writeFile(join(root, 'main.ts'), 'const start = 1;');
    const result = await explore({ root, objective: 'Find start', codeMode: true, model: { async complete(messages) {
      if (messages.length === 2) return { toolCalls: [{ id: '1', name: 'code', arguments: { code: 'search("start")' } }] };
      assert.match(messages.at(-1).content, /main\.ts/);
      return { result: { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
    } } });
    assert.equal(result.status, 'complete');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a stalled model is interrupted by the duration budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-'));
  try {
    const result = await explore({ root, objective: 'Find start', budget: { durationMs: 30 }, model: { async complete() { return new Promise(() => {}); } } });
    assert.equal(result.status, 'partial');
    assert.equal(result.stopReason, 'duration');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('model output cannot cite a file outside the workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-'));
  try {
    await assert.rejects(explore({ root, objective: 'Find secrets', model: { async complete() {
      return { result: { objective: 'Find secrets', entryPoints: [{ name: 'outside', evidence: [{ file: '../outside', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
    } } }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a trailing newline does not create an extra evidence line', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-'));
  try {
    await writeFile(join(root, 'main.ts'), 'const start = 1;\n');
    await assert.rejects(explore({ root, objective: 'Find start', model: { async complete() {
      return { result: { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 2, endLine: 2 }] }], components: [], relations: [], uncertainties: [] } };
    } } }), /outside a file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('final evidence is checked against current file contents rather than the read cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-'));
  try {
    await writeFile(join(root, 'main.ts'), 'first\nsecond\n');
    await assert.rejects(explore({ root, objective: 'Find second', model: { async complete(messages) {
      if (messages.length === 2) return { toolCalls: [{ id: '1', name: 'read', arguments: { file: 'main.ts' } }] };
      await writeFile(join(root, 'main.ts'), 'first\n');
      return { result: { objective: 'Find second', entryPoints: [{ name: 'second', evidence: [{ file: 'main.ts', startLine: 2, endLine: 2 }] }], components: [], relations: [], uncertainties: [] } };
    } } }), /outside a file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('an empty ungrounded answer cannot complete exploration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-'));
  try {
    const result = await explore({ root, objective: 'Explain start', model: { async complete() {
      return { result: { objective: 'Explain start', entryPoints: [], components: [], relations: [], uncertainties: ['No evidence yet.'] }, usage: { inputTokens: 10, outputTokens: 5 } };
    } } });
    assert.equal(result.status, 'partial');
    assert.equal(result.stopReason, 'evidence_missing');
    assert.equal(result.metrics.modelCalls, 3);
    assert.equal(result.metrics.inputTokens, 20);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an initial empty answer gets one chance to explore within the same budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-'));
  try {
    await writeFile(join(root, 'main.ts'), 'const start = 1;');
    let calls = 0;
    const result = await explore({ root, objective: 'Find start', model: { async complete(messages) {
      calls++;
      if (calls === 1) return { result: { objective: 'Find start', entryPoints: [], components: [], relations: [], uncertainties: ['No evidence yet.'] } };
      if (calls === 2) {
        assert.match(messages.at(-1).content, /tools/);
        return { toolCalls: [{ id: 'read', name: 'read', arguments: { file: 'main.ts' } }] };
      }
      return { result: { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
    } } });
    assert.equal(result.status, 'complete');
    assert.equal(result.metrics.toolCalls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the graph respects iteration budgets above its default recursion limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-'));
  try {
    let call = 0;
    const result = await explore({ root, objective: 'Find start', budget: { iterations: 30, calls: 100 }, model: { async complete() {
      return { toolCalls: [{ id: 'list', name: 'list', arguments: { maxFiles: ++call } }] };
    } } });
    assert.equal(result.stopReason, 'iterations');
    assert.equal(result.metrics.modelCalls, 30);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed exploration preserves effective model identity and provider usage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-failure-provenance-'));
  const modelConfig = { model: 'offline-model', temperature: 0, maxOutputTokens: 100 };
  try {
    await assert.rejects(explore({ root, objective: 'Malformed provider result', model: {
      snapshot: () => modelConfig,
      async complete() { return { result: { malformed: true }, usage: { inputTokens: 10, outputTokens: 2 } }; },
    } }), error => {
      const failure = (error as Error & { exploration: any }).exploration;
      assert.deepEqual(failure.modelConfig, modelConfig);
      assert.equal(failure.metrics.inputTokens, 20);
      assert.equal(failure.metrics.outputTokens, 4);
      assert.equal(failure.metrics.modelCalls, 3);
      assert.equal(failure.status, 'failed');
      return true;
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('citation corrections continue inside the original budget with all tokens counted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-citation-recovery-'));
  try {
    await writeFile(join(root, 'main.ts'), 'const start = 1;\n');
    let calls = 0;
    const result = await explore({ root, objective: 'Find start', budget: { iterations: 4 }, model: { async complete(messages) {
      calls++;
      if (calls > 1) assert.match(messages.at(-1).content, /main\.ts/);
      return { result: { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: calls < 3 ? 5 : 1, endLine: calls < 3 ? 5 : 1 }] }], components: [], relations: [], uncertainties: [] }, usage: { inputTokens: 10, outputTokens: 2 } };
    } } });
    assert.equal(result.status, 'complete');
    assert.equal(result.metrics.modelCalls, 4);
    assert.equal(result.metrics.inputTokens + result.metrics.outputTokens, 36);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('direct read tools show an explicit source line number beside every line', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-numbered-read-'));
  try {
    await writeFile(join(root, 'main.ts'), 'first\nsecond\nthird\n');
    await explore({ root, objective: 'Find second', codeMode: true, model: { async complete(messages) {
      if (messages.length === 2) return { toolCalls: [{ id: 'read', name: 'readLines', arguments: { file: 'main.ts', startLine: 2, endLine: 3 } }] };
      const output = JSON.parse(messages.at(-1).content);
      assert.deepEqual(output.result.lines, [{ line: 2, text: 'second' }, { line: 3, text: 'third' }]);
      return { result: { objective: 'Find second', entryPoints: [{ name: 'second', evidence: [{ file: 'main.ts', startLine: 2, endLine: 2 }] }], components: [], relations: [], uncertainties: [] } };
    } } });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('overlapping source reads warn about repeated context without blocking new pages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-overlap-'));
  try {
    await writeFile(join(root, 'main.ts'), Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n'));
    const reads = [[10, 30], [11, 31], [12, 32], [50, 60]];
    const notes: string[] = [];
    let step = 0;
    const result = await explore({ root, objective: 'Inspect lines', codeMode: true, model: { async complete(messages) {
      const last = messages.at(-1);
      if (last?.role === 'tool') notes.push(last.content);
      if (step < reads.length) {
        const [startLine, endLine] = reads[step++];
        return { toolCalls: [{ id: `read${step}`, name: 'readLines', arguments: { file: 'main.ts', startLine, endLine } }] };
      }
      return { result: { objective: 'Inspect lines', entryPoints: [{ name: 'line 50', evidence: [{ file: 'main.ts', startLine: 50, endLine: 50 }] }], components: [], relations: [], uncertainties: [] } };
    } } });
    assert.equal(result.status, 'complete');
    assert.doesNotMatch(notes[1], /overlap.*earlier/i);
    assert.match(notes[2], /overlap.*earlier/i);
    assert.doesNotMatch(notes[3], /overlap.*earlier/i);
    assert.ok(result.callTrace.some(item => item.name === 'overlapping_read_guard'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an overlap warning that cannot fit a full page is retried on a smaller page', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-overlap-fit-'));
  try {
    await writeFile(join(root, 'main.ts'), Array.from({ length: 50 }, (_, i) => `line ${i + 1} ${'x'.repeat(65)}`).join('\n'));
    const ranges = [[1, 30], [1, 31], [1, 32], [1, 5]];
    const notes: string[] = [];
    let step = 0;
    const result = await explore({ root, objective: 'Inspect lines', codeMode: true, config: { ...DEFAULT_CONFIG, context: { ...DEFAULT_CONFIG.context, maxResultBytes: 1100 } }, model: { async complete(messages) {
      const last = messages.at(-1);
      if (last?.role === 'tool') notes.push(last.content);
      if (step < ranges.length) {
        const [startLine, endLine] = ranges[step++];
        return { toolCalls: [{ id: `read${step}`, name: 'readLines', arguments: { file: 'main.ts', startLine, endLine } }] };
      }
      return { result: { objective: 'Inspect lines', entryPoints: [{ name: 'line 1', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
    } } });
    assert.equal(result.status, 'complete');
    assert.doesNotMatch(notes[2], /overlap.*earlier/i);
    assert.match(notes[3], /overlap.*earlier/i);
    assert.ok(result.callTrace.some(item => item.name === 'overlapping_read_guard'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an identical successful call is warned on the second result and stops the run on the third', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-repeat-'));
  try {
    await writeFile(join(root, 'main.ts'), 'const start = 1;');
    const seen: string[] = [];
    const result = await explore({ root, objective: 'Find start', model: { async complete(messages: any[]) {
      const last = messages.at(-1);
      if (last?.role === 'tool') seen.push(String(last.content));
      return { toolCalls: [{ id: `c${seen.length}`, name: 'list', arguments: {} }] };
    } } });
    assert.equal(result.stopReason, 'repeated_call');
    assert.equal(result.status, 'partial');
    assert.doesNotMatch(seen[0], /already returned the same result/);
    assert.match(seen[1], /already returned the same result/);
    assert.ok(result.callTrace.some((item: any) => item.name === 'repeated_call_guard'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('searches skip configured exclusions while the default hides research reports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-exclude-'));
  try {
    await mkdir(join(root, '.tours', 'research-reports'), { recursive: true });
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, '.tours', 'research-reports', 'old.json'), 'needle');
    await writeFile(join(root, 'docs', 'spec.md'), 'needle');
    await writeFile(join(root, 'main.ts'), 'needle');
    const files = async (tools: Awaited<ReturnType<typeof workspace>>) => (await tools.searchText('needle')).items.map((hit: any) => hit.file).sort();
    assert.deepEqual(await files(await workspace(root, { exclude: DEFAULT_CONFIG.search.exclude })), ['docs/spec.md', 'main.ts']);
    assert.deepEqual(await files(await workspace(root, { exclude: ['docs'] })), ['.tours/research-reports/old.json', 'main.ts']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('sandbox searches and reusable procedures respect configured search exclusions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-sandbox-exclude-'));
  try {
    await mkdir(join(root, '.tours', '.memory'), { recursive: true });
    await mkdir(join(root, 'excluded'));
    await writeFile(join(root, '.tours', '.memory', 'catalog.json'), 'needle');
    await writeFile(join(root, 'excluded', 'generated.ts'), 'needle');
    await writeFile(join(root, 'main.ts'), 'const needle = 1;\n');
    const config = { ...DEFAULT_CONFIG, search: { exclude: ['.tours/.memory', 'excluded'] } };
    let step = 0;
    const result = await explore({ root, objective: 'Find needle', codeMode: true, memory: { directory: join(root, '.tours', '.memory') }, config, model: { async complete(messages) {
      if (step++ === 0) return { toolCalls: [
        { id: 'direct', name: 'searchText', arguments: { query: 'needle' } },
        { id: 'trial', name: 'function_try', arguments: { source: '((p: { query: string }) => searchIdentifiers(p.query))', params: { query: 'needle' }, name: 'findNeedle', description: 'Searches for a symbol and returns source matches with file and line numbers.' } }
      ] };
      if (step === 2) {
        const outputs = messages.filter((message: any) => message.role === 'tool').slice(-2).map((message: any) => JSON.parse(message.content).result);
        assert.deepEqual(outputs.map((items: any[]) => items.map(item => item.file)), [['main.ts'], ['main.ts']]);
        return { result: { objective: 'Find needle', entryPoints: [{ name: 'needle', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
      }
      return { result: { selected: [] } };
    } } });
    assert.equal(result.status, 'complete');
  } finally { await rm(root, { recursive: true, force: true }); }
});
