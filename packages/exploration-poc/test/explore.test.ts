import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explore } from '../src/explore.ts';

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
    const result = await explore({ root, objective: 'Find start', budget: { iterations: 1 }, model: {
      async complete() { return { toolCalls: [{ id: '1', name: 'search', arguments: { query: 'start' } }], usage: { inputTokens: 20, outputTokens: 5 } }; }
    } });
    assert.equal(result.status, 'partial');
    assert.equal(result.stopReason, 'iterations');
    assert.equal(result.metrics.inputTokens, 20);
    assert.equal(result.metrics.outputTokens, 5);
    assert.equal(result.metrics.modelCalls, 1);
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
