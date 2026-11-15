import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectPreflight, sourceDigest } from '../preflight.mjs';

async function workspace(context) {
  const root = await mkdtemp(join(tmpdir(), 'spec174-preflight-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'poc/benchmark/gate-evidence'), { recursive: true });
  await mkdir(join(root, 'packages/exploration-poc/src'), { recursive: true });
  await writeFile(join(root, 'packages/exploration-poc/src/explore.ts'), 'export const version = 1;');
  return root;
}

test('missing evidence and provider configuration produce NO-GO without creating results or a lock', async context => {
  const root = await workspace(context);
  const report = await inspectPreflight({ root, env: {} });
  assert.equal(report.verdict, 'NO-GO');
  assert.equal(report.campaign_started, false);
  assert.deepEqual(Object.keys(report.gates), ['G0', 'G1', 'G2', 'G3', 'G4', 'G5']);
  assert.equal(report.gates.G0.passed, false);
  assert.equal(report.gates.G5.passed, false);
  assert.ok(report.blockers.some(reason => reason.includes('MISTRAL_API_KEY')));
  await assert.rejects(readFile(join(root, 'poc/benchmark/manifest-lock.json')));
});

test('self-declared sentinel gate booleans cannot certify a native subagent or usage', async context => {
  const root = await workspace(context);
  await writeFile(join(root, 'poc/benchmark/gate-evidence/sentinel.json'), JSON.stringify({ g1Passed: true, g2Passed: true, execution: { agent: { name: 'vibe-cli' }, tokens: { input: 100, output: 50, total: 150 } } }));
  const report = await inspectPreflight({ root, env: {} });
  assert.equal(report.gates.G1.passed, false);
  assert.equal(report.gates.G2.passed, false);
});

test('test evidence stops being valid when the tested source changes', async context => {
  const root = await workspace(context);
  const sources = ['packages/exploration-poc', 'packages/exploration-sandbox'];
  const digest = sourceDigest(root, sources);
  await writeFile(join(root, 'poc/benchmark/gate-evidence/g0-conformance.json'), JSON.stringify({ gate: 'G0', passed: true, exit_code: 0, total_tests: 1, failed_count: 0, source_digest: digest, commands: ['node --test'], ran_at: new Date().toISOString() }));
  assert.equal((await inspectPreflight({ root, env: {} })).gates.G0.passed, true);
  await writeFile(join(root, 'packages/exploration-poc/src/explore.ts'), 'export const version = 2;');
  assert.equal((await inspectPreflight({ root, env: {} })).gates.G0.passed, false);
});

test('the CLI exits with NO-GO and does not start a provider call', async context => {
  const root = await workspace(context);
  const run = spawnSync(process.execPath, [new URL('../preflight.mjs', import.meta.url).pathname, '--root', root], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(run.status, 2);
  assert.equal(JSON.parse(run.stdout).verdict, 'NO-GO');
  assert.equal(JSON.parse(run.stdout).campaign_started, false);
});
