import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  hashWorkspaceFile,
  isOutsideWorkspace,
  knowledgeDirectory,
  parseKnowledge,
  type KnowledgeFileProof
} from './knowledge';
import { validateCanonicalName } from './name';

/**
 * Deterministic persistence of Knowledge entries (spec #223, ticket #225).
 *
 * A proposal is validated in full before anything is written: names,
 * descriptions and bodies follow the read grammar, every cited file must stay
 * inside the workspace, avoid symlink escapes and either declare its exact
 * SHA-256 or receive a computed one. Any invalid entry or any existing
 * `<name>.md` refuses the whole proposal, so publication is never partial.
 * Writes are staged in the catalogue directory and published by hard link,
 * which is atomic and can never overwrite an existing entry.
 */

/** One evidence item as declared by a proposal; `sha256` is optional. */
export interface KnowledgeProposalFileProof {
  /** Only `file` proofs are supported; any other value is refused. */
  type?: 'file';
  /** Workspace-relative path of the cited file. */
  path: string;
  /** Optional declared SHA-256, verified against the cited bytes. */
  sha256?: string;
}

export interface KnowledgeProposalEntry {
  name: string;
  description: string;
  body: string;
  evidence: KnowledgeProposalFileProof[];
}

/** The documented proposal file: `{"entries":[...]}` and nothing else. */
export interface KnowledgeProposal {
  entries: KnowledgeProposalEntry[];
}

/** A concrete entry ready to serialize, with verified evidence. */
export interface KnowledgePersistableEntry {
  name: string;
  description: string;
  body: string;
  evidence: KnowledgeFileProof[];
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
  | 'catalogue_unusable';

export interface KnowledgeSaveRejection {
  name?: string;
  reason: KnowledgeSaveRejectionReason;
}

export interface KnowledgeNameConflict {
  name: string;
  reason: 'name_conflict';
}

export type KnowledgeSaveResult =
  | { status: 'saved'; saved: string[] }
  | { status: 'no-op' }
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
    lines.push('  - type: file', `    path: ${proof.path}`, `    sha256: ${proof.sha256}`);
  }
  lines.push('---');
  return `${lines.join('\n')}\n${entry.body}`;
}

interface ProposalFailure {
  ok: false;
  name?: string;
  reason: KnowledgeSaveRejectionReason;
}

type ProposalValidation = { ok: true; entry: KnowledgePersistableEntry } | ProposalFailure;

const failure = (reason: KnowledgeSaveRejectionReason, name?: string): ProposalFailure =>
  name === undefined ? { ok: false, reason } : { ok: false, name, reason };

const PROVIDED_HASH = /^[0-9a-fA-F]{64}$/;

const EVIDENCE_KEYS = new Set(['type', 'path', 'sha256']);

/**
 * Validate one proposal entry against the read grammar and the workspace, then
 * verify its evidence. Every refusal is a single deterministic reason; a
 * round-trip through `parseKnowledge` proves the serialized file reads back
 * with exactly the declared name, description, body and normalized evidence.
 */
