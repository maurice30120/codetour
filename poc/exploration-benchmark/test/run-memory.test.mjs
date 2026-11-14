import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('paired memory sequences preserve isolated cold libraries, task order, failures and honest metrics', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'memory-comparison-test-'));
  try {
    const output = path.join(temp, 'runs');
    const run = spawnSync(process.execPath, [path.join(base, 'run-memory.mjs'), '--adapter', process.execPath, '--arg', path.join(base, 'test/fake-memory-adapter.mjs'), '--output', output, '--repetitions', '1'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const summary = JSON.parse(await readFile(path.join(output, 'summary.json'), 'utf8'));
    assert.equal(summary.runs.length, 68);
    for (const order of [1, 2]) {
      const on = summary.runs.filter(row => row.order === order && row.mode === 'memory-on');
      const off = summary.runs.filter(row => row.order === order && row.mode === 'memory-off');
      assert.deepEqual(on.map(row => row.taskId), off.map(row => row.taskId));
      assert.equal(on[0].taskId, 'function');
      assert.equal(on[15].taskId, 'function');
      assert.ok(on.slice(1, 15).every(row => row.taskId !== 'function'));
      const first = JSON.parse(await readFile(path.join(output, `${on[0].id}.stdout.json`), 'utf8'));
      const last = JSON.parse(await readFile(path.join(output, `${on[16].id}.stdout.json`), 'utf8'));
      assert.equal(first.count, 1);
      assert.equal(last.count, 17);
      assert.equal(first.root, last.root);
      assert.equal(first.changed, false);
      assert.equal(last.changed, true);
      assert.equal(on[16].scenario, 'changed-code');
      assert.equal(on[1].status, 'process_error');
      assert.equal(on[1].exitCode, 7);
    }
    assert.equal(summary.summary['memory-on'].metrics.inputTokens.median, null);
    assert.equal(summary.summary['memory-on'].failed, 2);
    assert.equal(summary.summary['memory-on'].metrics.cost.total, null);
    assert.equal(summary.costPerCorrectExploration, null);
    assert.equal(summary.verdict, 'non_concluant_sans_revue_manuelle');
  } finally { await rm(temp, { recursive: true, force: true }); }
});
