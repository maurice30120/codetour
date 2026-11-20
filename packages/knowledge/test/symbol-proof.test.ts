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
  loadKnowledgeLibrary,
  parseKnowledge,
  verifyKnowledge,
  type KnowledgeParseResult,
  type SymbolFingerprinter,
  treeSitterSymbolFingerprinter
} from '../src/index';

const FIXTURE_HASH = 'f'.repeat(64);

const realRoot = async (prefix: string): Promise<string> => realpathSync(await mkdtemp(join(tmpdir(), prefix)));

const readRoot = async (root: string) => loadKnowledgeLibrary(root, knowledgeDirectory(root));

const writeEntry = async (root: string, fileName: string, content: string): Promise<void> => {
  const directory = knowledgeDirectory(root);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, fileName), content);
};

const symbolProofSource = (sha: string, extra = '') =>
  `---\nname: dispatch_flow\ndescription: How tool calls dispatch\nevidence:\n  - type: symbol\n    path: main.ts\n    symbol: dispatch\n    sha256: ${sha}${extra}\n---\nsecret body\n`;

const expectInvalid = (read: KnowledgeParseResult, reason: string): void => {
  assert.equal(read.status, 'invalid');
  assert.equal((read as { reason?: string }).reason, reason);
  assert.doesNotMatch(JSON.stringify(read), /secret body/);
};

test('a mixed file+symbol entry parses, and its symbol proof reads fail-closed until a canonicalizer is wired', async t => {
  const root = await realRoot('symbol-mixed-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export function dispatch(): number { return 1; }\n');
  const fileHash = fileProofHash(await readFile(join(root, 'main.ts')));
  await writeEntry(root, 'mixed.md', `---\nname: mixed\ndescription: file and symbol proofs coexist\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${fileHash}\n  - type: symbol\n    path: main.ts\n    symbol: dispatch\n    sha256: ${FIXTURE_HASH}\n---\nsecret body\n`);
  const library = await readRoot(root);
  // the complete symbol proof is contract grammar now: discovery lists it, the
  // read verifies the file proof then refuses on the symbol proof, fail-closed
  assert.deepEqual(
    (await library.catalog()).map(({ name, description }) => ({ name, description })),
    [{ name: 'mixed', description: 'file and symbol proofs coexist' }]
  );
  expectInvalid(await library.read('mixed'), 'symbol_hash_mismatch');
});

