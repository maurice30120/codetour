import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explore } from '../src/explore.ts';

test('compact search marks truncation and suppresses only unchanged repeated results', async () => {
  const base = await mkdtemp(join(tmpdir(), 'compact-search-'));
  const { mkdir } = await import('node:fs/promises');
  const { scriptMemory } = await import('../src/memory.ts');
  const root = join(base, 'repo');
  await mkdir(root);
  try {
    const file = join(root, 'main.ts');
    await writeFile(file, Array.from({ length: 10 }, (_, i) => `const alpha${i} = 1;`).join('\n'));
    const memory = { directory: join(base, 'memory'), compactSearch: true };
    const store = await scriptMemory(root, memory.directory);
    await store.finish([], [{ objective: 'Find', description: 'Searches the repository for literal matches. Returns each match with file, line and text.', name: 'searchRepoLiterals', code: 'search(params.query)', parameters: ['query'], verified: true, consolidationSignal: { executedSuccessfully: true, proofAvailable: true, contractRespected: true }, replay: { ok: true } }]);
    const id = store.catalog()[0].id;
    let step = 0;
    const result = await explore({ root, objective: 'Find alpha', codeMode: true, memory, model: { async complete(messages) {
      if (step === 1) {
        const first = JSON.parse(messages.at(-1).content);
        assert.equal(first.matches.length, 8); assert.equal(first.truncated, true); assert.equal(first.searchIsBounded, true);
      }
      if (step === 2) {
        assert.equal(JSON.parse(messages.at(-1).content).repeated, true);
        await writeFile(file, 'const alpha = 2;\n');
      }
      if (step === 3) {
        const changed = JSON.parse(messages.at(-1).content);
        assert.equal(changed.repeated, undefined); assert.equal(changed.matches[0].text, 'const alpha = 2;');
        return { result: { objective: 'Find alpha', entryPoints: [{ name: 'alpha', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
      }
      step++;
      return { toolCalls: [{ id: `call${step}`, name: 'memory_run', arguments: { id, params: { query: 'alpha' } } }] };
    } } });
    assert.equal(result.metrics.memoryReuses, 3);
    assert.equal(result.metrics.memoryResultsRepeated, 1);
    assert.equal(result.metrics.memoryResultsCompacted, 2);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('decided duplicates stay visible and indeterminate comparisons flag the relation instead of merging it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-dedup-'));
  const { scriptMemory } = await import('../src/memory.ts');
  try {
    const directory = join(root, 'memory');
    const store = await scriptMemory(root, directory);
    const candidate = { objective: 'Search', description: 'Searches the repository for literal matches. Returns each match with file, line and text.', name: 'searchRepoLiterals', code: 'search(params.query)', parameters: ['query'], verified: true, returns: 'SearchMatch[] {file,line,text}', consolidationSignal: { executedSuccessfully: true, proofAvailable: true, contractRespected: true }, replay: { ok: true } };
    // Same question + scope + contract under ANOTHER name => a decided duplicate:
    // it stays visible in the catalogue (issue #187: append-only, no smart dedup).
    await store.finish([], [candidate, { ...candidate, name: 'findRepoLiterals' }]);
    assert.equal(store.catalog().length, 2, 'the duplicate is appended and stays visible');
    assert.ok(store.get('searchRepoLiterals'));
    assert.ok(store.get('findRepoLiterals'));
    // Same question + scope + DIFFERENT contract => a distinct entry.
    await store.finish([], [{ ...candidate, name: 'countRepoLiterals', code: 'search(params.query).length', returns: '{count: number}' }]);
    const catalog = store.catalog();
    assert.equal(catalog.length, 3);
    assert.equal(catalog.find(e => e.id === 'countRepoLiterals')?.variantOf, undefined);
    // Indeterminate comparison (the stored entry declares NO contract, the
    // candidate does): BOTH entries are kept, the new one flagged variantOf —
    // no invented equivalence.
    await store.finish([], [{ ...candidate, name: 'listRepoLiterals', code: 'search(params.query).slice(0, 5)', returns: undefined }]);
    await store.finish([], [{ ...candidate, name: 'indexRepoLiterals', code: 'search(params.query).slice(0, 8)', returns: 'SearchMatch[]' }]);
    const after = store.catalog();
    assert.equal(after.length, 5);
    assert.equal(after.find(e => e.id === 'indexRepoLiterals')?.variantOf, 'listRepoLiterals');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('declared literal search contract gives feedback and stores only the repaired candidate', async () => {
  const base = await mkdtemp(join(tmpdir(), 'query-contract-'));
  const { mkdir } = await import('node:fs/promises');
  const root = join(base, 'repo');
  await mkdir(root);
  const memory = { directory: join(base, 'memory'), queryContract: true };
  try {
    await writeFile(join(root, 'main.ts'), 'const alpha = 1;\n');
    let step = 0;
    await explore({ root, objective: 'Find alpha', codeMode: true, memory, model: { async complete(messages) {
      if (step++ === 0) return { toolCalls: [{ id: 'bad', name: 'function_try', arguments: { source: 'searchText("alpha")', params: { query: 'alpha' }, remember: true, name: 'findRepoLiteral', description: 'Finds a literal in the repository and returns its file, line and text.', contract: 'literal_query' } }] };
      if (step === 2) {
        assert.equal(JSON.parse(messages.at(-1).content).memoryValidation.status, 'fail');
        return { toolCalls: [{ id: 'fixed', name: 'function_try', arguments: { source: 'searchText(params.query)', params: { query: 'alpha' }, remember: true, name: 'findRepoLiteral', description: 'Finds a literal in the repository and returns its file, line and text.', contract: 'literal_query' } }] };
      }
      if (/select.*executed/i.test(messages[0].content)) return { result: { selected: ['findRepoLiteral'] } };
      assert.equal(JSON.parse(messages.at(-1).content).memoryValidation.status, 'pass');
      return { result: { objective: 'Find alpha', entryPoints: [{ name: 'alpha', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
    } } });
    const { scriptMemory } = await import('../src/memory.ts');
    const stored = await scriptMemory(root, memory.directory);
    assert.deepEqual(Object.values(stored.sources()), ['searchText(params.query)']);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('optional query probe rejects a hardcoded search but preserves a parameterized search', async () => {
  const base = await mkdtemp(join(tmpdir(), 'query-probe-'));
  const { mkdir } = await import('node:fs/promises');
  const root = join(base, 'repo');
  await mkdir(root);
  try {
    await writeFile(join(root, 'main.ts'), 'const alpha = 1;\n');
    for (const [source, rejected] of [['searchText("alpha")', true], ['searchText(params.query)', false]] as const) {
      const memory = { directory: join(base, rejected ? 'bad' : 'good'), validateQuery: true };
      let step = 0;
      const result = await explore({ root, objective: 'Find alpha', codeMode: true, memory, model: { async complete(messages) {
        if (step++ === 0) return { toolCalls: [{ id: 'one', name: 'function_try', arguments: { source, params: { query: 'alpha' }, remember: true, name: 'probeRepoSymbol', description: 'Finds a symbol in the repository and returns its file, line and text.' } }] };
        if (/select.*executed/i.test(messages[0].content)) return { result: { selected: ['probeRepoSymbol'] } };
        return { result: { objective: 'Find alpha', entryPoints: [{ name: 'alpha', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
      } } });
      assert.equal(result.metrics.memoryQueryRejects, Number(rejected));
      const { scriptMemory } = await import('../src/memory.ts');
      assert.equal((await scriptMemory(root, memory.directory)).catalog().length, rejected ? 0 : 1);
    }
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('non-truncated execution without structural proof is refused at consolidation', async () => {
  const base = await mkdtemp(join(tmpdir(), 'script-candidate-'));
  const root = join(base, 'repo');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(root);
  const memory = { directory: join(base, 'memory') };
  try {
    await writeFile(join(root, 'main.ts'), 'const alpha = 1;\n');
    let step = 0;
    await explore({ root, objective: 'Test', codeMode: true, memory, model: { async complete() {
      if (step++ === 0) return { toolCalls: [{ id: 'code', name: 'code', arguments: { code: 'search(params.query)', params: { query: 'missing' }, remember: true, name: 'probeRepoSymbol', description: 'Find symbol' } }] };
      return { result: { objective: 'Test', entryPoints: [], components: [], relations: [], uncertainties: ['No match'] } };
    } } });
    step = 0;
    await explore({ root, objective: 'Inspect', codeMode: true, memory, model: { async complete(messages) {
      // Correction 3: the consolidation trigger needs structural proof
      // availability — an empty result is executed but consolidates nothing.
      if (step++ === 0) { assert.match(messages[0].content, /Available entries: \[\]/); }
      return { result: { objective: 'Inspect', entryPoints: [], components: [], relations: [], uncertainties: [] } };
    } } });
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a search result can support a wider cited range and the catalog is included on the next run', async () => {
  const base = await mkdtemp(join(tmpdir(), 'script-overlap-'));
  const root = join(base, 'repo');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(root);
  const memory = { directory: join(base, 'memory') };
  const final = { objective: 'Find alpha', entryPoints: [{ name: 'alpha', evidence: [{ file: 'main.ts', startLine: 1, endLine: 3 }] }], components: [], relations: [], uncertainties: [] };
  try {
    await writeFile(join(root, 'main.ts'), 'function alpha() {\n  return 1;\n}\n');
    let step = 0;
    await explore({ root, objective: 'Find alpha', codeMode: true, memory, model: { async complete(messages) {
      if (step++ === 0) return { toolCalls: [{ id: 'code', name: 'function_try', arguments: { source: 'searchText(params.query)', params: { query: 'alpha' }, remember: true, name: 'findRepoSymbols', description: 'Finds symbols in the repository and returns each match with file, line and text.' } }] };
      if (/select.*executed/i.test(messages[0].content)) return { result: { selected: ['findRepoSymbols'] } };
      return { result: final };
    } } });
    step = 0;
    const second = await explore({ root, objective: 'Find alpha again', codeMode: true, memory, model: { async complete(messages) {
      if (step++ === 0) {
        const catalog = JSON.parse(messages[0].content.match(/Available entries: (\[.*?\])\. If a listed function/)![1]);
        assert.equal(catalog.length, 1);
        return { toolCalls: [{ id: 'reuse', name: 'memory_run', arguments: { id: catalog[0].id, params: { query: 'alpha' } } }] };
      }
      return { result: final };
    } } });
    assert.equal(second.metrics.memoryReuses, 1);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('memory saves a useful parameterized script and reruns it on current repository contents', async () => {
  const base = await mkdtemp(join(tmpdir(), 'script-memory-'));
  const root = join(base, 'repo');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(root);
  const memory = { directory: join(base, 'memory') };
  try {
    await writeFile(join(root, 'main.ts'), 'const alpha = 1;\n');
    let step = 0;
    await explore({ root, objective: 'Find alpha', codeMode: true, memory, model: { async complete(messages) {
      if (step++ === 0) return { toolCalls: [{ id: 'one', name: 'function_try', arguments: { source: 'searchText(params.query)', params: { query: 'alpha' }, remember: true, name: 'findRepoLiteral', description: 'Finds a literal in the repository and returns its file, line and text.' } }] };
      if (/select.*executed/i.test(messages[0].content)) return { result: { selected: ['findRepoLiteral'] } };
      return { result: { objective: 'Find alpha', entryPoints: [{ name: 'alpha', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
    } } });
    await writeFile(join(root, 'main.ts'), 'first\nconst beta = 2;\n');
    step = 0;
    const result = await explore({ root, objective: 'Find beta', codeMode: true, memory, model: { async complete(messages) {
      if (step++ === 0) return { toolCalls: [{ id: 'list', name: 'memory_list', arguments: {} }] };
      if (step === 2) {
        const catalog = JSON.parse(messages.at(-1).content);
        assert.equal(catalog.length, 1);
        return { toolCalls: [{ id: 'reuse', name: 'memory_run', arguments: { id: catalog[0].id, params: { query: 'beta' } } }] };
      }
      assert.match(messages.at(-1).content, /beta/);
      return { result: { objective: 'Find beta', entryPoints: [{ name: 'beta', evidence: [{ file: 'main.ts', startLine: 2, endLine: 2 }] }], components: [], relations: [], uncertainties: [] } };
    } } });
    assert.equal(result.metrics.memoryReuses, 1);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('G0: interrupted runs do not age a script and inactive runs are never purged', async () => {
  const base = await mkdtemp(join(tmpdir(), 'script-retention-'));
  const root = join(base, 'repo');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(root);
  const memory = { directory: join(base, 'memory') };
  const empty = { objective: 'Other topic', entryPoints: [], components: [], relations: [], uncertainties: [] };
  try {
    await writeFile(join(root, 'main.ts'), 'const alpha = 1;\n');
    let step = 0;
    await explore({ root, objective: 'Find alpha', codeMode: true, memory, model: { async complete(messages) {
      if (step++ === 0) return { toolCalls: [{ id: 'one', name: 'function_try', arguments: { source: 'searchText(params.query)', params: { query: 'alpha' }, remember: true, name: 'findRepoLiteral', description: 'Finds a literal in the repository and returns its file, line and text.' } }] };
      if (/select.*executed/i.test(messages[0].content)) return { result: { selected: ['findRepoLiteral'] } };
      return { result: { ...empty, entryPoints: [{ name: 'alpha', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }] } };
    } } });
    await explore({ root, objective: 'Interrupted', codeMode: true, memory, budget: { iterations: 1 }, model: { async complete() { return { toolCalls: [{ id: 'one', name: 'list', arguments: {} }] }; } } });
    for (let i = 0; i < 9; i++) await explore({ root, objective: 'Other topic', codeMode: true, memory, model: { async complete() { return { result: empty }; } } });
    let count = -1;
    step = 0;
    await explore({ root, objective: 'Inspect', codeMode: true, memory, model: { async complete(messages) {
      if (step++ === 0) return { toolCalls: [{ id: 'catalog', name: 'memory_list', arguments: {} }] };
      count = JSON.parse(messages.at(-1).content).length;
      return { result: empty };
    } } });
    assert.equal(count, 1);
    // G0: no inactivity-based purge — the unused script survives further runs.
    step = 0;
    await explore({ root, objective: 'Inspect again', codeMode: true, memory, model: { async complete(messages) {
      if (step++ === 0) return { toolCalls: [{ id: 'catalog', name: 'memory_list', arguments: {} }] };
      count = JSON.parse(messages.at(-1).content).length;
      return { result: empty };
    } } });
    assert.equal(count, 1);
    // Interrupted and inactive runs never age the entry either.
    const { scriptMemory } = await import('../src/memory.ts');
    const store = await scriptMemory(root, memory.directory);
    const entry: any = store.get('findRepoLiteral');
    assert.equal(entry.successes, 1);
    assert.equal(entry.failures, 0);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a reference hidden by output truncation cannot cause a script to be saved', async () => {
  const base = await mkdtemp(join(tmpdir(), 'script-truncated-'));
  const root = join(base, 'repo');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(root);
  const memory = { directory: join(base, 'memory') };
  try {
    await writeFile(join(root, 'main.ts'), 'const alpha = 1;\n');
    let step = 0;
    const final = { objective: 'Find alpha', entryPoints: [{ name: 'alpha', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] };
    await explore({ root, objective: 'Find alpha', codeMode: true, memory, model: { async complete() {
      if (step++ === 0) return { toolCalls: [{ id: 'one', name: 'code', arguments: { code: '({padding:"x".repeat(15000),file:"main.ts",line:1})', remember: true, name: 'padRepoOutput', description: 'test' } }] };
      return { result: final };
    } } });
    step = 0;
    await explore({ root, objective: 'Check catalog', codeMode: true, memory, model: { async complete(messages) {
      if (step++ === 0) return { toolCalls: [{ id: 'list', name: 'memory_list', arguments: {} }] };
      assert.deepEqual(JSON.parse(messages.at(-1).content), []);
      return { result: final };
    } } });
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a first failure after a file change is retained and two errors in three attempts purge it', async () => {
  const base = await mkdtemp(join(tmpdir(), 'script-failure-'));
  const root = join(base, 'repo');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(root);
  const memory = { directory: join(base, 'memory') };
  const empty = { objective: 'Test', entryPoints: [], components: [], relations: [], uncertainties: [] };
  try {
    await writeFile(join(root, 'main.ts'), 'const alpha = 1;\n');
    let step = 0;
    await explore({ root, objective: 'Find alpha', codeMode: true, memory, model: { async complete(messages) {
      if (step++ === 0) return { toolCalls: [{ id: 'one', name: 'function_try', arguments: { source: 'readLines(params.file, 1, 1)', params: { file: 'main.ts' }, remember: true, name: 'readRepoFile', description: 'Reads the first line of a repository file and returns it with its file name and line number.' } }] };
      if (/select.*executed/i.test(messages[0].content)) return { result: { selected: ['readRepoFile'] } };
      return { result: { ...empty, entryPoints: [{ name: 'alpha', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }] } };
    } } });
    await rm(join(root, 'main.ts'));
    let id = '';
    for (let i = 0; i < 2; i++) {
      step = 0;
      await explore({ root, objective: 'Test', codeMode: true, memory, model: { async complete(messages) {
        if (step++ === 0) return { toolCalls: [{ id: 'list', name: 'memory_list', arguments: {} }] };
        if (step === 2) {
          id = JSON.parse(messages.at(-1).content)[0].id;
          return { toolCalls: [{ id: 'run', name: 'memory_run', arguments: { id, params: { file: 'main.ts' } } }] };
        }
        return { result: empty };
      } } });
    }
    step = 0;
    await explore({ root, objective: 'Test', codeMode: true, memory, model: { async complete(messages) {
      if (step++ === 0) return { toolCalls: [{ id: 'list', name: 'memory_list', arguments: {} }] };
      assert.deepEqual(JSON.parse(messages.at(-1).content), []);
      return { result: empty };
    } } });
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('the model can mark an output unusable for its declared subject after execution', async () => {
  const base = await mkdtemp(join(tmpdir(), 'script-unusable-'));
  const root = join(base, 'repo');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(root);
  const memory = { directory: join(base, 'memory') };
  const empty = { objective: 'Test', entryPoints: [], components: [], relations: [], uncertainties: [] };
  try {
    await writeFile(join(root, 'main.ts'), 'const alpha = 1;\n');
    let step = 0;
    await explore({ root, objective: 'Find alpha', codeMode: true, memory, model: { async complete(messages) {
      if (step++ === 0) return { toolCalls: [{ id: 'one', name: 'function_try', arguments: { source: 'searchText(params.query)', params: { query: 'alpha' }, remember: true, name: 'findRepoIdentifier', description: 'Finds an identifier in the repository and returns its file, line and text.' } }] };
      if (/select.*executed/i.test(messages[0].content)) return { result: { selected: ['findRepoIdentifier'] } };
      return { result: { ...empty, entryPoints: [{ name: 'alpha', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }] } };
    } } });
    for (let i = 0; i < 2; i++) {
      step = 0;
      let id = '';
      await explore({ root, objective: 'Test', codeMode: true, memory, model: { async complete(messages) {
        if (step++ === 0) return { toolCalls: [{ id: 'list', name: 'memory_list', arguments: {} }] };
        if (step === 2) { id = JSON.parse(messages.at(-1).content)[0].id; return { toolCalls: [{ id: 'run', name: 'memory_run', arguments: { id, params: { query: 'missing' } } }] }; }
        if (step === 3) return { toolCalls: [{ id: 'bad', name: 'memory_unusable', arguments: { id } }] };
        return { result: empty };
      } } });
    }
    step = 0;
    await explore({ root, objective: 'Test', codeMode: true, memory, model: { async complete(messages) {
      if (step++ === 0) return { toolCalls: [{ id: 'list', name: 'memory_list', arguments: {} }] };
      assert.deepEqual(JSON.parse(messages.at(-1).content), []);
      return { result: empty };
    } } });
  } finally { await rm(base, { recursive: true, force: true }); }
});

// Issue #187: a legacy candidate — the pre-#185 `code` protocol — can only
// arrive through a directly injected tool call (the provider offers strict
// function_try instead of `code` whenever memory is on). It is refused with an
// explicit reconciliation reason and never silently persisted: its citations
// were never validated at trial time and cannot be re-validated on replay.
test('a directly injected legacy candidate is refused with an explicit reason and never persists', async () => {
  const base = await mkdtemp(join(tmpdir(), 'legacy-refusal-'));
  const { mkdir } = await import('node:fs/promises');
  const root = join(base, 'repo');
  await mkdir(root);
  const memory = { directory: join(base, 'memory') };
  try {
    await writeFile(join(root, 'main.ts'), 'const alpha = 1;\n');
    let step = 0;
    const result = await explore({ root, objective: 'Find alpha', codeMode: true, memory, model: { async complete() {
      if (step++ === 0) return { toolCalls: [{ id: 'legacy', name: 'code', arguments: { code: 'search(params.query)', params: { query: 'alpha' }, remember: true, name: 'probeRepoLegacy', description: 'Finds a literal in the repository and returns its file, line and text.' } }] };
      return { result: { objective: 'Find alpha', entryPoints: [{ name: 'alpha', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
    } } });
    const report = result.consolidationReport as { accepted: string[]; reconciliation: Array<{ name: string; proposed: boolean; replayed: boolean; accepted: boolean; reason?: string }> };
    assert.deepEqual(report.accepted, []);
    assert.equal(report.reconciliation.length, 1);
    const refusal = report.reconciliation[0];
    assert.equal(refusal.name, 'probeRepoLegacy');
    assert.equal(refusal.proposed, false);
    assert.equal(refusal.replayed, false);
    assert.equal(refusal.accepted, false);
    assert.match(refusal.reason ?? '', /legacy candidate/i);
    assert.match(refusal.reason ?? '', /never validated at trial time/);
    const { scriptMemory } = await import('../src/memory.ts');
    assert.equal((await scriptMemory(root, memory.directory)).catalog().length, 0, 'a refused legacy candidate never persists');
  } finally { await rm(base, { recursive: true, force: true }); }
});
