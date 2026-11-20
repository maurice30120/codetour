import { constants } from 'node:fs';
import { access, copyFile, link, lstat, mkdir, open, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  catalogueCanonicalizerName,
  hashWorkspaceFile,
  hashWorkspaceSymbol,
  isOutsideWorkspace,
  knowledgeDirectory,
  knowledgeRevision,
  parseKnowledge,
  readCatalogueCanonicalizer,
  verifyKnowledge,
  type KnowledgeProof
} from './knowledge';
import { knowledgeCanonicalizer } from './symbol-fingerprint';
import { validateNewKnowledgeName } from './name';

/**
 * Deterministic persistence of Knowledge entries (spec #223, ticket #225).
 *
 * A proposal is validated in full before anything is written: names,
 * descriptions and bodies follow the read grammar, every cited file must stay
 * inside the workspace, avoid symlink escapes and either declare its exact
 * SHA-256 or receive a computed one. Any invalid entry or any existing
 * `<name>.md` refuses the whole proposal, so publication is never partial.
 * A published entry whose evidence cites fewer than two distinct files is
 * still published, but reported under `warnings` instead of passing silently
 * as fully backed (the signal is advisory and names no cited path or hash).
 * Every mode runs its critical section — entry re-read, revision comparison,
 * evidence stability re-check, staging file, publication — under one catalogue
 * lock (ADR 0049). `create` publishes by exclusive hard link, which is atomic
 * and can never overwrite an existing entry; `replace` rewrites one entry
 * against the Knowledge Revision the caller read and publishes by atomic
 * rename, so a reader always sees the previous whole file or the new one;
 * `append` keeps the historical body byte for byte, inserts one addition
 * verbatim after exactly one blank line and merges the evidence.
 */

/** One evidence item as declared by a proposal; `sha256` is optional. */
export interface KnowledgeProposalFileProof {
  type?: 'file';
  /** Workspace-relative path of the cited file. */
  path: string;
  /** Optional declared SHA-256, verified against the cited bytes. */
  sha256?: string;
}

/** A requested symbol proof: the engine resolves and fingerprints, the model never computes. */
export interface KnowledgeProposalSymbolProof {
  type: 'symbol';
  /** Workspace-relative path of the file carrying the cited symbol. */
  path: string;
  /** Qualified name of the cited symbol; resolved uniquely or refused. */
  symbol: string;
  /** Optional declared fingerprint, verified against the canonical span. */
  sha256?: string;
}

export interface KnowledgeProposalEntry {
  name: string;
  description: string;
  body: string;
  evidence: Array<KnowledgeProposalFileProof | KnowledgeProposalSymbolProof>;
}

/**
 * One `replace` entry: the whole new contract plus the Knowledge Revision the
 * caller read. `expectedRevision` is mandatory — a rewrite is a
 * compare-and-swap, never a last-writer-wins overwrite (spec #232).
 */
export interface KnowledgeReplaceProposalEntry extends KnowledgeProposalEntry {
  expectedRevision: string;
}

/**
 * One `append` entry: an addition inserted verbatim after the historical body
 * plus the evidence to merge into it, conditioned on the Knowledge Revision
 * the caller read. The historical name and description are deliberately not
 * accepted: an append enriches an entry, it never rewrites what the entry is.
 */
export interface KnowledgeAppendProposalEntry {
  name: string;
  /** Markdown inserted verbatim after the historical body; never titled or reformatted. */
  addition: string;
  /** New proofs to merge, deduplicated by `(type, path, symbol)`; none for a body-only addition. */
  evidence?: Array<KnowledgeProposalFileProof | KnowledgeProposalSymbolProof>;
  expectedRevision: string;
}

/**
 * Write mode of one Knowledge Consolidation Operation (spec #232). `create` is
 * the documented default, so a proposal without `mode` keeps its behaviour;
 * `append` enriches one existing valid entry without rewriting its body;
 * `replace` rewrites one existing entry in full.
 */
export type KnowledgeSaveMode = 'create' | 'append' | 'replace';

/** The documented proposal file: `{"mode"?,"entries":[...]}` and nothing else. */
export interface KnowledgeProposal {
  mode?: KnowledgeSaveMode;
  entries: Array<KnowledgeProposalEntry | KnowledgeReplaceProposalEntry | KnowledgeAppendProposalEntry>;
}

/** A concrete entry ready to serialize, with verified evidence. */
export interface KnowledgePersistableEntry {
  name: string;
  description: string;
  body: string;
  evidence: KnowledgeProof[];
}

/**
 * Rejection causes of a proposal. `name` is present whenever the proposal
 * declared a usable string name, so a caller can point at the entry.
 */
