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

// ============================================================================
// Harness–memory boundary (issue #187): full Tour scenarios driven through
// explore() with a deterministic model stub — the model proposes, the
// deterministic validator decides, no second LLM judge.
// ============================================================================

import { mkdir, writeFile } from 'node:fs/promises';
import { explore } from '../src/explore.ts';
import type { ConsolidationReport } from '../src/memory.ts';

const emptyResult = { objective: 'Inspect repository', entryPoints: [], components: [], relations: [], uncertainties: [] };
const DESCRIPTION = 'Searches the repository for the requested symbol. Returns each match with file, line and text, capped at fifty matches.';
const SEARCH_SOURCE = '((input: { query: string }) => searchText(input.query))';

async function fixtureRepo(base: string) {
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'main.ts'), 'export function start() { return 1; }\n');
  return root;
}

test('a full Tour: the proposal is replayed with the same code and params, all citations re-checked, and only the validated function persists', async t => {
  const base = await mkdtemp(join(tmpdir(), 'd04-full-tour-'));
  const root = await fixtureRepo(base);
  t.after(() => rm(base, { recursive: true, force: true }));
  const memory = { directory: join(base, 'memory') };
  let step = 0;
  const first = await explore({ root, objective: 'Explain start', codeMode: true, memory, model: { async complete(messages) {
    if (step++ === 0) return { toolCalls: [{ id: 'trial', name: 'function_try', arguments: { source: SEARCH_SOURCE, params: { query: 'start' }, remember: true, name: 'traceRepoEntryPoints', question: 'Where is an entry point declared?', description: DESCRIPTION } }] };
    if (step === 2) return { result: { ...emptyResult, entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }] } };
    assert.match(messages[0].content, /select/i, 'the sanctioned proposal step is the only LLM call in the reconciliation');
    return { result: { selected: ['traceRepoEntryPoints'] } };
  } } });
  // The reconciliation replay re-executed the exact same params...
  const trial = first.callTrace.find(call => call.type === 'function_try' && call.name === 'function_try');
  const replay = first.callTrace.find(call => call.name === 'consolidation-validation');
  assert.ok(trial && replay, 'both the trial and the reconciliation replay are traced');
  assert.equal(trial.parameters?.remember, true);
  const selection = first.callTrace.find(call => call.name === 'memory-selection');
  assert.deepEqual((selection?.parameters?.executedCandidates as Array<{ name: string }>).map(candidate => candidate.name), ['traceRepoEntryPoints']);
  assert.deepEqual(selection?.result, { response: { selected: ['traceRepoEntryPoints'] }, toolCalls: undefined, selected: ['traceRepoEntryPoints'], budgetStop: null });
  assert.deepEqual(replay.execution && (replay.execution as { parameters?: unknown }).parameters, { query: 'start' });
  assert.deepEqual(replay.execution && (replay.execution as { parameters?: unknown }).parameters, trial.execution && (trial.execution as { parameters?: unknown }).parameters, 'the replay used the exact same params');
  // ...and re-checked every citation on the replayed output.
  assert.match(replay.outcome ?? '', /reexecuted; citations=1 valid/);
  const report = first.consolidationReport as ConsolidationReport;
  assert.deepEqual(report.accepted, ['traceRepoEntryPoints']);
  assert.ok(report.reconciliation.some(entry => entry.name === 'traceRepoEntryPoints' && entry.proposed && entry.replayed && entry.accepted));
  // memory_list exposes description, canonical question, typed params, output
  // schema and limits — WITHOUT the source code.
  const store = await scriptMemory(root, memory.directory);
  const listed = store.memory_list('entry point')[0];
  assert.equal(listed.id, 'traceRepoEntryPoints');
  assert.equal(listed.description, DESCRIPTION);
  assert.equal(listed.objective, 'Where is an entry point declared?');
  assert.deepEqual(listed.paramsSchema, [{ name: 'query', type: 'string' }]);
  assert.ok(listed.outputContract?.returns);
  assert.ok(listed.limits?.maxItems);
  assert.ok(!('code' in listed), 'memory_list must not expose the source code');
  // A later Tour replays the consolidated procedure through memory_run.
  let reuseStep = 0;
  const second = await explore({ root, objective: 'Show start', codeMode: true, memory, model: { async complete(messages) {
    if (reuseStep++ === 0) return { toolCalls: [{ id: 'reuse', name: 'memory_run', arguments: { id: listed.id, params: { query: 'start' } } }] };
    assert.equal(JSON.parse(messages.at(-1).content).result[0].file, 'main.ts');
    return { result: emptyResult };
  } } });
  assert.equal(second.metrics.memoryReuses, 1, 'memory_run replayed the procedure added by the earlier Tour');
});

