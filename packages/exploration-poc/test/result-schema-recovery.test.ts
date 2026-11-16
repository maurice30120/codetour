import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { explore } from '../src/explore.ts';

test('repairs a final result missing a required field without losing its evidence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'schema-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  const partial = { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], relations: [], uncertainties: [] };
  let calls = 0;
  const result = await explore({ root, objective: 'Find start', model: { async complete(messages) {
    if (calls++ === 0) return { result: partial, usage: { inputTokens: 10, outputTokens: 2 } };
    assert.match(messages.at(-1).content, /components/);
    assert.deepEqual(JSON.parse(messages.at(-2).content), partial);
    return { result: { ...partial, components: [] }, usage: { inputTokens: 12, outputTokens: 3 } };
  } } });
  assert.equal(result.status, 'complete');
  assert.equal(calls, 2);
  assert.equal(result.metrics.inputTokens, 22);
  assert.equal(result.entryPoints[0].evidence[0].file, 'main.ts');
});
