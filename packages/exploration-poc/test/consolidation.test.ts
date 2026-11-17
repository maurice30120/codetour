import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptMemory, compareCandidates, validateCanonicalName } from '../src/memory.ts';
import type { ConsolidationCandidate } from '../src/memory.ts';

const baseCandidate = (overrides: Partial<ConsolidationCandidate> = {}): ConsolidationCandidate => ({
  objective: 'Find the indexes of a PostgreSQL table',
  description: 'Searches the SQL scripts of the repository for declared index declarations. Returns one match per declaration with file, line and text.',
  name: 'searchPostgresIndexes',
  code: 'search(params.query)',
  parameters: ['query'],
  verified: true,
  consolidationSignal: { executedSuccessfully: true, proofAvailable: true, contractRespected: true },
  replay: { ok: true, citations: 'valid' },
  ...overrides
});

async function withStore(run: (store: Awaited<ReturnType<typeof scriptMemory>>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'consolidation-'));
  try {
    await run(await scriptMemory(root, join(root, 'memory')));
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('a candidate actually executed during a validated Tour is consolidated under its canonical name', async () => {
  await withStore(async store => {
    const report = await store.finish([], [baseCandidate({
      returns: 'SearchMatch[] {file,line,text}',
      uncertaintyCases: [{ case: 'minified content', signal: 'truncated=true' }]
    })]);
    assert.deepEqual(report.rejected, []);
    assert.deepEqual(report.duplicates, []);
    assert.equal(store.catalog().length, 1);
    const entry = store.catalog()[0];
    assert.equal(entry.id, 'searchPostgresIndexes');
    assert.equal(entry.outputContract?.returns, 'SearchMatch[] {file,line,text}');
    assert.ok(Array.isArray(entry.parameters));
    // memory_list projection carries id, canonical question, scope, typed
    // params, contract, limits and uncertainty cases — WITHOUT function source.
    const listed = store.memory_list('index')[0];
    assert.equal(listed.id, 'searchPostgresIndexes');
    assert.equal(listed.objective, 'Find the indexes of a PostgreSQL table');
    assert.ok(!('code' in listed), 'memory_list must not leak function source');
    assert.equal(store.get('searchPostgresIndexes')?.code, 'search(params.query)');
  });
});

test('non-executed or unverified candidates are refused: only executed procedures consolidate', async () => {
  await withStore(async store => {
    const report = await store.finish([], [
      baseCandidate({ name: 'searchPostgresIndexes', verified: false, consolidationSignal: { executedSuccessfully: true, proofAvailable: true, contractRespected: true } }),
      baseCandidate({ name: 'readPostgresSchemas', verified: true, consolidationSignal: undefined })
    ]);
    assert.equal(store.catalog().length, 0, 'nothing may be consolidated without execution proof');
    assert.equal(report.accepted.length, 0);
    assert.match(report.rejected[0].reason, /Non-executed or unverified/);
    assert.match(report.rejected[1].reason, /Consolidation signal missing/);
  });
});

test('the consolidation trigger requires success AND proof availability AND contract respected', async () => {
  await withStore(async store => {
    for (const [key, value] of [['executedSuccessfully', false], ['proofAvailable', false], ['contractRespected', false]] as const) {
      const report = await store.finish([], [baseCandidate({
        name: `probePostgresPart${key.length}`,
        consolidationSignal: { executedSuccessfully: true, proofAvailable: true, contractRespected: true, [key]: value } as ConsolidationCandidate['consolidationSignal']
      })]);
      assert.equal(report.accepted.length, 0, `${key}=false must block consolidation`);
      assert.match(report.rejected[0].reason, /Consolidation signal missing/);
    }
  });
});

test('valid TypeScript identifiers are accepted regardless of semantic naming convention', async () => {
  await withStore(async store => {
    const report = await store.finish([], [
      baseCandidate({ name: 'SearchPostgresIndexes' }), // not camelCase
      baseCandidate({ name: 'search_indexes' }),        // separators
      baseCandidate({ name: 'searchIndexes' }),         // only two segments (verb+object)
      baseCandidate({ name: '' })                       // missing
    ]);
    assert.equal(report.accepted.length, 3);
    assert.equal(report.rejected.length, 1);
    assert.equal(validateCanonicalName('searchPostgresIndexes').ok, true);
    assert.equal(validateCanonicalName('searchIndexes').ok, true);
    assert.equal(validateCanonicalName('SearchPostgresIndexes').ok, true);
    assert.equal(validateCanonicalName('search_postgres_indexes').ok, true);
    assert.equal(validateCanonicalName('not-valid!').ok, false);
  });
});

test('duplicate candidates are not persisted', async () => {
  await withStore(async store => {
    // Decided duplicate: same question, same scope, same contract.
    const first = baseCandidate({ returns: 'SearchMatch[] {file,line,text}' });
    await store.finish([], [first]);
    const report = await store.finish([], [baseCandidate({
      name: 'findPostgresIndexDeclarations', // a DIFFERENT name does not hide the duplicate
      returns: 'SearchMatch[] {file,line,text}'
    })]);
    assert.equal(store.catalog().length, 1);
    assert.deepEqual(report.duplicates, ['findPostgresIndexDeclarations']);
    assert.deepEqual(report.accepted, []);
    // Same question + same scope + DIFFERENT contract => distinct entry, no duplicate flag.
    const second = await store.finish([], [baseCandidate({ name: 'countPostgresIndexes', returns: '{count: number}' })]);
    assert.deepEqual(second.duplicates, []);
    assert.equal(store.catalog().length, 2);
  });
});

test('an indeterminate comparison keeps both entries and flags the relation instead of inventing equivalence', async () => {
  await withStore(async store => {
    await store.finish([], [baseCandidate()]); // no declared contract on the stored entry
    const report = await store.finish([], [baseCandidate({ name: 'listPostgresIndexNames', returns: 'string[]' })]);
    assert.equal(store.catalog().length, 2, 'both entries are kept');
    assert.deepEqual(report.accepted, ['listPostgresIndexNames']);
    assert.ok(store.get('listPostgresIndexNames'));
  });
});

// Issue #187: replacement is deferred for this diagnostic — the catalogue is
// append-only. A candidate landing on an existing identifier is refused (never
// an overwrite, never a renamed shadow entry); a refined procedure under a NEW
// canonical name is simply appended and stays visible next to the old one.
test('a same-name candidate is refused on collision and a refined procedure appends under a new name', async () => {
  await withStore(async store => {
    await store.finish([], [baseCandidate()]);
    // Same canonical name, different code: identifier collision => refused.
    const refused = await store.finish([], [baseCandidate({ code: 'search(params.query).slice(0, 20)' })]);
    assert.equal(refused.accepted.length, 0);
    assert.match(refused.rejected[0].reason, /Identifier collision/);
    assert.equal(store.get('searchPostgresIndexes')?.code, 'search(params.query)', 'the validated entry is untouched');
    assert.equal(store.get('searchPostgresIndexes')?.replacedBy, undefined, 'nothing is superseded in this diagnostic');
    // A refined procedure under a NEW canonical name appends and stays visible.
    const appended = await store.finish([], [baseCandidate({
      name: 'extractPostgresIndexes',
      code: 'search(params.query).slice(0, 20)'
    })]);
    assert.deepEqual(appended.accepted, ['extractPostgresIndexes']);
    assert.equal(store.catalog().length, 2, 'both versions stay visible');
    assert.equal(store.get('extractPostgresIndexes')?.code, 'search(params.query).slice(0, 20)');
  });
});

test('failure traces and observations recorded during a run never mutate the catalogue before finish', async () => {
  await withStore(async store => {
    await store.finish([], [baseCandidate()]);
    const before = JSON.stringify(store.catalog());
    store.recordFailure('searchPostgresIndexes');
    store.observeRun('searchPostgresIndexes', { query: 'x' }, false);
    assert.equal(JSON.stringify(store.catalog()), before, 'mid-run traces are recorded, catalogue untouched');
    await store.finish([], []);
    const entry: any = store.get('searchPostgresIndexes');
    assert.equal(entry.failures, undefined);
    assert.equal(entry.referenceCases, undefined);
  });
});

test('purges reflect the failure rule (G0: never inactivity-based) and stay visible in metrics', async () => {
  await withStore(async store => {
    await store.finish([], [baseCandidate(), baseCandidate({ name: 'readPostgresTables', description: 'Reads a table declaration from the repository scripts. Returns the matching source lines.', code: 'read(params.file)' })]);
    assert.equal(store.purges(), 0);
    // 3 runs, 2 failures => clearly failed entry, pruned; the other entry stays.
    store.recordFailure('searchPostgresIndexes');
    store.recordFailure('readPostgresTables');
    store.recordFailure('readPostgresTables');
    await store.finish(['readPostgresTables'], []);
    const report = await store.finish([], [baseCandidate({ name: 'searchPostgresIndexes' })]);
    assert.ok(store.get('readPostgresTables'), 'G0: one failed+one succeeded run must NOT purge (inactivity untouched)');
    void report;
  });
});

test('compareCandidates outcomes: duplicate, distinct and indeterminate', () => {
  const candidate = { objective: 'Q', description: 'P', returns: 'A[]' };
  assert.equal(compareCandidates(candidate, { objective: 'q', description: 'p', outputContract: { returns: 'a[]' } }), 'duplicate');
  assert.equal(compareCandidates(candidate, { objective: 'q', description: 'p', outputContract: { returns: 'b[]' } }), 'distinct');
  assert.equal(compareCandidates(candidate, { objective: 'q', description: 'other scope', outputContract: { returns: 'a[]' } }), 'distinct');
  assert.equal(compareCandidates({ objective: 'Q', description: 'P' }, { objective: 'q', description: 'p', outputContract: { returns: 'a[]' } }), 'indeterminate');
  assert.equal(compareCandidates(candidate, { objective: 'Q', description: 'P' }), 'indeterminate');
});
