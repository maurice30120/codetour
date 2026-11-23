import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  fileProofHash,
  knowledgeDirectory,
  knowledgeRevision,
  loadKnowledgeLibrary,
  parseKnowledge,
  type KnowledgeDependency,
  type KnowledgeParseResult,
  type KnowledgeValidation
} from '../src/index';

async function realRoot(prefix: string): Promise<string> {
  return realpathSync(await mkdtemp(join(tmpdir(), prefix)));
}

const readRoot = async (root: string) => loadKnowledgeLibrary(root, knowledgeDirectory(root));

async function writeEntry(root: string, fileName: string, content: string): Promise<void> {
  const directory = knowledgeDirectory(root);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, fileName), content);
}

const proofOf = async (root: string, file: string): Promise<string> => fileProofHash(await readFile(join(root, file)));

const frontmatter = (proof: string, extra = '') => `name: dispatch_flow\ndescription: How tool calls dispatch and refuse forgery\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${proof}${extra}`;

const dependencyBlock = (dependencies: Array<{ name: string; sha256: string }>): string =>
  ['dependencies:', ...dependencies.flatMap(({ name, sha256 }) => [`  - name: ${name}`, `    sha256: ${sha256}`])].join('\n');

const fileProof = (proof: string, path: string, indent = '  '): string =>
  `${indent}- type: file\n${indent}  path: ${path}\n${indent}  sha256: ${proof}`;

async function expectInvalid(read: KnowledgeValidation, reason: string): Promise<void> {
  assert.equal(read.status, 'invalid');
  assert.equal((read as { reason?: string }).reason, reason);
}

