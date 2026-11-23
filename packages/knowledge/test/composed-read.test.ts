import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fileProofHash,
  knowledgeDirectory,
  knowledgeRevision,
  loadKnowledgeLibrary,
  KNOWLEDGE_MAX_COMPOSITION_DEPTH,
  KNOWLEDGE_MAX_VALIDATED_NODES,
  type KnowledgeDependency,
  type KnowledgeFailureReason,
  type KnowledgeValidation
} from '../src/index';

// The composed read (spec #288, ticket #283) is exercised through the
// catalogue library only: a real temporary workspace, real `<name>.md` files,
// and the body served or the refusal observed. Daughter bodies are written as
// a searchable token so "nothing of a daughter ever leaves" stays assertable.

const realRoot = async (prefix: string): Promise<string> => realpathSync(await mkdtemp(join(tmpdir(), prefix)));

const readRoot = async (root: string) => loadKnowledgeLibrary(root, knowledgeDirectory(root));

const entryPath = (root: string, name: string): string => join(knowledgeDirectory(root), `${name}.md`);

/** Write one entry and return her Knowledge Revision (the digest of her file bytes). */
const writeEntry = async (root: string, name: string, source: string): Promise<string> => {
  await mkdir(knowledgeDirectory(root), { recursive: true });
  await writeFile(entryPath(root, name), source);
  return knowledgeRevision(Buffer.from(source));
};

const proofOf = async (root: string, file: string): Promise<string> => fileProofHash(await readFile(join(root, file)));

const fileProof = (sha256: string, path: string): string => `  - type: file\n    path: ${path}\n    sha256: ${sha256}`;

const symbolProof = (sha256: string, path: string, symbol: string): string =>
  `  - type: symbol\n    path: ${path}\n    symbol: ${symbol}\n    sha256: ${sha256}`;

const atomicSource = (name: string, proofs: string[], body = `${name} SECRET daughter body\n`): string =>
  `---\nname: ${name}\ndescription: ${name} description\nevidence:\n${proofs.join('\n')}\n---\n${body}`;

const dependencyBlock = (daughters: KnowledgeDependency[]): string =>
  `dependencies:\n${daughters.map(({ name, sha256 }) => `  - name: ${name}\n    sha256: ${sha256}`).join('\n')}`;

const composedSource = (
  name: string,
  daughters: KnowledgeDependency[],
  proofs: string[],
  body = `${name} SECRET composed body\n`
): string =>
  `---\nname: ${name}\ndescription: how the daughters of ${name} interact\nevidence:\n${proofs.join('\n')}\n${dependencyBlock(daughters)}\n---\n${body}`;

const dependency = (name: string, sha256: string): KnowledgeDependency => ({ name, sha256 });

/** A refusal carries its reason, the faulty daughter of its own level, and never a body. */
const expectInvalid = (read: KnowledgeValidation, reason: KnowledgeFailureReason, via?: string): void => {
  assert.equal(read.status, 'invalid', JSON.stringify(read).slice(0, 300));
  const refused = read as { reason: KnowledgeFailureReason; via?: string; revision?: string };
  assert.equal(refused.reason, reason);
  assert.equal(refused.via, via);
  assert.doesNotMatch(JSON.stringify(read), /SECRET/);
};

/**
 * The canonical fixture: two atomic daughters, each citing her own source
 * file, and the composed entry that declares both. The entry's own two direct
 * proofs cite two other files, so breaking a daughter's code never breaks the
 * mother's own proofs — the two steps stay separable.
 */
interface ComposedFixture {
  one: KnowledgeDependency;
  two: KnowledgeDependency;
  own: string[];
  motherRevision: string;
}

async function composedWorkspace(root: string): Promise<ComposedFixture> {
  const sources: Record<string, string> = {
    'alpha.ts': 'export const alpha = 1;\n',
    'beta.ts': 'export const beta = 2;\n',
    'mother_a.ts': 'export const composed = 3;\n',
    'mother_b.ts': 'export const relation = 4;\n'
  };
  for (const [file, content] of Object.entries(sources)) await writeFile(join(root, file), content);
  const daughter = async (name: string, file: string): Promise<KnowledgeDependency> =>
    dependency(name, await writeEntry(root, name, atomicSource(name, [fileProof(await proofOf(root, file), file)])));
  const one = await daughter('child_one', 'alpha.ts');
  const two = await daughter('child_two', 'beta.ts');
  const own = [
    fileProof(await proofOf(root, 'mother_a.ts'), 'mother_a.ts'),
    fileProof(await proofOf(root, 'mother_b.ts'), 'mother_b.ts')
  ];
  const motherRevision = await writeEntry(root, 'mother', composedSource('mother', [one, two], own));
  return { one, two, own, motherRevision };
}

