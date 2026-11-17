import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

test('CLI forwards per-run budgets and model configuration and emits measured failure traces', async t => {
  const root = await mkdtemp(join(tmpdir(), 't02-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const preload = join(root, 'transport.mjs');
  await writeFile(preload, `globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.model !== 'fixture-model' || body.temperature !== 0.3 || body.max_tokens !== 50) throw new Error('configuration lost');
    if (!body.tools) return new Response(JSON.stringify({ choices: [{message: {content: JSON.stringify({understand: ['inspect'], investigate: ['find evidence'], reuse: []})}}], usage: {prompt_tokens: 0, completion_tokens: 0}}));
    return new Response(JSON.stringify({ choices: [{message: {content: JSON.stringify({objective: 'inspect', entryPoints: [{name: 'missing', evidence: [{file: 'missing.ts', startLine: 1, endLine: 1}]}], components: [], relations: [], uncertainties: []})}}], usage: {prompt_tokens: 31, completion_tokens: 7}}));
  };`);
  const child = spawnSync(process.execPath, ['--import', preload, cli, '--code', '--memory', join(await realpath(root), '.tours', '.memory'), '--workspace', root, '--tokens', '50', '--duration-ms', '10000', '--model', 'fixture-model', '--temperature', '0.3', 'inspect'], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, MISTRAL_API_KEY: 'fixture-key' }
  });
  assert.equal(child.status, 1);
  const report = JSON.parse(child.stdout);
  assert.equal(report.status, 'failed');
  assert.equal(report.metrics.inputTokens, 31);
  assert.equal(report.metrics.outputTokens, 7);
  assert.equal(report.callTrace[0].usageMissing, false);
});

test('output file captures a successful result and a measured failure without stdout JSON', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cli-output-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const preload = join(root, 'transport.mjs');
  await writeFile(preload, `globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (!body.tools) return new Response(JSON.stringify({ choices: [{message: {content: JSON.stringify({understand: ['inspect'], investigate: ['find evidence'], reuse: []})}}], usage: {prompt_tokens: 0, completion_tokens: 0}}));
    const entryPoints = process.env.TEST_FAILURE ? [{name: 'missing', evidence: [{file: 'missing.ts', startLine: 1, endLine: 1}]}] : [];
    return new Response(JSON.stringify({ choices: [{message: {content: JSON.stringify({objective: 'inspect', entryPoints, components: [], relations: [], uncertainties: []})}}], usage: {prompt_tokens: 31, completion_tokens: 7}}));
  };`);
  for (const failing of [false, true]) {
    const output = join(root, `result-${failing}.json`);
    const child = spawnSync(process.execPath, ['--import', preload, cli, '--workspace', root, '--output-file', output, 'inspect'], {
      encoding: 'utf8', timeout: 15000, env: { ...process.env, MISTRAL_API_KEY: 'fixture-key', TEST_FAILURE: failing ? '1' : '' }
    });
    assert.equal(child.status, failing ? 1 : 0, child.stderr);
    const summary = JSON.parse(child.stdout);
    assert.equal(summary.outputFile, output);
    assert.equal(summary.status, failing ? 'failed' : 'partial');
    assert.equal(summary.tokens.input >= 31, true);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.status, failing ? 'failed' : 'partial');
    assert.ok(report.metrics.inputTokens >= 31);
    const phases = (await readFile(`${output}.progress`, 'utf8')).trim().split('\n').map(line => JSON.parse(line).phase);
    assert.equal(phases[0], 'plan');
    assert.ok(phases.includes('investigate'));
    assert.equal(phases.at(-1), 'end');
    const plan = (await readFile(`${output}.progress`, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).find(event => event.plan);
    assert.deepEqual(plan.plan.understand, ['inspect']);
  }
});

test('output file write errors are reported on stderr', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cli-output-error-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, [cli, '--output-file', join(root, 'missing', 'result.json'), '--workspace', join(root, 'missing'), 'inspect'], { encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /Unable to write output file/);
});

test('CLI refuses a live lock on the output file and replaces a stale one', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 't02-lock-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = join(root, 'result.json');
  const lockDir = join(root, '.tours', '.log', 'locks');
  const lock = join(lockDir, `${createHash('sha256').update(out).digest('hex')}.lock`);
  await mkdir(lockDir, { recursive: true });
  const run = () => spawnSync(process.execPath, [cli, '--workspace', root, '--output-file', out, 'question'], { encoding: 'utf8', timeout: 15000, env: { ...process.env, MISTRAL_API_KEY: '' } });
  await writeFile(lock, JSON.stringify({ pid: process.pid }));
  const live = run();
  assert.equal(live.status, 1);
  assert.match(live.stderr, /Run already active/);
  await assert.rejects(readFile(out, 'utf8'));
  await writeFile(lock, JSON.stringify({ pid: 2 ** 22 + 1 }));
  assert.doesNotMatch(run().stderr, /Run already active/);
  await assert.rejects(readFile(lock, 'utf8'));
});
