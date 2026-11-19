import { createHash, timingSafeEqual } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { z } from 'zod';
import { validateKnowledgeName } from './name';

/**
 * A Knowledge entry (spec #219): one Markdown file in the `knowledge` memory
 * catalogue. Its frontmatter declares a name, a description and a nonempty
 * evidence list; the free-form Markdown body after the closing `---` is what
 * `memory_read` returns once the whole evidence contract has been verified.
 * The name is a safe flat Knowledge name equal to the file name, so
 * discovery presents entries by name and description only.
 */
export interface KnowledgeMetadata {
  name: string;
  description: string;
}

/** A `file` proof pins the deterministic SHA-256 of the cited file bytes. */
export interface KnowledgeFileProof {
  type: 'file';
  /** Workspace-relative path of the cited file. */
  path: string;
  /** Deterministic SHA-256 of the cited file bytes. */
  sha256: string;
}

/** `symbol` proofs are part of the catalogue grammar but unsupported by this prototype. */
export interface KnowledgeSymbolProof {
  type: 'symbol';
}

export type KnowledgeProof = KnowledgeFileProof | KnowledgeSymbolProof;

export interface KnowledgeEntry extends KnowledgeMetadata {
  evidence: KnowledgeProof[];
  body: string;
}

/**
 * Rejection causes of a Knowledge read. The model only ever sees the generic
 * `invalid` result; the machine-readable reason stays in the harness trace,
 * with no body content, no cited path and no hash value.
 */
export type KnowledgeFailureReason =
  | 'malformed_contract'
  | 'unsupported_proof'
  | 'file_missing'
  | 'file_hash_mismatch'
  | 'path_outside_workspace'
  | 'symlink_escape'
  | 'unknown_entry';

/** Outcome of a Knowledge read: the validated Markdown body, or a typed refusal. */
export type KnowledgeValidation =
  | { status: 'valid'; name: string; description: string; body: string; evidence: KnowledgeFileProof[] }
  | { status: 'invalid'; reason: KnowledgeFailureReason };

const fileProofSchema = z.object({
  type: z.literal('file'),
  path: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
}).strict();

const symbolProofSchema = z.object({ type: z.literal('symbol') }).strict();

const proofSchema = z.union([fileProofSchema, symbolProofSchema]);

const frontmatterSchema = z.object({
  name: z.string(),
  description: z.string().min(1),
  evidence: z.array(proofSchema).min(1),
}).strict();

/** Location of the Knowledge catalogue inside one workspace. */
export const knowledgeDirectory = (root: string): string => join(root, '.tours', '.memory', 'knowledge');

/** Deterministic SHA-256 of the cited file bytes (the preparation helper). */
export const fileProofHash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Strip one optional layer of matching single or double quotes from a scalar value. */
const stripQuotes = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ? trimmed.slice(1, -1)
    : trimmed;
};

const KEY_PATTERN = /^[A-Za-z][\w-]*$/;

const parsePair = (text: string): { key: string; value: string } | undefined => {
  const separator = text.indexOf(':');
  if (separator <= 0) return undefined;
  const key = text.slice(0, separator).trim();
  if (!KEY_PATTERN.test(key)) return undefined;
  return { key, value: stripQuotes(text.slice(separator + 1)) };
};

/**
 * Restricted YAML-subset parser for the Knowledge frontmatter: flat scalars
 * (`key: value`) plus one `evidence:` sequence of `- key: value` items.
 * Anything outside this grammar (nested structures, tabs, duplicated keys,
 * an inline evidence map…) is a malformed contract. The catalogue format is
 * fixed here, so validation stays deterministic without a YAML engine.
 */
function parseFrontmatter(lines: string[]): Record<string, unknown> | undefined {
  const scalars: Record<string, string> = {};
  let evidence: Array<Record<string, string>> | undefined;
  let itemIndent = -1;
  let current: Record<string, string> | undefined;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const inline = line.trimStart();
    if (inline.startsWith('- ')) {
      if (evidence === undefined || indent === 0) return undefined;
      if (itemIndent === -1) itemIndent = indent;
      if (indent !== itemIndent) return undefined;
      const pair = parsePair(inline.slice(2).trim());
      // Every item opens fresh; duplicate keys come from continuations only.
      if (!pair || !pair.value) return undefined;
      current = { [pair.key]: pair.value };
      evidence.push(current);
      continue;
    }
    if (indent === 0) {
      const pair = parsePair(line);
      if (!pair) return undefined;
      if (pair.key === 'evidence') {
        if (evidence !== undefined) return undefined;
        if (pair.value === '[]') { evidence = []; current = undefined; itemIndent = -1; continue; }
        // An inline evidence value other than an empty list is not part of the grammar.
        if (pair.value) return undefined;
        evidence = [];
        current = undefined;
        itemIndent = -1;
        continue;
      }
      if (!pair.value || pair.key in scalars) return undefined;
      scalars[pair.key] = pair.value;
      continue;
    }
    // Continuation: the keys of the current evidence item, deeper than its `- ` marker.
    if (evidence === undefined || !current || itemIndent === -1 || indent <= itemIndent) return undefined;
    const pair = parsePair(line.trim());
    if (!pair || !pair.value || pair.key in current) return undefined;
    current[pair.key] = pair.value;
  }
  if (!evidence) return undefined;
  return { ...scalars, evidence };
}

