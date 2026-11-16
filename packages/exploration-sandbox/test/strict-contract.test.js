const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runScript } = require('..');

test('an oversized read reports its real error without a QuickJS cleanup assertion', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'strict-read-error-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await fs.promises.writeFile(path.join(root, 'main.ts'), 'line\n'.repeat(150));
  const code = 'function readRange(params: { file: string; start: number; end: number }) { return readLines(params.file, params.start, params.end); }';
  await assert.rejects(runScript({ workspace: root, code, params: { file: 'main.ts', start: 1, end: 121 }, strict: true }), /at most 100 lines/i);
});

test('strict execution checks plain source types and denies indirect legacy host calls', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't02-strict-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const code of ['(() => { let n = 1; n = "bad"; return n; })()', '(globalThis as any)["_stat"]("secret")', '(globalThis as any)["stat"]("secret")']) {
    await assert.rejects(runScript({ workspace: root, code, strict: true }), /TS2322|not allowed|not a function|not defined|whitelist/i);
  }
});

test('strict trials validate actual params and expose the executed source contract and calls', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't02-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'main.ts'), 'export function start() {}\n');
  const code = '((input: { query: string }) => searchText(input.query))';
  await assert.rejects(runScript({ workspace: root, code, params: { query: 17 }, strict: true }), /TS2345/);
  const result = await runScript({ workspace: root, code, params: { query: 'start' }, strict: true, includeTrace: true });
  assert.deepEqual(result.trace.contract.paramsSchema, [{ name: 'query', type: 'string' }]);
  assert.equal(result.trace.source, code);
  assert.deepEqual(result.trace.parameters, { query: 'start' });
  assert.ok(result.trace.executedCalls.some(call => call.name === 'searchText'));
  assert.match(result.trace.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.value[0].file, 'main.ts');
});

test('parameter mismatch explains the expected type and gives targeted primitive guidance', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-params-guidance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'main.ts'), 'start\n');
  const bad = 'function explore(searchText: (query: string) => unknown[], params: { query: string }) { return searchText(params.query); }';
  await assert.rejects(runScript({ workspace: root, code: bad, params: { query: 'start' }, strict: true }), error => /TS2345/.test(error.message) && /Expected/.test(error.message) && /available.*directly/i.test(error.message) && /function\(params/.test(error.message));
  const mismatch = 'function explore(params: { query: string }) { return searchText(params.query); }';
  await assert.rejects(runScript({ workspace: root, code: mismatch, params: { query: 17 }, strict: true }), error => /TS2345/.test(error.message) && /Expected/.test(error.message) && !/available.*directly/i.test(error.message));
  const result = await runScript({ workspace: root, code: mismatch, params: { query: 'start' }, strict: true });
  assert.equal(result[0].file, 'main.ts');
});

test('strict named function declarations execute with validated parameters', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-declaration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'main.ts'), 'needle\n');
  const code = 'function explore(input: { query: string }) { return searchText(input.query); }';
  await assert.rejects(runScript({ workspace: root, code, params: { query: 17 }, strict: true }), /TS2345/);
  const result = await runScript({ workspace: root, code, params: { query: 'needle' }, strict: true, includeTrace: true });
  assert.deepEqual(result.value, [{ file: 'main.ts', line: 1, text: 'needle' }]);
  assert.deepEqual(result.trace.contract.paramsSchema, [{ name: 'query', type: 'string' }]);
  assert.ok(result.trace.executedCalls.some(call => call.name === 'searchText'));
});

test('canonical primitives return real symbols, imports and exact references with zero context', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't02-primitives-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'main.ts'), 'import { helper } from "./helper";\nfunction start() { helper(); }\nstart();\nstart();\n');
  const result = await runScript({ workspace: root, strict: true, includeTrace: true, code: '({ symbols: listSymbols(), definitions: findDefinitions("start"), references: findReferences("start"), imports: getImports("main.ts"), context: readAround("main.ts", 2, 0) })' });
  assert.ok(result.value.symbols.some(symbol => symbol.name === 'start' && symbol.line === 2));
  assert.equal(result.value.definitions[0].line, 2);
  assert.deepEqual(result.value.references.map(ref => ref.line), [2, 3, 4]);
  assert.equal(result.value.imports[0].line, 1);
  assert.equal(result.value.context.start, 2);
  assert.equal(result.value.context.lines.length, 1);
  assert.ok(result.trace.executedCalls.every(call => ['listSymbols', 'findDefinitions', 'findReferences', 'getImports', 'readAround'].includes(call.name)));
});

test('git diff rejects revision options before git can create a file', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't02-git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(runScript({ workspace: root, strict: true, code: 'getGitDiff("--output=written-by-git", "HEAD")' }), /Invalid revision/);
  assert.equal(fs.existsSync(path.join(root, 'written-by-git')), false);
});
