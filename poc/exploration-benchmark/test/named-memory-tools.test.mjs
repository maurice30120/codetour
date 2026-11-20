import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mistral } from '../../../packages/exploration-poc/src/mistral.ts';
import { countOccurrences, dominantPrefix, extractCandidateTerms, rankTerms, selectForTask, termDirectories } from '../autoselect.mjs';

const SEARCH_ID = 'aaaaaaaaaaaaaaaa';
const FN_ID = 'bbbbbbbbbbbbbbbb';

function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => handler(url, init);
  return Promise.resolve()
    .then(run)
    .finally(() => { globalThis.fetch = original; });
}

function completionWithToolCalls(toolCalls) {
  return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: toolCalls } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
}

function completionWithContent() {
  return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
}

test('named memory tools are exposed and mapped to memory_run with declared params only', async () => {
  const requests = [];
  await withFetch(async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return completionWithToolCalls([
      { id: 'c1', function: { name: 'memory_search', arguments: JSON.stringify({ query: 'totalPrice', pathPrefix: 'src/' }) } },
      { id: 'c2', function: { name: 'memory_fn_bbbbbbbb', arguments: JSON.stringify({ query: 'Catalog', extra: 'dropped' }) } }
    ]);
  }, async () => {
    const model = mistral('fake-key', 'test-model', {
      memorySearchId: SEARCH_ID,
      memoryTools: [
        { name: 'memory_search', id: SEARCH_ID, parameters: ['query', 'pathPrefix', 'offset'], required: ['query'], description: 'Reusable search' },
        { name: 'memory_fn_bbbbbbbb', id: FN_ID, parameters: ['query'], description: 'Learned function' }
      ]
    });
    const response = await model.complete([{ role: 'user', content: 'hi' }], { codeMode: true, memory: true });
    assert.deepEqual(response.toolCalls, [
      { id: 'c1', name: 'memory_run', arguments: { id: SEARCH_ID, params: { query: 'totalPrice', pathPrefix: 'src/' } } },
      { id: 'c2', name: 'memory_run', arguments: { id: FN_ID, params: { query: 'Catalog' } } }
    ]);
    assert.deepEqual(response.usage, { inputTokens: 10, outputTokens: 5 });
  });
  const names = requests[0].body.tools.map(tool => tool.function.name);
  assert.ok(names.includes('memory_search'));
  assert.ok(names.includes('memory_fn_bbbbbbbb'));
  assert.ok(names.includes('code'));
  assert.ok(names.includes('search'));
  const searchTool = requests[0].body.tools.find(tool => tool.function.name === 'memory_search');
  assert.deepEqual(searchTool.function.parameters.required, ['query']);
  assert.equal(searchTool.function.parameters.properties.offset.type, 'integer');
});

test('exclusive named memory removes free search and code tools', async () => {
  const requests = [];
  await withFetch(async (url, init) => {
    requests.push(JSON.parse(init.body));
    return completionWithContent();
  }, async () => {
    const model = mistral('fake-key', 'test-model', { memorySearchId: SEARCH_ID, memorySearchExclusive: true });
    await model.complete([{ role: 'user', content: 'hi' }], { codeMode: true, memory: true });
  });
  const names = requests[0].tools.map(tool => tool.function.name);
  assert.ok(!names.includes('search'));
  assert.ok(!names.includes('code'));
  assert.ok(names.includes('list') && names.includes('read'));
  assert.ok(names.includes('memory_search') && names.includes('memory_run') && names.includes('memory_list'));
});

test('named memory tools require the memory option to be exposed', async () => {
  const requests = [];
  await withFetch(async (url, init) => {
    requests.push(JSON.parse(init.body));
    return completionWithContent();
  }, async () => {
    const model = mistral('fake-key', 'test-model', { memorySearchId: SEARCH_ID, memoryTools: [{ name: 'memory_search', id: SEARCH_ID, parameters: ['query'], required: ['query'], description: 'x' }] });
    await model.complete([{ role: 'user', content: 'hi' }], { codeMode: true, memory: false });
  });
  const names = requests[0].tools.map(tool => tool.function.name);
  assert.ok(!names.includes('memory_search'));
  assert.ok(!names.includes('memory_run'));
});

test('memory-only mode removes free search and code tools but keeps memory tools', async () => {
  const requests = [];
  await withFetch(async (url, init) => {
    requests.push(JSON.parse(init.body));
    return completionWithContent();
  }, async () => {
    const model = mistral('fake-key', 'test-model', { removeSearch: true, removeCode: true });
    await model.complete([{ role: 'user', content: 'hi' }], { codeMode: true, memory: true });
  });
  const names = requests[0].tools.map(tool => tool.function.name);
  assert.ok(!names.includes('search'));
  assert.ok(!names.includes('code'));
  assert.ok(names.includes('list') && names.includes('read') && names.includes('git'));
  assert.ok(names.includes('memory_list') && names.includes('memory_run') && names.includes('memory_unusable'));
});