/**
 * Parse one Knowledge file: the static contract only, never the workspace —
 * malformed frontmatter, an oversized or missing body, a name that is not an
 * safe name equal to the file name, or a nonempty-but-unsupported evidence
 * item (`symbol`) are refused here, before any evidence is verified.
 */
export function parseKnowledge(source: string, fileName: string): KnowledgeValidation {
  const lines = source.split('\n').map(line => line.replace(/\r$/, ''));
  if (lines[0]?.trim() !== '---') return { status: 'invalid', reason: 'malformed_contract' };
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closing === -1) return { status: 'invalid', reason: 'malformed_contract' };
  const body = lines.slice(closing + 1).join('\n');
  if (!body.trim()) return { status: 'invalid', reason: 'malformed_contract' };
  const frontmatter = parseFrontmatter(lines.slice(1, closing));
  if (!frontmatter) return { status: 'invalid', reason: 'malformed_contract' };
  const parsed = frontmatterSchema.safeParse(frontmatter);
  if (!parsed.success) return { status: 'invalid', reason: 'malformed_contract' };
  const { name, description, evidence } = parsed.data;
  if (!validateKnowledgeName(name).ok) return { status: 'invalid', reason: 'malformed_contract' };
  if (name !== fileName.replace(/\.md$/, '')) return { status: 'invalid', reason: 'malformed_contract' };
  // `symbol` items match the known grammar but can never verify in this
  // prototype: refuse the entry up front instead of failing at read time.
  if (evidence.some(proof => proof.type !== 'file')) return { status: 'invalid', reason: 'unsupported_proof' };
  return {
    status: 'valid',
    name,
    description,
    body,
    evidence: evidence.filter((proof): proof is KnowledgeFileProof => proof.type === 'file'),
  };
}

const sameHash = (declared: string, computed: string): boolean => {
  const declaredBuffer = Buffer.from(declared.toLowerCase(), 'hex');
  const computedBuffer = Buffer.from(computed.toLowerCase(), 'hex');
  return declaredBuffer.length === computedBuffer.length && timingSafeEqual(declaredBuffer, computedBuffer);
};

/**
 * True when `target` is not strictly inside `root`. Every workspace path rule
 * (verification, hashing and persistence) shares this single check.
 */
export const isOutsideWorkspace = (root: string, target: string): boolean => {
  const confined = relative(root, target);
  return confined === '..' || confined.startsWith(`..${sep}`) || isAbsolute(confined);
};

const escapes = isOutsideWorkspace;

/**
 * Deterministic verification of a parsed Knowledge entry. EVERY declared
 * `file` proof is checked — never a sample — before the body is returned:
 * the declared path must stay inside the workspace, must not escape through a
 * symbolic link, and the cited regular file's bytes must hash to the declared
 * SHA-256. The first failing proof stops the check with its reason; no
 * content, path or hash value ever leaves this module with the refusal.
 */
export async function verifyKnowledge(entry: Extract<KnowledgeValidation, { status: 'valid' }>, root: string): Promise<KnowledgeValidation> {
  let realRoot: string;
  try { realRoot = await realpath(root); }
  catch { return { status: 'invalid', reason: 'file_missing' }; }
  for (const proof of entry.evidence) {
    if (proof.type !== 'file') return { status: 'invalid', reason: 'unsupported_proof' };
    if (isAbsolute(proof.path) || proof.path.includes('\0')) return { status: 'invalid', reason: 'path_outside_workspace' };
    const target = resolve(realRoot, proof.path);
    if (escapes(realRoot, target)) return { status: 'invalid', reason: 'path_outside_workspace' };
    let real: string;
    try { real = await realpath(target); }
    catch { return { status: 'invalid', reason: 'file_missing' }; }
    // A symbolic link resolving outside the workspace is refused regardless of the bytes it reaches.
    if (escapes(realRoot, real)) return { status: 'invalid', reason: 'symlink_escape' };
    let bytes: Buffer;
    try {
      const info = await stat(real);
      if (!info.isFile()) return { status: 'invalid', reason: 'file_missing' };
      bytes = await readFile(real);
    } catch { return { status: 'invalid', reason: 'file_missing' }; }
    if (!sameHash(proof.sha256, fileProofHash(bytes))) return { status: 'invalid', reason: 'file_hash_mismatch' };
  }
  return entry;
}

/** Refusal causes of a deterministic path hash, with no bytes and no resolved location. */
export type KnowledgePathHash =
  | { status: 'ok'; path: string; sha256: string }
  | { status: 'absent'; reason: 'file_missing' }
  | { status: 'invalid'; reason: 'path_outside_workspace' | 'symlink_escape' | 'not_a_file' };

