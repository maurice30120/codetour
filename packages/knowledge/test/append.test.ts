import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  catalogueCanonicalizerName,
  knowledgeCanonicalizer,
  knowledgeDirectory,
  knowledgeRevision,
  loadKnowledgeLibrary,
  parseKnowledge,
  saveKnowledgeProposal
} from '../src/index';

// Enriching an existing Knowledge Entry (spec #232, ticket #256): the `append`
// mode adds one section and merges evidence without rewriting the historical
// body. These tests observe the returned vocabulary and the exact bytes left
// in the catalogue; they never inspect internal call order.

const realRoot = async (prefix: string): Promise<string> => realpathSync(await mkdtemp(join(tmpdir(), prefix)));

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

/** A valid entry whose body ends with a single newline, the common case. */
const SEEDED_BODY = '## Dispatch\n\nHistorical body kept verbatim.\n';

async function seed(root: string, name = 'dispatch_flow'): Promise<{ revision: string; body: string }> {
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  await writeFile(join(root, 'reader.ts'), 'export const read = () => 1;\n');
  await saveKnowledgeProposal(root, {
    entries: [{
      name,
      description: 'How dispatch reaches the reader',
      body: SEEDED_BODY,
      evidence: [{ path: 'main.ts' }]
    }]
  });
  return { revision: await readRevision(root, name), body: SEEDED_BODY };
}

const append = (root: string, entry: Record<string, unknown>) =>
  saveKnowledgeProposal(root, { mode: 'append', entries: [entry] });

