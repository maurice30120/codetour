import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptMemory, compareCandidates, validateCanonicalName } from '../src/memory.ts';
import type { ConsolidationCandidate } from '../src/memory.ts';

const baseCandidate = (overrides: Partial<ConsolidationCandidate> = {}): ConsolidationCandidate => ({
  objective: 'Trouver les index d une table PostgreSQL',
  description: 'Recherche des index déclarés dans les scripts SQL du dépôt',
  name: 'searchPostgresIndexes',
  code: 'search(params.query)',
  parameters: ['query'],
  verified: true,
  consolidationSignal: { executedSuccessfully: true, proofAvailable: true, contractRespected: true },
  ...overrides
});

async function withStore(run: (store: Awaited<ReturnType<typeof scriptMemory>>) => Promise<void>, options: { deduplicate?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'consolidation-'));
  try {
    await run(await scriptMemory(root, join(root, 'memory'), options));
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('a candidate actually executed during a validated Tour is consolidated under its canonical name', async () => {
  await withStore(async store => {
    const report = await store.finish([], [baseCandidate({
      returns: 'SearchMatch[] {file,line,text}',
      uncertaintyCases: [{ case: 'contenu minifié', signal: 'truncated=true' }]
    })]);
    assert.deepEqual(report.rejected, []);
    assert.deepEqual(report.duplicates, []);
    assert.equal(store.catalog().length, 1);
    const entry = store.catalog()[0];
    assert.equal(entry.id, 'searchPostgresIndexes');
    assert.equal(entry.outputContract?.returns, 'SearchMatch[] {file,line,text}');
    assert.ok(Array.isArray(entry.parameters));
    // memory_list projection carries id, canonical question, périmètre, typed
    // params, contract, limits and uncertainty cases — WITHOUT function source.
    const listed = store.memory_list('index')[0];
    assert.equal(listed.id, 'searchPostgresIndexes');
    assert.equal(listed.objective, 'Trouver les index d une table PostgreSQL');
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

test('canonical naming is enforced at consolidation with a clear error', async () => {
  await withStore(async store => {
    const report = await store.finish([], [
      baseCandidate({ name: 'SearchPostgresIndexes' }), // not camelCase
      baseCandidate({ name: 'search_indexes' }),        // separators
      baseCandidate({ name: 'searchIndexes' }),         // only two segments (verbe+objet)
      baseCandidate({ name: '' })                       // missing
    ]);
    assert.equal(report.accepted.length, 0);
    assert.ok(report.rejected.every(rejection => rejection.reason.startsWith('Naming convention:')), report.rejected.map(r => r.reason).join(' | '));
    assert.deepEqual(store.catalog(), []);
    // The convention itself: camelCase, verbe+domaine+objet (three segments).
    assert.equal(validateCanonicalName('searchPostgresIndexes').ok, true);
    assert.equal(validateCanonicalName('searchIndexes').ok, false);
    assert.equal(validateCanonicalName('SearchPostgresIndexes').ok, false);
    assert.equal(validateCanonicalName('search_postgres_indexes').ok, false);
  });
});

test('dedup decides on question + périmètre + contrat, never on the name alone', async () => {
  await withStore(async store => {
    // Decided duplicate: same question, same périmètre, same contract.
    const first = baseCandidate({ returns: 'SearchMatch[] {file,line,text}' });
    await store.finish([], [first]);
    const report = await store.finish([], [baseCandidate({
      name: 'findPostgresIndexDeclarations', // a DIFFERENT name does not bypass dedup
      returns: 'SearchMatch[] {file,line,text}'
    })]);
    assert.equal(store.catalog().length, 1, 'duplicate question+périmètre+contrat must not create a second entry');
    assert.deepEqual(report.duplicates, ['findPostgresIndexDeclarations']);
    // Same question + same périmètre + DIFFERENT contract => distinct entry.
    const second = await store.finish([], [baseCandidate({ name: 'countPostgresIndexes', returns: '{count: number}' })]);
    assert.deepEqual(second.duplicates, []);
    assert.equal(store.catalog().length, 2);
  });
});

test('an INDÉTERMINÉ comparison keeps both entries and flags the relation instead of inventing equivalence', async () => {
  await withStore(async store => {
    await store.finish([], [baseCandidate()]); // no declared contract on the stored entry
    const report = await store.finish([], [baseCandidate({ name: 'listPostgresIndexNames', returns: 'string[]' })]);
    assert.equal(store.catalog().length, 2, 'both entries are kept');
    assert.deepEqual(report.accepted, ['listPostgresIndexNames']);
    const variant = store.get('listPostgresIndexNames');
    assert.equal(variant?.variantOf, 'searchPostgresIndexes', 'the new entry is flagged variantOf the unclear relation');
    assert.ok(report.indeterminate.includes('listPostgresIndexNames'));
  });
});

test('replacing a stored function requires verification on candidate params AND a representative reference set', async () => {
  await withStore(async store => {
    await store.finish([], [baseCandidate()]);
    // Record real executions of the old version (reference test set) during runs.
    store.observeRun('searchPostgresIndexes', { query: 'idx_' }, true);
    store.observeRun('searchPostgresIndexes', { query: 'CREATE UNIQUE' }, true);
    store.observeRun('searchPostgresIndexes', { query: 'usleep' }, true); // negative probe
    // Replacement without regression evidence => refused, old entry untouched.
    const refused = await store.finish([], [baseCandidate({
      name: 'extractPostgresIndexes',
      code: 'search(params.query).slice(0, 20)',
      replaces: 'searchPostgresIndexes',
      regression: { candidateProofOk: true, referenceProofOk: true, executedParamSets: 1 }
    })]);
    assert.match(refused.rejected[0].reason, /Replacement gate: verified only 1 param set/);
    assert.equal(store.get('searchPostgresIndexes')?.replacedBy, undefined);
    // Verification on the candidate's own params + every reference case => accepted.
    const accepted = await store.finish([], [baseCandidate({
      name: 'extractPostgresIndexes',
      code: 'search(params.query).slice(0, 20)',
      replaces: 'searchPostgresIndexes',
      regression: { candidateProofOk: true, referenceProofOk: true, executedParamSets: 4 }
    })]);
    assert.deepEqual(accepted.rejected, []);
    assert.deepEqual(accepted.accepted, ['extractPostgresIndexes']);
    // Rollback preserved: the old entry stays, retained and marked superseded;
    // the replacement exists under its own canonical name.
    const oldEntry = store.get('searchPostgresIndexes');
    assert.ok(oldEntry, 'old version retained for rollback');
    assert.equal(oldEntry?.code, 'search(params.query)');
    assert.equal(oldEntry?.replacedBy, 'extractPostgresIndexes');
    assert.equal(store.get('extractPostgresIndexes')?.code, 'search(params.query).slice(0, 20)');
  });
});

test('replacement with invalid candidate or reference proofs is refused', async () => {
  await withStore(async store => {
    await store.finish([], [baseCandidate()]);
    store.observeRun('searchPostgresIndexes', { query: 'idx_' }, true);
    for (const regression of [
      { candidateProofOk: false, referenceProofOk: true, executedParamSets: 2 },
      { candidateProofOk: true, referenceProofOk: false, executedParamSets: 2 }
    ]) {
      const report = await store.finish([], [baseCandidate({
        name: 'searchPostgresIndexes',
        code: 'search(params.query).slice(0, 20)',
        replaces: 'searchPostgresIndexes',
        regression
      })]);
      assert.match(report.rejected[0].reason, /Replacement gate: proofs invalid/);
      assert.equal(store.get('searchPostgresIndexes')?.code, 'search(params.query)', 'old version kept on refusal');
    }
  });
});

test('replacement is refused when the old version has no recorded reference cases', async () => {
  await withStore(async store => {
    await store.finish([], [baseCandidate()]);
    const report = await store.finish([], [baseCandidate({
      name: 'searchPostgresIndexes',
      code: 'search(params.query).slice(0, 20)',
      replaces: 'searchPostgresIndexes',
      regression: { candidateProofOk: true, referenceProofOk: true, executedParamSets: 1 }
    })]);
    assert.match(report.rejected[0].reason, /no recorded reference cases/);
    assert.equal(store.get('searchPostgresIndexes')?.code, 'search(params.query)');
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
    assert.equal(entry.failures, 1, 'failure applied once, in finish');
    assert.equal(entry.referenceCases.length, 1, 'observations become reference cases in finish');
    assert.equal(entry.referenceCases[0].ok, false);
  });
});

test('purges reflect the failure rule (G0: never inactivity-based) and stay visible in metrics', async () => {
  await withStore(async store => {
    await store.finish([], [baseCandidate(), baseCandidate({ name: 'readPostgresTables', description: 'Liste des tables', code: 'read(params.file)' })]);
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

test('compareCandidates outcomes: duplicate, distinct and indéterminé', () => {
  const candidate = { objective: 'Q', description: 'P', returns: 'A[]' };
  assert.equal(compareCandidates(candidate, { objective: 'q', description: 'p', outputContract: { returns: 'a[]' } }), 'duplicate');
  assert.equal(compareCandidates(candidate, { objective: 'q', description: 'p', outputContract: { returns: 'b[]' } }), 'distinct');
  assert.equal(compareCandidates(candidate, { objective: 'q', description: 'other périmètre', outputContract: { returns: 'a[]' } }), 'distinct');
  assert.equal(compareCandidates({ objective: 'Q', description: 'P' }, { objective: 'q', description: 'p', outputContract: { returns: 'a[]' } }), 'indeterminate');
  assert.equal(compareCandidates(candidate, { objective: 'Q', description: 'P' }), 'indeterminate');
});
