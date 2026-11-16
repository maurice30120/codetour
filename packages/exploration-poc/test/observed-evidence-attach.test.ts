import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explore } from '../src/explore.ts';

// Regression captured on the 2026-11-17 zai-glm-5-3-flash run: the model declared
// a component without evidence and the run died on the schema. The harness now
// attaches observed (file, line) references from the tool trace itself.
test('an empty evidence array is filled from observed tool outputs instead of failing the schema', async () => {
  const root = await mkdtemp(join(tmpdir(), 'observed-evidence-'));
  try {
    await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
    const model = {
      async complete(messages: unknown[]) {
        if (messages.length === 2) return { toolCalls: [{ id: '1', name: 'search', arguments: { query: 'start' } }] };
        return { result: { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [] }], components: [], relations: [], uncertainties: [] } };
      }
    };
    const result = await explore({ root, objective: 'Find start', model });
    assert.equal(result.status, 'complete');
    assert.deepEqual(result.entryPoints[0].evidence, [{ file: 'main.ts', startLine: 1, endLine: 1 }]);
    assert.equal(result.metrics.autoAttachedEvidence, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an item the observed trace cannot anchor stays empty and turns into evidence_missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'observed-evidence-'));
  try {
    await writeFile(join(root, 'main.ts'), 'const start = 1;\n');
    const model = {
      async complete(messages: unknown[]) {
        if (messages.length === 2) return { toolCalls: [{ id: '1', name: 'search', arguments: { query: 'zzz_absent' } }] };
        return { result: { objective: 'Find start', entryPoints: [{ name: 'unrelated', evidence: [] }], components: [], relations: [], uncertainties: [] } };
      }
    };
    const result = await explore({ root, objective: 'Find start', model });
    assert.equal(result.status, 'partial');
    assert.equal(result.stopReason, 'evidence_missing');
    assert.equal(result.metrics.autoAttachedEvidence, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
