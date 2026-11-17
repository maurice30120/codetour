import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG, loadConfig, parseConfig } from '../src/config.ts';

test('a missing config file yields the defaults and a partial file overrides section by section', async t => {
  const root = await mkdtemp(join(tmpdir(), 'config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await loadConfig(root), DEFAULT_CONFIG);
  await mkdir(join(root, '.tours'));
  await writeFile(join(root, '.tours', 'config.json'), JSON.stringify({ budget: { tokens: 123 }, mistral: { model: 'm' } }));
  const config = await loadConfig(root);
  assert.equal(config.budget.tokens, 123);
  assert.equal(config.budget.calls, DEFAULT_CONFIG.budget.calls);
  assert.equal(config.mistral.model, 'm');
  assert.equal(config.limits.memorySynthesisAttempts, 5);
  assert.equal(parseConfig({ limits: { memorySynthesisAttempts: 2 } }).limits.memorySynthesisAttempts, 2);
});

test('unknown keys, wrong types and invalid values are rejected', () => {
  assert.throws(() => parseConfig({ budjet: {} }), /Unknown section budjet/);
  assert.throws(() => parseConfig({ budget: { tokens: '5' } }), /budget.tokens must be a number/);
  assert.throws(() => parseConfig({ budget: { tokens: 0 } }), /positive/);
  assert.throws(() => parseConfig({ mistral: { reasoningEffort: 'extreme' } }), /reasoningEffort/);
  assert.throws(() => parseConfig({ mistral: { temperature: 2 } }), /Temperature/);
  assert.throws(() => parseConfig({ limits: { memorySynthesisAttempts: 1.5 } }), /positive integer/);
});
