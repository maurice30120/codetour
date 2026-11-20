const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runScript } = require('..');

test('readLines paginates a requested range without skipping lines', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'read-page-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'source.txt'), Array.from({ length: 180 }, (_, i) => `line ${i + 1}`).join('\n'));
  const first = (await runScript({ workspace: root, code: 'readLines("source.txt", 1, 180)', strict: true, includeTrace: true })).value;
  assert.equal(first.lines.length, 100);
  assert.equal(first.nextLine, 101);
  const second = (await runScript({ workspace: root, code: 'readLines("source.txt", 101, 180)', strict: true, includeTrace: true })).value;
  assert.equal(second.lines[0], 'line 101');
  assert.equal(second.lines.at(-1), 'line 180');
  assert.equal(second.nextLine, null);
});

test('long lines are flagged and recoverable in UTF-8 fragments', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'read-fragments-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const line = 'é"\\'.repeat(3000);
  fs.writeFileSync(path.join(root, 'source.txt'), `${line}\nnext`);
  const page = (await runScript({ workspace: root, code: 'readLines("source.txt", 1, 2)', strict: true, includeTrace: true })).value;
  assert.deepEqual(page.truncatedLines, [1]);
  assert.equal(page.nextLine, null);
  let offset = 0;
  let recovered = '';
  do {
    const part = (await runScript({ workspace: root, code: 'readLineFragment("source.txt", 1, params.offset)', params: { offset }, strict: true, includeTrace: true })).value;
    recovered += part.content;
    offset = part.nextOffset;
  } while (offset !== null);
  assert.equal(recovered, line);
});

test('a byte-limited page resumes at the first line not returned', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'read-bytes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'source.txt'), Array.from({ length: 30 }, (_, i) => `${i + 1}: ${'x'.repeat(500)}`).join('\n'));
  const page = (await runScript({ workspace: root, code: 'readLines("source.txt", 1, 30)', strict: true, includeTrace: true })).value;
  assert.ok(page.nextLine > 1 && page.nextLine < 31);
  assert.equal(page.nextLine, page.lines.length + 1);
});

test('a truncated excerpt never splits a UTF-16 surrogate pair', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'read-emoji-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'source.txt'), `${'a'.repeat(1999)}😀${'b'.repeat(100)}`);
  const page = (await runScript({ workspace: root, code: 'readLines("source.txt", 1, 1)', strict: true, includeTrace: true })).value;
  assert.equal(page.lines[0], 'a'.repeat(1999));
  assert.deepEqual(page.truncatedLines, [1]);
});
