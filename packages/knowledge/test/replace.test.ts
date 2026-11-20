import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  catalogueCanonicalizerName,
  catalogueLockName,
  knowledgeDirectory,
  knowledgeRevision,
  loadKnowledgeLibrary,
  parseKnowledge,
  saveKnowledgeProposal
} from '../src/index';

// Repairing an existing Knowledge Entry (spec #232, ticket #255): the
// `replace` mode rewrites one entry in full against the Knowledge Revision the
// caller read. These tests observe the returned vocabulary and the exact bytes
// left in the catalogue; they never inspect internal call order.

const realRoot = async (prefix: string): Promise<string> => realpathSync(await mkdtemp(join(tmpdir(), prefix)));

const sleep = (milliseconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

const entryPath = (root: string, name: string): string => join(knowledgeDirectory(root), `${name}.md`);

async function catalogueFiles(root: string): Promise<string[]> {
  try {
    return (await readdir(knowledgeDirectory(root))).sort();
  } catch {
    return [];
  }
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const readRevision = async (root: string, name: string): Promise<string> => {
  const read = await loadKnowledgeLibrary(root, knowledgeDirectory(root)).then(library => library.read(name));
  assert.ok(read.status === 'valid' || read.revision, 'a readable entry file carries a revision');
  return (read as { revision: string }).revision;
};

test('replace rewrites one existing entry in full against the revision that was read', async t => {
  const root = await realRoot('knowledge-replace-valid-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  await writeFile(join(root, 'reader.ts'), 'export const read = () => 1;\n');
  await saveKnowledgeProposal(root, {
    entries: [{ name: 'dispatch_flow', description: 'old description', body: 'OLD BODY never served.\n', evidence: [{ path: 'main.ts' }] }]
  });
  const revision = await readRevision(root, 'dispatch_flow');

  const result = await saveKnowledgeProposal(root, {
    mode: 'replace',
    entries: [{
      name: 'dispatch_flow',
      description: 'How dispatch reaches the reader',
      body: '## Dispatch\n\nWhole new body.\n',
      evidence: [{ path: 'main.ts' }, { path: 'reader.ts' }],
      expectedRevision: revision
    }]
  });
  assert.deepEqual(result, { status: 'replaced', replaced: ['dispatch_flow'], warnings: [] });
  // The old body is never echoed back with the outcome.
  assert.doesNotMatch(JSON.stringify(result), /OLD BODY/);

  // The published file is the whole new contract, with verified evidence.
  const parsed = parseKnowledge(await readFile(entryPath(root, 'dispatch_flow'), 'utf8'), 'dispatch_flow.md');
  assert.deepEqual(parsed, {
    status: 'valid',
    name: 'dispatch_flow',
    description: 'How dispatch reaches the reader',
    body: '## Dispatch\n\nWhole new body.\n',
    evidence: [
      { type: 'file', path: 'main.ts', sha256: sha256('export const start = 1;\n') },
      { type: 'file', path: 'reader.ts', sha256: sha256('export const read = () => 1;\n') }
    ]
  });
  // No staging file and no lock file survive a successful publication.
  assert.deepEqual(await catalogueFiles(root), ['dispatch_flow.md']);
  assert.equal(
    await readRevision(root, 'dispatch_flow'),
    knowledgeRevision(await readFile(entryPath(root, 'dispatch_flow')))
  );
  assert.notEqual(await readRevision(root, 'dispatch_flow'), revision);
});

test('replace repairs an invalid entry whose evidence no longer verifies, without serving its body', async t => {
  const root = await realRoot('knowledge-replace-invalid-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  // An entry whose declared proof no longer matches the cited bytes: the read
  // refuses its body, and only its revision addresses the file.
  await mkdir(knowledgeDirectory(root), { recursive: true });
  const stale = [
    '---',
    'name: stale_flow',
    'description: Cites bytes that moved',
    'evidence:',
    '  - type: file',
    '    path: main.ts',
    `    sha256: ${'f'.repeat(64)}`,
    '---',
    'STALE BODY never served.\n'
  ].join('\n');
  await writeFile(entryPath(root, 'stale_flow'), stale);
  const library = await loadKnowledgeLibrary(root, knowledgeDirectory(root));
  const refused = await library.read('stale_flow');
  assert.equal(refused.status, 'invalid');
  assert.equal(refused.reason, 'file_hash_mismatch');
  assert.ok(refused.revision, 'an invalid entry still carries the revision of its file');

  const result = await saveKnowledgeProposal(root, {
    mode: 'replace',
    entries: [{
      name: 'stale_flow',
      description: 'Repaired from the current code',
      body: 'Repaired body.\n',
      evidence: [{ path: 'main.ts' }],
      expectedRevision: refused.revision
    }]
  });
  assert.deepEqual(result, {
    status: 'replaced',
    replaced: ['stale_flow'],
    warnings: [{ name: 'stale_flow', code: 'insufficient_backing', distinctEvidencePaths: 1 }]
  });
  assert.doesNotMatch(JSON.stringify(result), /STALE BODY/);

  // The repaired entry reads valid again, and the invalid body is gone.
  const repaired = await library.read('stale_flow');
  assert.equal(repaired.status, 'valid');
  assert.equal((repaired as { body: string }).body, 'Repaired body.\n');
  assert.doesNotMatch(await readFile(entryPath(root, 'stale_flow'), 'utf8'), /STALE BODY/);
});

test('an absent, wrong or stale revision refuses the rewrite and leaves the file untouched', async t => {
  const root = await realRoot('knowledge-replace-conflict-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  await saveKnowledgeProposal(root, {
    entries: [{ name: 'dispatch_flow', description: 'original description', body: 'Original body.\n', evidence: [{ path: 'main.ts' }] }]
  });
  const revision = await readRevision(root, 'dispatch_flow');
  const rewrite = (expectedRevision?: unknown) => saveKnowledgeProposal(root, {
    mode: 'replace',
    entries: [{
      name: 'dispatch_flow',
      description: 'rewritten',
      body: 'Rewritten body.\n',
      evidence: [{ path: 'main.ts' }],
      ...(expectedRevision === undefined ? {} : { expectedRevision })
    }]
  });
  const expected = { status: 'conflict', conflicts: [{ name: 'dispatch_flow', reason: 'revision_conflict' }] };

  // Absent, non-string and wrong tokens are all the same compare-and-swap
  // conflict: the write is never guessed as last-writer-wins.
  assert.deepEqual(await rewrite(), expected);
  assert.deepEqual(await rewrite(42), expected);
  assert.deepEqual(await rewrite('a'.repeat(64)), expected);
  assert.equal(await readFile(entryPath(root, 'dispatch_flow'), 'utf8').then(source => source.includes('Original body.')), true);

  // A concurrent writer moved the entry: the token read before is now stale.
  await writeFile(entryPath(root, 'dispatch_flow'), (await readFile(entryPath(root, 'dispatch_flow'), 'utf8')).replace('original description', 'changed elsewhere'));
  const current = await readFile(entryPath(root, 'dispatch_flow'));
  assert.deepEqual(await rewrite(revision), expected);
  assert.deepEqual(await readFile(entryPath(root, 'dispatch_flow')), current, 'a refused rewrite never touches the file');
  assert.deepEqual(await catalogueFiles(root), ['dispatch_flow.md'], 'no staging file and no lock file survive a refusal');
});

test('replace refuses a name that does not exist: it rewrites, it never upserts', async t => {
  const root = await realRoot('knowledge-replace-unknown-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  const result = await saveKnowledgeProposal(root, {
    mode: 'replace',
    entries: [{
      name: 'never_written',
      description: 'replace is not an upsert',
      body: 'Body.\n',
      evidence: [{ path: 'main.ts' }],
      expectedRevision: 'a'.repeat(64)
    }]
  });
  assert.deepEqual(result, { status: 'invalid', rejected: [{ name: 'never_written', reason: 'unknown_entry' }] });
  assert.deepEqual(await catalogueFiles(root), []);
});

// Two writers starting from the same revision: the catalogue lock makes the
// compare-and-swap decide, so exactly one rewrite publishes and the other is
// refused without losing the winner's bytes.
test('two concurrent rewrites from the same revision cannot both succeed', async t => {
  const root = await realRoot('knowledge-replace-race-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  await saveKnowledgeProposal(root, {
    entries: [{ name: 'dispatch_flow', description: 'original', body: 'Original body.\n', evidence: [{ path: 'main.ts' }] }]
  });
  const revision = await readRevision(root, 'dispatch_flow');
  const rewrite = (body: string) => saveKnowledgeProposal(root, {
    mode: 'replace',
    entries: [{ name: 'dispatch_flow', description: 'rewritten', body, evidence: [{ path: 'main.ts' }], expectedRevision: revision }]
  });

  const results = await Promise.all([rewrite('First writer body.\n'), rewrite('Second writer body.\n')]);
  const replaced = results.filter(result => result.status === 'replaced');
  const refused = results.filter(result => result.status === 'conflict');
  assert.equal(replaced.length, 1, JSON.stringify(results));
  assert.equal(refused.length, 1, JSON.stringify(results));
  assert.deepEqual(refused[0], { status: 'conflict', conflicts: [{ name: 'dispatch_flow', reason: 'revision_conflict' }] });

  // The published file is the winner's whole body, and nothing else survived.
  const read = await loadKnowledgeLibrary(root, knowledgeDirectory(root)).then(library => library.read('dispatch_flow'));
  assert.equal(read.status, 'valid');
  assert.ok(['First writer body.\n', 'Second writer body.\n'].includes((read as { body: string }).body));
  assert.deepEqual(await catalogueFiles(root), ['dispatch_flow.md']);
});

test('a lock left by a crashed writer is taken over, and every refusal leaves no lock or temp file', async t => {
  const root = await realRoot('knowledge-replace-lock-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  await saveKnowledgeProposal(root, {
    entries: [{ name: 'dispatch_flow', description: 'original', body: 'Original body.\n', evidence: [{ path: 'main.ts' }] }]
  });
  const revision = await readRevision(root, 'dispatch_flow');
  const lock = join(knowledgeDirectory(root), catalogueLockName);

  // A stale lock is reclaimed by age instead of blocking every later write.
  await writeFile(lock, '');
  const past = new Date(Date.now() - 60_000);
  await utimes(lock, past, past);
  const published = await saveKnowledgeProposal(root, {
    mode: 'replace',
    entries: [{ name: 'dispatch_flow', description: 'after takeover', body: 'Taken over.\n', evidence: [{ path: 'main.ts' }], expectedRevision: revision }]
  });
  assert.equal(published.status, 'replaced', JSON.stringify(published));
  assert.deepEqual(await catalogueFiles(root), ['dispatch_flow.md']);

  // Every refusal — stale revision here — releases the lock and leaves no
  // staging file behind, so the next writer is never blocked by this one.
  const stale = await saveKnowledgeProposal(root, {
    mode: 'replace',
    entries: [{ name: 'dispatch_flow', description: 'stale', body: 'Stale.\n', evidence: [{ path: 'main.ts' }], expectedRevision: revision }]
  });
  assert.equal(stale.status, 'conflict');
  assert.deepEqual(await catalogueFiles(root), ['dispatch_flow.md']);
});