test('a selected candidate whose trial output is not cited in the final Tour still persists when the replay re-validates it', async t => {
  // Run-1 regression (#194): the model answered the final Tour from evidence
  // other than the trial output; the retained-evidence overlap must not gate
  // persistence — the deterministic replay already re-checks every citation.
  const base = await mkdtemp(join(tmpdir(), 'd194-uncited-'));
  const root = await fixtureRepo(base);
  await writeFile(join(root, 'notes.md'), 'unrelated notes\n');
  t.after(() => rm(base, { recursive: true, force: true }));
  const memory = { directory: join(base, 'memory') };
  let step = 0;
  const first = await explore({ root, objective: 'Explain start', codeMode: true, memory, model: { async complete(messages) {
    if (step++ === 0) return { toolCalls: [{ id: 'trial', name: 'function_try', arguments: { source: SEARCH_SOURCE, params: { query: 'start' }, name: 'traceRepoEntryPoints', question: 'Where is an entry point declared?', description: DESCRIPTION } }] };
    // The final Tour cites only a different file: the trial output (main.ts)
    // contributes nothing to the retained evidence.
    if (step === 2) return { result: { ...emptyResult, components: [{ name: 'other', evidence: [{ file: 'notes.md', startLine: 1, endLine: 1 }] }] } };
    return { result: { selected: ['traceRepoEntryPoints'] } };
  } } });
  const report = first.consolidationReport as ConsolidationReport;
  assert.deepEqual(report.accepted, ['traceRepoEntryPoints'], 'replay + citation re-validation decide persistence, not final-Tour overlap');
  assert.equal((await scriptMemory(root, memory.directory)).catalog().length, 1);
});

test('a candidate the model does not select is logged as such and never persists', async t => {
  const base = await mkdtemp(join(tmpdir(), 'd04-not-proposed-'));
  const root = await fixtureRepo(base);
  t.after(() => rm(base, { recursive: true, force: true }));
  const memory = { directory: join(base, 'memory') };
  let step = 0;
  const result = await explore({ root, objective: 'Explain start', codeMode: true, memory, model: { async complete(messages) {
    if (step++ === 0) return { toolCalls: [{ id: 'trial', name: 'function_try', arguments: { source: SEARCH_SOURCE, params: { query: 'start' }, remember: true, name: 'traceRepoEntryPoints', question: 'Where is an entry point declared?', description: DESCRIPTION } }] };
    if (step === 2) return { result: { ...emptyResult, entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }] } };
    assert.match(messages[0].content, /select/i);
    return { result: { selected: [] } };
  } } });
  const report = result.consolidationReport as ConsolidationReport;
  assert.deepEqual((result.callTrace.find(call => call.name === 'memory-selection')?.result as { response: unknown }).response, { selected: [] });
  assert.deepEqual(report.accepted, []);
  assert.deepEqual(report.reconciliation, [{ name: 'traceRepoEntryPoints', proposed: false, replayed: false, accepted: false, reason: 'Not selected by the model for consolidation' }]);
  assert.equal((await scriptMemory(root, memory.directory)).catalog().length, 0);
});

test('a candidate abandoned through memory_unusable never persists, even if executed and valid', async t => {
  const base = await mkdtemp(join(tmpdir(), 'd04-abandoned-'));
  const root = await fixtureRepo(base);
  t.after(() => rm(base, { recursive: true, force: true }));
  const memory = { directory: join(base, 'memory') };
  let step = 0;
  const result = await explore({ root, objective: 'Explain start', codeMode: true, memory, model: { async complete() {
    if (step === 0) { step++; return { toolCalls: [{ id: 'trial', name: 'function_try', arguments: { source: SEARCH_SOURCE, params: { query: 'start' }, remember: true, name: 'traceRepoEntryPoints', question: 'Where is an entry point declared?', description: DESCRIPTION } }] }; }
    if (step === 1) { step++; return { toolCalls: [{ id: 'abandon', name: 'memory_unusable', arguments: { id: 'traceRepoEntryPoints' } }] }; }
    return { result: { ...emptyResult, entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }] } };
  } } });
  const report = result.consolidationReport as ConsolidationReport;
  assert.deepEqual(report.accepted, []);
  assert.deepEqual(report.reconciliation, [{ name: 'traceRepoEntryPoints', proposed: false, replayed: false, accepted: false, reason: 'Marked unusable by memory_unusable during the Tour' }]);
  assert.equal((await scriptMemory(root, memory.directory)).catalog().length, 0);
});