async function validateEntry(root: string, raw: unknown, seen: Set<string>): Promise<ProposalValidation> {
  if (!isRecord(raw)) return failure('malformed_entry');
  const rawName = typeof raw.name === 'string' && raw.name ? raw.name : undefined;
  if (Object.keys(raw).some(key => !['name', 'description', 'body', 'evidence'].includes(key))) {
    return failure('malformed_entry', rawName);
  }
  if (typeof raw.name !== 'string' || !validateCanonicalName(raw.name).ok) return failure('invalid_name', rawName);
  const name = raw.name;
  if (seen.has(name)) return failure('duplicate_name', name);
  seen.add(name);

  if (typeof raw.description !== 'string') return failure('invalid_description', name);
  const description = raw.description.trim();
  if (!description || /[\r\n]/.test(description)) return failure('invalid_description', name);

  if (typeof raw.body !== 'string' || !raw.body.trim() || raw.body.includes('\r')) return failure('invalid_body', name);
  const body = raw.body;

  if (!Array.isArray(raw.evidence) || raw.evidence.length === 0) return failure('missing_evidence', name);

  const evidence: KnowledgeFileProof[] = [];
  for (const item of raw.evidence) {
    if (!isRecord(item) || Object.keys(item).some(key => !EVIDENCE_KEYS.has(key))) {
      return failure('malformed_evidence', name);
    }
    if ('type' in item && item.type !== 'file') return failure('unsupported_proof', name);
    const cited = typeof item.path === 'string' ? item.path.trim() : '';
    if (!cited || /[\r\n]/.test(cited)) return failure('malformed_evidence', name);
    let declared: string | undefined;
    if (item.sha256 !== undefined) {
      if (typeof item.sha256 !== 'string' || !PROVIDED_HASH.test(item.sha256)) return failure('malformed_evidence', name);
      declared = item.sha256.toLowerCase();
    }
    const hashed = await hashWorkspaceFile(root, cited);
    if (hashed.status === 'absent') return failure('file_missing', name);
    if (hashed.status === 'invalid') return failure(hashed.reason, name);
    if (declared !== undefined && declared !== hashed.sha256) return failure('file_hash_mismatch', name);
    evidence.push({ type: 'file', path: hashed.path, sha256: hashed.sha256 });
  }

  const entry: KnowledgePersistableEntry = { name, description, body, evidence };
  // The read grammar is the contract: if serialization cannot be read back
  // exactly, the entry is refused instead of publishing an ambiguous file.
  const parsed = parseKnowledge(serializeKnowledgeEntry(entry), `${name}.md`);
  if (parsed.status !== 'valid') return failure('malformed_entry', name);
  if (parsed.name !== name) return failure('invalid_name', name);
  if (parsed.description !== description) return failure('invalid_description', name);
  if (parsed.body !== body) return failure('invalid_body', name);
  if (parsed.evidence.length !== evidence.length || parsed.evidence.some((proof, index) =>
    proof.path !== evidence[index].path || proof.sha256 !== evidence[index].sha256
  )) {
    return failure('malformed_evidence', name);
  }
  return { ok: true, entry };
}

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
 * Validate and persist a whole proposal. Validation, duplicate detection and
 * conflict detection all run before the first byte is staged; staging files
 * are removed on every path and publication rolls back if a late conflict
 * appears, so no failure publishes a subset.
 */
export async function saveKnowledgeProposal(root: string, proposal: unknown): Promise<KnowledgeSaveResult> {
  if (!isRecord(proposal) || Object.keys(proposal).some(key => key !== 'entries') || !Array.isArray(proposal.entries)) {
    return { status: 'invalid', rejected: [{ reason: 'malformed_proposal' }] };
  }
  if (proposal.entries.length === 0) return { status: 'no-op' };

  const realRoot = await realpath(root).catch(() => undefined);
  if (!realRoot) return { status: 'invalid', rejected: [{ reason: 'catalogue_unusable' }] };
  const directory = knowledgeDirectory(realRoot);
  if (!(await containedCatalogue(realRoot, directory))) {
    return { status: 'invalid', rejected: [{ reason: 'catalogue_unusable' }] };
  }

  const seen = new Set<string>();
  const validated: KnowledgePersistableEntry[] = [];
  const rejected: KnowledgeSaveRejection[] = [];
  for (const raw of proposal.entries) {
    const validation = await validateEntry(realRoot, raw, seen);
    if (validation.ok) validated.push(validation.entry);
    else rejected.push(validation.name === undefined ? { reason: validation.reason } : { name: validation.name, reason: validation.reason });
  }
  if (rejected.length > 0) return { status: 'invalid', rejected };

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

  try {
    await mkdir(directory, { recursive: true });
    if (isOutsideWorkspace(realRoot, await realpath(directory))) {
      return { status: 'invalid', rejected: [{ reason: 'catalogue_unusable' }] };
    }
  } catch {
    return { status: 'invalid', rejected: [{ reason: 'catalogue_unusable' }] };
  }

  const staged: Array<{ name: string; temp: string; target: string }> = [];
  const published: string[] = [];
  try {
    for (const entry of validated) {
      const temp = join(directory, `.${entry.name}.${randomUUID()}.tmp`);
      await writeFile(temp, serializeKnowledgeEntry(entry), { flag: 'wx' });
      staged.push({ name: entry.name, temp, target: join(directory, `${entry.name}.md`) });
    }
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
    return { status: 'saved', saved: validated.map(entry => entry.name) };
  } catch (error) {
    await Promise.allSettled(published.map(removeQuietly));
    throw error;
  } finally {
    await Promise.allSettled(staged.map(item => removeQuietly(item.temp)));
  }
}
