const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runScript } = require('..');

test('a script combines bounded reads and returns compact evidence', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'app.js'), 'one\nfunction main() {}\nthree\n');
  const result = await runScript({ workspace: root, code: 'search("main")' });
  assert.deepEqual(result, [{ file: 'app.js', line: 2, text: 'function main() {}' }]);
});

test('scripts cannot access Node, network, writes or files outside the workspace', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const secret = path.join(os.tmpdir(), `outside-${process.pid}`);
  fs.writeFileSync(secret, 'secret');
  t.after(() => fs.rmSync(secret, { force: true }));
  fs.symlinkSync(secret, path.join(root, 'link'));
  assert.deepEqual(await runScript({ workspace: root, code: '[typeof process, typeof require, typeof fetch]' }), ['undefined', 'undefined', 'undefined']);
  for (const code of ['read("../outside")', 'read("link")', 'require("fs").writeFileSync("x", "y")', 'fetch("https://example.com")', 'import("fs")']) {
    await assert.rejects(runScript({ workspace: root, code }));
  }
  assert.equal(fs.existsSync(path.join(root, 'x')), false);
});

test('infinite computation and excess memory are stopped', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(runScript({ workspace: root, code: '(() => { while (true) {} })()', timeoutMs: 100 }));
  await assert.rejects(runScript({ workspace: root, code: '"x".repeat(100000000)' }));
  await assert.rejects(runScript({ workspace: root, code: '"x".repeat(50000)' }));
});

test('the timeout covers worker startup and accepts small remaining budgets', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const start = Date.now();
  await assert.rejects(runScript({ workspace: root, code: '(() => { while (true) {} })()', timeoutMs: 20 }), /timeout/i);
  assert.ok(Date.now() - start < 1000, 'a small timeout must not wait for the old two-second grace period');
});

test('cancellation interrupts a running script', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const controller = new AbortController();
  const run = runScript({ workspace: root, code: '(() => { while (true) {} })()', signal: controller.signal });
  controller.abort();
  await assert.rejects(run, /abort/i);
});

test('reads reject files and ranges above the workspace limits', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'large.txt'), 'x'.repeat(1048577));
  fs.writeFileSync(path.join(root, 'small.txt'), 'x\n'.repeat(101));
  await assert.rejects(runScript({ workspace: root, code: 'read("large.txt")' }));
  await assert.rejects(runScript({ workspace: root, code: 'read("small.txt", 1, 101)' }));
  assert.deepEqual(await runScript({ workspace: root, code: 'search("xxx")' }), []);
});

test('a stored script receives new JSON parameters without changing its code', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'app.txt'), 'alpha\nbeta\n');
  const code = 'search(params.query)';
  assert.deepEqual(await runScript({ workspace: root, code, params: { query: 'alpha' } }), [{ file: 'app.txt', line: 1, text: 'alpha' }]);
  assert.deepEqual(await runScript({ workspace: root, code, params: { query: 'beta' } }), [{ file: 'app.txt', line: 2, text: 'beta' }]);
  assert.deepEqual(await runScript({ workspace: root, code: 'params', params: { query: '\"; globalThis.hacked = true; //', nested: [1, null] } }), { query: '\"; globalThis.hacked = true; //', nested: [1, null] });
  await assert.rejects(runScript({ workspace: root, code, params: { query: 'x'.repeat(9000) } }), /parameter/i);
});

test('stored expressions compose with parameters and share sandbox limits', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'app.txt'), 'alpha\nbeta\n');
  const id = '0123456789abcdef';
  const scripts = { [id]: 'search(params.query)' };
  assert.deepEqual(await runScript({ workspace: root, code: `script("${id}", {query: params.term})`, params: { term: 'beta' }, scripts }), [{ file: 'app.txt', line: 2, text: 'beta' }]);
  await assert.rejects(runScript({ workspace: root, code: `script("${id}", {})`, scripts: { [id]: `script("${id}", {})` } }), /nesting|stack/i);
  await assert.rejects(runScript({ workspace: root, code: 'script("missing", {})', scripts }), /Unknown script/);
});

test('search reaches files beyond the bounded listing', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let i = 0; i < 501; i++) fs.writeFileSync(path.join(root, `${String(i).padStart(4, '0')}.txt`), i === 500 ? 'target beyond list' : 'other');
  assert.equal((await runScript({ workspace: root, code: 'list()' })).length, 500);
  assert.deepEqual(await runScript({ workspace: root, code: 'search("target beyond list")' }), [{ file: '0500.txt', line: 1, text: 'target beyond list' }]);
});

test('scoped search filters before paging and signals remaining results', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scoped-search-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'target'));
  fs.writeFileSync(path.join(root, 'aaa.txt'), Array(60).fill('needle').join('\n'));
  fs.writeFileSync(path.join(root, 'target', 'code.txt'), 'needle one\nneedle two\nneedle three\n');
  const code = 'search(params.query,{pathPrefix:params.pathPrefix,offset:params.offset,limit:2})';
  const first = await runScript({ workspace: root, code, params: { query: 'needle', pathPrefix: 'target/', offset: 0 } });
  const second = await runScript({ workspace: root, code, params: { query: 'needle', pathPrefix: 'target/', offset: 2 } });
  assert.deepEqual(first.matches.map(x => x.line), [1, 2]);
  assert.equal(first.hasMore, true);
  assert.deepEqual(second.matches.map(x => x.line), [3]);
  assert.equal(second.hasMore, false);
  await assert.rejects(runScript({ workspace: root, code, params: { query: 'needle', pathPrefix: '../', offset: 0 } }), /prefix/i);
});
