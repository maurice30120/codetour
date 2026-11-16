import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { citationAccess, validateCitations } from '../src/citation-validator.ts';
import type { CitationAccess } from '../src/citation-validator.ts';
import { workspace } from '../src/workspace.ts';

// Independent fixture: an in-memory file map implementing the confined-read
// contract the validator consumes. Expected values come from literal file
// contents written here, not from the implementation under test.
const fixture = (files: Record<string, string>): CitationAccess => ({
  async readRange(file, startLine, endLine) {
    const content = files[file];
    if (content === undefined) throw new Error(`ENOENT: no such file or directory, open '${file}'`);
    const lines = content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n');
    return { lines: lines.slice(startLine - 1, endLine), totalLines: lines.length };
  }
});

const files = {
  'main.ts': 'export function start() { return 1; }\nexport function stop() { return 0; }\n',
  'long.ts': 'x'.repeat(600) + '\n',
  'ten.ts': Array.from({ length: 10 }, (_, index) => `start ${index};`).join('\n') + '\n'
};
const access = fixture(files);
const revision = 'abc123def456abc789';

test('a single-line reference with an exact excerpt is valid', async () => {
  const validation = await validateCitations([{ file: 'main.ts', line: 1, text: 'export function start() { return 1; }' }], { access, revision });
  assert.equal(validation.status, 'valid');
  assert.equal(validation.validCount, 1);
  assert.equal(validation.references, 1);
  assert.equal(validation.exhaustive, true);
  assert.deepEqual(validation.validReferences, [{ file: 'main.ts', startLine: 1, endLine: 1 }]);
});

test('a readLines-shaped reference with matching lines is valid', async () => {
  const validation = await validateCitations(
    [{ file: 'main.ts', start: 1, lines: ['export function start() { return 1; }', 'export function stop() { return 0; }'] }],
    { access, revision }
  );
  assert.equal(validation.status, 'valid');
  assert.deepEqual(validation.validReferences, [{ file: 'main.ts', startLine: 1, endLine: 2 }]);
});

test('line 0 and negative line numbers are invalid', async () => {
  for (const line of [0, -3]) {
    const validation = await validateCitations([{ file: 'main.ts', line }], { access, revision });
    assert.equal(validation.status, 'validation_failed');
    assert.match(validation.invalidReferences[0].errors.join(' '), /positive integer/);
  }
});

test('a file-bearing object without line information is a missing mandatory reference', async () => {
  const validation = await validateCitations([{ file: 'main.ts', note: 'no lines' }], { access, revision });
  assert.equal(validation.status, 'validation_failed');
  assert.match(validation.invalidReferences[0].errors.join(' '), /no line number/);
});

test('an inverted range is invalid', async () => {
  const validation = await validateCitations([{ file: 'main.ts', startLine: 2, endLine: 1 }], { access, revision });
  assert.equal(validation.status, 'validation_failed');
  assert.match(validation.invalidReferences[0].errors.join(' '), /inverted range/);
});

test('a range beyond the end of the file is invalid', async () => {
  const validation = await validateCitations([{ file: 'main.ts', startLine: 1, endLine: 5 }], { access, revision });
  assert.equal(validation.status, 'validation_failed');
  assert.match(validation.invalidReferences[0].errors.join(' '), /beyond the end of the file \(2 lines\)/);
});

test('a range wider than the citation span limit is invalid without any read', async () => {
  const validation = await validateCitations([{ file: 'main.ts', startLine: 1, endLine: 150 }], { access, revision });
  assert.equal(validation.status, 'validation_failed');
  assert.match(validation.invalidReferences[0].errors.join(' '), /limited to 100 lines/);
});

test('a mismatched excerpt is invalid', async () => {
  const validation = await validateCitations([{ file: 'main.ts', line: 1, text: 'fabricated content' }], { access, revision });
  assert.equal(validation.status, 'validation_failed');
  assert.match(validation.invalidReferences[0].errors.join(' '), /does not match the file content/);
});

test('a short excerpt that is neither exact nor a primitive truncation bound is invalid', async () => {
  const validation = await validateCitations([{ file: 'long.ts', line: 1, text: 'x'.repeat(10) }], { access, revision });
  assert.equal(validation.status, 'validation_failed');
  assert.match(validation.invalidReferences[0].errors.join(' '), /does not match the file content/);
});

