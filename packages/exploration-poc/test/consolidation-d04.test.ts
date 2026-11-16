import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptMemory, validateDescription } from '../src/memory.ts';
import type { ConsolidationCandidate } from '../src/memory.ts';

/**
 * Issue #187 (D04) — keep only verified procedures with an English description.
 * The model proposes; a deterministic validator decides persistence. These
 * tests cover the pure description rule and the append-only catalogue gates
 * at the store seam; harness-level scenarios live further below in this file.
 */

const baseCandidate = (overrides: Partial<ConsolidationCandidate> = {}): ConsolidationCandidate => ({
  objective: 'Find the PostgreSQL index declarations',
  description: 'Searches the SQL scripts of the repository for declared index declarations. Returns one match per declaration with file, line and text, capped at fifty matches.',
  name: 'searchPostgresIndexes',
  code: 'search(params.query)',
  parameters: ['query'],
  verified: true,
  consolidationSignal: { executedSuccessfully: true, proofAvailable: true, contractRespected: true },
  replay: { ok: true, citations: 'valid' },
  ...overrides
});

async function withStore(run: (store: Awaited<ReturnType<typeof scriptMemory>>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'd04-store-'));
  try {
    await run(await scriptMemory(root, join(root, 'memory')));
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('validateDescription accepts one or two bounded English sentences', () => {
  assert.deepEqual(validateDescription('Returns the repository index declarations with file, line and text.'), { ok: true });
  assert.deepEqual(validateDescription('Searches the SQL scripts of the repository for index declarations. Returns one match per declaration with file, line and text.'), { ok: true });
});

test('validateDescription refuses an empty description with a precise reason', () => {
  for (const description of ['', '   ', '\t\n']) {
    const check = validateDescription(description);
    assert.equal(check.ok, false);
    assert.match(check.reason ?? '', /mandatory/i);
    assert.match(check.reason ?? '', /what the procedure does/i);
  }
});

test('validateDescription refuses off-format descriptions (not one or two sentences)', () => {
  for (const description of ['Find a literal', 'Index declarations', 'Returns a. Returns b. Returns c. Fourth sentence here.']) {
    const check = validateDescription(description);
    assert.equal(check.ok, false, description);
    assert.match(check.reason ?? '', /one or two sentences/i);
  }
});

test('validateDescription refuses a disproportionately long description', () => {
  const check = validateDescription(`Returns the repository index declarations. ${'x'.repeat(400)}`);
  assert.equal(check.ok, false);
  assert.match(check.reason ?? '', /too long/i);
  assert.match(check.reason ?? '', /at most 300/);
});

test('validateDescription refuses non-English descriptions deterministically', () => {
  // Accented French text: refused on the printable-ASCII rule.
  const accented = validateDescription('Recherche des index déclarés dans les scripts SQL du dépôt.');
  assert.equal(accented.ok, false);
  assert.match(accented.reason ?? '', /English/i);
  // ASCII-only French without any common English word: refused on the word rule.
  const asciiFrench = validateDescription('Le chat cherche les index du depot.');
  assert.equal(asciiFrench.ok, false);
  assert.match(asciiFrench.reason ?? '', /English/i);
});

test('finish refuses a candidate whose description is empty, off-format or too long', async () => {
  await withStore(async store => {
    const report = await store.finish([], [
      baseCandidate({ name: 'probeRepoEmpty', description: '' }),
      baseCandidate({ name: 'probeRepoFormat', description: 'Find a literal' }),
      baseCandidate({ name: 'probeRepoFrench', description: 'Recherche des index déclarés dans les scripts SQL du dépôt.' }),
      baseCandidate({ name: 'probeRepoLength', description: `Returns matches. ${'y'.repeat(400)}` })
    ]);
    assert.equal(store.catalog().length, 0, 'no candidate may persist without a valid English description');
    assert.equal(report.accepted.length, 0);
    assert.match(report.rejected[0].reason, /Description refused: .*mandatory/);
    assert.match(report.rejected[1].reason, /Description refused: .*one or two sentences/);
    assert.match(report.rejected[2].reason, /Description refused: .*English/);
    assert.match(report.rejected[3].reason, /Description refused: .*too long/);
  });
});

test('an identifier collision is refused: the catalogue is append-only and never overwrites', async () => {
  await withStore(async store => {
    await store.finish([], [baseCandidate()]);
    const report = await store.finish([], [baseCandidate({ code: 'search(params.query).slice(0, 20)' })]);
    assert.equal(report.accepted.length, 0, 'a colliding candidate must not be persisted');
    assert.equal(store.catalog().length, 1, 'exactly one entry remains');
    assert.equal(report.rejected[0].name, 'searchPostgresIndexes');
    assert.match(report.rejected[0].reason, /Identifier collision/);
    assert.match(report.rejected[0].reason, /append-only/);
    // The validated entry is untouched: same code, same description, no rename.
    const entry = store.get('searchPostgresIndexes');
    assert.equal(entry?.code, 'search(params.query)');
    assert.equal(entry?.description, baseCandidate().description);
    assert.equal(store.catalog().filter(e => e.id.startsWith('searchPostgresIndexes')).length, 1, 'no suffixed shadow entry');
  });
});

test('a candidate without deterministic replay evidence is refused', async () => {
  await withStore(async store => {
    const missing = await store.finish([], [baseCandidate({ name: 'probeRepoUnreplayed', replay: undefined })]);
    assert.equal(missing.accepted.length, 0);
    assert.match(missing.rejected[0].reason, /Reconciliation replay missing/);
    const failed = await store.finish([], [baseCandidate({ name: 'probeRepoBrokenReplay', replay: { ok: false, reason: 'the re-execution did not reproduce the exact original output' } })]);
    assert.equal(failed.accepted.length, 0);
    assert.match(failed.rejected[0].reason, /Reconciliation replay failed: .*did not reproduce/);
    assert.equal(store.catalog().length, 0);
  });
});

test('decided duplicates stay visible: semantic dedup never gates this diagnostic', async () => {
  await withStore(async store => {
    const first = await store.finish([], [baseCandidate({ returns: 'SearchMatch[] {file,line,text}' })]);
    assert.deepEqual(first.accepted, ['searchPostgresIndexes']);
    // Same question + scope + contract under a DIFFERENT name: a decided
    // duplicate — it stays visible in the catalogue and in the report.
    const second = await store.finish([], [baseCandidate({
      name: 'findPostgresIndexDeclarations',
      code: 'search(params.query)',
      returns: 'SearchMatch[] {file,line,text}'
    })]);
    assert.equal(second.accepted.length, 1, 'the duplicate is appended, not refused');
    assert.deepEqual(second.duplicates, ['findPostgresIndexDeclarations'], 'the duplicate is reported for visibility');
    assert.equal(store.catalog().length, 2, 'both entries stay visible');
  });
});

test('the reconciliation log distinguishes proposed, replayed, accepted and rejected with a reason', async () => {
  await withStore(async store => {
    const accepted = await store.finish([], [baseCandidate()]);
    assert.deepEqual(accepted.reconciliation, [{ name: 'searchPostgresIndexes', proposed: true, replayed: true, accepted: true }]);
    await store.finish([], [baseCandidate({ code: 'search(params.query).slice(0, 1)' })]);
    const report = await store.finish([], [baseCandidate({ name: 'probeRepoUnverified', verified: false, replay: undefined })]);
    const rejected = report.reconciliation.find(entry => entry.name === 'probeRepoUnverified');
    assert.equal(rejected?.proposed, true);
    assert.equal(rejected?.replayed, false);
    assert.equal(rejected?.accepted, false);
    assert.match(rejected?.reason ?? '', /Non-executed or unverified/);
  });
});