test('a failed trial and a citation-invalid trial never persist, even when the model recommends their names', async t => {
  const base = await mkdtemp(join(tmpdir(), 'd04-recommended-refused-'));
  const root = await fixtureRepo(base);
  t.after(() => rm(base, { recursive: true, force: true }));
  const memory = { directory: join(base, 'memory') };
  const fabricated = '((input: { tag: string }) => [{ file: \'main.ts\', line: 1, text: \'fabricated excerpt\' }])';
  const broken = '((input: { query: string }) => unknownPrimitive(params.query))';
  let step = 0;
  const result = await explore({ root, objective: 'Explain start', codeMode: true, memory, model: { async complete(messages) {
    if (step === 0) { step++; return { toolCalls: [{ id: 'broken', name: 'function_try', arguments: { source: broken, params: { query: 'start' }, remember: true, name: 'traceRepoBroken', question: 'Broken?', description: DESCRIPTION } }] }; }
    if (step === 1) { step++; return { toolCalls: [{ id: 'fabricated', name: 'function_try', arguments: { source: fabricated, params: { tag: 'x' }, remember: true, name: 'traceRepoFabricated', question: 'Which line declares start?', description: DESCRIPTION } }] }; }
    if (step === 2) { step++; return { toolCalls: [{ id: 'good', name: 'function_try', arguments: { source: SEARCH_SOURCE, params: { query: 'start' }, remember: true, name: 'traceRepoEntryPoints', question: 'Where is an entry point declared?', description: DESCRIPTION } }] }; }
    if (step === 3) { step++; return { result: { ...emptyResult, entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }] } }; }
    assert.match(messages[0].content, /select/i);
    return { result: { selected: ['traceRepoBroken', 'traceRepoFabricated', 'traceRepoEntryPoints'] } };
  } } });
  const report = result.consolidationReport as ConsolidationReport;
  // Only the actually executed, citation-valid candidate is consolidated —
  // the failed and citation-invalid recommendations are ignored.
  assert.deepEqual(report.accepted, ['traceRepoEntryPoints']);
  const store = await scriptMemory(root, memory.directory);
  assert.equal(store.catalog().length, 1);
  assert.ok(store.get('traceRepoEntryPoints'));
  assert.ok(!store.get('traceRepoBroken'));
  assert.ok(!store.get('traceRepoFabricated'));
});

test('off-format and oversized descriptions are refused deterministically with a precise reason', async t => {
  const base = await mkdtemp(join(tmpdir(), 'd04-descriptions-'));
  const root = await fixtureRepo(base);
  t.after(() => rm(base, { recursive: true, force: true }));
  const memory = { directory: join(base, 'memory') };
  const tooLong = `Returns the repository matches for the requested symbol. ${'z'.repeat(400)}`;
  let step = 0;
  const result = await explore({ root, objective: 'Explain start', codeMode: true, memory, model: { async complete(messages) {
    if (step === 0) { step++; return { toolCalls: [{ id: 'format', name: 'function_try', arguments: { source: SEARCH_SOURCE, params: { query: 'start' }, remember: true, name: 'traceRepoBadFormat', question: 'Where is an entry point declared?', description: 'Find a literal' } }] }; }
    if (step === 1) { step++; return { toolCalls: [{ id: 'long', name: 'function_try', arguments: { source: SEARCH_SOURCE, params: { query: 'start' }, remember: true, name: 'traceRepoTooLong', question: 'Where is an entry point declared?', description: tooLong } }] }; }
    if (step === 2) { step++; return { result: { ...emptyResult, entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }] } }; }
    assert.match(messages[0].content, /select/i);
    return { result: { selected: ['traceRepoBadFormat', 'traceRepoTooLong'] } };
  } } });
  const report = result.consolidationReport as ConsolidationReport;
  assert.deepEqual(report.accepted, []);
  assert.equal(report.rejected.length, 2);
  assert.match(report.rejected[0].reason, /Description refused: .*one or two sentences/);
  assert.match(report.rejected[1].reason, /Description refused: .*too long/);
  for (const name of ['traceRepoBadFormat', 'traceRepoTooLong']) {
    const entry = report.reconciliation.find(item => item.name === name);
    assert.equal(entry?.proposed, true);
    assert.equal(entry?.replayed, true);
    assert.equal(entry?.accepted, false);
    assert.match(entry?.reason ?? '', /Description refused/);
  }
  assert.equal((await scriptMemory(root, memory.directory)).catalog().length, 0);
});