export type KnowledgeSaveRejectionReason =
  | 'malformed_proposal'
  | 'malformed_entry'
  | 'malformed_evidence'
  | 'invalid_name'
  | 'invalid_description'
  | 'invalid_body'
  | 'missing_evidence'
  | 'unsupported_proof'
  | 'duplicate_name'
  | 'file_missing'
  | 'file_hash_mismatch'
  | 'path_outside_workspace'
  | 'symlink_escape'
  | 'not_a_file'
  | 'catalogue_unusable'
  | 'symbol_unresolved'
  | 'symbol_ambiguous'
  | 'unsupported_language'
  | 'symbol_hash_mismatch'
  | 'engine_changed'
  | 'unstable_evidence'
  | 'unknown_entry'
  | 'unknown_mode'
  | 'mode_requires_single_entry'
  /** The historical contract of an `append` target no longer validates; repair it with `replace`. */
  | 'stale_evidence';

export interface KnowledgeSaveRejection {
  name?: string;
  reason: KnowledgeSaveRejectionReason;
}

/**
 * A refused publication caused by the catalogue state, not by the proposal:
 * the name already exists (`create`) or no longer matches the revision that
 * was read (`replace`, compare-and-swap). Both sort a client-visible
 * `conflict`, with a reason that says which corrective action applies.
 */
export interface KnowledgeNameConflict {
  name: string;
  reason: 'name_conflict' | 'revision_conflict';
}

/**
 * Advisory signals about published entries; never a refusal and never a
 * body leak. A fallback signal names the substituted path — at save time
 * the proposing agent itself just authored that path, so naming it leaks
 * nothing (spec #233: explicit fallback, never silent).
 */
export type KnowledgeSaveWarning =
  | { name: string; code: 'insufficient_backing'; distinctEvidencePaths: number }
  | { name: string; code: 'symbol_proof_fallback'; path: string; reason: 'symbol_unresolved' | 'symbol_ambiguous' | 'unsupported_language' };

