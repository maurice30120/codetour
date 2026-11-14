import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runScript } from '../../../packages/exploration-sandbox/index.js';

const results = JSON.parse(await readFile(new URL('../results-generated-guided.json', import.meta.url), 'utf8'));
test('generated functions handle line boundaries, new symbols and a bounded number of hits', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'generated-tools-'));
  try {
    const lines = Array.from({ length: 180 }, (_, i) => i === 0 ? 'firstMarker' : i === 149 ? 'lateMarker' : i > 160 ? 'repeatedMarker' : 'nothing');
    await writeFile(path.join(root, 'fixture.js'), lines.join('\n'));
    for (const row of results.rows) {
      const code = row.generated.code;
      for (const [query, expected] of [['firstMarker', 1], ['lateMarker', 150]]) {
        const result = await runScript({ workspace: root, code, params: { query } });
        assert.ok(result.some(part => part.file === 'fixture.js' && part.start <= expected && part.start + part.lines.length - 1 >= expected));
      }
      assert.deepEqual(await runScript({ workspace: root, code, params: { query: 'absentMarker' } }), []);
      const repeated = await runScript({ workspace: root, code, params: { query: 'repeatedMarker' } });
      assert.equal(repeated.length, 6);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
