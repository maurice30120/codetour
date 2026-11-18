#!/usr/bin/env node
/**
 * Pre-run connectivity check for the parcours B Knowledge entries (spec #219,
 * ticket #222). Drives the #220 validation seam WITHOUT a model and without
 * any API key:
 *
 *   parseKnowledge / verifyKnowledge / loadKnowledgeLibrary
 *   (packages/exploration-poc/src/knowledge.ts)
 *
 * Checks, in order:
 *   1. RED-proof: a deliberately forged hash (wrong sha256) is refused
 *      (file_hash_mismatch) with no body leak — the harness would return
 *      `invalid` and no content.
 *   2. Same for a tmp-modified copy of the real cited file: the bytes changed
 *      after preparation, so the entry must be refused (file_hash_mismatch),
 *      and the sanitized result must not leak the body.
 *   3. GREEN: the real catalogue in the snapshot worktree —
 *      a. discovery exposes name and description ONLY (no body, no evidence);
 *      b. memory_read(name) verifies the evidence contract and returns the
 *         validated Markdown body (status 'valid', nonempty body);
 *      c. the raw bytes of the cited files hash to the declared SHA-256.
 *
 * Exit code 0 only when every check passes. Usage:  node check-knowledge.mjs
 * (paths below are defaults; override via WORKTREE and SNAPSHOT env vars).
 */
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WORKTREE = process.env.WORKTREE ?? '/tmp/spec-219-wt/t222';
const SNAPSHOT = process.env.SNAPSHOT ?? '/tmp/spec-219-wt/run-b-snapshot';
const ENTRY = 'harness_dispatch_and_forgery';
const BODY_MARKER = 'MASK_MIN_BYTES = 2000'; // distinctive sentence from the real body

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const { parseKnowledge, verifyKnowledge, loadKnowledgeLibrary, knowledgeDirectory } = await import(
  resolve(WORKTREE, 'packages/exploration-poc/src/knowledge.ts')
);

const noLeak = JSON.stringify; // a leaked body would appear in the raw JSON of a refusal

// ---- 1. RED-proof: forged hash is refused, nothing leaks -------------------
const entryFile = join(knowledgeDirectory(SNAPSHOT), `${ENTRY}.md`);
const source = await readFile(entryFile, 'utf8');
const forgedSource = source.replace(
  /sha256: [0-9a-f]{64}/,
  'sha256: ' + '0'.repeat(64),
);
const forged = parseKnowledge(forgedSource, ENTRY);
check('forged-hash entry parses to a contract', forged.status === 'valid', `reason=${forged.status === 'valid' ? '' : forged.reason}`);
const forgedVerify = forged.status === 'valid' ? await verifyKnowledge(forged, SNAPSHOT) : forged;
check('forged sha256 refused at verify', forgedVerify.status === 'invalid' && forgedVerify.reason === 'file_hash_mismatch', `→ ${forgedVerify.status === 'valid' ? 'VALID (must be invalid)' : forgedVerify.reason}`);
check('forged refusal leaks no body', !noLeak(forgedVerify).includes(BODY_MARKER));

// ---- 2. Negative: tmp-modified cited file in a throwaway root --------------
const tmpRoot = await mkdtemp(join(tmpdir(), 'spec219-connectivity-'));
try {
  const cited = ['packages/exploration-poc/src/cli.ts', 'packages/exploration-poc/src/explore.ts', 'packages/exploration-poc/src/mask.ts'];
  await mkdir(join(tmpRoot, 'packages/exploration-poc/src'), { recursive: true });
  await mkdir(join(tmpRoot, '.tours/.memory/knowledge'), { recursive: true });
  for (const path of cited) {
    const bytes = await readFile(join(SNAPSHOT, path));
    // All cited files exist in the throwaway root; ONLY mask.ts is modified after preparation.
    const modified = path === 'packages/exploration-poc/src/mask.ts';
    await writeFile(join(tmpRoot, path), modified ? Buffer.concat([bytes, Buffer.from('\n// trailing garbage added after preparation\n')]) : bytes);
  }
  await writeFile(join(tmpRoot, '.tours/.memory/knowledge', `${ENTRY}.md`), source);
  const tmpLib = await loadKnowledgeLibrary(tmpRoot, knowledgeDirectory(tmpRoot));
  const tmpRead = await tmpLib.read(ENTRY);
  check('tmp-modified cited file refused', tmpRead.status === 'invalid' && tmpRead.reason === 'file_hash_mismatch', `→ ${tmpRead.status === 'valid' ? 'VALID (must be invalid)' : tmpRead.reason}`);
  check('tmp refusal leaks no body', !noLeak(tmpRead).includes(BODY_MARKER));
  check('invalid entry does not break discovery', (await tmpLib.catalog()).every(item => Object.keys(item).join() === 'name,description'));
  const ordinarySearch = await tmpLib.list('nothing-matches-this');
  check('ordinary search on a partly stale catalogue still answers', Array.isArray(ordinarySearch) && ordinarySearch.length === 0);
} finally {
  await rm(tmpRoot, { recursive: true, force: true });
}

// ---- 3. GREEN: the real catalogue of the snapshot --------------------------
const root = resolve(SNAPSHOT);
const library = await loadKnowledgeLibrary(root, knowledgeDirectory(root));

const catalog = await library.catalog();
check('discovery finds the entry', catalog.some(item => item.name === ENTRY), `catalog=${JSON.stringify(catalog.map(item => item.name))}`);
check('discovery exposes name and description ONLY', catalog.every(item => Object.keys(item).sort().join() === 'description,name'), JSON.stringify(catalog.map(item => Object.keys(item))));
check('discovery leaks no body', !noLeak(catalog).includes(BODY_MARKER));

const read = await library.read(ENTRY);
check('memory_read verifies and returns the validated body', read.status === 'valid' && typeof read.body === 'string' && read.body.trim().length > 0, `status=${read.status}${read.status === 'invalid' ? `, reason=${read.reason}` : `, body ${read.body.length} chars`}`);
check('read body carries no evidence hashes (body only, contract kept separately)', read.status === 'invalid' || !read.body.includes('sha256:'));

if (read.status === 'valid') {
  const proofsMatch = (
    await Promise.all(read.evidence.map(async proof => {
      const bytes = await readFile(join(root, proof.path));
      const hash = createHash('sha256').update(bytes).digest('hex');
      return hash === proof.sha256.toLowerCase() ? proof.path : `${proof.path} (declared ${proof.sha256.slice(0, 8)}…, actual ${hash.slice(0, 8)}…)`;
    }))
  );
  check('every cited file hashes to its declared SHA-256 at 2f1ebcf', proofsMatch.every(item => !item.includes('(declared')), proofsMatch.join('; '));
}

// entry name is a valid TypeScript identifier equal to the file name (checked statically too)
const staticParse = parseKnowledge(source, ENTRY);
check('static contract parse is valid', staticParse.status === 'valid', staticParse.status === 'invalid' ? staticParse.reason : '');

console.log(failures === 0 ? '\nCONNECTIVITY CHECK: ALL CHECKS PASSED' : `\nCONNECTIVITY CHECK: ${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
