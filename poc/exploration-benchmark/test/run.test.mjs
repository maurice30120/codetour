import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('comparison preserves failures, reports unavailable metrics and keeps expectations out of requests', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'comparison-test-'));
  try {
    const output = path.join(temp, 'runs');
    const run = spawnSync(process.execPath, [path.join(base, 'run.mjs'), '--adapter', process.execPath, '--arg', path.join(base, 'test/fake-adapter.mjs'), '--output', output, '--repetitions', '1'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const summary = JSON.parse(await readFile(path.join(output, 'summary.json'), 'utf8'));
    assert.equal(summary.runs.length, 6);
    assert.equal(summary.summary.baseline.failed, 1);
    assert.equal(summary.summary.baseline.metrics.inputTokens.median, 7);
    assert.equal(summary.summary.baseline.metrics.cost.median, null);
    assert.equal(summary.summary.baseline.metrics.cost.missing, 3);
    assert.equal(summary.runs.find(row => row.id === '01-function-code-mode').assessment.covered[0], 'calculation');
    assert.equal(summary.runs.find(row => row.id === '01-function-code-mode').explorationStatus, 'partial');
    assert.equal(summary.runs.find(row => row.id === '01-function-code-mode').stopReason, 'iterations');
    assert.equal(summary.summary['code-mode'].metrics.calls.median, 5);
    assert.equal(summary.summary['code-mode'].metrics.volumeReturnedBytes.median, 40);
    assert.equal(summary.summary['code-mode'].metrics.inputTokens.median, null);
    assert.equal(summary.summary['code-mode'].metrics.outputTokens.missing, 3);
    assert.equal(summary.byTask.function['code-mode'].runs, 1);
    const failure = JSON.parse(await readFile(path.join(output, '01-class-baseline.meta.json'), 'utf8'));
    assert.equal(failure.status, 'process_error');
    assert.equal(failure.exitCode, 3);
    const rerun = spawnSync(process.execPath, [path.join(base, 'run.mjs'), '--adapter', process.execPath, '--arg', path.join(base, 'test/fake-adapter.mjs'), '--output', output, '--repetitions', '1']);
    assert.notEqual(rerun.status, 0);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
