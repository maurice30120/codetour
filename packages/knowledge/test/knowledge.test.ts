import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileProofHash, knowledgeDirectory, loadKnowledgeLibrary, parseKnowledge, type KnowledgeValidation } from '../src/index';

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
  assert.deepEqual(await library.catalog(), [{ name: 'dispatch_flow', description: 'How tool calls dispatch and refuse forgery' }]);
  const read = await library.read('dispatch_flow');
  assert.equal(read.status, 'valid');
  assert.equal((read as { body: string }).body, 'Body line one.\n\nBody line two.\n');
});

test('discovery presents name and description only, sorted, without evidence or body', async t => {
  const root = await realRoot('knowledge-meta-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'docs.md'), 'cited bytes\n');
  const proof = await proofOf(root, 'docs.md');
  await writeEntry(root, 'zeta.md', `---\nname: zeta\ndescription: last\nevidence:\n  - type: file\n    path: docs.md\n    sha256: ${proof}\n---\nzeta body\n`);
  await writeEntry(root, 'alpha.md', `---\nname: alpha\ndescription: first\nevidence:\n  - type: file\n    path: docs.md\n    sha256: ${proof}\n---\nalpha body\n`);
  const catalog = await (await readRoot(root)).catalog();
  assert.deepEqual(catalog, [{ name: 'alpha', description: 'first' }, { name: 'zeta', description: 'last' }]);
  for (const entry of catalog) assert.deepEqual(Object.keys(entry).sort(), ['description', 'name']);
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
  assert.deepEqual(await library.catalog(), [{ name: 'good', description: 'survives neighbours' }]);
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