const newRoot = async (t: { after: (cleanup: () => unknown) => void }, prefix: string): Promise<string> => {
  const root = await realRoot(prefix);
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
};

/**
 * The three-level chain: `middle` composes two atomic leaves, `upper` composes
 * `middle` and a third leaf, `top` composes `upper` and a fourth one. Every
 * composed entry's own two direct proofs cite `own_a.ts` and `own_b.ts`, so a
 * leaf's code can move without touching a mother's own-proof step.
 */
async function chainWorkspace(root: string): Promise<void> {
  for (const leaf of ['leaf_a', 'leaf_b', 'leaf_c', 'leaf_d']) await writeFile(join(root, `${leaf}.ts`), `${leaf} bytes\n`);
  await writeFile(join(root, 'own_a.ts'), 'export const composed = 3;\n');
  await writeFile(join(root, 'own_b.ts'), 'export const relation = 4;\n');
  const own = [
    fileProof(await proofOf(root, 'own_a.ts'), 'own_a.ts'),
    fileProof(await proofOf(root, 'own_b.ts'), 'own_b.ts')
  ];
  const leafDependency = async (leaf: string): Promise<KnowledgeDependency> =>
    dependency(leaf, await writeEntry(root, leaf, atomicSource(leaf, [fileProof(await proofOf(root, `${leaf}.ts`), `${leaf}.ts`)])));
  const leafA = await leafDependency('leaf_a');
  const leafB = await leafDependency('leaf_b');
  const leafC = await leafDependency('leaf_c');
  const leafD = await leafDependency('leaf_d');
  const middle = dependency('middle', await writeEntry(root, 'middle', composedSource('middle', [leafA, leafB], own)));
  const upper = dependency('upper', await writeEntry(root, 'upper', composedSource('upper', [middle, leafC], own)));
  await writeEntry(root, 'top', composedSource('top', [upper, leafD], own));
}

test('a valid composed entry serves its own body only, every daughter verified and no daughter body', async t => {
  const root = await newRoot(t, 'composed-valid-');
  const fixture = await composedWorkspace(root);
  const library = await readRoot(root);
  const read = await library.read('mother');
  assert.equal(read.status, 'valid', JSON.stringify(read).slice(0, 300));
  const valid = read as Extract<KnowledgeValidation, { status: 'valid' }>;
  assert.equal(valid.body, 'mother SECRET composed body\n');
  assert.equal(valid.revision, fixture.motherRevision);
  assert.deepEqual(valid.dependencies, [fixture.one, fixture.two]);
  // No daughter body, and no daughter evidence, rides along with the mother.
  assert.doesNotMatch(JSON.stringify(valid), /SECRET daughter/);
  assert.deepEqual(valid.evidence.map(proof => proof.path), ['mother_a.ts', 'mother_b.ts']);
  // Every entry keeps her own line in the catalogue, the mother included.
  assert.deepEqual((await library.catalog()).map(entry => entry.name), ['child_one', 'child_two', 'mother']);
  assert.deepEqual((await library.verifiedList()).invalid, []);
});

test('a composed read verifies its own direct proofs before it reaches any daughter', async t => {
  const root = await newRoot(t, 'composed-order-');
  await composedWorkspace(root);
  const library = await readRoot(root);
  // The mother's own proof is stale AND a daughter is absent. The own-proof
  // check runs first, so its reason is the one reported — with no `via`, since
  // no dependency step was reached.
  await writeFile(join(root, 'mother_a.ts'), 'export const composed = 99;\n');
  await rm(entryPath(root, 'child_one'));
  expectInvalid(await library.read('mother'), 'file_hash_mismatch', undefined);
  // Restoring the own proof exposes the daughter step: the missing daughter is
  // the one named, never the mother's stale proof.
  await writeFile(join(root, 'mother_a.ts'), 'export const composed = 3;\n');
  expectInvalid(await library.read('mother'), 'dependency_missing', 'child_one');
});