test('an excerpt truncated at a primitive bound (500 or 2000 chars) is accepted', async () => {
  for (const bound of [500, 2000]) {
    const longFiles = { 'huge.ts': 'y'.repeat(2500) + '\n' };
    const validation = await validateCitations([{ file: 'huge.ts', line: 1, text: 'y'.repeat(bound) }], { access: fixture(longFiles), revision });
    assert.equal(validation.status, 'valid', `prefix bound ${bound}`);
  }
});

test('a reference claiming a wrong revision is invalid; a matching short revision is valid', async () => {
  const mismatch = await validateCitations([{ file: 'main.ts', line: 1, revision: 'deadbeefdeadbeef' }], { access, revision });
  assert.equal(mismatch.status, 'validation_failed');
  assert.match(mismatch.invalidReferences[0].errors.join(' '), /does not match the workspace revision/);
  const matching = await validateCitations([{ file: 'main.ts', line: 1, revision: 'abc123' }], { access, revision });
  assert.equal(matching.status, 'valid');
});

test('nine valid references and one invalid: the trial fails, valid references stay visible, only the faulty one is identified', async () => {
  const references = Array.from({ length: 10 }, (_, index) => ({ file: 'ten.ts', line: index + 1, text: `start ${index};` }));
  references[9].text = 'tampered line';
  const validation = await validateCitations(references, { access, revision });
  assert.equal(validation.status, 'validation_failed');
  assert.equal(validation.validCount, 9);
  assert.equal(validation.validReferences.length, 9);
  assert.equal(validation.invalidReferences.length, 1);
  assert.equal(validation.invalidReferences[0].file, 'ten.ts');
  assert.equal(validation.invalidReferences[0].startLine, 10);
  assert.equal(validation.invalidReferences[0].endLine, 10);
});

test('an output without references reports no_references', async () => {
  assert.equal((await validateCitations('a plain string', { access, revision })).status, 'no_references');
  assert.equal((await validateCitations({ from: 'A', to: 'B' }, { access, revision })).status, 'no_references');
  assert.equal((await validateCitations([], { access, revision })).status, 'no_references');
});

test('exceeding the validation ceiling is an explicit non-exhaustive failure', async () => {
  const references = Array.from({ length: 5 }, (_, index) => ({ file: 'ten.ts', line: index + 1, text: `start ${index};` }));
  const validation = await validateCitations(references, { access, revision, maxReferences: 3 });
  assert.equal(validation.status, 'validation_failed');
  assert.equal(validation.validated, 3);
  assert.equal(validation.exhaustive, false);
  assert.match(validation.invalidReferences[0].errors.join(' '), /NOT proven exhaustive/);
});

test('a reference nested inside another reference is validated too', async () => {
  const validation = await validateCitations(
    [{ file: 'main.ts', line: 1, text: 'export function start() { return 1; }', related: { file: 'missing.ts', line: 1 } }],
    { access, revision }
  );
  assert.equal(validation.status, 'validation_failed');
  assert.equal(validation.invalidReferences.length, 1);
  assert.equal(validation.invalidReferences[0].file, 'missing.ts');
});

test('the workspace adapter classifies missing files, escaped paths and confirms real excerpts', async t => {
  const base = await mkdtemp(join(tmpdir(), 'citation-access-'));
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'main.ts'), 'export function start() { return 1; }\n');
  await writeFile(join(base, 'escape.ts'), 'outside the workspace\n');
  t.after(() => rm(base, { recursive: true, force: true }));
  const access = citationAccess(await workspace(root));
  const missing = await validateCitations([{ file: 'nope.ts', line: 1 }], { access });
  assert.equal(missing.status, 'validation_failed');
  assert.match(missing.invalidReferences[0].errors.join(' '), /file not found: nope\.ts/);
  const escaped = await validateCitations([{ file: '../escape.ts', line: 1 }], { access });
  assert.equal(escaped.status, 'validation_failed');
  assert.match(escaped.invalidReferences[0].errors.join(' '), /path escapes the workspace/);
  const exact = await validateCitations([{ file: 'main.ts', line: 1, text: 'export function start() { return 1; }' }], { access });
  assert.equal(exact.status, 'valid');
});