test('a valid Knowledge entry is discoverable and its verified body is returned unmodified', async t => {
  const root = await realRoot('knowledge-valid-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  await writeEntry(root, 'dispatch_flow.md', `---\n${frontmatter(await proofOf(root, 'main.ts'))}\n---\nBody line one.\n\nBody line two.\n`);
  const library = await readRoot(root);
  assert.deepEqual(await library.catalog().then(entries => entries.map(({ name, description }) => ({ name, description }))), [{ name: 'dispatch_flow', description: 'How tool calls dispatch and refuse forgery' }]);
  const read = await library.read('dispatch_flow');
  assert.equal(read.status, 'valid');
  assert.equal((read as { body: string }).body, 'Body line one.\n\nBody line two.\n');
});

test('discovery presents name, description and revision only, sorted, without evidence or body', async t => {
  const root = await realRoot('knowledge-meta-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'docs.md'), 'cited bytes\n');
  const proof = await proofOf(root, 'docs.md');
  await writeEntry(root, 'zeta.md', `---\nname: zeta\ndescription: last\nevidence:\n  - type: file\n    path: docs.md\n    sha256: ${proof}\n---\nzeta body\n`);
  await writeEntry(root, 'alpha.md', `---\nname: alpha\ndescription: first\nevidence:\n  - type: file\n    path: docs.md\n    sha256: ${proof}\n---\nalpha body\n`);
  const catalog = await (await readRoot(root)).catalog();
  assert.deepEqual(catalog.map(({ name, description }) => ({ name, description })), [{ name: 'alpha', description: 'first' }, { name: 'zeta', description: 'last' }]);
  for (const entry of catalog) assert.deepEqual(Object.keys(entry).sort(), ['description', 'name', 'revision']);
});

test('discovery exposes one opaque revision per verified entry, stable until a byte changes', async t => {
  const root = await realRoot('knowledge-revision-discovery-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'docs.md'), 'cited bytes\n');
  const proof = await proofOf(root, 'docs.md');
  const entrySource = (description: string) => `---\nname: first\ndescription: ${description}\nevidence:\n  - type: file\n    path: docs.md\n    sha256: ${proof}\n---\nfirst body\n`;
  await writeEntry(root, 'first.md', entrySource('first'));
  const [entry] = await (await readRoot(root)).catalog();
  // The revision is a token about the entry file: never a body, a cited path
  // or a source hash, and never the same value.
  assert.equal(typeof entry.revision, 'string');
  assert.ok(entry.revision.length > 0);
  assert.notEqual(entry.revision, proof);
  assert.doesNotMatch(JSON.stringify(entry), /first body|docs\.md/);
  // Stable while the entry file is unchanged; a one-byte change moves it.
  assert.deepEqual(await (await readRoot(root)).catalog(), [entry]);
  await writeEntry(root, 'first.md', entrySource('firsT'));
  const [changed] = await (await readRoot(root)).catalog();
  assert.notEqual(changed.revision, entry.revision);
});

test('a read exposes the revision, including when the contract no longer verifies', async t => {
  const root = await realRoot('knowledge-revision-read-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'original bytes\n');
  const proof = await proofOf(root, 'main.ts');
  const source = (sha256: string) => `---\nname: dispatch_flow\ndescription: How tool calls dispatch\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${sha256}\n---\nbody one\n`;
  await writeEntry(root, 'dispatch_flow.md', source(proof));
  const first = await (await readRoot(root)).read('dispatch_flow');
  assert.equal(first.status, 'valid');
  assert.equal(typeof (first as { revision: string }).revision, 'string');
  assert.notEqual((first as { revision: string }).revision, proof);
  // One changed byte of the entry file: the revision moves even though the
  // contract stops verifying, so an invalid entry stays repairable.
  const forged = createHash('sha256').update('forged').digest('hex');
  await writeEntry(root, 'dispatch_flow.md', source(forged));
  const refused = await (await readRoot(root)).read('dispatch_flow');
  await expectInvalid(refused, 'file_hash_mismatch');
  assert.equal(typeof (refused as { revision?: string }).revision, 'string');
  assert.notEqual((refused as { revision?: string }).revision, (first as { revision: string }).revision);
  // No entry file, no revision: an absent or unreadable entry has nothing to
  // hash, and the refusal stays content-free.
  const absent = await (await readRoot(root)).read('never_written');
  await expectInvalid(absent, 'unknown_entry');
  assert.equal((absent as { revision?: string }).revision, undefined);
});

test('a modified cited file, a forged hash and a missing cited file are refused without the body', async t => {
  const root = await realRoot('knowledge-stale-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'original bytes\n');
  const proof = await proofOf(root, 'main.ts');
  await writeEntry(root, 'modified.md', `---\nname: modified\ndescription: cites a file changed after preparation\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${proof}\n---\nsecret body\n`);
  const forged = createHash('sha256').update('forged').digest('hex');
  await writeEntry(root, 'forged.md', `---\nname: forged\ndescription: cites a well-formed but wrong hash\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${forged}\n---\nsecret body\n`);
  await writeEntry(root, 'absent.md', `---\nname: absent\ndescription: cites a file that does not exist\nevidence:\n  - type: file\n    path: gone.ts\n    sha256: ${proof}\n---\nsecret body\n`);
  await writeFile(join(root, 'main.ts'), 'modified bytes\n');
  const library = await readRoot(root);
  for (const name of ['modified', 'forged', 'absent']) {
    const toolError = await library.read(name);
    if (name === 'modified' || name === 'forged') await expectInvalid(toolError, 'file_hash_mismatch');
    else await expectInvalid(toolError, 'file_missing');
    assert.doesNotMatch(JSON.stringify(toolError), /secret body/);
  }
  // Availability is metadata only; the read refusal must not block other reads.
  assert.equal((await library.catalog()).length, 3);
  const valid = await library.read('modified');
  assert.equal(valid.status, 'invalid');
});

test('a path outside the workspace and an escaping symbolic link are refused', async t => {
  const root = await realRoot('knowledge-escape-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'x');
  const outside = join(await realRoot('knowledge-outside-'), 'secret.txt');
  await writeFile(outside, 'outside bytes\n');
  const proof = await proofOf(root, 'main.ts');
  await writeEntry(root, 'escape.md', `---\nname: escape\ndescription: relative path escaping the workspace\nevidence:\n  - type: file\n    path: ../secret.txt\n    sha256: ${proof}\n---\nsecret body\n`);
  await writeEntry(root, 'absolute.md', `---\nname: absolute\ndescription: absolute path\nevidence:\n  - type: file\n    path: ${outside}\n    sha256: ${proof}\n---\nsecret body\n`);
  await symlink(outside, join(root, 'linked.ts'));
  await writeEntry(root, 'symlink.md', `---\nname: symlink\ndescription: escaping symbolic link\nevidence:\n  - type: file\n    path: linked.ts\n    sha256: ${proof}\n---\nsecret body\n`);
  const library = await readRoot(root);
  await expectInvalid(await library.read('escape'), 'path_outside_workspace');
  await expectInvalid(await library.read('absolute'), 'path_outside_workspace');
  await expectInvalid(await library.read('symlink'), 'symlink_escape');
  for (const name of ['escape', 'absolute', 'symlink']) assert.doesNotMatch(JSON.stringify(await library.read(name)), /outside bytes|secret body/);
});

test('a symbolic link staying inside the workspace verifies against the real bytes', async t => {
  const root = await realRoot('knowledge-inner-link-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'real.ts'), 'real bytes\n');
  await symlink(join(root, 'src', 'real.ts'), join(root, 'alias.ts'));
  const proof = await proofOf(root, join('src', 'real.ts'));
  await writeEntry(root, 'linked.md', `---\nname: linked\ndescription: cites an inner symbolic link\nevidence:\n  - type: file\n    path: alias.ts\n    sha256: ${proof}\n---\nopen body\n`);
  const read = await (await readRoot(root)).read('linked');
  assert.equal(read.status, 'valid');
  assert.equal((read as { body: string }).body.trim(), 'open body');
});

test('symbol proofs are unsupported and uppercase declared hashes verify', async t => {
  const root = await realRoot('knowledge-symbol-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'bytes\n');
  const lower = await proofOf(root, 'main.ts');
  await writeEntry(root, 'symbolic.md', `---\nname: symbolic\ndescription: declares an unsupported proof\nevidence:\n  - type: symbol\n    path: main.ts\n---\nsecret body\n`);
  await writeEntry(root, 'bare_symbol.md', `---\nname: bare_symbol\ndescription: declares a bare unsupported proof\nevidence:\n  - type: symbol\n---\nsecret body\n`);
  await writeEntry(root, 'upper.md', `---\nname: upper\ndescription: uppercase declared digest\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${lower.toUpperCase()}\n---\nopen body\n`);
  const library = await readRoot(root);
  // A `symbol` item with ad-hoc keys is out of the fixed grammar; a bare one
  // no longer satisfies the strict symbol-proof schema (spec #233) either.
  // Both refuse as malformed contracts without the body.
  await expectInvalid(await library.read('symbolic'), 'malformed_contract');
  await expectInvalid(await library.read('bare_symbol'), 'malformed_contract');
  assert.doesNotMatch(JSON.stringify(await library.read('symbolic')), /secret body/);
  const read = await library.read('upper');
  assert.equal(read.status, 'valid');
});

test('every declared proof is verified: a valid first proof cannot carry a broken second one', async t => {
  const root = await realRoot('knowledge-multi-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'keep.ts'), 'keep\n');
  await writeFile(join(root, 'other.ts'), 'other\n');
  const keep = await proofOf(root, 'keep.ts');
  const stale = await proofOf(root, 'other.ts');
  await writeEntry(root, 'two_ok.md', `---\nname: two_ok\ndescription: two verified proofs\nevidence:\n  - type: file\n    path: keep.ts\n    sha256: ${keep}\n  - type: file\n    path: other.ts\n    sha256: ${stale}\n---\nopen body\n`);
  await writeFile(join(root, 'other.ts'), 'changed\n');
  const read = await (await readRoot(root)).read('two_ok');
  assert.equal(read.status, 'invalid');
  await writeFile(join(root, 'other.ts'), 'other\n');
  // Quoted values, and two proofs in one entry, verify deterministically.
  const ok = `---\nname: two_ok\ndescription: "two verified proofs"\nevidence:\n  - type: "file"\n    path: "keep.ts"\n    sha256: "${keep}"\n  - type: file\n    path: other.ts\n    sha256: ${stale}\n---\nopen body\n`;
  await writeEntry(root, 'two_ok.md', ok);
  const valid = await (await readRoot(root)).read('two_ok');
  assert.equal(valid.status, 'valid');
  assert.equal((valid as { body: string }).body.trim(), 'open body');
});

test('malformed contracts are refused without reading evidence and unknown names are unknown', async t => {
  const root = await realRoot('knowledge-malformed-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'bytes\n');
  const proof = await proofOf(root, 'main.ts');
  const cases: Array<[string, string]> = [
    ['no_frontmatter.md', 'plain markdown\n'],
    ['unclosed.md', `---\nname: unclosed\ndescription: never closed\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${proof}\nbody\n`],
    ['empty_body.md', `---\nname: empty_body\ndescription: declared\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${proof}\n---\n\n`],
    ['missing_description.md', `---\nname: missing_description\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${proof}\n---\nbody\n`],
    ['empty_description.md', `---\nname: empty_description\ndescription:\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${proof}\n---\nbody\n`],
    ['absent_evidence.md', `---\nname: absent_evidence\ndescription: declared\n---\nbody\n`],
    ['empty_evidence.md', `---\nname: empty_evidence\ndescription: declared\nevidence: []\n---\nbody\n`],
    ['name_mismatch.md', `---\nname: other_name\ndescription: declared\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${proof}\n---\nbody\n`],
    ['digest_mismatch_shape.md', `---\nname: digest_mismatch_shape\ndescription: declared\nevidence:\n  - type: file\n    path: main.ts\n    sha256: tooshort\n---\nbody\n`],
    ['unknown_proof_field.md', `---\nname: unknown_proof_field\ndescription: declared\nevidence:\n  - type: file\n    path: main.ts\n    hash: ${proof}\n---\nbody\n`],
    ['unknown_top_level.md', `---\nname: unknown_top_level\ndescription: declared\nextra: value\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${proof}\n---\nbody\n`],
    ['nested_yaml.md', `---\nname: nested_yaml\ndescription: declared\nevidence:\n  - type: file\n    nested:\n      path: main.ts\n    sha256: ${proof}\n---\nbody\n`],
  ];
  for (const [name, content] of cases) await writeEntry(root, name, content);
  const library = await readRoot(root);
  assert.deepEqual(await library.catalog(), []);
  for (const [name] of cases) await expectInvalid(await library.read(name.replace(/\.md$/, '')), 'malformed_contract');
  await expectInvalid(await library.read('never_written'), 'unknown_entry');
  await expectInvalid(await library.read('../escape'), 'malformed_contract');
});

test('a malformed catalogue entry never hides a valid neighbour and a missing catalogue never breaks the library', async t => {
  const root = await realRoot('knowledge-catalogue-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'bytes\n');
  await writeEntry(root, 'broken.md', 'not a knowledge file\n');
  await writeEntry(root, 'good.md', `---\nname: good\ndescription: survives neighbours\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${await proofOf(root, 'main.ts')}\n---\ngood body\n`);
  const library = await readRoot(root);
  assert.deepEqual(await library.catalog().then(entries => entries.map(({ name, description }) => ({ name, description }))), [{ name: 'good', description: 'survives neighbours' }]);
  const read = await library.read('good');
  assert.equal((read as { body: string }).body.trim(), 'good body');
  // An entirely absent catalogue directory still serves an empty library.
  const absentRoot = await realRoot('knowledge-absent-');
  t.after(() => rm(absentRoot, { recursive: true, force: true }));
  const absent = await loadKnowledgeLibrary(absentRoot, knowledgeDirectory(absentRoot));
  assert.deepEqual(await absent.catalog(), []);
  await expectInvalid(await absent.read('good'), 'unknown_entry');
});

test('parseKnowledge refuses without workspace access and the catalogue sits in the hidden memory directory', async t => {
  assert.equal(parseKnowledge('no envelope at all', 'x').status, 'invalid');
  const source = `---\nname: x\ndescription: declared\nevidence:\n  - type: symbol\n---\nbody\n`;
  const parsed = parseKnowledge(source, 'x');
  // spec #233: an incomplete `symbol` item fails the strict schema up front
  assert.equal((parsed as { reason?: string }).reason, 'malformed_contract');
  assert.equal(knowledgeDirectory('/ws'), join('/ws', '.tours', '.memory', 'knowledge'));
});

/**
 * The two daughters of the composed fixtures, declared with the SHA-256 of
 * their complete Markdown file bytes — never a path. Nothing resolves them in
 * this step (spec #288, ticket #282), so a refusal only needs the shape.
 */
async function writeDaughters(root: string): Promise<KnowledgeDependency[]> {
  const daughters: KnowledgeDependency[] = [];
  for (const [name, description] of [['child_one', 'first daughter'], ['child_two', 'second daughter']] as const) {
    const source = `---\nname: ${name}\ndescription: ${description}\nevidence:\n${fileProof(await proofOf(root, 'main.ts'), 'main.ts')}\n---\n${name} body\n`;
    await writeEntry(root, `${name}.md`, source);
    daughters.push({ name, sha256: knowledgeRevision(Buffer.from(source)) });
  }
  return daughters;
}

const composedEntry = (name: string, dependencies: string, evidence: string): string =>
  `---\nname: ${name}\ndescription: how the two daughters interact\nevidence:\n${evidence}\n${dependencies}\n---\nsecret composed body\n`;

test('a composed entry declares two distinct daughters and its body is refused until the graph is validated', async t => {
  const root = await realRoot('knowledge-composed-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'main bytes\n');
  await writeFile(join(root, 'other.ts'), 'other bytes\n');
  const daughters = await writeDaughters(root);
  const evidence = [fileProof(await proofOf(root, 'main.ts'), 'main.ts'), fileProof(await proofOf(root, 'other.ts'), 'other.ts')].join('\n');
  const source = composedEntry('mother', dependencyBlock(daughters), evidence);
  await writeEntry(root, 'mother.md', source);

  // The contract is accepted: two distinct daughters, each exactly a name and
  // a file digest, and the mother's own two direct proofs.
  const parsed = parseKnowledge(source, 'mother.md');
  assert.equal(parsed.status, 'valid');
  const entry = parsed as Extract<KnowledgeParseResult, { status: 'valid' }>;
  assert.deepEqual(entry.dependencies, daughters);
  assert.deepEqual(entry.dependencies?.map(dependency => Object.keys(dependency).sort()), [['name', 'sha256'], ['name', 'sha256']]);
  assert.equal(entry.evidence.length, 2);
  assert.equal(entry.evidence.every(proof => proof.type === 'file'), true);

  // The read is not: no composed body is served before the daughter graph is
  // validated (ticket #283), even though both direct proofs verify.
  const library = await readRoot(root);
  const read = await library.read('mother');
  await expectInvalid(read, 'dependency_validation_unavailable');
  assert.doesNotMatch(JSON.stringify(read), /secret composed body/);
  assert.equal(typeof (read as { revision?: string }).revision, 'string');
  // Discovery stays metadata only, and the refusal is visible as such.
  assert.ok((await library.catalog()).some(({ name, description }) => name === 'mother' && description === 'how the two daughters interact'));
  const { invalid } = await library.verifiedList();
  assert.deepEqual(invalid.map(({ name, reason }) => ({ name, reason })), [{ name: 'mother', reason: 'dependency_validation_unavailable' }]);
});

test('a dependencies block declared before evidence stays a dependency block', async t => {
  const root = await realRoot('knowledge-composed-order-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'main bytes\n');
  await writeFile(join(root, 'other.ts'), 'other bytes\n');
  const daughters = await writeDaughters(root);
  const evidence = [fileProof(await proofOf(root, 'main.ts'), 'main.ts'), fileProof(await proofOf(root, 'other.ts'), 'other.ts')].join('\n');
  const source = `---\nname: mother\ndescription: how the two daughters interact\n${dependencyBlock(daughters)}\nevidence:\n${evidence}\n---\nsecret composed body\n`;
  await writeEntry(root, 'mother.md', source);

  // Neither block absorbs the other's items: two proofs, two dependencies.
  const parsed = parseKnowledge(source, 'mother.md');
  assert.equal(parsed.status, 'valid');
  const entry = parsed as Extract<KnowledgeParseResult, { status: 'valid' }>;
  assert.deepEqual(entry.dependencies, daughters);
  assert.equal(entry.evidence.length, 2);
  await expectInvalid(await (await readRoot(root)).read('mother'), 'dependency_validation_unavailable');
});

test('malformed dependency contracts are refused without reading the body', async t => {
  const root = await realRoot('knowledge-dependency-malformed-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'main bytes\n');
  await writeFile(join(root, 'other.ts'), 'other bytes\n');
  const [childOne, childTwo] = await writeDaughters(root);
  const evidence = [fileProof(await proofOf(root, 'main.ts'), 'main.ts'), fileProof(await proofOf(root, 'other.ts'), 'other.ts')].join('\n');
  const item = (name: string, sha256: string, extra = '') => `  - name: ${name}\n    sha256: ${sha256}${extra}`;
  const singleProof = fileProof(await proofOf(root, 'main.ts'), 'main.ts');
  const cases: Array<[string, string, string]> = [
    // A sequence key declares at least one item: zero daughters is not atomicity.
    ['no_daughter', 'dependencies:', evidence],
    // One daughter is not a relationship between two things (a composed entry needs two).
    ['one_daughter', `dependencies:\n${item(childOne.name, childOne.sha256)}`, evidence],
    ['duplicate_daughter', `dependencies:\n${item(childOne.name, childOne.sha256)}\n${item(childOne.name, childTwo.sha256)}`, evidence],
    ['short_digest', `dependencies:\n${item(childOne.name, childOne.sha256)}\n${item(childTwo.name, 'tooshort')}`, evidence],
    ['non_canonical_name', `dependencies:\n${item(childOne.name, childOne.sha256)}\n${item('not a name', childTwo.sha256)}`, evidence],
    ['unknown_dependency_key', `dependencies:\n${item(childOne.name, childOne.sha256)}\n${item(childTwo.name, childTwo.sha256, '\n    type: file')}`, evidence],
    // The contract never carries a path: the engine resolves the daughter file.
    ['supplied_path', `dependencies:\n${item(childOne.name, childOne.sha256)}\n${item(childTwo.name, childTwo.sha256, '\n    path: .tours/.memory/knowledge/child_two.md')}`, evidence],
    // `evidence` is conditional on the composition: two direct proofs at least.
    ['single_direct_proof', dependencyBlock([childOne, childTwo]), singleProof]
  ];
  for (const [name, declarations, proofs] of cases) await writeEntry(root, `${name}.md`, composedEntry(name, declarations, proofs));
  const library = await readRoot(root);
  // The daughters stay discoverable; none of the malformed mouths is.
  assert.deepEqual((await library.catalog()).map(({ name }) => name), ['child_one', 'child_two']);
  for (const [name] of cases) {
    const read = await library.read(name);
    await expectInvalid(read, 'malformed_contract');
    assert.doesNotMatch(JSON.stringify(read), /secret composed body/);
  }
  // The same declaration with two direct proofs is a legal contract.
  await writeEntry(root, 'mother.md', composedEntry('mother', dependencyBlock([childOne, childTwo]), evidence));
  await expectInvalid(await (await readRoot(root)).read('mother'), 'dependency_validation_unavailable');
});

test('a dependency item under evidence and a proof item under dependencies are refused, never attached', async t => {
  const root = await realRoot('knowledge-dependency-crossed-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'main bytes\n');
  await writeFile(join(root, 'other.ts'), 'other bytes\n');
  const [childOne] = await writeDaughters(root);
  const directProofs = [fileProof(await proofOf(root, 'main.ts'), 'main.ts'), fileProof(await proofOf(root, 'other.ts'), 'other.ts')];
  const cases: Array<[string, string]> = [
    // A `- name:` item belongs to `dependencies`, never to `evidence`.
    ['dependency_under_evidence.md', `---\nname: dependency_under_evidence\ndescription: declares a daughter under evidence\nevidence:\n${directProofs[0]}\n  - name: ${childOne.name}\n    sha256: ${childOne.sha256}\n---\nsecret body\n`],
    // A `- type:` item belongs to `evidence`: a proof is never a dependency.
    ['proof_under_dependencies.md', `---\nname: proof_under_dependencies\ndescription: declares proofs under dependencies\nevidence:\n${directProofs.join('\n')}\ndependencies:\n${fileProof(await proofOf(root, 'main.ts'), 'main.ts')}\n${fileProof(await proofOf(root, 'other.ts'), 'other.ts')}\n---\nsecret body\n`]
  ];
  for (const [name, content] of cases) await writeEntry(root, name, content);
  const library = await readRoot(root);
  for (const [name] of cases) {
    const read = await library.read(name.replace(/\.md$/, ''));
    await expectInvalid(read, 'malformed_contract');
    assert.doesNotMatch(JSON.stringify(read), /secret body/);
  }
});

test('a read never derives a dependency from a file proof citing a daughter Markdown', async t => {
  const root = await realRoot('knowledge-dependency-boundary-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'main bytes\n');
  await writeFile(join(root, 'other.ts'), 'other bytes\n');
  const [childOne, childTwo] = await writeDaughters(root);
  const daughterCatalogue = join('.tours', '.memory', 'knowledge');
  // Citing both daughters' Markdown is evidence of their bytes, not a
  // declaration of dependency: the entry stays atomic and readable.
  await writeEntry(root, 'citing.md', `---\nname: citing\ndescription: cites the daughters Markdown as evidence\nevidence:\n${fileProof(await proofOf(root, join(daughterCatalogue, 'child_one.md')), join(daughterCatalogue, 'child_one.md'))}\n${fileProof(await proofOf(root, join(daughterCatalogue, 'child_two.md')), join(daughterCatalogue, 'child_two.md'))}\n---\nopen body\n`);
  const library = await readRoot(root);
  const citing = await library.read('citing');
  assert.equal(citing.status, 'valid');
  assert.equal('dependencies' in citing, false);
  assert.equal((citing as { body: string }).body.trim(), 'open body');
  // A composed entry doing the same keeps its two declared dependencies and
  // gains none from the citing proofs.
  const evidence = [fileProof(await proofOf(root, 'main.ts'), 'main.ts'), fileProof(await proofOf(root, join(daughterCatalogue, 'child_one.md')), join(daughterCatalogue, 'child_one.md'))].join('\n');
  await writeEntry(root, 'mother.md', composedEntry('mother', dependencyBlock([childOne, childTwo]), evidence));
  const mother = parseKnowledge(await readFile(join(knowledgeDirectory(root), 'mother.md'), 'utf8'), 'mother.md');
  assert.equal(mother.status, 'valid');
  const entry = mother as Extract<KnowledgeParseResult, { status: 'valid' }>;
  assert.deepEqual(entry.dependencies, [childOne, childTwo]);
  assert.equal(entry.evidence.length, 2);
  assert.equal(entry.evidence.some(proof => proof.path === join(daughterCatalogue, 'child_one.md')), true);
});

test('a proof is never a dependency: the two exported contract types stay distinct', () => {
  const asDependency = (dependency: KnowledgeDependency): KnowledgeDependency => dependency;
  // @ts-expect-error a `file` proof carries a path and no name: it is not a Knowledge Dependency
  asDependency({ type: 'file', path: '.tours/.memory/knowledge/child.md', sha256: 'a'.repeat(64) });
});

test('an atomic entry without dependencies reads exactly as before, with no new contract field', async t => {
  const root = await realRoot('knowledge-atomic-unchanged-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'main bytes\n');
  await writeFile(join(root, 'other.ts'), 'other bytes\n');
  const single = `---\nname: single\ndescription: one direct proof\nevidence:\n${fileProof(await proofOf(root, 'main.ts'), 'main.ts')}\n---\nsingle body\n`;
  const pair = `---\nname: pair\ndescription: two direct proofs\nevidence:\n${fileProof(await proofOf(root, 'main.ts'), 'main.ts')}\n${fileProof(await proofOf(root, 'other.ts'), 'other.ts')}\n---\npair body\n`;
  await writeEntry(root, 'single.md', single);
  await writeEntry(root, 'pair.md', pair);
  const library = await readRoot(root);
  // One proof is still enough for an entry that declares no daughter.
  const read = await library.read('single');
  assert.equal(read.status, 'valid');
  assert.equal('dependencies' in read, false);
  assert.equal((read as { body: string }).body, 'single body\n');
  const readPair = await library.read('pair');
  assert.equal(readPair.status, 'valid', JSON.stringify(readPair));
  // The parsed contract of an atomic entry has no dependencies key at all.
  const parsed = parseKnowledge(single, 'single.md');
  assert.equal(parsed.status, 'valid');
  assert.equal('dependencies' in parsed, false);
  assert.equal((parsed as { evidence: unknown[] }).evidence.length, 1);
});