test('a daughter missing from the catalogue is dependency_missing, with no body and no daughter digest', async t => {
  const root = await newRoot(t, 'composed-missing-');
  const fixture = await composedWorkspace(root);
  await rm(entryPath(root, 'child_two'));
  const read = await (await readRoot(root)).read('mother');
  expectInvalid(read, 'dependency_missing', 'child_two');
  // The mother's own file was readable, so her revision still leaves: it
  // addresses what failed without revealing a byte of it.
  assert.equal((read as { revision?: string }).revision, fixture.motherRevision);
  // Nothing of the daughter leaves with the refusal, her pin included.
  assert.doesNotMatch(JSON.stringify(read), new RegExp(fixture.two.sha256));
});

test('a daughter whose Markdown moved is refused even though her own contract still verifies', async t => {
  const root = await newRoot(t, 'composed-moved-');
  const fixture = await composedWorkspace(root);
  // Her direct proof still matches the code she cites: only her Markdown moved,
  // so only the revision pinned by the mother is wrong.
  await writeEntry(root, 'child_two', atomicSource('child_two', [fileProof(await proofOf(root, 'beta.ts'), 'beta.ts')], 'child_two rewritten\n'));
  const library = await readRoot(root);
  assert.equal((await library.read('child_two')).status, 'valid');
  expectInvalid(await library.read('mother'), 'dependency_invalid', 'child_two');
  // The daughter's own read is untouched, and her declared pin never leaves.
  assert.doesNotMatch(JSON.stringify(await library.read('mother')), new RegExp(fixture.two.sha256));
});

test('a daughter whose cited code moved without her Markdown is refused by her contract check', async t => {
  const root = await newRoot(t, 'composed-code-');
  await composedWorkspace(root);
  await writeFile(join(root, 'beta.ts'), 'export const beta = 999;\n');
  const library = await readRoot(root);
  // Her file digest is unchanged, so the mother's pin still matches: it is her
  // own contract check that fails, and the mother reports the dependency step.
  expectInvalid(await library.read('mother'), 'dependency_invalid', 'child_two');
  expectInvalid(await library.read('child_two'), 'file_hash_mismatch', undefined);
});

test('every proof of a daughter is verified, symbol proofs included', async t => {
  const root = await newRoot(t, 'composed-symbol-');
  const fixture = await composedWorkspace(root);
  const library = await readRoot(root);
  // A daughter whose file proof verifies but whose symbol proof does not is an
  // invalid daughter: her whole contract is checked, exactly like an atomic read.
  const mixed = atomicSource('child_two', [
    fileProof(await proofOf(root, 'beta.ts'), 'beta.ts'),
    symbolProof('f'.repeat(64), 'beta.ts', 'beta')
  ]);
  await writeEntry(root, 'child_two', mixed);
  await writeEntry(root, 'mother', composedSource('mother', [fixture.one, dependency('child_two', knowledgeRevision(Buffer.from(mixed)))], fixture.own));
  expectInvalid(await library.read('mother'), 'dependency_invalid', 'child_two');
});

test('a daughter whose own contract is invalid refuses the mother as dependency_invalid', async t => {
  const root = await newRoot(t, 'composed-invalid-');
  await writeFile(join(root, 'alpha.ts'), 'export const alpha = 1;\n');
  await writeFile(join(root, 'mother_a.ts'), 'export const composed = 3;\n');
  await writeFile(join(root, 'mother_b.ts'), 'export const relation = 4;\n');
  const one = dependency('child_one', await writeEntry(root, 'child_one', atomicSource('child_one', [fileProof(await proofOf(root, 'alpha.ts'), 'alpha.ts')])));
  // Present and pinned against her current bytes, but not a Knowledge contract
  // at all: presence and pin match, her own read refuses.
  const malformed = dependency('broken', await writeEntry(root, 'broken', 'not a knowledge entry\n'));
  const own = [
    fileProof(await proofOf(root, 'mother_a.ts'), 'mother_a.ts'),
    fileProof(await proofOf(root, 'mother_b.ts'), 'mother_b.ts')
  ];
  await writeEntry(root, 'mother', composedSource('mother', [one, malformed], own));
  expectInvalid(await (await readRoot(root)).read('mother'), 'dependency_invalid', 'broken');
});

