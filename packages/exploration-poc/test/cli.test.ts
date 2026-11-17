import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  const child = spawnSync(process.execPath, ['--import', preload, cli, '--code', '--memory', '--workspace', root, '--tokens', '50', '--duration-ms', '10000', 'inspect'], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, MISTRAL_API_KEY: 'fixture-key', MISTRAL_MODEL: 'fixture-model', MISTRAL_TEMPERATURE: '0.3' }
  });
  assert.equal(child.status, 1);
  const report = JSON.parse(child.stdout);
  assert.equal(report.status, 'failed');
  assert.equal(report.metrics.inputTokens, 31);
  assert.equal(report.metrics.outputTokens, 7);
  assert.equal(report.callTrace[0].usageMissing, false);
});
