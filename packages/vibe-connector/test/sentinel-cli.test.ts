import { it } from 'node:test';
import assert = require('node:assert/strict');
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

it('sentinel CLI persists NO-GO at the requested output and refuses to replace prior proof', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'vibe-sentinel-'));
  try {
    const output = path.join(base, 'sentinel.json');
    const args = [path.join(__dirname, '../scripts/sentinel-execution.js'), '--fixture', base, '--output', output];
    const options = { env: { ...process.env, PATH: '', MISTRAL_API_KEY: '' }, encoding: 'utf8' as const };
    const first = spawnSync(process.execPath, args, options);
    assert.equal(first.status, 1);
    const proof = readFileSync(output, 'utf8');
    const manifest = JSON.parse(proof);
    assert.equal(manifest.status, 'NO-GO');
    assert.equal(manifest.execution, null);
    assert.equal(manifest.g1Passed, false);
    assert.equal(manifest.g2Passed, false);
    assert.ok(manifest.reasons.length > 0);
    const second = spawnSync(process.execPath, args, options);
    assert.equal(second.status, 1);
    assert.equal(readFileSync(output, 'utf8'), proof);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
