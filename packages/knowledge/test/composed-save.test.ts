import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KNOWLEDGE_MAX_VALIDATED_NODES,
  knowledgeDirectory,
  knowledgeRevision,
  loadKnowledgeLibrary,
  saveKnowledgeProposal,
  type KnowledgeSaveResult,
  type KnowledgeValidation
} from '../src/index';

// Publishing a Composed Knowledge Entry (spec #288, ticket #284): the proposal
// carries the daughters' names alone and the engine resolves each file from
// the catalogue, verifies her whole contract and pins her revision itself,
// inside the publication lock (ADR 0054). These tests observe the returned
// vocabulary, the exact bytes left in the catalogue and the immediate
// readability of what was published; they never inspect internal call order.

const realRoot = async (prefix: string): Promise<string> => realpathSync(await mkdtemp(join(tmpdir(), prefix)));

const entryPath = (root: string, name: string): string => join(knowledgeDirectory(root), `${name}.md`);

async function catalogueFiles(root: string): Promise<string[]> {
  try {
    return (await readdir(knowledgeDirectory(root))).sort();
  } catch {
    return [];
  }
}

const read = async (root: string, name: string): Promise<KnowledgeValidation> =>
  loadKnowledgeLibrary(root, knowledgeDirectory(root)).then(library => library.read(name));

/** The revision of one published entry, as the read path exposes it. */
async function readRevision(root: string, name: string): Promise<string> {
  const written = await read(root, name);
  assert.ok(written.status === 'valid' || written.revision !== undefined, 'a readable entry file carries a revision');
  return (written as { revision: string }).revision;
}

const rejected = (result: KnowledgeSaveResult): Array<{ name?: string; reason: string; via?: string }> => {
  assert.equal(result.status, 'invalid', JSON.stringify(result));
  return (result as Extract<KnowledgeSaveResult, { status: 'invalid' }>).rejected;
};

/**
 * One atomic entry published through the real write path, citing a source file
 * of her own. She is a daughter like any other: her revision is the digest of
 * the bytes the mother must pin.
 */
async function seedAtomic(root: string, name: string, source: string): Promise<string> {
  await writeFile(join(root, source), `export const ${source.replace(/\.ts$/, '')} = 1;\n`);
  const result = await saveKnowledgeProposal(root, {
    entries: [{ name, description: `${name} atomic description`, body: `${name} atomic body\n`, evidence: [{ path: source }] }]
  });
  assert.equal(result.status, 'saved', JSON.stringify(result));
  return readRevision(root, name);
}

/** Two valid atomic daughters, plus the two files a mother cites as her own direct proofs. */
interface Daughters {
  one: string;
  two: string;
}

async function workspaceWithTwoDaughters(root: string): Promise<Daughters> {
  await writeFile(join(root, 'relation_a.ts'), 'export const relationA = 1;\n');
  await writeFile(join(root, 'relation_b.ts'), 'export const relationB = 2;\n');
  return { one: await seedAtomic(root, 'child_one', 'alpha.ts'), two: await seedAtomic(root, 'child_two', 'beta.ts') };
}

const MOTHER_BODY = '## Relation\n\nThe two daughters interact through dispatch.\n';

/** One composed proposal entry: names only, never a digest (ADR 0054). */
const motherEntry = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'mother',
  description: 'how the two daughters interact',
  body: MOTHER_BODY,
  evidence: [{ path: 'relation_a.ts' }, { path: 'relation_b.ts' }],
  dependencies: [{ name: 'child_one' }, { name: 'child_two' }],
  ...overrides
});

/** A refusal of this ticket is atomic: the catalogue holds exactly what it held before. */
async function expectUnchangedCatalogue(root: string, expected: string[]): Promise<void> {
  assert.deepEqual(await catalogueFiles(root), expected, 'no entry and no staging residue was left behind');
}