test('an identifier collision in a later Tour is refused: the validated entry is never overwritten', async t => {
  const base = await mkdtemp(join(tmpdir(), 'd04-collision-'));
  const root = await fixtureRepo(base);
  t.after(() => rm(base, { recursive: true, force: true }));
  const memory = { directory: join(base, 'memory') };
  const refined = '((input: { query: string }) => searchText(input.query).slice(0, 5))';
  let step = 0;
  const first = await explore({ root, objective: 'Explain start', codeMode: true, memory, model: { async complete(messages) {
    if (step++ === 0) return { toolCalls: [{ id: 'trial', name: 'function_try', arguments: { source: SEARCH_SOURCE, params: { query: 'start' }, remember: true, name: 'traceRepoEntryPoints', question: 'Where is an entry point declared?', description: DESCRIPTION } }] };
    if (step === 2) return { result: { ...emptyResult, entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }] } };
    return { result: { selected: ['traceRepoEntryPoints'] } };
  } } });
  assert.deepEqual((first.consolidationReport as ConsolidationReport).accepted, ['traceRepoEntryPoints']);
  step = 0;
  const second = await explore({ root, objective: 'Explain start again', codeMode: true, memory, model: { async complete(messages) {
    if (step++ === 0) return { toolCalls: [{ id: 'trial', name: 'function_try', arguments: { source: refined, params: { query: 'start' }, remember: true, name: 'traceRepoEntryPoints', question: 'Where is an entry point declared?', description: DESCRIPTION } }] };
    if (step === 2) return { result: { ...emptyResult, entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }] } };
    return { result: { selected: ['traceRepoEntryPoints'] } };
  } } });
  const report = second.consolidationReport as ConsolidationReport;
  assert.deepEqual(report.accepted, []);
  assert.equal(report.rejected.length, 1);
  assert.match(report.rejected[0].reason, /Identifier collision/);
  assert.match(report.rejected[0].reason, /append-only/);
  // The validated entry is untouched — same code, no overwrite, no shadow id.
  const store = await scriptMemory(root, memory.directory);
  assert.equal(store.catalog().length, 1);
  assert.equal(store.get('traceRepoEntryPoints')?.code, SEARCH_SOURCE);
});

// ============================================================================
// Issue #194: every successfully-executed function_try trial is automatically
// submitted to post-Tour selection — the model never has to flag it with
// remember. The model judges future utility at selection; the harness decides
// persistence through deterministic validations only.
// ============================================================================

test('a successful trial without remember is auto-proposed, selected, deterministically validated, persisted and reused in a later Tour', async t => {
  const base = await mkdtemp(join(tmpdir(), 'd194-auto-propose-'));
  const root = await fixtureRepo(base);
  t.after(() => rm(base, { recursive: true, force: true }));
  const memory = { directory: join(base, 'memory') };
  let step = 0;
  const first = await explore({ root, objective: 'Explain start', codeMode: true, memory, model: { async complete(messages) {
    // The trial carries NO remember flag: the harness must submit it anyway.
    if (step++ === 0) return { toolCalls: [{ id: 'trial', name: 'function_try', arguments: { source: SEARCH_SOURCE, params: { query: 'start' }, name: 'traceRepoEntryPoints', question: 'Where is an entry point declared?', description: DESCRIPTION } }] };
    if (step === 2) return { result: { ...emptyResult, entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }] } };
    // The selection step receives the auto-submitted candidate with its code,
    // its contract and a summary of its result.
    assert.match(messages[0].content, /select/i);
    const input = JSON.parse(messages.at(-1).content);
    assert.equal(input.executedCandidates.length, 1);
    assert.equal(input.executedCandidates[0].name, 'traceRepoEntryPoints');
    assert.equal(input.executedCandidates[0].code, SEARCH_SOURCE);
    assert.deepEqual(input.executedCandidates[0].paramsSchema, [{ name: 'query', type: 'string' }]);
    assert.ok(input.executedCandidates[0].returns, 'the output contract reaches the selection step');
    assert.equal(input.executedCandidates[0].output.result[0].file, 'main.ts');
    return { result: { selected: ['traceRepoEntryPoints'] } };
  } } });
  // The trace field stays: the model did not set remember, the harness proposed anyway.
  const trial = first.callTrace.find(call => call.type === 'function_try' && call.name === 'function_try');
  assert.equal(trial?.parameters?.remember, false);
  const selection = first.callTrace.find(call => call.name === 'memory-selection');
  assert.deepEqual((selection?.parameters?.executedCandidates as Array<{ name: string }>).map(candidate => candidate.name), ['traceRepoEntryPoints']);
  const report = first.consolidationReport as ConsolidationReport;
  assert.deepEqual(report.accepted, ['traceRepoEntryPoints'], 'a trial without remember is selected, replayed and persisted');
  assert.ok(report.reconciliation.some(entry => entry.name === 'traceRepoEntryPoints' && entry.proposed && entry.replayed && entry.accepted));
  // A later Tour replays the consolidated procedure through memory_run.
  const listed = (await scriptMemory(root, memory.directory)).memory_list('entry point')[0];
  assert.equal(listed.id, 'traceRepoEntryPoints');
  let reuseStep = 0;
  const second = await explore({ root, objective: 'Show start', codeMode: true, memory, model: { async complete(messages) {
    if (reuseStep++ === 0) return { toolCalls: [{ id: 'reuse', name: 'memory_run', arguments: { id: listed.id, params: { query: 'start' } } }] };
    assert.equal(JSON.parse(messages.at(-1).content).result[0].file, 'main.ts');
    return { result: emptyResult };
  } } });
  assert.equal(second.metrics.memoryReuses, 1, 'the function persisted without remember is reused in a later Tour');
});

