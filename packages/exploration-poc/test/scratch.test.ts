import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, existsSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanScratch, createScratch } from '../src/scratch.ts';

test('scratch preserves complete UTF-8 results in bounded pages and enforces the run limit', () => {
  const root = mkdtempSync(join(tmpdir(), 'scratch-test-'));
  try {
    const scratch = createScratch(root, 'run');
    const value = '😀é'.repeat(3000);
    assert.equal(scratch.save('call', value), true);
    let offset: number | null = 0;
    let restored = '';
    while (offset !== null) {
      const page = scratch.read('call', offset);
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 8000);
      restored += page.content;
      offset = page.nextOffset;
    }
    assert.equal(restored, value);
    assert.equal(scratch.save('too-large', 'x'.repeat(1_000_000)), false);
    assert.throws(() => scratch.read('../other', 0));
    scratch.cleanup();
    assert.equal(existsSync(join(root, '.tours/.scratch/run')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('cleanup keeps active or uncertain owners and removes only old dead owners', () => {
  const root = mkdtempSync(join(tmpdir(), 'scratch-test-'));
  try {
    const base = join(root, '.tours/.scratch');
    for (const [name, owner] of [['active', { pid: process.pid }], ['dead', { pid: 2147483647 }], ['unknown', {}]] as const) {
      const dir = join(base, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'owner.json'), JSON.stringify(owner));
      utimesSync(dir, 1, 1);
    }
    cleanScratch(root);
    assert.equal(existsSync(join(base, 'active')), true);
    assert.equal(existsSync(join(base, 'unknown')), true);
    assert.equal(existsSync(join(base, 'dead')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