test('an unknown mode and a multi-entry rewrite are refused by explicit reasons and write nothing', async t => {
  const root = await realRoot('knowledge-replace-shape-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  const entry = (name: string) => ({
    name,
    description: 'shape',
    body: 'Body.\n',
    evidence: [{ path: 'main.ts' }],
    expectedRevision: 'a'.repeat(64)
  });

  // `append` belongs to another ticket: an unknown mode is refused, never
  // silently treated as `create`.
  assert.deepEqual(await saveKnowledgeProposal(root, { mode: 'append', entries: [entry('one_flow')] }), {
    status: 'invalid',
    rejected: [{ reason: 'unknown_mode' }]
  });
  assert.deepEqual(await saveKnowledgeProposal(root, { mode: 'replace', entries: [entry('one_flow'), entry('two_flow')] }), {
    status: 'invalid',
    rejected: [{ reason: 'mode_requires_single_entry' }]
  });
  assert.deepEqual(await catalogueFiles(root), []);
});

test('a caller-supplied origin is refused at creation and at rewrite: only the engine traces a fallback', async t => {
  const root = await realRoot('knowledge-origin-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  const faked = { path: 'main.ts', origin: 'symbol_fallback' };
  assert.deepEqual(await saveKnowledgeProposal(root, {
    entries: [{ name: 'faked_fallback', description: 'declares a fallback it never suffered', body: 'Body.\n', evidence: [faked] }]
  }), {
    status: 'invalid',
    rejected: [{ name: 'faked_fallback', reason: 'malformed_evidence' }]
  });
  assert.deepEqual(await catalogueFiles(root), []);

  // The engine still produces the trace by itself on a real substitution.
  await writeFile(join(root, 'legacy.rb'), 'def legacy\nend\n');
  const fallback = await saveKnowledgeProposal(root, {
    entries: [{ name: 'legacy_rule', description: 'Ruby rule', body: 'Body.\n', evidence: [{ type: 'symbol', path: 'legacy.rb', symbol: 'legacy' }] }]
  });
  assert.equal(fallback.status, 'saved');
  assert.match(await readFile(entryPath(root, 'legacy_rule'), 'utf8'), /origin: symbol_fallback/);
});

test('engine_changed refuses a rewrite carrying symbol proofs, and no path ever rewrites the marker', async t => {
  const root = await realRoot('knowledge-replace-engine-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  await saveKnowledgeProposal(root, {
    entries: [{ name: 'dispatch_flow', description: 'original', body: 'Original body.\n', evidence: [{ path: 'main.ts' }] }]
  });
  const marker = join(knowledgeDirectory(root), catalogueCanonicalizerName);
  await writeFile(marker, 'span@0\n');
  const revision = await readRevision(root, 'dispatch_flow');
  const before = await readFile(entryPath(root, 'dispatch_flow'), 'utf8');

  // Repairing with `symbol` proofs under another engine identity is refused,
  // exactly like a creation: the marker is a trace, never a configuration.
  assert.deepEqual(await saveKnowledgeProposal(root, {
    mode: 'replace',
    entries: [{
      name: 'dispatch_flow',
      description: 'repaired from symbols',
      body: 'Symbol body.\n',
      evidence: [{ type: 'symbol', path: 'main.ts', symbol: 'start' }],
      expectedRevision: revision
    }]
  }), {
    status: 'invalid',
    rejected: [{ reason: 'engine_changed' }]
  });
  assert.equal(await readFile(entryPath(root, 'dispatch_flow'), 'utf8'), before);
  assert.equal((await readFile(marker, 'utf8')).trim(), 'span@0');

  // Repairing with `file` proofs is unaffected by the canonicalizer identity.
  const repaired = await saveKnowledgeProposal(root, {
    mode: 'replace',
    entries: [{
      name: 'dispatch_flow',
      description: 'repaired from files',
      body: 'File body.\n',
      evidence: [{ path: 'main.ts' }],
      expectedRevision: revision
    }]
  });
  assert.equal(repaired.status, 'replaced', JSON.stringify(repaired));
  assert.equal((await readFile(marker, 'utf8')).trim(), 'span@0', 'the marker is never rewritten');
});

// The lock is taken by `create` too, not only by the mode that needs it to
// compare a revision: a catalogue-wide critical section is the only way the
// canonicalizer marker can never be raced. Readers stay lock-free.
test('create waits for the catalogue lock while readers keep working', async t => {
  const root = await realRoot('knowledge-lock-create-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  await mkdir(knowledgeDirectory(root), { recursive: true });
  const lock = join(knowledgeDirectory(root), catalogueLockName);
  await writeFile(lock, '');

  let settled = false;
  const pending = saveKnowledgeProposal(root, {
    entries: [{ name: 'blocked_flow', description: 'Waits for the lock', body: 'Body.\n', evidence: [{ path: 'main.ts' }] }]
  }).then(result => {
    settled = true;
    return result;
  });
  await sleep(150);
  assert.equal(settled, false, 'a create takes the catalogue lock instead of publishing beside it');
  assert.equal(
    (await readFile(join(root, 'main.ts'), 'utf8')).trim(),
    'export const start = 1;',
    'a concurrent read of the workspace is unaffected: readers take no lock'
  );

  await rm(lock, { force: true });
  assert.equal((await pending).status, 'saved');
  assert.deepEqual(await catalogueFiles(root), ['blocked_flow.md']);
});
