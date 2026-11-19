import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  fileProofHash,
  knowledgeDirectory,
  loadKnowledgeLibrary,
  parseKnowledge,
  saveKnowledgeProposal,
  serializeKnowledgeEntry,
  type KnowledgeSaveResult
} from '../src/index';

async function realRoot(prefix: string): Promise<string> {
  return realpathSync(await mkdtemp(join(tmpdir(), prefix)));
}

const proofOf = async (root: string, file: string): Promise<string> => fileProofHash(await readFile(join(root, file)));

async function catalogueFiles(root: string): Promise<string[]> {
  try {
    return (await readdir(knowledgeDirectory(root))).sort();
  } catch {
    return [];
  }
}

function expectStatus<S extends KnowledgeSaveResult['status']>(result: KnowledgeSaveResult, status: S): Extract<KnowledgeSaveResult, { status: S }> {
  assert.equal(result.status, status, JSON.stringify(result));
  return result as Extract<KnowledgeSaveResult, { status: S }>;
}

test('a proposal is persisted as one parseable entry with its computed evidence hash', async t => {
  const root = await realRoot('knowledge-save-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  const body = '## Dispatch flow\n\nBody line one.\n\n- item\n';
  const result = await saveKnowledgeProposal(root, {
    entries: [{ name: 'dispatch_flow', description: 'How tool calls dispatch', body, evidence: [{ path: 'main.ts' }] }]
  });
  assert.deepEqual(result, {
    status: 'saved',
    saved: ['dispatch_flow'],
    warnings: [{ name: 'dispatch_flow', code: 'insufficient_backing', distinctEvidencePaths: 1 }]
  });

  const source = await readFile(join(knowledgeDirectory(root), 'dispatch_flow.md'), 'utf8');
  const parsed = parseKnowledge(source, 'dispatch_flow.md');
  assert.equal(parsed.status, 'valid');
  const digest = createHash('sha256').update('export const start = 1;\n').digest('hex');
  assert.deepEqual(parsed, {
    status: 'valid',
    name: 'dispatch_flow',
    description: 'How tool calls dispatch',
    body,
    evidence: [{ type: 'file', path: 'main.ts', sha256: digest }]
  });

  const library = await loadKnowledgeLibrary(root, knowledgeDirectory(root));
  const read = await library.read('dispatch_flow');
  assert.equal(read.status, 'valid');
  assert.equal((read as { body: string }).body, body);
});

test('Knowledge names allow hyphens, digits and reserved words while confining paths', async t => {
  const root = await realRoot('knowledge-name-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'bytes\n');
  const makeEntry = (name: string) => ({ name, description: 'test', body: 'content\n', evidence: [{ path: 'main.ts' }] });
  const names = ['knowledge-lecture-verifiee', '1st-step', 'class', 'legacyName'];
  assert.deepEqual(await saveKnowledgeProposal(root, { entries: names.map(makeEntry) }), {
    status: 'saved',
    saved: names,
    warnings: names.map(name => ({ name, code: 'insufficient_backing', distinctEvidencePaths: 1 }))
  });
  const library = await loadKnowledgeLibrary(root, knowledgeDirectory(root));
  assert.deepEqual((await library.list()).map(entry => entry.name).sort(), [...names].sort());
  for (const name of names) assert.equal((await library.read(name)).status, 'valid', name);
  for (const name of ['../outside', 'path/name', 'path\\name', '/absolute', '.', '..', '-option', 'bad\nname']) {
    const result = await saveKnowledgeProposal(root, { entries: [makeEntry(name)] });
    assert.equal(result.status, 'invalid', name);
    assert.equal((await library.read(name)).status, 'invalid', name);
  }
  for (const name of ['CON', 'nul', 'COM1', 'lpt9']) {
    assert.equal((await saveKnowledgeProposal(root, { entries: [makeEntry(name)] })).status, 'invalid', name);
  }
});

test('serializeKnowledgeEntry round-trips the body through the read grammar', () => {
  const source = serializeKnowledgeEntry({
    name: 'round_trip',
    description: 'keeps the Markdown body: exactly',
    body: '---\nnot a delimiter\n\n# Heading\n',
    evidence: [{ type: 'file', path: 'src/main.ts', sha256: 'a'.repeat(64) }]
  });
  const parsed = parseKnowledge(source, 'round_trip.md');
  assert.equal(parsed.status, 'valid');
  assert.equal((parsed as { body: string }).body, '---\nnot a delimiter\n\n# Heading\n');
});

test('an explicitly empty proposal is a no-op that writes nothing', async t => {
  const root = await realRoot('knowledge-save-noop-');
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await saveKnowledgeProposal(root, { entries: [] }), { status: 'no-op' });
  assert.deepEqual(await catalogueFiles(root), []);
});

test('a second entry with the same name in one proposal is refused', async t => {
  const root = await realRoot('knowledge-save-duplicate-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'bytes\n');
  const entry = (description: string) => ({ name: 'same_name', description, body: 'body\n', evidence: [{ path: 'main.ts' }] });
  const result = await saveKnowledgeProposal(root, { entries: [entry('first'), entry('second')] });
  const invalid = expectStatus(result, 'invalid');
  assert.deepEqual(invalid.rejected, [{ name: 'same_name', reason: 'duplicate_name' }]);
  assert.deepEqual(await catalogueFiles(root), []);
});

test('a name conflict preserves the existing file byte for byte and writes nothing else', async t => {
  const root = await realRoot('knowledge-save-conflict-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'bytes\n');
  await mkdir(knowledgeDirectory(root), { recursive: true });
  const existing = `---\nname: existing\ndescription: original\n---\noriginal body\n`;
  await writeFile(join(knowledgeDirectory(root), 'existing.md'), existing);
  const before = await readFile(join(knowledgeDirectory(root), 'existing.md'));

  const result = await saveKnowledgeProposal(root, {
    entries: [
      { name: 'brand_new', description: 'new entry', body: 'new body\n', evidence: [{ path: 'main.ts' }] },
      { name: 'existing', description: 'replacement', body: 'replacement body\n', evidence: [{ path: 'main.ts' }] }
    ]
  });
  const conflict = expectStatus(result, 'conflict');
  assert.deepEqual(conflict.conflicts, [{ name: 'existing', reason: 'name_conflict' }]);
  assert.deepEqual(await readFile(join(knowledgeDirectory(root), 'existing.md')), before);
  // No partial publication: the sibling entry was not written either, and no
  // staging file survived.
  assert.deepEqual(await catalogueFiles(root), ['existing.md']);
});

test('invalid evidence refuses the whole proposal without publishing or leaving staging files', async t => {
  const root = await realRoot('knowledge-save-invalid-');
  const outsideRoot = await realRoot('knowledge-save-outside-');
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outsideRoot, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'bytes\n');
  await mkdir(join(root, 'dir'));
  await writeFile(join(outsideRoot, 'secret.ts'), 'outside bytes\n');
  await symlink(join(outsideRoot, 'secret.ts'), join(root, 'linked.ts'));
  const digest = await proofOf(root, 'main.ts');

  const result = await saveKnowledgeProposal(root, {
    entries: [
      { name: 'valid_one', description: 'valid', body: 'body\n', evidence: [{ path: 'main.ts' }] },
      { name: 'missing_file', description: 'missing', body: 'body\n', evidence: [{ path: 'gone.ts' }] },
      { name: 'changed_hash', description: 'changed', body: 'body\n', evidence: [{ path: 'main.ts', sha256: 'a'.repeat(64) }] },
      { name: 'outside_path', description: 'outside', body: 'body\n', evidence: [{ path: '../secret.ts' }] },
      { name: 'absolute_path', description: 'absolute', body: 'body\n', evidence: [{ path: join(outsideRoot, 'secret.ts') }] },
      { name: 'escaping_link', description: 'link', body: 'body\n', evidence: [{ path: 'linked.ts' }] },
      { name: 'directory', description: 'dir', body: 'body\n', evidence: [{ path: 'dir' }] },
      { name: 'symbolic', description: 'symbol', body: 'body\n', evidence: [{ type: 'symbol', path: 'main.ts' }] },
      { name: 'bad_shape', description: 'shape', body: 'body\n', evidence: [{ path: 'main.ts', sha256: 'nope' }] },
      { name: 'not_an_object', description: 'shape', body: 'body\n', evidence: ['main.ts'] }
    ]
  });
  const invalid = expectStatus(result, 'invalid');
  assert.deepEqual(invalid.rejected, [
    { name: 'missing_file', reason: 'file_missing' },
    { name: 'changed_hash', reason: 'file_hash_mismatch' },
    { name: 'outside_path', reason: 'path_outside_workspace' },
    { name: 'absolute_path', reason: 'path_outside_workspace' },
    { name: 'escaping_link', reason: 'symlink_escape' },
    { name: 'directory', reason: 'not_a_file' },
    { name: 'symbolic', reason: 'unsupported_proof' },
    { name: 'bad_shape', reason: 'malformed_evidence' },
    { name: 'not_an_object', reason: 'malformed_evidence' }
  ]);
  assert.equal(digest.length, 64);
  assert.deepEqual(await catalogueFiles(root), []);
});

test('invalid fields and a malformed proposal shape are refused without publication', async t => {
  const root = await realRoot('knowledge-save-fields-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'bytes\n');
  const body = 'body\n';
  const evidence = [{ path: 'main.ts' }];

  const rejected = async (proposal: unknown) => expectStatus(await saveKnowledgeProposal(root, proposal), 'invalid').rejected;

  assert.deepEqual(await rejected({ entries: [{ name: 'not an id', description: 'd', body, evidence }] }), [{ name: 'not an id', reason: 'invalid_name' }]);
  assert.deepEqual(await rejected({ entries: [{ name: 'empty_description', description: '   ', body, evidence }] }), [{ name: 'empty_description', reason: 'invalid_description' }]);
  assert.deepEqual(await rejected({ entries: [{ name: 'multiline_description', description: 'one\ntwo', body, evidence }] }), [{ name: 'multiline_description', reason: 'invalid_description' }]);
  assert.deepEqual(await rejected({ entries: [{ name: 'empty_body', description: 'd', body: '  \n', evidence }] }), [{ name: 'empty_body', reason: 'invalid_body' }]);
  assert.deepEqual(await rejected({ entries: [{ name: 'no_evidence', description: 'd', body, evidence: [] }] }), [{ name: 'no_evidence', reason: 'missing_evidence' }]);
  assert.deepEqual(await rejected({ entries: [{ name: 'unknown_field', description: 'd', body, evidence, extra: true }] }), [{ name: 'unknown_field', reason: 'malformed_entry' }]);
  assert.deepEqual(await rejected({ entries: [{ name: 'empty_path', description: 'd', body, evidence: [{ path: '  ' }] }] }), [{ name: 'empty_path', reason: 'malformed_evidence' }]);
  assert.deepEqual(await rejected({ entries: 'nope' }), [{ reason: 'malformed_proposal' }]);
  assert.deepEqual(await rejected({ entries: [], extra: true }), [{ reason: 'malformed_proposal' }]);
  assert.deepEqual(await catalogueFiles(root), []);
});

test('an entry backed by two distinct files publishes without a warning, one citing a single file twice stays flagged', async t => {
  const root = await realRoot('knowledge-save-backing-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  await writeFile(join(root, 'reader.ts'), 'export const read = () => 1;\n');
  const result = await saveKnowledgeProposal(root, {
    entries: [
      {
        name: 'well_backed_flow',
        description: 'cites two distinct files',
        body: 'body\n',
        evidence: [{ path: 'main.ts' }, { path: 'reader.ts' }]
      },
      {
        name: 'single_file_flow',
        description: 'cites the same file twice',
        body: 'body\n',
        evidence: [{ path: 'main.ts' }, { path: 'main.ts' }]
      }
    ]
  });
  assert.deepEqual(result, {
    status: 'saved',
    saved: ['well_backed_flow', 'single_file_flow'],
    warnings: [{ name: 'single_file_flow', code: 'insufficient_backing', distinctEvidencePaths: 1 }]
  });
  assert.deepEqual(await catalogueFiles(root), ['single_file_flow.md', 'well_backed_flow.md']);
});

test('a provided matching hash is accepted and normalized while an uppercase hash verifies', async t => {
  const root = await realRoot('knowledge-save-provided-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'bytes\n');
  const digest = await proofOf(root, 'main.ts');
  const result = await saveKnowledgeProposal(root, {
    entries: [{ name: 'provided', description: 'declares its hash', body: 'body\n', evidence: [{ path: './main.ts', sha256: digest.toUpperCase() }] }]
  });
  assert.deepEqual(result, {
    status: 'saved',
    saved: ['provided'],
    warnings: [{ name: 'provided', code: 'insufficient_backing', distinctEvidencePaths: 1 }]
  });
  const parsed = parseKnowledge(await readFile(join(knowledgeDirectory(root), 'provided.md'), 'utf8'), 'provided.md');
  assert.equal(parsed.status, 'valid');
  assert.deepEqual((parsed as { evidence: unknown }).evidence, [{ type: 'file', path: 'main.ts', sha256: digest }]);
});