test('creating a composed entry by naming two daughters pins each revision and publishes the digest of its own bytes', async t => {
  const root = await realRoot('knowledge-composed-create-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const daughters = await workspaceWithTwoDaughters(root);

  const result = await saveKnowledgeProposal(root, { entries: [motherEntry()] });
  assert.equal(result.status, 'saved', JSON.stringify(result));

  const source = await readFile(entryPath(root, 'mother'), 'utf8');
  // Every declared dependency carries the daughter's name and her revision —
  // the digest the engine computed from the catalogue, never one it was given.
  assert.match(source, /dependencies:\n {2}- name: child_one\n {4}sha256: [0-9a-f]{64}\n {2}- name: child_two\n {4}sha256: [0-9a-f]{64}\n---/);
  assert.ok(source.includes(`  - name: child_one\n    sha256: ${daughters.one}\n`), 'child_one is pinned at her current revision');
  assert.ok(source.includes(`  - name: child_two\n    sha256: ${daughters.two}\n`), 'child_two is pinned at her current revision');
  assert.equal(daughters.one, knowledgeRevision(await readFile(entryPath(root, 'child_one'))));

  // The entry is her own file, not a view of her daughters: her revision is
  // the digest of the bytes just written, and #283's validation serves her
  // body immediately because both daughters still verify.
  const published = await read(root, 'mother');
  assert.equal(published.status, 'valid', JSON.stringify(published));
  assert.equal((published as { body: string }).body, MOTHER_BODY);
  assert.equal((published as { revision: string }).revision, knowledgeRevision(Buffer.from(source)));
});

test('a composed proposal that supplies a digest, a path or a type is refused as an unknown field', async t => {
  const root = await realRoot('knowledge-composed-unknown-field-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const daughters = await workspaceWithTwoDaughters(root);

  // The model never pins: a dependency is a name, so anything else is an
  // unknown field refused like a caller-supplied `origin`.
  const shapes: Array<[string, Record<string, unknown>]> = [
    ['a digest', { dependencies: [{ name: 'child_one', sha256: daughters.one }, { name: 'child_two' }] }],
    ['a path', { dependencies: [{ name: 'child_one', path: '.tours/.memory/knowledge/child_one.md' }, { name: 'child_two' }] }],
    ['a proof type', { dependencies: [{ name: 'child_one', type: 'file' }, { name: 'child_two' }] }]
  ];
  for (const [label, override] of shapes) {
    const [rejection] = rejected(await saveKnowledgeProposal(root, { entries: [motherEntry(override)] }));
    assert.equal(rejection.reason, 'malformed_entry', JSON.stringify(label));
    await expectUnchangedCatalogue(root, ['child_one.md', 'child_two.md']);
  }
});

test('an unknown daughter is refused as dependency_missing before any byte is written', async t => {
  const root = await realRoot('knowledge-composed-missing-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await workspaceWithTwoDaughters(root);

  const [rejection] = rejected(await saveKnowledgeProposal(root, {
    entries: [motherEntry({ dependencies: [{ name: 'child_one' }, { name: 'absent_daughter' }] })]
  }));
  assert.equal(rejection.reason, 'dependency_missing');
  assert.equal(rejection.via, 'absent_daughter', 'the faulty daughter is named, as on the read path');
  await expectUnchangedCatalogue(root, ['child_one.md', 'child_two.md']);
});

test('a daughter present but whose own read refuses is refused as dependency_invalid, naming her', async t => {
  const root = await realRoot('knowledge-composed-invalid-daughter-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await workspaceWithTwoDaughters(root);
  await seedAtomic(root, 'child_three', 'gamma.ts');
  // Her Markdown is intact and her code moved: her own read now refuses, so a
  // mother pinning her would be born dead.
  await writeFile(join(root, 'gamma.ts'), 'export const gamma = 999;\n');

  const [rejection] = rejected(await saveKnowledgeProposal(root, {
    entries: [motherEntry({ dependencies: [{ name: 'child_one' }, { name: 'child_three' }] })]
  }));
  assert.equal(rejection.reason, 'dependency_invalid');
  assert.equal(rejection.via, 'child_three');
  await expectUnchangedCatalogue(root, ['child_one.md', 'child_three.md', 'child_two.md']);
});

test('an append never declares the dependencies field and keeps the historical list identical', async t => {
  const root = await realRoot('knowledge-composed-append-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await workspaceWithTwoDaughters(root);
  assert.equal((await saveKnowledgeProposal(root, { entries: [motherEntry()] })).status, 'saved');
  const revision = await readRevision(root, 'mother');
  const historical = await readFile(entryPath(root, 'mother'), 'utf8');

  // An append enriches one entry, it never changes what the entry IS: the
  // field is refused exactly like `name` and `description`, before any byte.
  const [refused] = rejected(await saveKnowledgeProposal(root, {
    mode: 'append',
    entries: [{ name: 'mother', addition: '## More\n\nAddition.\n', dependencies: [{ name: 'child_one' }, { name: 'child_two' }], expectedRevision: revision }]
  }));
  assert.equal(refused.reason, 'malformed_entry');
  assert.equal(await readFile(entryPath(root, 'mother'), 'utf8'), historical, 'the historical file is untouched');

  // Without the field the same append publishes, and neither adds nor drops a
  // composition: the list is carried verbatim, pins included.
  const appended = await saveKnowledgeProposal(root, {
    mode: 'append',
    entries: [{ name: 'mother', addition: '## More\n\nAddition.\n', expectedRevision: revision }]
  });
  assert.equal(appended.status, 'appended', JSON.stringify(appended));
  const published = await read(root, 'mother');
  assert.equal(published.status, 'valid', JSON.stringify(published));
  assert.deepEqual((published as { dependencies: unknown }).dependencies, [
    { name: 'child_one', sha256: await readRevision(root, 'child_one') },
    { name: 'child_two', sha256: await readRevision(root, 'child_two') }
  ]);
  assert.ok((published as { body: string }).body.startsWith(MOTHER_BODY), 'the historical body stays verbatim');
});

test('a replace promotes an atomic entry into a composed one, published and immediately readable', async t => {
  const root = await realRoot('knowledge-composed-promote-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const daughters = await workspaceWithTwoDaughters(root);
  await writeFile(join(root, 'promoted.ts'), 'export const promoted = 1;\n');
  assert.equal((await saveKnowledgeProposal(root, {
    entries: [{ name: 'promoted', description: 'atomic before', body: 'ATOMIC BODY.\n', evidence: [{ path: 'promoted.ts' }] }]
  })).status, 'saved');
  const revision = await readRevision(root, 'promoted');

  const result = await saveKnowledgeProposal(root, {
    mode: 'replace',
    entries: [{
      name: 'promoted',
      description: 'how the two daughters interact',
      body: MOTHER_BODY,
      evidence: [{ path: 'relation_a.ts' }, { path: 'relation_b.ts' }],
      dependencies: [{ name: 'child_one' }, { name: 'child_two' }],
      expectedRevision: revision
    }]
  });
  assert.equal(result.status, 'replaced', JSON.stringify(result));

  const published = await read(root, 'promoted');
  assert.equal(published.status, 'valid', JSON.stringify(published));
  assert.deepEqual((published as { dependencies: unknown }).dependencies, [
    { name: 'child_one', sha256: daughters.one },
    { name: 'child_two', sha256: daughters.two }
  ]);
  assert.equal((published as { body: string }).body, MOTHER_BODY);
  assert.doesNotMatch(JSON.stringify(published), /ATOMIC BODY/);
});

test('a replace never downgrades a composed entry: the complete list is redeclared or refused', async t => {
  const root = await realRoot('knowledge-composed-no-downgrade-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const daughters = await workspaceWithTwoDaughters(root);
  assert.equal((await saveKnowledgeProposal(root, { entries: [motherEntry()] })).status, 'saved');
  const revision = await readRevision(root, 'mother');
  const historical = await readFile(entryPath(root, 'mother'), 'utf8');

  const rewrite = (overrides: Record<string, unknown>): Record<string, unknown> => ({
    name: 'mother',
    description: 'rewritten description',
    body: '## Rewritten\n\nRewritten body.\n',
    evidence: [{ path: 'relation_a.ts' }, { path: 'relation_b.ts' }],
    expectedRevision: revision,
    ...overrides
  });

  // Losing the structure of an entry must never be a side effect of a rewrite,
  // and the engine never fills a missing list in.
  for (const [label, override] of [
    ['without a list', {}],
    ['with one daughter', { dependencies: [{ name: 'child_one' }] }]
  ] as Array<[string, Record<string, unknown>]>) {
    const [refusal] = rejected(await saveKnowledgeProposal(root, { mode: 'replace', entries: [rewrite(override)] }));
    assert.equal(refusal.reason, 'dependencies_incomplete', JSON.stringify(label));
    assert.equal(await readFile(entryPath(root, 'mother'), 'utf8'), historical, `${label}: nothing was written`);
  }

  // The complete list is accepted, and the rewrite pins what the catalogue
  // holds now.
  const replaced = await saveKnowledgeProposal(root, {
    mode: 'replace',
    entries: [rewrite({ dependencies: [{ name: 'child_two' }, { name: 'child_one' }] })]
  });
  assert.equal(replaced.status, 'replaced', JSON.stringify(replaced));
  const published = await read(root, 'mother');
  assert.equal(published.status, 'valid', JSON.stringify(published));
  assert.deepEqual((published as { dependencies: unknown }).dependencies, [
    { name: 'child_two', sha256: daughters.two },
    { name: 'child_one', sha256: daughters.one }
  ]);
});

test('a self-reference and an ancestor cycle introduced at write time are refused as dependency_cycle', async t => {
  const root = await realRoot('knowledge-composed-cycle-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await workspaceWithTwoDaughters(root);

  // An entry is never her own daughter.
  const [self] = rejected(await saveKnowledgeProposal(root, {
    entries: [motherEntry({ dependencies: [{ name: 'mother' }, { name: 'child_one' }] })]
  }));
  assert.equal(self.reason, 'dependency_cycle');
  assert.equal(self.via, 'mother');
  await expectUnchangedCatalogue(root, ['child_one.md', 'child_two.md']);

  // A rewrite that would make her daughter her own ancestor is refused whole.
  assert.equal((await saveKnowledgeProposal(root, { entries: [motherEntry()] })).status, 'saved');
  const motherRevision = await readRevision(root, 'mother');
  const childOneRevision = await readRevision(root, 'child_one');
  await writeFile(join(root, 'gamma.ts'), 'export const gamma = 1;\n');
  await writeFile(join(root, 'delta.ts'), 'export const delta = 2;\n');
  const [ancestor] = rejected(await saveKnowledgeProposal(root, {
    mode: 'replace',
    entries: [{
      name: 'child_one',
      description: 'child_one now rests on the mother',
      body: '## Cycle\n\nThis would close a loop.\n',
      evidence: [{ path: 'gamma.ts' }, { path: 'delta.ts' }],
      dependencies: [{ name: 'mother' }, { name: 'child_two' }],
      expectedRevision: childOneRevision
    }]
  }));
  assert.equal(ancestor.reason, 'dependency_cycle');
  assert.equal(ancestor.via, 'mother');
  assert.equal(await readRevision(root, 'child_one'), childOneRevision, 'the daughter was not rewritten');
  assert.equal(await readRevision(root, 'mother'), motherRevision);
});

test('a composed daughter is published and readable, and one composition level deeper is refused', async t => {
  const root = await realRoot('knowledge-composed-depth-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await workspaceWithTwoDaughters(root);
  assert.equal((await saveKnowledgeProposal(root, { entries: [motherEntry()] })).status, 'saved');

  // composed → composed → atomic is legal: `deep` rests on a composed daughter.
  await writeFile(join(root, 'relation_c.ts'), 'export const relationC = 3;\n');
  const deep = await saveKnowledgeProposal(root, {
    entries: [motherEntry({
      name: 'deep',
      dependencies: [{ name: 'mother' }, { name: 'child_two' }]
    })]
  });
  assert.equal(deep.status, 'saved', JSON.stringify(deep));
  const published = await read(root, 'deep');
  assert.equal(published.status, 'valid', JSON.stringify(published));
  assert.deepEqual((published as { dependencies: Array<{ name: string }> }).dependencies.map(dependency => dependency.name), ['mother', 'child_two']);

  // One level deeper cannot be served by a read, so it is never published:
  // the engine refuses rather than birthing a dead entry.
  const [rejection] = rejected(await saveKnowledgeProposal(root, {
    entries: [motherEntry({ name: 'too_deep', dependencies: [{ name: 'deep' }, { name: 'child_one' }] })]
  }));
  assert.equal(rejection.reason, 'dependency_depth_exceeded');
  assert.equal(rejection.via, 'deep');
  assert.equal(await readFile(entryPath(root, 'too_deep'), 'utf8').catch(() => undefined), undefined);
});

test('the same declaration is refused the same way on the write side and on the read side', async t => {
  const root = await realRoot('knowledge-composed-parity-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await workspaceWithTwoDaughters(root);

  // What the engine pins is exactly what a read then verifies: the published
  // pins are the daughters' current revisions, so the read path agrees.
  assert.equal((await saveKnowledgeProposal(root, { entries: [motherEntry()] })).status, 'saved');
  const published = await read(root, 'mother');
  assert.equal(published.status, 'valid');

  // A daughter that moves afterwards refuses the mother on both sides, and the
  // write side refuses to re-publish her dead while the read still names her.
  await writeFile(join(root, 'alpha.ts'), 'export const alpha = 999;\n');
  const reread = await read(root, 'mother');
  assert.equal(reread.status, 'invalid');
  assert.equal((reread as { reason: string }).reason, 'dependency_invalid');
  assert.equal((reread as { via?: string }).via, 'child_one');
  const [rejection] = rejected(await saveKnowledgeProposal(root, {
    entries: [motherEntry({ name: 'second_mother', dependencies: [{ name: 'child_one' }, { name: 'child_two' }] })]
  }));
  assert.equal(rejection.reason, 'dependency_invalid');
  assert.equal(rejection.via, 'child_one');
});

test('a composed entry is never published with fewer than two direct proofs of her own', async t => {
  const root = await realRoot('knowledge-composed-backing-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await workspaceWithTwoDaughters(root);
  await mkdir(knowledgeDirectory(root), { recursive: true });

  // The read grammar refuses a composed entry backed by one proof, so the
  // proposal is refused instead of publishing a file no read can serve.
  const [rejection] = rejected(await saveKnowledgeProposal(root, {
    entries: [motherEntry({ evidence: [{ path: 'relation_a.ts' }] })]
  }));
  assert.equal(rejection.reason, 'malformed_entry');
  await expectUnchangedCatalogue(root, ['child_one.md', 'child_two.md']);
});

test('the write side checks the node bound before it resolves a daughter past it', async t => {
  const root = await realRoot('knowledge-composed-write-bound-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'shared.ts'), 'export const shared = 1;\n');
  await writeFile(join(root, 'relation_a.ts'), 'export const relationA = 1;\n');
  await writeFile(join(root, 'relation_b.ts'), 'export const relationB = 2;\n');

  // 63 atomic daughters, published in one call: with their mother they are
  // exactly the node budget of one operation.
  const names = Array.from(
    { length: KNOWLEDGE_MAX_VALIDATED_NODES - 1 },
    (_, index) => `node_${String(index).padStart(2, '0')}`
  );
  const seeded = await saveKnowledgeProposal(root, {
    entries: names.map(name => ({
      name,
      description: `${name} atomic description`,
      body: `${name} atomic body\n`,
      evidence: [{ path: 'shared.ts' }]
    }))
  });
  assert.equal(seeded.status, 'saved', JSON.stringify(seeded));

  const fits = await saveKnowledgeProposal(root, {
    entries: [motherEntry({ name: 'fits', dependencies: names.map(name => ({ name })) })]
  });
  assert.equal(fits.status, 'saved', JSON.stringify(fits));
  assert.equal((await read(root, 'fits')).status, 'valid');

  // One daughter more is past the budget. That daughter is deliberately absent
  // from the catalogue: a `dependency_node_limit_exceeded` refusal proves she
  // was never resolved, because resolving her would answer
  // `dependency_missing` instead.
  const before = await catalogueFiles(root);
  const [rejection] = rejected(await saveKnowledgeProposal(root, {
    entries: [motherEntry({
      name: 'wide',
      dependencies: [...names.map(name => ({ name })), { name: 'absent_daughter' }]
    })]
  }));
  assert.equal(rejection.reason, 'dependency_node_limit_exceeded');
  assert.equal(rejection.via, 'absent_daughter', 'the first daughter over the bound is named');
  assert.deepEqual(await catalogueFiles(root), before, 'nothing was read past the bound, nothing was written');
});