test('the chain composed to composed to atomic reads when valid and refuses from its far end', async t => {
  const root = await newRoot(t, 'composed-chain-');
  await chainWorkspace(root);
  const library = await readRoot(root);
  // composed(upper) → composed(middle) → atomic: legal at every level.
  for (const name of ['middle', 'upper']) assert.equal((await library.read(name)).status, 'valid', name);
  // An invalidity at the far end refuses the whole chain, one level at a time.
  await writeFile(join(root, 'leaf_b.ts'), 'leaf_b changed\n');
  expectInvalid(await library.read('upper'), 'dependency_invalid', 'middle');
  expectInvalid(await library.read('middle'), 'dependency_invalid', 'leaf_b');
  expectInvalid(await library.read('leaf_b'), 'file_hash_mismatch', undefined);
  // The rest of the graph is untouched: only the broken branch is refused.
  assert.equal((await library.read('leaf_d')).status, 'valid');
});

test('one composition level beyond the depth bound is a typed refusal, never a partial serve', async t => {
  const root = await newRoot(t, 'composed-depth-');
  await chainWorkspace(root);
  const library = await readRoot(root);
  // Two composition levels below the entry read are legal: the `top` entry is
  // the only one that asks for a third level, through `upper` then `middle`.
  assert.equal(KNOWLEDGE_MAX_COMPOSITION_DEPTH, 2);
  assert.equal((await library.read('middle')).status, 'valid');
  assert.equal((await library.read('upper')).status, 'valid');
  // The refusal is typed, total, and names the faulty daughter of this level.
  expectInvalid(await library.read('top'), 'dependency_depth_exceeded', 'upper');
  // Reading the too-deep entry on her own is legal: the bound is about the
  // graph one read traverses, never about an entry's existence.
  assert.equal((await library.read('middle')).status, 'valid');
});

test('a cycle is refused explicitly and terminates, a self edge included', async t => {
  const root = await newRoot(t, 'composed-cycle-');
  await composedWorkspace(root);
  const proof = async (file: string): Promise<string> => fileProof(await proofOf(root, file), file);
  const own = [await proof('mother_a.ts'), await proof('mother_b.ts')];
  const one = dependency('child_one', knowledgeRevision(Buffer.from(await readFile(entryPath(root, 'child_one'), 'utf8'))));
  const library = await readRoot(root);
  // An entry that declares itself: the edge closes the loop before any read.
  await writeEntry(root, 'selfish', composedSource('selfish', [dependency('selfish', 'a'.repeat(64)), one], own));
  expectInvalid(await library.read('selfish'), 'dependency_cycle', 'selfish');
  // A two-entry loop. `loop_bottom` pins `loop_top` with a digest `loop_top` no
  // longer has: the cycle is detected one level down, before that stale pin is
  // compared, so the read terminates with the cycle rather than the pin.
  const bottom = await writeEntry(root, 'loop_bottom', composedSource('loop_bottom', [dependency('loop_top', 'b'.repeat(64)), one], own));
  await writeEntry(root, 'loop_top', composedSource('loop_top', [dependency('loop_bottom', bottom), one], own));
  expectInvalid(await library.read('loop_top'), 'dependency_cycle', 'loop_bottom');
  // Entering the loop from the other side stops at the stale pin instead: a
  // bounded, typed refusal, never an unbounded walk.
  expectInvalid(await library.read('loop_bottom'), 'dependency_invalid', 'loop_top');
});

test('the node bound refuses a wider graph than it serves, with its own reason and daughter', async t => {
  const root = await newRoot(t, 'composed-nodes-');
  await writeFile(join(root, 'source.ts'), 'export const shared = 1;\n');
  await writeFile(join(root, 'mother_a.ts'), 'export const composed = 3;\n');
  await writeFile(join(root, 'mother_b.ts'), 'export const relation = 4;\n');
  const shared = await proofOf(root, 'source.ts');
  const own = [
    fileProof(await proofOf(root, 'mother_a.ts'), 'mother_a.ts'),
    fileProof(await proofOf(root, 'mother_b.ts'), 'mother_b.ts')
  ];
  const daughters: KnowledgeDependency[] = [];
  for (let index = 0; index <= KNOWLEDGE_MAX_VALIDATED_NODES; index += 1) {
    const name = `node_${String(index).padStart(2, '0')}`;
    daughters.push(dependency(name, await writeEntry(root, name, atomicSource(name, [fileProof(shared, 'source.ts')]))));
  }
  // The bound counts every distinct entry verified by the operation, the entry
  // being read included: 63 daughters and their mother are exactly the limit.
  assert.equal(KNOWLEDGE_MAX_VALIDATED_NODES, 64);
  await writeEntry(root, 'fits', composedSource('fits', daughters.slice(0, 63), own));
  await writeEntry(root, 'wide', composedSource('wide', daughters, own));
  const library = await readRoot(root);
  assert.equal((await library.read('fits')).status, 'valid');
  expectInvalid(await library.read('wide'), 'dependency_node_limit_exceeded', daughters[63].name);
  assert.equal(daughters[63].name, 'node_63');
});