test('an incomplete or malformed symbol proof is a malformed contract, refused before any workspace read', async t => {
  const root = await realRoot('symbol-malformed-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const missingHash = `---\nname: nohash\ndescription: symbol proof without a declared fingerprint\nevidence:\n  - type: symbol\n    path: main.ts\n    symbol: dispatch\n---\nbody\n`;
  const badHash = symbolProofSource(createHash('sha256').update('x').digest('hex').slice(0, 63) + 'z');
  const missingSymbol = `---\nname: nosym\ndescription: symbol proof without a symbol name\nevidence:\n  - type: symbol\n    path: main.ts\n    sha256: ${FIXTURE_HASH}\n---\nbody\n`;
  for (const source of [missingHash, missingSymbol, badHash, symbolProofSource('0'.repeat(64), '\n    unexpected: x')]) {
    const parsed = parseKnowledge(source, 'nohash');
    assert.equal(parsed.status, 'invalid');
    assert.equal((parsed as { reason?: string }).reason, 'malformed_contract');
  }
});

test('a symbol-proof entry whose declared fingerprint does not match the real canonical span is refused without leaking the body', async t => {
  const root = await realRoot('symbol-failclosed-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export function dispatch(): number { return 1; }\n');
  await writeEntry(root, 'dispatch_flow.md', symbolProofSource(FIXTURE_HASH));
  const library = await readRoot(root);
  expectInvalid(await library.read('dispatch_flow'), 'symbol_hash_mismatch');
});

test('verification dispatches symbol proofs to the fingerprint contract: unique resolution, refusal, mismatch', async t => {
  const root = await realRoot('symbol-verify-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export function dispatch(): number { return 1; }\n');
  await writeEntry(root, 'dispatch_flow.md', symbolProofSource(FIXTURE_HASH));
  const spanHash = createHash('sha256').update('export function dispatch(): number { return 1; }\n').digest('hex');
  const fingerprinter: SymbolFingerprinter = async (_root, _realFile, proof) =>
    proof.symbol === 'ghost' ? { status: 'refused', reason: 'symbol_unresolved' }
    : { status: 'ok', sha256: spanHash };
  const parsed = parseKnowledge(symbolProofSource(spanHash), 'dispatch_flow');
  assert.equal(parsed.status, 'valid');
  const ok = await verifyKnowledge(parsed, root, fingerprinter);
  assert.equal(ok.status, 'valid');
  expectInvalid(await verifyKnowledge(parsed, root, async () => ({ status: 'refused', reason: 'symbol_unresolved' })), 'symbol_unresolved');
  expectInvalid(await verifyKnowledge(parsed, root, async () => ({ status: 'refused', reason: 'symbol_ambiguous' })), 'symbol_ambiguous');
  expectInvalid(await verifyKnowledge(parsed, root, async () => ({ status: 'refused', reason: 'engine_changed' })), 'engine_changed');
});

test('a symbol fingerprint mismatch is refused with its own reason and no body', async t => {
  const root = await realRoot('symbol-mismatch-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export function dispatch(): number { return 2; }\n');
  await writeEntry(root, 'dispatch_flow.md', symbolProofSource(FIXTURE_HASH));
  const spanHash = createHash('sha256').update('export function dispatch(): number { return 1; }\n').digest('hex');
  const fingerprinter: SymbolFingerprinter = async () => ({ status: 'ok', sha256: spanHash });
  const parsed = parseKnowledge(symbolProofSource(FIXTURE_HASH), 'dispatch_flow');
  assert.equal(parsed.status, 'valid');
  expectInvalid(await verifyKnowledge(parsed, root, fingerprinter), 'symbol_hash_mismatch');
});

test('symbol proof path safety matches file proof path safety exactly', async t => {
  const root = await realRoot('symbol-paths-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const variant = (name: string, path: string): string =>
    symbolProofSource(FIXTURE_HASH).replace('name: dispatch_flow', `name: ${name}`).replace('path: main.ts', `path: ${path}`);
  await writeEntry(root, 'outside.md', variant('outside', '../outside.ts'));
  await writeEntry(root, 'absolute.md', variant('absolute', join(root, 'main.ts')));
  const linked = await realRoot('symbol-linked-');
  t.after(() => rm(linked, { recursive: true, force: true }));
  await writeFile(join(linked, 'target.ts'), 'outside bytes\n');
  await symlink(join(linked, 'target.ts'), join(root, 'escape-link.ts'));
  await writeEntry(root, 'escape.md', variant('escape', 'escape-link.ts'));
  const library = await readRoot(root);
  expectInvalid(await library.read('outside'), 'path_outside_workspace');
  expectInvalid(await library.read('absolute'), 'path_outside_workspace');
  expectInvalid(await library.read('escape'), 'symlink_escape');
});

test('existing file-proof entries keep reading exactly as before — no behavioural drift', async t => {
  const root = await realRoot('symbol-regression-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  const proof = fileProofHash(await readFile(join(root, 'main.ts')));
  await writeEntry(root, 'plain.md', `---\nname: plain\ndescription: unchanged file proof contract\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${proof}\n---\nplain body\n`);
  const library = await readRoot(root);
  assert.deepEqual(
    (await library.catalog()).map(({ name, description }) => ({ name, description })),
    [{ name: 'plain', description: 'unchanged file proof contract' }]
  );
  const read = await library.read('plain');
  assert.equal(read.status, 'valid');
  assert.equal((read as { body: string }).body, 'plain body\n');
});

// --- slice 2: the grammar-backed canonicalizer (spec #233, ADR 0046) ---

test('the canonical span tolerates comment and formatting changes but refuses behaviour changes', async t => {
  const root = await realRoot('symbol-canonical-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = 'export function dispatch(input: string): string {\n  return `ok:${input}`;\n}\n';
  await writeFile(join(root, 'main.ts'), original);
  // the real fingerprint of the cited symbol, as a creation flow would compute it
  const real = realpathSync(root);
  const fingerprint = await treeSitterSymbolFingerprinter(real, join(real, 'main.ts'), { type: 'symbol', path: 'main.ts', symbol: 'dispatch', sha256: '' });
  assert.equal(fingerprint.status, 'ok');
  const sha = (fingerprint as { sha256: string }).sha256;
  await writeEntry(root, 'dispatch_flow.md', symbolProofSource(sha));
  const library = await readRoot(root);
  // presentation-only churn: comments and reindentation, no token of behaviour
  const churned = '// a new header comment\nexport function dispatch( input: string ): string /* reflow */ {\n    // an inner comment\n    return `ok:${input}`;   \n}\n';
  await writeFile(join(root, 'main.ts'), churned);
  const afterChurn = await library.read('dispatch_flow');
  assert.equal(afterChurn.status, 'valid');
  // behaviour change inside the cited symbol: refusal, no body
  await writeFile(join(root, 'main.ts'), original.replace('return `ok:${input}`;', 'return `ko:${input}`;'));
  expectInvalid(await library.read('dispatch_flow'), 'symbol_hash_mismatch');
  // a sibling symbol changing does not touch the cited span
  await writeFile(join(root, 'main.ts'), `${original}export function bystander(): number { return 7; }\n`);
  await rm(join(root, 'dispatch_flow.md'), { force: true });
  await writeEntry(root, 'dispatch_flow.md', symbolProofSource(sha));
  const afterSibling = await readRoot(root);
  assert.equal((await afterSibling.read('dispatch_flow')).status, 'valid');
});

test('a symbol cited with a qualified name resolves through its declaration chain and refuses duplicates', async t => {
  const root = await realRoot('symbol-qualified-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = 'export class AuthService {\n  login(user: string): boolean { return true; }\n}\nexport function login(): void {}\n';
  await writeFile(join(root, 'main.ts'), source);
  const real = realpathSync(root);
  const qualified = await treeSitterSymbolFingerprinter(real, join(real, 'main.ts'), { type: 'symbol', path: 'main.ts', symbol: 'AuthService.login', sha256: '' });
  assert.equal(qualified.status, 'ok');
  await writeEntry(root, 'method.md', symbolProofSource((qualified as { sha256: string }).sha256).replace('symbol: dispatch', 'symbol: AuthService.login').replace('name: dispatch_flow', 'name: method'));
  const library = await readRoot(root);
  assert.equal((await library.read('method')).status, 'valid');
  // the bare name resolves uniquely to the top-level function: the class
  // method's chain is AuthService.login, a different qualified symbol. The
  // declared fixture hash then mismatches — deterministic, no guessing.
  await rm(join(knowledgeDirectory(root), 'method.md'));
  await writeEntry(root, 'bare.md', symbolProofSource(FIXTURE_HASH).replace('symbol: dispatch', 'symbol: login').replace('name: dispatch_flow', 'name: bare'));
  const read = await (await readRoot(root)).read('bare');
  assert.equal(read.status, 'invalid');
  assert.equal((read as { reason?: string }).reason, 'symbol_hash_mismatch');
  await writeEntry(root, 'dupe.md', symbolProofSource(FIXTURE_HASH).replace('symbol: dispatch', 'symbol: login').replace('path: main.ts', 'path: dupe.ts').replace('name: dispatch_flow', 'name: dupe'));
  // two top-level declarations of the same name are genuinely ambiguous
  await writeFile(join(root, 'dupe.ts'), 'export function login(): void {}\nexport function login(): void {}\n');
  const dupe = await (await readRoot(root)).read('dupe');
  assert.equal(dupe.status, 'invalid');
  assert.equal((dupe as { reason?: string }).reason, 'symbol_ambiguous');
  assert.doesNotMatch(JSON.stringify(read), /secret body/);
  assert.doesNotMatch(JSON.stringify(dupe), /secret body/);
});

test('an absent symbol is unresolved and an unimplemented language stays unsupported', async t => {
  const root = await realRoot('symbol-unresolved-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export function dispatch(): number { return 1; }\n');
  await writeFile(join(root, 'legacy.rb'), 'def legacy\nend\n');
  await writeEntry(root, 'ghost.md', symbolProofSource(FIXTURE_HASH).replace('symbol: dispatch', 'symbol: ghost').replace('name: dispatch_flow', 'name: ghost'));
  await writeEntry(root, 'legacy.md', symbolProofSource(FIXTURE_HASH).replace('path: main.ts', 'path: legacy.rb').replace('name: dispatch_flow', 'name: legacy'));
  const library = await readRoot(root);
  const ghost = await library.read('ghost');
  assert.equal(ghost.status, 'invalid');
  assert.equal((ghost as { reason?: string }).reason, 'symbol_unresolved');
  const legacy = await library.read('legacy');
  assert.equal(legacy.status, 'invalid');
  assert.equal((legacy as { reason?: string }).reason, 'unsupported_language');
  assert.doesNotMatch(JSON.stringify([ghost, legacy]), /secret body/);
});