test('a truncated successful trial is still submitted, flagged as truncated, and subject to the deterministic validation', async t => {
  const base = await mkdtemp(join(tmpdir(), 'd194-truncated-'));
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'many.ts'), Array.from({ length: 60 }, (_, index) => `needle ${index};`).join('\n') + '\n');
  t.after(() => rm(base, { recursive: true, force: true }));
  const memory = { directory: join(base, 'memory') };
  let step = 0;
  const result = await explore({ root, objective: 'Explain start', codeMode: true, memory, model: { async complete(messages) {
    if (step++ === 0) return { toolCalls: [{ id: 'trial', name: 'function_try', arguments: { source: SEARCH_SOURCE, params: { query: 'needle' }, name: 'traceRepoNeedles', question: 'Where are the needles declared?', description: DESCRIPTION } }] };
    if (step === 2) return { result: { ...emptyResult, entryPoints: [{ name: 'needle', evidence: [{ file: 'many.ts', startLine: 1, endLine: 1 }] }] } };
    assert.match(messages[0].content, /select/i);
    const input = JSON.parse(messages.at(-1).content);
    assert.equal(input.executedCandidates.length, 1, 'the truncated trial is still submitted');
    assert.equal(input.executedCandidates[0].output.truncated, true, 'the truncation is flagged, never presented as exhaustive');
    return { result: { selected: ['traceRepoNeedles'] } };
  } } });
  const report = result.consolidationReport as ConsolidationReport;
  assert.deepEqual(report.accepted, ['traceRepoNeedles'], 'the flagged truncated trial is validated by the deterministic replay and persists');
  assert.ok(report.reconciliation.some(entry => entry.name === 'traceRepoNeedles' && entry.replayed && entry.accepted));
});

test('a candidate from an unvalidated Tour never reaches the catalogue', async t => {
  const base = await mkdtemp(join(tmpdir(), 'd04-unvalidated-'));
  const root = await fixtureRepo(base);
  t.after(() => rm(base, { recursive: true, force: true }));
  const memory = { directory: join(base, 'memory') };
  let step = 0;
  const result = await explore({ root, objective: 'Explain start', codeMode: true, memory, budget: { iterations: 3 }, model: { async complete() {
    if (step++ === 0) return { toolCalls: [{ id: 'trial', name: 'function_try', arguments: { source: SEARCH_SOURCE, params: { query: 'start' }, remember: true, name: 'traceRepoEntryPoints', question: 'Where is an entry point declared?', description: DESCRIPTION } }] };
    return { toolCalls: [{ id: 'list', name: 'list', arguments: {} }] };
  } } });
  assert.equal(result.status, 'partial', 'the Tour never produced a validated structured result');
  assert.equal((await scriptMemory(root, memory.directory)).catalog().length, 0, 'no consolidation may run for an unvalidated Tour');
});