test('legacy memorySearchId still maps memory_search to memory_run', async () => {
  await withFetch(async () => completionWithToolCalls([{ id: 'c1', function: { name: 'memory_search', arguments: JSON.stringify({ query: 'postOrder' }) } }]), async () => {
    const model = mistral('fake-key', 'test-model', { memorySearchId: SEARCH_ID, memorySearchScoped: true });
    const response = await model.complete([{ role: 'user', content: 'hi' }], { codeMode: true, memory: true });
    assert.deepEqual(response.toolCalls, [{ id: 'c1', name: 'memory_run', arguments: { id: SEARCH_ID, params: { query: 'postOrder' } } }]);
  });
});

test('candidate term extraction keeps identifiers and drops prose', () => {
  const terms = extractCandidateTerms('Pour relier postOrder au calcul de totalPrice dans Catalog, cite les lignes.').map(entry => entry.term);
  assert.ok(terms.includes('postOrder'));
  assert.ok(terms.includes('totalPrice'));
  assert.ok(terms.includes('Catalog'));
  assert.ok(!terms.includes('pour'));
  assert.ok(!terms.includes('les'));
});

test('ranking prefers code symbols, then the most targeted term', () => {
  const entries = extractCandidateTerms('Pour préparer un Project Tour, retrace le flux de query_string depuis le parsing dans exec_simple_query. Cite les lignes du code.');
  const occurrences = new Map([['Project', 3], ['Tour', 2], ['flux', 40], ['query_string', 120], ['parsing', 900], ['exec_simple_query', 25], ['Cite', 1], ['lignes', 30], ['code', 5000]]);
  const ranked = rankTerms(entries, occurrences);
  assert.equal(ranked[0], 'exec_simple_query');
  assert.equal(ranked[1], 'query_string');
  for (const prose of ['parsing', 'code', 'flux']) if (ranked.includes(prose)) assert.ok(ranked.indexOf(prose) > 1);
  assert.ok(!ranked.includes('pour'));
});

test('occurrence counting uses whole identifiers, not substrings', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codetour-occurrences-'));
  try {
    await writeFile(path.join(root, 'a.js'), 'totalPrice(x);\ntotal = 1;\n');
    const counts = await countOccurrences(root, ['total', 'totalPrice']);
    assert.equal(counts.get('total'), 1);
    assert.equal(counts.get('totalPrice'), 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('dominant prefix is kept only when one directory holds at least half of the hits', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codetour-dirs-'));
  try {
    await mkdir(path.join(root, 'src/backend/tcop'), { recursive: true });
    await mkdir(path.join(root, 'src/backend/parser'), { recursive: true });
    await writeFile(path.join(root, 'src/backend/tcop/postgres.c'), 'exec_simple_query();\nexec_simple_query();\nexec_simple_query();\n');
    await writeFile(path.join(root, 'src/backend/parser/parser.c'), 'exec_simple_query();\n');
    const dirs = await termDirectories(root, 'exec_simple_query');
    assert.equal(dirs.get('src/backend/tcop/'), 3);
    assert.equal(dirs.get('src/backend/parser/'), 1);
    assert.equal(dominantPrefix(dirs, 4), 'src/backend/tcop/');
    assert.equal(dominantPrefix(new Map([['src/a/', 2], ['src/b/', 2]]), 4), null);
    assert.equal(dominantPrefix(new Map([['src/a/', 2]]), 4), null);
    assert.equal(dominantPrefix(new Map(), 0), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('selectForTask picks the probe-passing query script and its best term, exposing learned functions as named tools', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codetour-autoselect-'));
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/a.js'), 'postOrder(x);\npostOrder(y);\npostOrder(w);\ntotalPrice(z);\n');
    await writeFile(path.join(root, 'src/b.js'), 'totalPrice(a);\ntotalPrice(b);\ntotalPrice(c);\n');
    const FN_FULL = 'cccccccccccccccc';
    const entries = [
      { id: SEARCH_ID, objective: 'primitive', description: 'Find literal occurrences; input query.', parameters: ['query'], code: 'search(params.query)' },
      { id: FN_FULL, objective: 'learned', description: 'Composed search and read.', parameters: ['file'], code: 'read(params.file,1,10)' }
    ];
    const store = {
      catalog: () => entries.map(({ id, objective, description, parameters }) => ({ id, objective, description, parameters })),
      get: id => entries.find(entry => entry.id === id),
      sources: () => Object.fromEntries(entries.map(entry => [entry.id, entry.code]))
    };
    const probe = async () => ({ status: 'pass' });
    const selection = await selectForTask(store, root, 'Relie postOrder au calcul de totalPrice.', probe, { primitiveCodes: ['list()', 'search(params.query)', 'read(params.file,params.start,params.end)'] });
    assert.equal(selection.query.id, SEARCH_ID);
    assert.equal(selection.query.term, 'postOrder');
    assert.equal(selection.query.hits, 3);
    assert.equal(selection.query.pathPrefix, 'src/');
    assert.deepEqual(selection.namedTools.map(tool => tool.name).sort(), ['memory_fn_cccccccc', 'memory_search']);
    const failing = await selectForTask(store, root, 'Relie postOrder au calcul de totalPrice.', async () => ({ status: 'fail' }), { primitiveCodes: [] });
    assert.equal(failing.query, null);
    assert.deepEqual(failing.namedTools.map(tool => tool.name), ['memory_fn_cccccccc']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