test('append preserves the historical body byte for byte behind exactly one blank line', async t => {
  const root = await realRoot('knowledge-append-section-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const { revision } = await seed(root);
  const addition = '## Exceptions\n\nNew section, inserted verbatim.\n  indented line\n';

  const result = await append(root, {
    name: 'dispatch_flow',
    addition,
    evidence: [{ path: 'reader.ts' }],
    expectedRevision: revision
  });
  assert.deepEqual(result, { status: 'appended', appended: ['dispatch_flow'], warnings: [] });

  // The historical body is an exact prefix, exactly one blank line separates
  // it from the verbatim addition, and no title was injected.
  const source = await readFile(entryPath(root, 'dispatch_flow'), 'utf8');
  const parsed = parseKnowledge(source, 'dispatch_flow.md');
  assert.equal(parsed.status, 'valid');
  assert.equal(parsed.body, `${SEEDED_BODY}\n${addition}`);
  assert.ok(parsed.body.startsWith(SEEDED_BODY), 'the historical body is preserved byte for byte');
  assert.doesNotMatch(parsed.body, /\n{3,}/, 'never two blank lines between the body and the addition');

  // The frontmatter keeps the historical name and description and merges the
  // evidence: append can never rewrite who the entry is.
  assert.equal(parsed.description, 'How dispatch reaches the reader');
  assert.deepEqual(parsed.evidence, [
    { type: 'file', path: 'main.ts', sha256: sha256('export const start = 1;\n') },
    { type: 'file', path: 'reader.ts', sha256: sha256('export const read = () => 1;\n') }
  ]);
  // The result passes the read grammar and the catalogue stays clean.
  assert.equal((await loadKnowledgeLibrary(root, knowledgeDirectory(root)).then(library => library.read('dispatch_flow'))).status, 'valid');
  assert.deepEqual(await catalogueFiles(root), ['dispatch_flow.md']);
  const moved = await readRevision(root, 'dispatch_flow');
  assert.equal(moved, knowledgeRevision(await readFile(entryPath(root, 'dispatch_flow'))));
  assert.notEqual(moved, revision);
});

test('append merges evidence on a body it cannot change, keeping the body byte for byte', async t => {
  const root = await realRoot('knowledge-append-proof-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const { revision } = await seed(root);
  const before = await readFile(entryPath(root, 'dispatch_flow'), 'utf8');

  // A blank addition with new evidence is a proof-only append: the body is
  // untouched, the coverage grows.
  const added = await append(root, {
    name: 'dispatch_flow',
    addition: '   \n',
    evidence: [{ path: 'reader.ts' }],
    expectedRevision: revision
  });
  assert.deepEqual(added, { status: 'appended', appended: ['dispatch_flow'], warnings: [] });
  const parsed = parseKnowledge(await readFile(entryPath(root, 'dispatch_flow'), 'utf8'), 'dispatch_flow.md');
  assert.equal(parsed.status, 'valid');
  assert.equal(parsed.body, SEEDED_BODY, 'a proof-only append leaves the body byte for byte identical');
  assert.deepEqual(parsed.evidence.map(proof => proof.path), ['main.ts', 'reader.ts']);
  assert.match(before, /evidence:\n  - type: file\n    path: main\.ts\n/);

  // Evidence already cited is merged, not duplicated.
  const again = await append(root, {
    name: 'dispatch_flow',
    addition: '',
    evidence: [{ path: 'reader.ts' }],
    expectedRevision: await readRevision(root, 'dispatch_flow')
  });
  assert.deepEqual(again, { status: 'no_change' });
});

test('a literal no-op is no_change: it writes nothing and reports the same revision', async t => {
  const root = await realRoot('knowledge-append-nochange-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const { revision } = await seed(root);
  const before = await readFile(entryPath(root, 'dispatch_flow'));

  // A blank addition with no new evidence adds nothing literal.
  assert.deepEqual(await append(root, {
    name: 'dispatch_flow',
    addition: '\n  ',
    evidence: [],
    expectedRevision: revision
  }), { status: 'no_change' });
  // An addition already present as an exact suffix and no new evidence adds
  // nothing literal either: no fuzzy deduplication, no semantic judgement.
  assert.deepEqual(await append(root, {
    name: 'dispatch_flow',
    addition: 'Historical body kept verbatim.\n',
    evidence: [{ path: 'main.ts' }],
    expectedRevision: revision
  }), { status: 'no_change' });

  assert.deepEqual(await readFile(entryPath(root, 'dispatch_flow')), before, 'no_change never touches the file');
  assert.equal(await readRevision(root, 'dispatch_flow'), revision);
  assert.deepEqual(await catalogueFiles(root), ['dispatch_flow.md']);
});

test('the same literal addition is appended once more when it brings new evidence', async t => {
  const root = await realRoot('knowledge-append-suffix-evidence-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const { revision } = await seed(root);

  const result = await append(root, {
    name: 'dispatch_flow',
    addition: 'Historical body kept verbatim.\n',
    evidence: [{ path: 'reader.ts' }],
    expectedRevision: revision
  });
  assert.deepEqual(result, { status: 'appended', appended: ['dispatch_flow'], warnings: [] });
  const parsed = parseKnowledge(await readFile(entryPath(root, 'dispatch_flow'), 'utf8'), 'dispatch_flow.md');
  assert.equal(parsed.status, 'valid');
  assert.equal(parsed.body, `${SEEDED_BODY}\nHistorical body kept verbatim.\n`);
});

test('an addition with a carriage return is refused with nothing written', async t => {
  const root = await realRoot('knowledge-append-cr-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const { revision } = await seed(root);
  const before = await readFile(entryPath(root, 'dispatch_flow'));

  assert.deepEqual(await append(root, {
    name: 'dispatch_flow',
    addition: '## Windows\r\n\r\nCarriage return.\r\n',
    evidence: [{ path: 'reader.ts' }],
    expectedRevision: revision
  }), { status: 'invalid', rejected: [{ name: 'dispatch_flow', reason: 'invalid_body' }] });

  assert.deepEqual(await readFile(entryPath(root, 'dispatch_flow')), before);
  assert.deepEqual(await catalogueFiles(root), ['dispatch_flow.md']);
});

test('a hand-authored CRLF entry is published as LF with its parsed historical body as an exact prefix', async t => {
  const root = await realRoot('knowledge-append-crlf-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  // An entry written by hand on Windows: the read grammar normalizes CRLF to
  // LF, so the parsed historical body is the LF form. An append re-emits the
  // frontmatter and the body from that parsed contract, and the historical
  // body stays an exact prefix of the normalized result — deliberate
  // behaviour, not an accident (spec #232).
  const handAuthored = [
    '---',
    'name: legacy_rule',
    'description: Written on Windows',
    'evidence:',
    '  - type: file',
    '    path: main.ts',
    `    sha256: ${sha256('export const start = 1;\n')}`,
    '---',
    'Historical body.',
    ''
  ].join('\r\n');
  await mkdir(knowledgeDirectory(root), { recursive: true });
  await writeFile(entryPath(root, 'legacy_rule'), handAuthored);
  const revision = await readRevision(root, 'legacy_rule');

  const addition = '## Added\n\nWindows-tolerant section.\n';
  const result = await append(root, { name: 'legacy_rule', addition, expectedRevision: revision });
  assert.deepEqual(result, { status: 'appended', appended: ['legacy_rule'], warnings: [] });

  const published = await readFile(entryPath(root, 'legacy_rule'), 'utf8');
  assert.doesNotMatch(published, /\r/, 'the published file is LF, the only ending the engine writes');
  const parsed = parseKnowledge(published, 'legacy_rule.md');
  assert.equal(parsed.status, 'valid');
  // The historical body as the read grammar parses it — LF, not CRLF — is an
  // exact prefix, and the name and description are carried unchanged.
  assert.equal(parsed.name, 'legacy_rule');
  assert.equal(parsed.description, 'Written on Windows');
  assert.equal(parsed.body, `Historical body.\n\n${addition}`);
  assert.ok(parsed.body.startsWith('Historical body.\n'), 'the parsed historical body is preserved as an exact prefix');
});

test('append refuses an entry whose historical proof no longer verifies as stale_evidence, not as a bad proposal', async t => {
  const root = await realRoot('knowledge-append-stale-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  await writeFile(join(root, 'reader.ts'), 'export const read = () => 1;\n');
  await saveKnowledgeProposal(root, {
    entries: [{ name: 'dispatch_flow', description: 'Historical', body: 'Historical body.\n', evidence: [{ path: 'main.ts' }] }]
  });
  const revision = await readRevision(root, 'dispatch_flow');
  // The cited bytes move after the entry was written: the historical contract
  // no longer verifies, so enriching it would stack new text on a false base.
  await writeFile(join(root, 'main.ts'), 'export const start = 2;\n');
  const before = await readFile(entryPath(root, 'dispatch_flow'));

  assert.deepEqual(await append(root, {
    name: 'dispatch_flow',
    addition: '## More\n',
    evidence: [{ path: 'reader.ts' }],
    expectedRevision: revision
  }), { status: 'invalid', rejected: [{ name: 'dispatch_flow', reason: 'stale_evidence' }] });

  assert.deepEqual(await readFile(entryPath(root, 'dispatch_flow')), before);
  assert.deepEqual(await catalogueFiles(root), ['dispatch_flow.md']);
});

test('an entry whose contract itself is unreadable is refused as stale_evidence too', async t => {
  const root = await realRoot('knowledge-append-malformed-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  await mkdir(knowledgeDirectory(root), { recursive: true });
  await writeFile(entryPath(root, 'broken_flow'), '---\nname: broken_flow\n---\nBroken body.\n');
  const before = await readFile(entryPath(root, 'broken_flow'));

  assert.deepEqual(await append(root, {
    name: 'broken_flow',
    addition: '## More\n',
    evidence: [{ path: 'main.ts' }],
    expectedRevision: knowledgeRevision(before)
  }), { status: 'invalid', rejected: [{ name: 'broken_flow', reason: 'stale_evidence' }] });
  assert.deepEqual(await readFile(entryPath(root, 'broken_flow')), before);
});

test('a digest divergence on the same evidence key is refused, never corrected silently', async t => {
  const root = await realRoot('knowledge-append-divergence-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const { revision } = await seed(root);
  const before = await readFile(entryPath(root, 'dispatch_flow'));

  // The caller declares a fingerprint for a path the entry already cites that
  // is not the cited bytes' digest: a caller mistake, refused as such.
  assert.deepEqual(await append(root, {
    name: 'dispatch_flow',
    addition: '## More\n',
    evidence: [{ path: 'main.ts', sha256: 'f'.repeat(64) }],
    expectedRevision: revision
  }), { status: 'invalid', rejected: [{ name: 'dispatch_flow', reason: 'file_hash_mismatch' }] });
  assert.deepEqual(await readFile(entryPath(root, 'dispatch_flow')), before);
});

test('re-citing a stale path is a divergence, never a silent re-anchoring', async t => {
  const root = await realRoot('knowledge-append-reanchor-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  await saveKnowledgeProposal(root, {
    entries: [{ name: 'dispatch_flow', description: 'Historical', body: 'Historical body.\n', evidence: [{ path: 'main.ts' }] }]
  });
  const revision = await readRevision(root, 'dispatch_flow');
  await writeFile(join(root, 'main.ts'), 'export const start = 2;\n');
  const before = await readFile(entryPath(root, 'dispatch_flow'));

  // The caller re-cites the path whose digest moved: the engine refuses the
  // divergence instead of adopting the current bytes as the new proof.
  assert.deepEqual(await append(root, {
    name: 'dispatch_flow',
    addition: '## More\n',
    evidence: [{ path: 'main.ts' }],
    expectedRevision: revision
  }), { status: 'invalid', rejected: [{ name: 'dispatch_flow', reason: 'file_hash_mismatch' }] });
  assert.deepEqual(await readFile(entryPath(root, 'dispatch_flow')), before);
});

test('a file proof and a symbol proof coexist on the same file', async t => {
  const root = await realRoot('knowledge-append-coexist-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export function dispatch(input: string): string {\n  return `ok:${input}`;\n}\n');
  await saveKnowledgeProposal(root, {
    entries: [{ name: 'dispatch_flow', description: 'Cited as a file', body: 'Body.\n', evidence: [{ path: 'main.ts' }] }]
  });
  const revision = await readRevision(root, 'dispatch_flow');

  const result = await append(root, {
    name: 'dispatch_flow',
    addition: '## Symbol grain\n',
    evidence: [{ type: 'symbol', path: 'main.ts', symbol: 'dispatch' }],
    expectedRevision: revision
  });
  assert.deepEqual(result, { status: 'appended', appended: ['dispatch_flow'], warnings: [] });

  const parsed = parseKnowledge(await readFile(entryPath(root, 'dispatch_flow'), 'utf8'), 'dispatch_flow.md');
  assert.equal(parsed.status, 'valid');
  assert.deepEqual(parsed.evidence.map(proof => (proof.type === 'symbol' ? `symbol:${proof.symbol}` : 'file')), ['file', 'symbol:dispatch']);
  assert.deepEqual(parsed.evidence.map(proof => proof.path), ['main.ts', 'main.ts']);
  assert.equal((await loadKnowledgeLibrary(root, knowledgeDirectory(root)).then(library => library.read('dispatch_flow'))).status, 'valid');
});

test('append carries historical origin traces verbatim', async t => {
  const root = await realRoot('knowledge-append-origin-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'legacy.rb'), 'def legacy\nend\n');
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  // A creation-time fallback leaves an engine trace in the entry.
  await saveKnowledgeProposal(root, {
    entries: [{ name: 'legacy_rule', description: 'Ruby rule', body: 'Body.\n', evidence: [{ type: 'symbol', path: 'legacy.rb', symbol: 'legacy' }] }]
  });
  assert.match(await readFile(entryPath(root, 'legacy_rule'), 'utf8'), /origin: symbol_fallback/);

  const result = await append(root, {
    name: 'legacy_rule',
    addition: '## More\n',
    evidence: [{ path: 'main.ts' }],
    expectedRevision: await readRevision(root, 'legacy_rule')
  });
  assert.deepEqual(result, { status: 'appended', appended: ['legacy_rule'], warnings: [] });
  const parsed = parseKnowledge(await readFile(entryPath(root, 'legacy_rule'), 'utf8'), 'legacy_rule.md');
  assert.equal(parsed.status, 'valid');
  assert.deepEqual(parsed.evidence, [
    { type: 'file', path: 'legacy.rb', sha256: sha256('def legacy\nend\n'), origin: 'symbol_fallback' },
    { type: 'file', path: 'main.ts', sha256: sha256('export const start = 1;\n') }
  ]);
});

test('append never introduces the insufficient_backing signal', async t => {
  const root = await realRoot('knowledge-append-backing-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const { revision } = await seed(root);
  // The entry cites one file: its thin backing was already reported at
  // creation, and citing that same path again cannot change the count.
  const result = await append(root, {
    name: 'dispatch_flow',
    addition: '## More\n',
    evidence: [{ type: 'symbol', path: 'main.ts', symbol: 'start' }],
    expectedRevision: revision
  });
  assert.deepEqual(result, { status: 'appended', appended: ['dispatch_flow'], warnings: [] });
  const parsed = parseKnowledge(await readFile(entryPath(root, 'dispatch_flow'), 'utf8'), 'dispatch_flow.md');
  assert.equal(parsed.status, 'valid');
  assert.equal(new Set(parsed.evidence.map(proof => proof.path)).size, 1);
});

test('append needs the revision it read: an absent, wrong or stale token writes nothing', async t => {
  const root = await realRoot('knowledge-append-conflict-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const { revision } = await seed(root);
  const before = await readFile(entryPath(root, 'dispatch_flow'));
  const expected = { status: 'conflict', conflicts: [{ name: 'dispatch_flow', reason: 'revision_conflict' }] };
  const attempt = (expectedRevision?: unknown) => append(root, {
    name: 'dispatch_flow',
    addition: '## More\n',
    evidence: [{ path: 'reader.ts' }],
    ...(expectedRevision === undefined ? {} : { expectedRevision })
  });

  assert.deepEqual(await attempt(), expected);
  assert.deepEqual(await attempt('a'.repeat(64)), expected);

  // A concurrent writer moved the entry: the token read before is now stale.
  await writeFile(entryPath(root, 'dispatch_flow'), (await readFile(entryPath(root, 'dispatch_flow'), 'utf8')).replace('How dispatch reaches the reader', 'changed elsewhere'));
  assert.deepEqual(await attempt(revision), expected);
  assert.equal(await readFile(entryPath(root, 'dispatch_flow'), 'utf8').then(source => source.includes('changed elsewhere')), true);
  assert.deepEqual(await catalogueFiles(root), ['dispatch_flow.md'], 'no staging file and no lock file survive a refusal');
  assert.notDeepEqual(await readFile(entryPath(root, 'dispatch_flow')), before);
});

// Two writers appending from the same revision: the catalogue lock makes the
// compare-and-swap decide, so exactly one append publishes and the other is
// refused without losing the winner's bytes.
test('two concurrent appends from the same revision cannot both succeed', async t => {
  const root = await realRoot('knowledge-append-race-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const { revision } = await seed(root);
  const attempt = (addition: string) => append(root, {
    name: 'dispatch_flow',
    addition,
    evidence: [{ path: 'reader.ts' }],
    expectedRevision: revision
  });

  const results = await Promise.all([attempt('First writer section.\n'), attempt('Second writer section.\n')]);
  assert.equal(results.filter(result => result.status === 'appended').length, 1, JSON.stringify(results));
  const refused = results.filter(result => result.status === 'conflict');
  assert.deepEqual(refused, [{ status: 'conflict', conflicts: [{ name: 'dispatch_flow', reason: 'revision_conflict' }] }]);

  const parsed = parseKnowledge(await readFile(entryPath(root, 'dispatch_flow'), 'utf8'), 'dispatch_flow.md');
  assert.equal(parsed.status, 'valid');
  const sections = ['First writer section.\n', 'Second writer section.\n'].filter(section => parsed.body.includes(section));
  assert.equal(sections.length, 1, 'exactly the winner section is published');
  assert.ok(parsed.body.startsWith(SEEDED_BODY));
  assert.deepEqual(await catalogueFiles(root), ['dispatch_flow.md']);
});

test('append refuses a name that does not exist, an unknown mode and a multi-entry append', async t => {
  const root = await realRoot('knowledge-append-shape-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');

  assert.deepEqual(await append(root, {
    name: 'never_written',
    addition: '## More\n',
    evidence: [{ path: 'main.ts' }],
    expectedRevision: 'a'.repeat(64)
  }), { status: 'invalid', rejected: [{ name: 'never_written', reason: 'unknown_entry' }] });

  assert.deepEqual(await saveKnowledgeProposal(root, {
    mode: 'upsert',
    entries: [{ name: 'any_flow', addition: 'Body.\n', evidence: [{ path: 'main.ts' }], expectedRevision: 'a'.repeat(64) }]
  }), { status: 'invalid', rejected: [{ reason: 'unknown_mode' }] });

  const two = (suffix: string) => ({
    name: `flow_${suffix}`,
    addition: '## More\n',
    evidence: [{ path: 'main.ts' }],
    expectedRevision: 'a'.repeat(64)
  });
  assert.deepEqual(await saveKnowledgeProposal(root, { mode: 'append', entries: [two('one'), two('two')] }), {
    status: 'invalid',
    rejected: [{ reason: 'mode_requires_single_entry' }]
  });
  assert.deepEqual(await catalogueFiles(root), []);
});

test('engine_changed refuses an append whose resulting entry carries symbol proofs, and the marker never moves', async t => {
  const root = await realRoot('knowledge-append-engine-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const { revision } = await seed(root);
  // The catalogue was stamped by another canonicalizer identity.
  const marker = join(knowledgeDirectory(root), catalogueCanonicalizerName);
  await writeFile(marker, 'span@0\n');
  const before = await readFile(entryPath(root, 'dispatch_flow'));

  assert.deepEqual(await append(root, {
    name: 'dispatch_flow',
    addition: '## Symbol grain\n',
    evidence: [{ type: 'symbol', path: 'main.ts', symbol: 'start' }],
    expectedRevision: revision
  }), { status: 'invalid', rejected: [{ reason: 'engine_changed' }] });
  assert.deepEqual(await readFile(entryPath(root, 'dispatch_flow')), before);
  assert.equal((await readFile(marker, 'utf8')).trim(), 'span@0');

  // A file-only append is unaffected by the canonicalizer identity.
  const appended = await append(root, {
    name: 'dispatch_flow',
    addition: '## Files only\n',
    evidence: [{ path: 'reader.ts' }],
    expectedRevision: revision
  });
  assert.equal(appended.status, 'appended', JSON.stringify(appended));
  assert.equal((await readFile(marker, 'utf8')).trim(), 'span@0', 'the marker is never rewritten');
  assert.notEqual(knowledgeCanonicalizer, 'span@0');
});

test('an append keeps the daughters of a composed entry verbatim, pins included', async t => {
  const root = await realRoot('knowledge-append-composed-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  await writeFile(join(root, 'reader.ts'), 'export const read = () => 1;\n');
  // A composed entry enriches without changing what she is: the daughters are
  // carried exactly as the body is, so `append` can neither drop nor re-pin one
  // (spec #288).
  const pins = [
    { name: 'child_one', sha256: 'a'.repeat(64) },
    { name: 'child_two', sha256: 'b'.repeat(64) }
  ];
  const composed = `---\nname: mother\ndescription: How the two daughters interact\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${sha256('export const start = 1;\n')}\n  - type: file\n    path: reader.ts\n    sha256: ${sha256('export const read = () => 1;\n')}\ndependencies:\n${pins.map(pin => `  - name: ${pin.name}\n    sha256: ${pin.sha256}`).join('\n')}\n---\n${SEEDED_BODY}`;
  await mkdir(knowledgeDirectory(root), { recursive: true });
  await writeFile(entryPath(root, 'mother'), composed);

  const result = await append(root, {
    name: 'mother',
    addition: '## Interaction\n\nAppended section.\n',
    expectedRevision: knowledgeRevision(Buffer.from(composed))
  });
  assert.equal(result.status, 'appended', JSON.stringify(result));
  const parsed = parseKnowledge(await readFile(entryPath(root, 'mother'), 'utf8'), 'mother.md');
  assert.equal(parsed.status, 'valid');
  const written = parsed as { dependencies: unknown; body: string };
  assert.deepEqual(written.dependencies, pins);
  assert.ok(written.body.startsWith(SEEDED_BODY), 'the historical body stays verbatim');
  assert.match(written.body, /Appended section\./);
});