test('a malformed dependency declaration is a malformed contract with no via', async t => {
  const root = await newRoot(t, 'composed-malformed-');
  const fixture = await composedWorkspace(root);
  const suppliedPath = `  - name: child_two\n    sha256: ${fixture.two.sha256}\n    path: .tours/.memory/knowledge/child_two.md`;
  const ready = (name: string, block: string): string =>
    `---\nname: ${name}\ndescription: declares a daughter with an extra key\nevidence:\n${fixture.own.join('\n')}\ndependencies:\n  - name: child_one\n    sha256: ${fixture.one.sha256}\n${block}\n---\nSECRET composed body\n`;
  await writeEntry(root, 'pathed', ready('pathed', suppliedPath));
  // One daughter is not a composition between two things.
  await writeEntry(root, 'single', ready('single', ''));
  const library = await readRoot(root);
  for (const name of ['pathed', 'single']) expectInvalid(await library.read(name), 'malformed_contract', undefined);
});

test('a daughter escaping the catalogue and a daughter citing an outside path are refused without disclosure', async t => {
  const root = await newRoot(t, 'composed-escape-');
  const outside = await newRoot(t, 'composed-outside-');
  await writeFile(join(outside, 'secret.md'), 'OUTSIDE SECRET bytes\n');
  await writeFile(join(outside, 'secret.ts'), 'OUTSIDE SECRET code\n');
  await composedWorkspace(root);
  await mkdir(knowledgeDirectory(root), { recursive: true });
  // `escaped.md` is inside the catalogue by name and a symbolic link outside it
  // by resolution: the catalogue root stays confined exactly as for an atomic.
  await symlink(join(outside, 'secret.md'), entryPath(root, 'escaped'));
  const proof = async (file: string): Promise<string> => fileProof(await proofOf(root, file), file);
  const own = [await proof('mother_a.ts'), await proof('mother_b.ts')];
  const one = dependency('child_one', knowledgeRevision(Buffer.from(await readFile(entryPath(root, 'child_one'), 'utf8'))));
  await writeEntry(root, 'escaping', composedSource('escaping', [dependency('escaped', 'c'.repeat(64)), one], own));
  // A daughter that is readable but cites a path outside the workspace is a
  // daughter whose own read refuses.
  const citing = dependency('citing', await writeEntry(root, 'citing', atomicSource('citing', [fileProof('d'.repeat(64), '../secret.ts')])));
  await writeEntry(root, 'outside', composedSource('outside', [one, citing], own));
  const library = await readRoot(root);
  expectInvalid(await library.read('escaping'), 'dependency_invalid', 'escaped');
  expectInvalid(await library.read('outside'), 'dependency_invalid', 'citing');
  for (const name of ['escaping', 'outside']) assert.doesNotMatch(JSON.stringify(await library.read(name)), /OUTSIDE/);
});

test('an invalid atomic read is unchanged: the same reasons and no via', async t => {
  const root = await newRoot(t, 'composed-atomic-');
  await writeFile(join(root, 'main.ts'), 'original bytes\n');
  const source = atomicSource('stale', [fileProof(await proofOf(root, 'main.ts'), 'main.ts')], 'stale SECRET atomic body\n');
  const revision = await writeEntry(root, 'stale', source);
  const missing = await writeEntry(root, 'absent', atomicSource('absent', [fileProof('e'.repeat(64), 'gone.ts')]));
  await writeFile(join(root, 'main.ts'), 'changed bytes\n');
  const library = await readRoot(root);
  // Exactly the shape an atomic read had before composed entries could be read.
  assert.deepEqual(await library.read('stale'), { status: 'invalid', reason: 'file_hash_mismatch', revision });
  assert.deepEqual(await library.read('absent'), { status: 'invalid', reason: 'file_missing', revision: missing });
  // And a valid atomic read gains neither a dependency field nor a via.
  await writeFile(join(root, 'main.ts'), 'original bytes\n');
  const valid = await library.read('stale');
  assert.deepEqual(Object.keys(valid).sort(), ['body', 'description', 'evidence', 'name', 'revision', 'status']);
});