export type KnowledgeSaveResult =
  | { status: 'saved'; saved: string[]; warnings: KnowledgeSaveWarning[] }
  | { status: 'appended'; appended: string[]; warnings: KnowledgeSaveWarning[] }
  | { status: 'replaced'; replaced: string[]; warnings: KnowledgeSaveWarning[] }
  | { status: 'no-op' }
  /** The append added nothing literal: no byte of the entry changed. */
  | { status: 'no_change' }
  | { status: 'conflict'; conflicts: KnowledgeNameConflict[] }
  | { status: 'invalid'; rejected: KnowledgeSaveRejection[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Serialize one verified entry in the restricted catalogue grammar. The body
 * is appended verbatim after the closing delimiter: Markdown is data, never
 * executed or reformatted.
 */
export function serializeKnowledgeEntry(entry: KnowledgePersistableEntry): string {
  const lines = ['---', `name: ${entry.name}`, `description: ${entry.description}`, 'evidence:'];
  for (const proof of entry.evidence) {
    if (proof.type === 'symbol') {
      lines.push('  - type: symbol', `    path: ${proof.path}`, `    symbol: ${proof.symbol}`, `    sha256: ${proof.sha256}`);
    } else {
      lines.push('  - type: file', `    path: ${proof.path}`, `    sha256: ${proof.sha256}`);
      if (proof.origin) lines.push(`    origin: ${proof.origin}`);
    }
  }
  lines.push('---');
  return `${lines.join('\n')}\n${entry.body}`;
}

/**
 * One validated entry, or one refusal. A missing `expectedRevision` is not a
 * malformed proposal: it is a compare-and-swap conflict, so it carries the
 * name and its own kind and never reaches the `invalid` vocabulary.
 */
type ProposalValidation =
  | { ok: true; entry: KnowledgePersistableEntry; warnings: KnowledgeSaveWarning[]; expectedRevision?: string }
  | { ok: false; name?: string; reason: KnowledgeSaveRejectionReason }
  | { ok: false; name: string; reason: 'revision_conflict' };

const failure = (reason: KnowledgeSaveRejectionReason, name?: string): ProposalValidation =>
  name === undefined ? { ok: false, reason } : { ok: false, name, reason };

const PROVIDED_HASH = /^[0-9a-fA-F]{64}$/;

// `origin` is engine-only (spec #232): a client cannot declare that a file
// proof substitutes a symbol proof it never suffered, so the key is refused
// like any other unknown field instead of being copied into the catalogue.
const EVIDENCE_KEYS = new Set(['type', 'path', 'symbol', 'sha256']);

const CREATE_ENTRY_KEYS = ['name', 'description', 'body', 'evidence'];
const REPLACE_ENTRY_KEYS = [...CREATE_ENTRY_KEYS, 'expectedRevision'];
const APPEND_ENTRY_KEYS = ['name', 'addition', 'evidence', 'expectedRevision'];

type EvidenceValidation =
  | { ok: true; evidence: KnowledgeProof[]; warnings: KnowledgeSaveWarning[] }
  | { ok: false; reason: KnowledgeSaveRejectionReason };

/**
 * Verify every declared proof of one entry against the workspace: the path
 * stays inside it, no symbolic link escapes it, and each proof hashes to its
 * declared SHA-256 — or receives the engine-computed one when it declares
 * none. Only `create` may substitute an unresolvable symbol proof by a traced
 * file proof; `replace` and `append` refuse it (spec #233, spec #232).
 */
async function validateProposalEvidence(
  root: string,
  rawEvidence: readonly unknown[],
  name: string,
  mode: KnowledgeSaveMode
): Promise<EvidenceValidation> {
  const evidence: KnowledgeProof[] = [];
  const fallbacks: KnowledgeSaveWarning[] = [];
  for (const item of rawEvidence) {
    if (!isRecord(item) || Object.keys(item).some(key => !EVIDENCE_KEYS.has(key))) {
      return { ok: false, reason: 'malformed_evidence' };
    }
    const cited = typeof item.path === 'string' ? item.path.trim() : '';
    if (!cited || /[\r\n]/.test(cited)) return { ok: false, reason: 'malformed_evidence' };
    let declared: string | undefined;
    if (item.sha256 !== undefined) {
      if (typeof item.sha256 !== 'string' || !PROVIDED_HASH.test(item.sha256)) return { ok: false, reason: 'malformed_evidence' };
      declared = item.sha256.toLowerCase();
    }
    const requested = item.type ?? 'file';
    if (requested === 'symbol') {
      // Spec #233: the engine resolves and fingerprints; the model never computes.
      const symbolName = typeof item.symbol === 'string' ? item.symbol.trim() : '';
      if (!symbolName) return { ok: false, reason: 'malformed_evidence' };
      const hashed = await hashWorkspaceSymbol(root, cited, symbolName);
      if (hashed.status === 'ok') {
        if (declared !== undefined && declared !== hashed.sha256) return { ok: false, reason: 'symbol_hash_mismatch' };
        evidence.push({ type: 'symbol', path: hashed.path, symbol: hashed.symbol, sha256: hashed.sha256 });
        continue;
      }
      // Explicit fallback at creation only: a symbol proof the engine cannot
      // resolve — unsupported language, absent or ambiguous symbol — is
      // substituted by a verified file proof, traced in the entry AND
      // reported, never silent (spec #233). Path-safety and engine failures
      // refuse: substituting would hide a real mistake. A write that enriches
      // or rewrites an existing entry cannot add or drop that trace (spec
      // #232), so `replace` and `append` never fall back: an unresolvable
      // symbol is refused and the repair is done with `file` proofs.
      const fallbackReason = mode === 'create' && hashed.status === 'absent' && (hashed.reason === 'symbol_unresolved' || hashed.reason === 'symbol_ambiguous')
        ? hashed.reason
        : mode === 'create' && hashed.status === 'invalid' && hashed.reason === 'unsupported_language'
          ? 'unsupported_language' as const
          : undefined;
      if (!fallbackReason) {
        return { ok: false, reason: hashed.status === 'invalid' ? hashed.reason : 'file_missing' };
      }
      const substituted = await hashWorkspaceFile(root, cited);
      if (substituted.status !== 'ok') return { ok: false, reason: substituted.reason === 'file_missing' ? 'file_missing' : substituted.reason };
      evidence.push({ type: 'file', path: substituted.path, sha256: substituted.sha256, origin: 'symbol_fallback' });
      fallbacks.push({ name, code: 'symbol_proof_fallback', path: substituted.path, reason: fallbackReason });
      continue;
    }
    if (requested !== 'file') return { ok: false, reason: 'unsupported_proof' };
    const hashed = await hashWorkspaceFile(root, cited);
    if (hashed.status === 'absent') return { ok: false, reason: 'file_missing' };
    if (hashed.status === 'invalid') return { ok: false, reason: hashed.reason };
    if (declared !== undefined && declared !== hashed.sha256) return { ok: false, reason: 'file_hash_mismatch' };
    evidence.push({ type: 'file', path: hashed.path, sha256: hashed.sha256 });
  }
  return { ok: true, evidence, warnings: fallbacks };
}

/**
 * Validate one `create`/`replace` proposal entry against the read grammar and
 * the workspace, then verify its evidence. Every refusal is a single
 * deterministic reason; a round-trip through `parseKnowledge` proves the
 * serialized file reads back with exactly the declared name, description,
 * body and normalized evidence.
 */
async function validateEntry(root: string, raw: unknown, seen: Set<string>, mode: KnowledgeSaveMode): Promise<ProposalValidation> {
  if (!isRecord(raw)) return failure('malformed_entry');
  const rawName = typeof raw.name === 'string' && raw.name ? raw.name : undefined;
  const entryKeys = mode === 'replace' ? REPLACE_ENTRY_KEYS : CREATE_ENTRY_KEYS;
  if (Object.keys(raw).some(key => !entryKeys.includes(key))) {
    return failure('malformed_entry', rawName);
  }
  if (typeof raw.name !== 'string' || !validateNewKnowledgeName(raw.name).ok) return failure('invalid_name', rawName);
  const name = raw.name;
  if (seen.has(name)) return failure('duplicate_name', name);
  seen.add(name);

  // A rewrite is conditioned on the revision the caller actually read: an
  // absent token refuses the write instead of guessing the last writer wins.
  if (mode === 'replace' && (typeof raw.expectedRevision !== 'string' || !raw.expectedRevision)) {
    return { ok: false, name, reason: 'revision_conflict' };
  }
  const expectedRevision = typeof raw.expectedRevision === 'string' && raw.expectedRevision ? raw.expectedRevision : undefined;

  if (typeof raw.description !== 'string') return failure('invalid_description', name);
  const description = raw.description.trim();
  if (!description || /[\r\n]/.test(description)) return failure('invalid_description', name);

  if (typeof raw.body !== 'string' || !raw.body.trim() || raw.body.includes('\r')) return failure('invalid_body', name);
  const body = raw.body;

  if (!Array.isArray(raw.evidence) || raw.evidence.length === 0) return failure('missing_evidence', name);

  const verified = await validateProposalEvidence(root, raw.evidence, name, mode);
  if (!verified.ok) return failure(verified.reason, name);
  const { evidence } = verified;

  const entry: KnowledgePersistableEntry = { name, description, body, evidence };
  // The read grammar is the contract: if serialization cannot be read back
  // exactly, the entry is refused instead of publishing an ambiguous file.
  const parsed = parseKnowledge(serializeKnowledgeEntry(entry), `${name}.md`);
  if (parsed.status !== 'valid') return failure('malformed_entry', name);
  if (parsed.name !== name) return failure('invalid_name', name);
  if (parsed.description !== description) return failure('invalid_description', name);
  if (parsed.body !== body) return failure('invalid_body', name);
  if (parsed.evidence.length !== evidence.length || parsed.evidence.some((proof, index) =>
    proof.type !== evidence[index].type || proof.path !== evidence[index].path || proof.sha256 !== evidence[index].sha256
  )) {
    return failure('malformed_evidence', name);
  }
  return expectedRevision === undefined
    ? { ok: true, entry, warnings: verified.warnings }
    : { ok: true, entry, warnings: verified.warnings, expectedRevision };
}

/** One validated `append` entry: the addition, its new proofs and the revision read. */
interface ValidatedAppend {
  name: string;
  addition: string;
  evidence: KnowledgeProof[];
  expectedRevision: string;
}

type AppendValidation =
  | ({ ok: true } & ValidatedAppend)
  | { ok: false; name?: string; reason: KnowledgeSaveRejectionReason }
  | { ok: false; name: string; reason: 'revision_conflict' };

/**
 * Validate one `append` entry: the addition, which is the only new text the
 * operation introduces, and the proofs it merges. The addition obeys the body
 * controls of a creation — a carriage return would corrupt the file — but a
 * blank addition is not refused: it is the proof-only enrichment the contract
 * documents, and `no_change` covers the case where it also brings no proof.
 */
async function validateAppendEntry(root: string, raw: unknown, seen: Set<string>): Promise<AppendValidation> {
  if (!isRecord(raw)) return { ok: false, reason: 'malformed_entry' };
  const rawName = typeof raw.name === 'string' && raw.name ? raw.name : undefined;
  if (Object.keys(raw).some(key => !APPEND_ENTRY_KEYS.includes(key))) {
    return { ok: false, name: rawName, reason: 'malformed_entry' };
  }
  if (typeof raw.name !== 'string' || !validateNewKnowledgeName(raw.name).ok) {
    return { ok: false, name: rawName, reason: 'invalid_name' };
  }
  const name = raw.name;
  if (seen.has(name)) return { ok: false, name, reason: 'duplicate_name' };
  seen.add(name);

  // An append is a compare-and-swap too: an absent token refuses the write
  // instead of guessing the last writer wins.
  if (typeof raw.expectedRevision !== 'string' || !raw.expectedRevision) {
    return { ok: false, name, reason: 'revision_conflict' };
  }
  const expectedRevision = raw.expectedRevision;

  if (typeof raw.addition !== 'string' || raw.addition.includes('\r')) {
    return { ok: false, name, reason: 'invalid_body' };
  }
  const addition = raw.addition;

  // Proof-only append: the addition is optional and may merge nothing at all,
  // because the historical proofs already back the body.
  if (raw.evidence === undefined) return { ok: true, name, addition, evidence: [], expectedRevision };
  if (!Array.isArray(raw.evidence)) return { ok: false, name, reason: 'malformed_evidence' };
  const verified = await validateProposalEvidence(root, raw.evidence, name, 'append');
  if (!verified.ok) return { ok: false, name, reason: verified.reason };
  return { ok: true, name, addition, evidence: verified.evidence, expectedRevision };
}

/** Number of leading newlines, used to compose the append separator. */
const leadingNewlines = (text: string): number => {
  let count = 0;
  while (count < text.length && text[count] === '\n') count++;
  return count;
};

/** Number of trailing newlines, used to compose the append separator. */
const trailingNewlines = (text: string): number => {
  let count = 0;
  let index = text.length - 1;
  while (index >= 0 && text[index] === '\n') { count++; index--; }
  return count;
};

/**
 * Compose an appended body: the historical body verbatim, a separator that
 * guarantees at least one blank line and never a second one, then the
 * addition verbatim. Nothing is normalized, retitled or reformatted, so the
 * historical body stays an exact prefix of the result; a broken prefix is an
 * internal error and never a silent refusal.
 */
function appendedBody(historicalBody: string, addition: string): string {
  // A blank addition introduces no text: the body stays byte for byte identical.
  if (!addition.trim()) return historicalBody;
  const surrounding = trailingNewlines(historicalBody) + leadingNewlines(addition);
  const body = `${historicalBody}${'\n'.repeat(Math.max(0, 2 - surrounding))}${addition}`;
  if (!body.startsWith(historicalBody)) {
    throw new Error('Knowledge append did not preserve the historical body; nothing was written.');
  }
  return body;
}

/** The deduplication key of a proof: its type, path and, for a symbol, its name. */
const evidenceKey = (proof: KnowledgeProof): string =>
  proof.type === 'symbol' ? `symbol\n${proof.path}\n${proof.symbol}` : `file\n${proof.path}`;

type MergedEvidence =
  | { ok: true; evidence: KnowledgeProof[]; added: number }
  | { ok: false; reason: 'file_hash_mismatch' | 'symbol_hash_mismatch' };

/**
 * Merge new proofs into the historical ones, deduplicated by
 * `(type, path, symbol)`: a `file` and a `symbol` proof may therefore coexist
 * on one file. Divergence on the same key is a refusal, never an implicit
 * correction of either side.
 */
function mergeEvidence(historical: readonly KnowledgeProof[], added: readonly KnowledgeProof[]): MergedEvidence {
  const evidence = [...historical];
  const known = new Map(historical.map(proof => [evidenceKey(proof), proof]));
  let count = 0;
  for (const proof of added) {
    const key = evidenceKey(proof);
    const existing = known.get(key);
    if (!existing) {
      evidence.push(proof);
      known.set(key, proof);
      count++;
      continue;
    }
    if (existing.sha256.toLowerCase() !== proof.sha256.toLowerCase()) {
      return { ok: false, reason: proof.type === 'symbol' ? 'symbol_hash_mismatch' : 'file_hash_mismatch' };
    }
  }
  return { ok: true, evidence, added: count };
}

/** Compare a serialized evidence list with the one it was serialized from. */
const sameEvidence = (left: readonly KnowledgeProof[], right: readonly KnowledgeProof[]): boolean =>
  left.length === right.length && left.every((proof, index) => {
    const other = right[index];
    if (proof.type === 'symbol') {
      return other.type === 'symbol' && proof.path === other.path && proof.symbol === other.symbol && proof.sha256 === other.sha256;
    }
    return other.type === 'file' && proof.path === other.path && proof.sha256 === other.sha256 && proof.origin === other.origin;
  });

const errorCode = (error: unknown): string | undefined =>
  isRecord(error) && typeof error.code === 'string' ? error.code : undefined;

/**
 * Check that the catalogue location cannot leave the workspace through any
 * existing path component, without creating anything. A catalogue that does
 * not exist yet is checked through its deepest existing ancestor.
 */
async function containedCatalogue(realRoot: string, directory: string): Promise<boolean> {
  let probe = directory;
  for (;;) {
    try {
      return !isOutsideWorkspace(realRoot, await realpath(probe));
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') return false;
      const parent = dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
  }
}

type Publication = 'created' | 'conflict';

/**
 * Publish a staged file without ever replacing an existing entry. A hard link
 * is atomic; where the platform cannot create one, an exclusive copy still
 * refuses an existing target.
 */
async function publish(temp: string, target: string): Promise<Publication> {
  try {
    await link(temp, target);
    return 'created';
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EEXIST') return 'conflict';
    if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EOPNOTSUPP') {
      try {
        await copyFile(temp, target, constants.COPYFILE_EXCL);
        return 'created';
      } catch (fallback) {
        if (errorCode(fallback) === 'EEXIST') return 'conflict';
        throw fallback;
      }
    }
    throw error;
  }
}

const removeQuietly = async (target: string): Promise<void> => {
  await unlink(target).catch(() => undefined);
};

/**
 * The single catalogue lock (spec #232, ADR 0049). It is catalogue-wide and
 * not per entry because the canonicalizer marker belongs to no entry: a marker
 * protected by its own conditional lock would be a lock a path can forget.
 * Readers take no lock at all.
 */
export const catalogueLockName = '.catalogue.lock';

const CATALOGUE_LOCK_TIMEOUT_MS = 5000;
const CATALOGUE_LOCK_STALE_MS = 15000;

const sleep = (milliseconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

/**
 * Exclusive creation of the catalogue lock in the catalogue directory, with
 * takeover of a lock left by a crashed writer (age-based, the same pattern as
 * the Run State lock). Every writer — `create` included — takes it, so the
 * entry re-read, the revision comparison, the evidence stability re-check,
 * the temp file and the publication are one critical section.
 */
async function acquireCatalogueLock(directory: string): Promise<string> {
  const lock = join(directory, catalogueLockName);
  const deadline = Date.now() + CATALOGUE_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await open(lock, 'wx');
      await handle.close();
      return lock;
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
      const info = await stat(lock).catch(() => undefined);
      if (info && Date.now() - info.mtimeMs > CATALOGUE_LOCK_STALE_MS) {
        await removeQuietly(lock);
        continue;
      }
      if (Date.now() >= deadline) throw new Error('The Knowledge catalogue is locked by another writer.');
      await sleep(25);
    }
  }
}

async function withCatalogueLock<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const lock = await acquireCatalogueLock(directory);
  try {
    return await action();
  } finally {
    await removeQuietly(lock);
  }
}

