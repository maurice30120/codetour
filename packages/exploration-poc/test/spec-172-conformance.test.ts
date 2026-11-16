/**
 * Spec #172 G0 conformance — executable checks against the REAL implementations
 * (no placeholders): the sandbox constraints, the memory catalogue contract,
 * and #174 additions (nesting rejection, bounded outputs, canonical naming).
 * Ported from a vitest scaffold whose assertions were largely tautologies.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspace } from '../src/workspace.ts';
import { scriptMemory, validateCanonicalName } from '../src/memory.ts';
import { runScript } from '../../exploration-sandbox/index.js';

let tempDir = '';

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'codetour-g0-'));
  await mkdir(join(tempDir, 'src'), { recursive: true });
  await mkdir(join(tempDir, 'lib'), { recursive: true });
  await writeFile(join(tempDir, 'src/index.ts'), `export function main() { return 'hello'; }`);
  await writeFile(join(tempDir, 'src/utils.ts'), `export function helper() { return 42; }`);
  await writeFile(join(tempDir, 'lib/config.json'), `{ "version": "1.0" }`);
  await writeFile(join(tempDir, 'README.md'), `# Test Project\n\nThis is a test.`);
});

describe('Spec #172 G0 — sandbox constraints (real execution)', () => {
  it('runs whitelisted primitives inside the sandbox', async () => {
    const files = await runScript({ workspace: tempDir, code: 'listFiles().length', params: {}, timeoutMs: 3000 });
    assert.equal(typeof files, 'number');
    assert.ok(files >= 4, `expected at least the four written files, got ${files}`);
    const matches = await runScript({ workspace: tempDir, code: 'search("helper")', params: {}, timeoutMs: 3000 });
    assert.ok(Array.isArray(matches));
    assert.ok(matches.some((m: any) => m.file === 'src/utils.ts' && m.text.includes('helper')));
  });

  it('executes TypeScript with params and returns the result', async () => {
    const result = await runScript({ workspace: tempDir, code: 'const x: number = 42; x + params.added', params: { added: 8 }, timeoutMs: 3000 });
    assert.equal(result, 50);
  });

  it('rejects invalid TypeScript and infinite loops (bounded execution)', async () => {
    await assert.rejects(runScript({ workspace: tempDir, code: 'const x: number =;', params: {}, timeoutMs: 3000 }), /Sandbox failed|validation/i);
    await assert.rejects(runScript({ workspace: tempDir, code: 'while(true) {}', params: {}, timeoutMs: 200 }), /abort|timeout|Terminated/i);
  });

  it('enforces input bounds on code and params', async () => {
    await assert.rejects(runScript({ workspace: tempDir, code: 'x'.repeat(33000), params: {}, timeoutMs: 1000 }), /Invalid sandbox input/);
    await assert.rejects(runScript({ workspace: tempDir, code: 'params.x', params: { big: 'y'.repeat(9000) }, timeoutMs: 1000 }), /parameters|Invalid/);
  });

  it('#174: rejects memorized-procedure nesting and memory tools inside memorized code', async () => {
    await assert.rejects(
      runScript({ workspace: tempDir, code: 'searchApiFunctions(params.q)', params: { q: 'x' }, scripts: { searchApiFunctions: 'search(params.q)' }, timeoutMs: 2000 }),
      /NESTING_REJECTED/
    );
    await assert.rejects(
      runScript({ workspace: tempDir, code: 'memory_run(params.id)', params: { id: 'x' }, scripts: { searchApiFunctions: 'search(params.q)' }, timeoutMs: 2000 }),
      /NESTING_REJECTED/
    );
  });
});

describe('Spec #172 G0 — workspace primitives guard the fixture boundary', () => {
  it('refuses paths outside the workspace, oversized queries and missing files', async () => {
    const ws = await workspace(tempDir);
    await assert.rejects(ws.stat({ path: '../etc/passwd' }));
    await assert.rejects(ws.searchText('a'.repeat(300)));
    await assert.rejects(ws.readLines('nonexistent.ts', { startLine: 1, endLine: 1 }));
  });

  it('exposes bounded search with source locations', async () => {
    const ws = await workspace(tempDir);
    const result = await ws.searchText('export');
    assert.ok(result.items.length > 0);
    for (const item of result.items.slice(0, 3)) {
      assert.equal(typeof item.file, 'string');
      assert.equal(typeof item.line, 'number');
    }
    assert.ok(result.items.length <= 50, 'MAX_SEARCH_RESULTS bound');
  });
});

describe('Spec #172 G0 — memory catalogue contract', () => {
  it('memory_list(query) filters the projection; projection carries NO function source', async () => {
    const memory = await scriptMemory(tempDir, join(tempDir, 'memory'));
    await memory.finish([], [{
      objective: 'Trouver les index PostgreSQL', description: 'Searches the SQL scripts of the repository for declared index declarations. Returns one match per declaration with file, line and text.',
      name: 'searchPostgresIndexes', code: 'search(params.query)', parameters: ['query'], verified: true,
      consolidationSignal: { executedSuccessfully: true, proofAvailable: true, contractRespected: true }, replay: { ok: true }
    }]);
    const all = memory.memory_list();
    assert.equal(all.length, 1);
    assert.ok(!('code' in all[0]));
    assert.deepEqual(memory.memory_list('absent-query-xy'), []);
    const filtered = memory.memory_list('index');
    assert.equal(filtered.length, 1);
    // memory_run returns the wiring descriptor, throws for unknown ids.
    const known = await memory.memory_run('searchPostgresIndexes', { query: 'x' });
    assert.equal(known.id, 'searchPostgresIndexes');
    assert.throws(() => memory.memory_run('unknown-id', {}), /Unknown script/);
  });

  it('G0: no inactivity purge — entries survive untouched runs; failure rule purges only clearly-failed entries', async () => {
    const memory = await scriptMemory(tempDir, join(tempDir, 'memory'));
    const candidate = {
      objective: 'Trouver les index PostgreSQL', description: 'Searches the SQL scripts of the repository for declared index declarations. Returns one match per declaration with file, line and text.',
      name: 'searchPostgresIndexes', code: 'search(params.query)', parameters: ['query'], verified: true,
      consolidationSignal: { executedSuccessfully: true, proofAvailable: true, contractRespected: true }, replay: { ok: true }
    };
    await memory.finish([], [candidate]);
    for (let i = 0; i < 15; i++) await memory.finish(['none'], []); // dry evaluated runs, never reused
    assert.equal(memory.catalog().length, 1, 'no inactivity-based purge');
    memory.recordFailure('searchPostgresIndexes');
    memory.recordFailure('searchPostgresIndexes');
    await memory.finish([], []);
    assert.equal(memory.catalog().length, 0, '2 failures in 3 attempts => clearly failed => purged');
    void validateCanonicalName;
  });

  it('#174: naming convention rejects non-conforming names with a clear error', () => {
    assert.equal(validateCanonicalName('searchPostgresIndexes').ok, true);
    const bad = validateCanonicalName('search_indexes');
    assert.equal(bad.ok, false);
    assert.match(bad.reason ?? '', /camelCase/);
  });
});