test('the validation cache does not survive a read: a modification between two reads is seen', async t => {
  const root = await newRoot(t, 'composed-cache-');
  await composedWorkspace(root);
  // One library instance for every read below: the cache is per operation.
  const library = await readRoot(root);
  assert.equal((await library.read('mother')).status, 'valid');
  const original = await readFile(entryPath(root, 'child_one'), 'utf8');
  // The daughter's Markdown moves; her own proofs still verify.
  await writeEntry(root, 'child_one', atomicSource('child_one', [fileProof(await proofOf(root, 'alpha.ts'), 'alpha.ts')], 'child_one rewritten\n'));
  assert.equal((await library.read('child_one')).status, 'valid');
  expectInvalid(await library.read('mother'), 'dependency_invalid', 'child_one');
  // Restoring the bytes restores the read: no negative result is cached either.
  await writeFile(entryPath(root, 'child_one'), original);
  assert.equal((await library.read('mother')).status, 'valid');
});

test('the temporary composed refusal is gone and the composition bounds are exported', () => {
  // The transitional reason of #282 no longer exists (spec #288, ticket #283).
  // @ts-expect-error a composed entry is read now; this reason must not compile
  const removed: KnowledgeFailureReason = 'dependency_validation_unavailable';
  assert.equal(removed, 'dependency_validation_unavailable');
  const dependencyReasons: KnowledgeFailureReason[] = [
    'dependency_missing',
    'dependency_invalid',
    'dependency_cycle',
    'dependency_depth_exceeded',
    'dependency_node_limit_exceeded'
  ];
  assert.equal(new Set(dependencyReasons).size, 5);
  assert.equal(KNOWLEDGE_MAX_COMPOSITION_DEPTH, 2);
  assert.equal(KNOWLEDGE_MAX_VALIDATED_NODES, 64);
});

test('the verified listing carries the daughters of a composed entry by name only', async t => {
  const root = await newRoot(t, 'composed-listing-');
  const fixture = await composedWorkspace(root);
  const library = await readRoot(root);
  const { entries, invalid } = await library.verifiedList();
  assert.deepEqual(invalid, []);
  const mother = entries.find(entry => entry.name === 'mother');
  // The relation is derived from the declared dependencies: the daughters'
  // names, in declared order, and nothing of their own.
  assert.deepEqual(mother, {
    name: 'mother',
    description: 'how the daughters of mother interact',
    revision: fixture.motherRevision,
    daughterNames: ['child_one', 'child_two']
  });
  // Every daughter keeps her own row, and an atomic entry carries no relation.
  for (const daughter of ['child_one', 'child_two']) {
    const row = entries.find(entry => entry.name === daughter);
    assert.ok(row, `${daughter} keeps her row`);
    assert.deepEqual(Object.keys(row).sort(), ['description', 'name', 'revision']);
  }
});

test('the verified listing reports a composed refusal with its dependency step and the faulty daughter', async t => {
  const root = await newRoot(t, 'composed-listing-refused-');
  await composedWorkspace(root);
  const library = await readRoot(root);
  // The daughter's Markdown is untouched; the code she cites moved.
  await writeFile(join(root, 'alpha.ts'), 'export const alpha = 99;\n');
  const { entries, invalid } = await library.verifiedList();
  assert.ok(!entries.some(entry => entry.name === 'mother'), 'a mother whose daughter broke is no longer verified');
  const mother = invalid.find(entry => entry.name === 'mother');
  // The reason describes the dependency step, never the daughter's own reason,
  // and the faulty daughter of that level is named: the repair has a target.
  assert.equal(mother?.reason, 'dependency_invalid');
  assert.equal(mother?.via, 'child_one');
  assert.equal(typeof mother?.revision, 'string');
  // The invalid set is listed in full whatever the query: it stays visible.
  for (const query of ['mother', 'nothing-matches-this']) {
    const filtered = await library.verifiedList(query);
    assert.deepEqual(filtered.invalid.map(entry => entry.name), invalid.map(entry => entry.name));
    assert.equal(filtered.invalid.find(entry => entry.name === 'mother')?.via, 'child_one');
  }
});