/**
 * Deterministic backing signal about published entries, computed from the
 * validated evidence alone: an entry whose published contract cites fewer
 * than two distinct files cannot demonstrate a rule beyond that single path,
 * so it is reported instead of passing as fully backed. The signal is
 * advisory — publication stays successful — and it never refuses, never
 * names a cited path and never names a hash value.
 */
function publishedWarnings(entries: KnowledgePersistableEntry[]): KnowledgeSaveWarning[] {
  return entries.flatMap(entry => {
    const distinctEvidencePaths = new Set(entry.evidence.map(proof => proof.path)).size;
    return distinctEvidencePaths < 2
      ? [{ name: entry.name, code: 'insufficient_backing' as const, distinctEvidencePaths }]
      : [];
  });
}

/**
 * Second read of every declared evidence (spec #233 decision): publication
 * hashes each cited proof once during validation and once again right before
 * staging. A divergence means the workspace changed under the save — the
 * proposal is refused as unstable instead of pinning a fingerprint captured
 * mid-write. Deterministic double read, no locks, no watchers.
 */
async function evidenceIsStable(root: string, entries: KnowledgePersistableEntry[]): Promise<boolean> {
  for (const entry of entries) {
    for (const proof of entry.evidence) {
      if (proof.type === 'symbol') {
        const hashed = await hashWorkspaceSymbol(root, proof.path, proof.symbol);
        if (hashed.status !== 'ok' || hashed.sha256 !== proof.sha256) return false;
      } else {
        const hashed = await hashWorkspaceFile(root, proof.path);
        if (hashed.status !== 'ok' || hashed.sha256 !== proof.sha256) return false;
      }
    }
  }
  return true;
}

