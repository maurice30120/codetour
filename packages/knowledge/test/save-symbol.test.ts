import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  catalogueCanonicalizerName,
  knowledgeCanonicalizer,
  knowledgeDirectory,
  loadKnowledgeLibrary,
  saveKnowledgeProposal,
  type KnowledgeSaveResult
} from '../src/index';

const realRoot = async (prefix: string): Promise<string> => realpathSync(await mkdtemp(join(tmpdir(), prefix)));

const writeEntry = async (root: string, fileName: string, content: string): Promise<void> => {
  const directory = knowledgeDirectory(root);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, fileName), content);
};

const expectStatus = (result: KnowledgeSaveResult, status: string): { rejected?: Array<{ name?: string; reason: string }>; warnings?: Array<Record<string, unknown>>; saved?: string[] } => {
  assert.equal(result.status, status);
  return result as never;
};

test('knowledge_save accepts a symbol proof, computes the engine fingerprint and the entry reads valid', async t => {
  const root = await realRoot('symbol-save-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export function dispatch(input: string): string {\n  return `ok:${input}`;\n}\n');
  const result = expectStatus(await saveKnowledgeProposal(root, {
    entries: [{
      name: 'dispatch_flow',
      description: 'How dispatch works',
      body: 'Body.\n',
      evidence: [{ type: 'symbol', path: 'main.ts', symbol: 'dispatch' }]
    }]
  }), 'saved');
  assert.deepEqual(result.saved, ['dispatch_flow']);
  assert.deepEqual(result.warnings, [{ name: 'dispatch_flow', code: 'insufficient_backing', distinctEvidencePaths: 1 }]);
  // the engine computed the fingerprint: the persisted file carries a real sha
  const persisted = join(knowledgeDirectory(root), 'dispatch_flow.md');
  const source = await readFile(persisted, 'utf8');
  assert.match(source, /type: symbol/);
  assert.match(source, /symbol: dispatch/);
  assert.doesNotMatch(source, /sha256: f{64}/);
  const library = await loadKnowledgeLibrary(root, knowledgeDirectory(root));
  assert.equal((await library.read('dispatch_flow')).status, 'valid');
  // the catalogue was stamped with the canonicalizer identity
  const marker = await readFile(join(knowledgeDirectory(root), catalogueCanonicalizerName), 'utf8');
  assert.equal(marker.trim(), knowledgeCanonicalizer);
});

test('a wrong declared symbol fingerprint refuses the proposal without publishing', async t => {
  const root = await realRoot('symbol-savewrong-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  const result = expectStatus(await saveKnowledgeProposal(root, {
    entries: [{
      name: 'wrong',
      description: 'declared fingerprint does not match the canonical span',
      body: 'Body.\n',
      evidence: [{ type: 'symbol', path: 'main.ts', symbol: 'start', sha256: 'f'.repeat(64) }]
    }]
  }), 'invalid');
  assert.deepEqual(result.rejected, [{ name: 'wrong', reason: 'symbol_hash_mismatch' }]);
  assert.equal(await readFile(join(knowledgeDirectory(root), 'wrong.md'), 'utf8').then(() => true).catch(() => false), false);
});

test('an unresolvable symbol proof falls back to a traced file proof with an explicit warning (creation only)', async t => {
  const root = await realRoot('symbol-fallback-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'legacy.rb'), 'def legacy\nend\n');
  const result = expectStatus(await saveKnowledgeProposal(root, {
    entries: [{
      name: 'legacy_rule',
      description: 'Cited in an unsupported language',
      body: 'Ruby rule body.\n',
      evidence: [{ type: 'symbol', path: 'legacy.rb', symbol: 'legacy' }]
    }]
  }), 'saved');
  assert.ok((result.warnings ?? []).some(warning =>
    warning.name === 'legacy_rule' && warning.code === 'symbol_proof_fallback'
  ), 'the fallback must be reported, never silent');
  const source = await readFile(join(knowledgeDirectory(root), 'legacy_rule.md'), 'utf8');
  assert.match(source, /type: file/);
  assert.match(source, /origin: symbol_fallback/);
  const library = await loadKnowledgeLibrary(root, knowledgeDirectory(root));
  const read = await library.read('legacy_rule');
  assert.equal(read.status, 'valid');
});

test('a symbol with syntax errors falls back at creation and is refused on later symbol reads', async t => {
  const root = await realRoot('symbol-syntax-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'main.ts');
  const valid = 'export function dispatch() { return 1; }\n';
  await writeFile(file, valid);
  const proposal = (name: string) => ({ entries: [{ name, description: 'dispatch', body: 'Secret body.\n', evidence: [{ type: 'symbol' as const, path: 'main.ts', symbol: 'dispatch' }] }] });
  expectStatus(await saveKnowledgeProposal(root, proposal('good')), 'saved');
  for (const invalid of [
    'export function dispatch() { const x = ; return 1; }\n',
    'export function dispatch() { return (1 + ); }\n',
    'export function dispatch() { return 1;\n'
  ]) {
    await writeFile(file, invalid);
    const read = await (await loadKnowledgeLibrary(root, knowledgeDirectory(root))).read('good');
    assert.deepEqual(read, { status: 'invalid', reason: 'symbol_unparseable' });
  }
  const fallback = expectStatus(await saveKnowledgeProposal(root, proposal('fallback')), 'saved');
  assert.ok(fallback.warnings?.some(warning => warning.code === 'symbol_proof_fallback' && warning.reason === 'symbol_unparseable'));
  assert.match(await readFile(join(knowledgeDirectory(root), 'fallback.md'), 'utf8'), /origin: symbol_fallback/);
  await writeFile(file, valid + 'const unrelated = ;\n');
  assert.equal((await (await loadKnowledgeLibrary(root, knowledgeDirectory(root))).read('good')).status, 'valid');
});

test('a stale canonicalizer marker routes symbol-proof saves to engine_changed without touching file proofs', async t => {
  const root = await realRoot('symbol-enginestale-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  await writeEntry(root, 'old_engine.md', '---\nname: old_engine\ndescription: from a previous engine identity\nevidence:\n  - type: symbol\n    path: main.ts\n    symbol: start\n' + `    sha256: ${'f'.repeat(64)}\n---\nbody\n`);
  await mkdir(knowledgeDirectory(root), { recursive: true });
  await writeFile(join(knowledgeDirectory(root), catalogueCanonicalizerName), 'span@0\n');
  // file-only saves go through: the canonicalizer identity does not concern them
  const fileOnly = expectStatus(await saveKnowledgeProposal(root, {
    entries: [{ name: 'plain', description: 'no symbol proofs', body: 'Body.\n', evidence: [{ path: 'main.ts' }] }]
  }), 'saved');
  assert.deepEqual(fileOnly.saved, ['plain']);
  // a symbol-proof proposal routes to explicit re-anchoring
  const result = expectStatus(await saveKnowledgeProposal(root, {
    entries: [{ name: 'anchored', description: 'new engine anchor', body: 'Body.\n', evidence: [{ type: 'symbol', path: 'main.ts', symbol: 'start' }] }]
  }), 'invalid');
  assert.deepEqual(result.rejected, [{ reason: 'engine_changed' }]);
});
