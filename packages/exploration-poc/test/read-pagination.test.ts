import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explore } from './fixture-explore.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

test('direct reads expose a usable cursor and long-line fragments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'direct-read-page-'));
  try {
    await writeFile(join(root, 'main.ts'), `${'x'.repeat(9000)}\n${Array.from({ length: 130 }, (_, i) => `line ${i + 2}`).join('\n')}`);
    let step = 0;
    await explore({ root, objective: 'Inspect main', codeMode: true, budget: { iterations: 4 }, model: { async complete(messages: any[]) {
      if (step++ === 0) return { toolCalls: [{ id: 'read', name: 'readLines', arguments: { file: 'main.ts', startLine: 1, endLine: 131 } }] };
      if (step === 2) {
        const output = JSON.parse(messages.at(-1).content);
        assert.ok(output.result.nextLine > 1 && output.result.nextLine <= 101);
        assert.deepEqual(output.result.truncatedLines, [1]);
        return { toolCalls: [{ id: 'fragment', name: 'readLineFragment', arguments: { file: 'main.ts', line: 1, offset: 0 } }] };
      }
      const output = JSON.parse(messages.at(-1).content);
      assert.ok(output.result.content.length > 0);
      assert.ok(output.result.nextOffset > 0);
      return { result: { objective: 'Inspect main', entryPoints: [], components: [], relations: [], uncertainties: [] } };
    } } });
    assert.ok(step >= 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('direct page keeps its cursor under a smaller configured output limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'direct-read-limit-'));
  try {
    await writeFile(join(root, 'main.ts'), Array.from({ length: 100 }, (_, i) => `${i + 1} ${'a'.repeat(50)}`).join('\n'));
    let step = 0;
    await explore({ root, objective: 'Inspect main', codeMode: true, budget: { iterations: 3 }, config: { ...DEFAULT_CONFIG, memoryOutput: { ...DEFAULT_CONFIG.memoryOutput, maxBytes: 1000 } }, model: { async complete(messages: any[]) {
      if (step++ === 0) return { toolCalls: [{ id: 'read', name: 'readLines', arguments: { file: 'main.ts', startLine: 1, endLine: 100 } }] };
      const output = JSON.parse(messages.at(-1).content);
      assert.ok(output.result.nextLine > 1);
      assert.equal(output.result.nextLine, output.result.lines.length + 1);
      return { result: { objective: 'Inspect main', entryPoints: [], components: [], relations: [], uncertainties: [] } };
    } } });
    assert.ok(step >= 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