/**
 * The `append` critical section, run under the catalogue lock: re-read the
 * entry, compare the revision that was read, re-verify the historical
 * contract and the new proofs, merge the evidence, compose the body and
 * publish by atomic rename. A refusal writes nothing and leaves no residue.
 */
async function appendToEntry(realRoot: string, directory: string, append: ValidatedAppend): Promise<KnowledgeSaveResult> {
  const { name } = append;
  const target = join(directory, `${name}.md`);
  let bytes: Buffer;
  try {
    bytes = await readFile(target);
  } catch (error) {
    // An append enriches an entry that exists; `create` is the mode that adds
    // one, so an absent name is not silently promoted to a creation.
    return errorCode(error) === 'ENOENT'
      ? { status: 'invalid', rejected: [{ name, reason: 'unknown_entry' }] }
      : { status: 'invalid', rejected: [{ name, reason: 'catalogue_unusable' }] };
  }
  if (knowledgeRevision(bytes) !== append.expectedRevision) {
    return { status: 'conflict', conflicts: [{ name, reason: 'revision_conflict' }] };
  }

  // The historical entry has to be true before anything is stacked on it. An
  // unreadable contract and a proof that no longer verifies are the same
  // answer here — stale evidence, whose repair is `replace` — and never the
  // proposal's own evidence reasons: the caller supplied no historical proof.
  const stale: KnowledgeSaveResult = { status: 'invalid', rejected: [{ name, reason: 'stale_evidence' }] };
  const historical = parseKnowledge(bytes.toString('utf8'), `${name}.md`);
  if (historical.status !== 'valid') return stale;
  // A proof re-cited with another digest is refused as a divergence before the
  // historical contract is judged: an append may add coverage, never re-anchor
  // a fingerprint nobody confirmed. A historical proof that merely stopped
  // verifying is the stale case below.
  const merged = mergeEvidence(historical.evidence, append.evidence);
  if (!merged.ok) return { status: 'invalid', rejected: [{ name, reason: merged.reason }] };

  // The resulting entry carries the historical symbol proofs too, so an engine
  // change refuses the write exactly as it refuses a creation or a rewrite.
  if (merged.evidence.some(proof => proof.type === 'symbol')) {
    const stored = await readCatalogueCanonicalizer(directory);
    if (stored && stored !== knowledgeCanonicalizer) {
      return { status: 'invalid', rejected: [{ reason: 'engine_changed' }] };
    }
  }

  // Every historical proof is re-verified, not only the new ones.
  const verified = await verifyKnowledge(historical, realRoot);
  if (verified.status !== 'valid') return stale;

  const body = appendedBody(historical.body, append.addition);
  // `no_change` is a literal decision only: nothing new in the body and
  // nothing new in the evidence. No fuzzy deduplication, no judgement.
  if (merged.added === 0 && (body === historical.body || historical.body.endsWith(append.addition))) {
    return { status: 'no_change' };
  }

  const entry: KnowledgePersistableEntry = {
    name: historical.name,
    description: historical.description,
    body,
    evidence: merged.evidence
  };
  // The read grammar stays the only grammar: an appended entry that does not
  // read back exactly — name, description, body, evidence traces — is refused
  // instead of published. The historical description is carried, never
  // re-invented: an append cannot rewrite who the entry is.
  const roundTrip = parseKnowledge(serializeKnowledgeEntry(entry), `${entry.name}.md`);
  if (roundTrip.status !== 'valid' || roundTrip.name !== entry.name || roundTrip.description !== entry.description ||
    roundTrip.body !== body || !sameEvidence(roundTrip.evidence, entry.evidence)) {
    return { status: 'invalid', rejected: [{ name, reason: 'malformed_entry' }] };
  }
  // The second read of every cited proof, historical ones included.
  if (!(await evidenceIsStable(realRoot, [entry]))) {
    return { status: 'invalid', rejected: [{ name, reason: 'unstable_evidence' }] };
  }

  const temp = join(directory, `.${name}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, serializeKnowledgeEntry(entry), { flag: 'wx' });
    // Atomic replacement from the temp file, with no prior delete: a reader
    // sees the historical whole file or the appended whole file.
    await rename(temp, target);
  } finally {
    await removeQuietly(temp);
  }
  // `append` never introduces `insufficient_backing`: adding a proof on an
  // already cited path cannot lower the distinct-path count, and a thin entry
  // was already reported when it was created.
  return { status: 'appended', appended: [name], warnings: [] };
}

/**
 * Validate and persist a whole proposal. Validation, duplicate detection and
 * conflict detection all run before the first byte is staged; staging files
 * are removed on every path and publication rolls back if a late conflict
 * appears, so no failure publishes a subset.
 */
export async function saveKnowledgeProposal(root: string, proposal: unknown): Promise<KnowledgeSaveResult> {
  if (!isRecord(proposal) || Object.keys(proposal).some(key => key !== 'entries' && key !== 'mode') || !Array.isArray(proposal.entries)) {
    return { status: 'invalid', rejected: [{ reason: 'malformed_proposal' }] };
  }
  const mode = proposal.mode === undefined ? 'create' : proposal.mode;
  if (mode !== 'create' && mode !== 'append' && mode !== 'replace') {
    return { status: 'invalid', rejected: [{ reason: 'unknown_mode' }] };
  }
  if (proposal.entries.length === 0) return { status: 'no-op' };
  // The documented `entries` array is the single call form for every mode; an
  // append or a rewrite operates on one entry, so a longer array is refused by
  // an explicit reason instead of a partial multi-entry write.
  if (mode !== 'create' && proposal.entries.length > 1) {
    return { status: 'invalid', rejected: [{ reason: 'mode_requires_single_entry' }] };
  }

  const realRoot = await realpath(root).catch(() => undefined);
  if (!realRoot) return { status: 'invalid', rejected: [{ reason: 'catalogue_unusable' }] };
  const directory = knowledgeDirectory(realRoot);
  if (!(await containedCatalogue(realRoot, directory))) {
    return { status: 'invalid', rejected: [{ reason: 'catalogue_unusable' }] };
  }

  const seen = new Set<string>();
  const validated: KnowledgePersistableEntry[] = [];
  const appends: ValidatedAppend[] = [];
  const rejected: KnowledgeSaveRejection[] = [];
  const revisionConflicts: KnowledgeNameConflict[] = [];
  const expectedRevisions = new Map<string, string>();
  const fallbackWarnings: KnowledgeSaveWarning[] = [];
  for (const raw of proposal.entries) {
    if (mode === 'append') {
      const validation = await validateAppendEntry(realRoot, raw, seen);
      if (validation.ok) {
        appends.push(validation);
      } else if (validation.reason === 'revision_conflict') {
        revisionConflicts.push({ name: validation.name, reason: 'revision_conflict' });
      } else {
        rejected.push(validation.name === undefined ? { reason: validation.reason } : { name: validation.name, reason: validation.reason });
      }
      continue;
    }
    const validation = await validateEntry(realRoot, raw, seen, mode);
    if (validation.ok) {
      validated.push(validation.entry);
      fallbackWarnings.push(...validation.warnings);
      if (validation.expectedRevision !== undefined) expectedRevisions.set(validation.entry.name, validation.expectedRevision);
    } else if (validation.reason === 'revision_conflict') {
      // An absent revision is a compare-and-swap conflict, never a malformed
      // proposal: the corrective action is to re-read the entry.
      revisionConflicts.push({ name: validation.name, reason: 'revision_conflict' });
    } else {
      rejected.push(validation.name === undefined ? { reason: validation.reason } : { name: validation.name, reason: validation.reason });
    }
  }
  if (revisionConflicts.length > 0) return { status: 'conflict', conflicts: revisionConflicts };
  if (rejected.length > 0) return { status: 'invalid', rejected };

  // `create` refuses an existing name before staging anything. The lock is
  // taken afterwards and the exclusive-link publication re-checks it, so this
  // early answer can only save work, never publish over an entry.
  if (mode === 'create') {
    const conflicts: KnowledgeNameConflict[] = [];
    for (const entry of validated) {
      try {
        await lstat(join(directory, `${entry.name}.md`));
        conflicts.push({ name: entry.name, reason: 'name_conflict' });
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') return { status: 'invalid', rejected: [{ name: entry.name, reason: 'catalogue_unusable' }] };
      }
    }
    if (conflicts.length > 0) return { status: 'conflict', conflicts };
  }

  try {
    await mkdir(directory, { recursive: true });
    if (isOutsideWorkspace(realRoot, await realpath(directory))) {
      return { status: 'invalid', rejected: [{ reason: 'catalogue_unusable' }] };
    }
  } catch {
    return { status: 'invalid', rejected: [{ reason: 'catalogue_unusable' }] };
  }

  // One critical section for the three modes: re-read, revision comparison,
  // evidence stability re-check, temp file and publication. The canonicalizer
  // marker is written inside it too, so two symbolic writers can never race it.
  return withCatalogueLock(directory, async () => {
    if (mode === 'append') return appendToEntry(realRoot, directory, appends[0]);
    if (mode === 'replace') {
      const entry = validated[0];
      const target = join(directory, `${entry.name}.md`);
      let bytes: Buffer;
      try {
        bytes = await readFile(target);
      } catch (error) {
        // `replace` rewrites, it never upserts.
        if (errorCode(error) === 'ENOENT') return { status: 'invalid', rejected: [{ name: entry.name, reason: 'unknown_entry' }] };
        return { status: 'invalid', rejected: [{ name: entry.name, reason: 'catalogue_unusable' }] };
      }
      if (knowledgeRevision(bytes) !== expectedRevisions.get(entry.name)) {
        return { status: 'conflict', conflicts: [{ name: entry.name, reason: 'revision_conflict' }] };
      }
    }

    // An engine change refuses symbol-proof writes only: file proofs do not
    // depend on the canonicalizer identity at all (spec #233 / ADR 0046). A
    // repair rewrite carrying `symbol` proofs is refused like a creation;
    // repairing then uses `file` proofs.
    const hasSymbolProofs = validated.some(entry => entry.evidence.some(proof => proof.type === 'symbol'));
    if (hasSymbolProofs) {
      const stored = await readCatalogueCanonicalizer(directory);
      if (stored && stored !== knowledgeCanonicalizer) {
        return { status: 'invalid', rejected: [{ reason: 'engine_changed' }] };
      }
    }

    // The second read of every cited proof: refuse a proposal whose workspace
    // moved under it instead of pinning a mid-write fingerprint.
    if (!(await evidenceIsStable(realRoot, validated))) {
      return { status: 'invalid', rejected: validated.map(entry => ({ name: entry.name, reason: 'unstable_evidence' as const })) };
    }

    const staged: Array<{ name: string; temp: string; target: string }> = [];
    const published: string[] = [];
    try {
      for (const entry of validated) {
        const temp = join(directory, `.${entry.name}.${randomUUID()}.tmp`);
        await writeFile(temp, serializeKnowledgeEntry(entry), { flag: 'wx' });
        staged.push({ name: entry.name, temp, target: join(directory, `${entry.name}.md`) });
      }
      if (mode === 'replace') {
        // Atomic replacement from the temp file, with no prior delete: a
        // reader sees the old whole file or the new whole file, and a failed
        // rename leaves the previous entry in place.
        await rename(staged[0].temp, staged[0].target);
        published.push(staged[0].target);
      } else {
        const lateConflicts: KnowledgeNameConflict[] = [];
        for (const item of staged) {
          if (await publish(item.temp, item.target) === 'conflict') {
            lateConflicts.push({ name: item.name, reason: 'name_conflict' });
          } else {
            published.push(item.target);
          }
        }
        if (lateConflicts.length > 0) {
          await Promise.allSettled(published.map(removeQuietly));
          return { status: 'conflict', conflicts: lateConflicts };
        }
      }
      if (hasSymbolProofs) {
        // Stamp the catalogue with the canonicalizer identity that produced its
        // symbol fingerprints; an existing marker never changes here.
        const marker = join(directory, catalogueCanonicalizerName);
        try { await access(marker); }
        catch { try { await writeFile(marker, `${knowledgeCanonicalizer}\n`); } catch { /* advisory marker only */ } }
      }
      const warnings = [...publishedWarnings(validated), ...fallbackWarnings];
      return mode === 'replace'
        ? { status: 'replaced', replaced: validated.map(entry => entry.name), warnings }
        : { status: 'saved', saved: validated.map(entry => entry.name), warnings };
    } catch (error) {
      await Promise.allSettled(published.map(removeQuietly));
      throw error;
    } finally {
      await Promise.allSettled(staged.map(item => removeQuietly(item.temp)));
    }
  });
}