/**
 * Deterministic hash of one workspace-relative path, using the exact same
 * confinement rules as Knowledge verification: absolute or `..` paths and
 * symbolic links resolving outside the workspace are refused, a missing file
 * is an absence and a non-regular file is invalid. The returned `path` is the
 * resolved workspace-relative spelling a caller can cite as evidence.
 */
export async function hashWorkspaceFile(root: string, path: string): Promise<KnowledgePathHash> {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\0')) {
    return { status: 'invalid', reason: 'path_outside_workspace' };
  }
  let realRoot: string;
  try { realRoot = await realpath(root); }
  catch { return { status: 'absent', reason: 'file_missing' }; }
  const target = resolve(realRoot, path);
  if (escapes(realRoot, target)) return { status: 'invalid', reason: 'path_outside_workspace' };
  let real: string;
  try { real = await realpath(target); }
  catch { return { status: 'absent', reason: 'file_missing' }; }
  if (escapes(realRoot, real)) return { status: 'invalid', reason: 'symlink_escape' };
  let info;
  try { info = await stat(real); }
  catch { return { status: 'absent', reason: 'file_missing' }; }
  if (!info.isFile()) return { status: 'invalid', reason: 'not_a_file' };
  let bytes: Buffer;
  try { bytes = await readFile(real); }
  catch { return { status: 'absent', reason: 'file_missing' }; }
  return { status: 'ok', path: relative(realRoot, real).split(sep).join('/'), sha256: fileProofHash(bytes) };
}

export interface KnowledgeLibrary {
  /** Discoverable entries: name and description only, sorted by name. */
  catalog(): Promise<KnowledgeMetadata[]>;
  /** Catalogue filtered by a literal case-insensitive name/description substring. */
  list(query?: string): Promise<KnowledgeMetadata[]>;
  /** Deterministic read: verifies the whole declared evidence contract first. */
  read(name: string): Promise<KnowledgeValidation>;
}

/**
 * Open the `knowledge` catalogue of one workspace: a flat directory of
 * `<name>.md` entries. A missing or unreadable catalogue is an empty library
 * and never breaks an ordinary search; every read verifies the whole declared
 * evidence contract before the body is returned.
 */
export async function loadKnowledgeLibrary(root: string, directory: string): Promise<KnowledgeLibrary> {
  const realRoot = await realpath(root).catch(() => undefined);
  const realDirectory = realRoot ? await realpath(directory).catch(() => undefined) : undefined;
  const usable = (): string | undefined => realRoot && realDirectory && !escapes(realRoot, realDirectory) ? realDirectory : undefined;
  const readEntryFile = async (name: string): Promise<{ status: 'valid'; source: string } | { status: 'invalid'; reason: KnowledgeFailureReason }> => {
    // A catalogue name is a safe flat name (the file-name rule), which
    // also keeps every lookup inside the flat catalogue directory.
    if (!validateKnowledgeName(name).ok) return { status: 'invalid', reason: 'malformed_contract' };
    const dir = usable();
    if (!dir) return { status: 'invalid', reason: 'unknown_entry' };
    let real: string;
    try { real = await realpath(join(dir, `${name}.md`)); }
    catch { return { status: 'invalid', reason: 'unknown_entry' }; }
    if (escapes(realRoot!, real)) return { status: 'invalid', reason: 'symlink_escape' };
    try {
      const info = await stat(real);
      if (!info.isFile()) return { status: 'invalid', reason: 'unknown_entry' };
      return { status: 'valid', source: (await readFile(real)).toString('utf8') };
    } catch { return { status: 'invalid', reason: 'unknown_entry' }; }
  };
  const library: KnowledgeLibrary = {
    catalog: async () => {
      const dir = usable();
      if (!dir) return [];
      let files: string[];
      try { files = (await readdir(dir)).filter(file => file.endsWith('.md')).sort(); }
      catch { return []; }
      const metadata: KnowledgeMetadata[] = [];
      for (const file of files) {
        const stem = file.slice(0, -3);
        try {
          const entryFile = await readEntryFile(stem);
          if (entryFile.status !== 'valid') continue;
          const parsed = parseKnowledge(entryFile.source, stem);
          if (parsed.status === 'valid') metadata.push({ name: parsed.name, description: parsed.description });
        } catch { /* an invalid or unreadable entry never breaks discovery */ }
      }
      return metadata;
    },
    list: async query => {
      const entries = await library.catalog();
      if (!query) return entries;
      const lowerQuery = query.toLowerCase();
      return entries.filter(entry => `${entry.name} ${entry.description}`.toLowerCase().includes(lowerQuery));
    },
    read: async name => {
      if (typeof name !== 'string' || !validateKnowledgeName(name).ok) return { status: 'invalid', reason: 'malformed_contract' };
      const entryFile = await readEntryFile(name);
      if (entryFile.status !== 'valid') return entryFile;
      const parsed = parseKnowledge(entryFile.source, name);
      if (parsed.status !== 'valid') return parsed;
      return verifyKnowledge(parsed, root);
    }
  };
  return library;
}
