import { createHash, timingSafeEqual } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { z } from 'zod';
import { validateKnowledgeName } from './name';
import { knowledgeCanonicalizer, treeSitterSymbolFingerprinter } from './symbol-fingerprint';

/**
 * A Knowledge entry (spec #219): one Markdown file in the `knowledge` memory
 * catalogue. Its frontmatter declares a name, a description and a nonempty
 * evidence list; the free-form Markdown body after the closing `---` is what
 * `memory_read` returns once the whole evidence contract has been verified.
 * The name is a safe flat Knowledge name equal to the file name, so
 * discovery presents entries by name, description and revision only.
 */
export interface KnowledgeMetadata {
  name: string;
  description: string;
  /**
   * Knowledge Revision of the entry file (ADR 0048): the SHA-256 of its
   * complete bytes, as an opaque token. Opaque on purpose — nothing of the
   * body, of a cited path or of a source hash is derivable from it.
   */
  revision: string;
}

/** A `file` proof pins the deterministic SHA-256 of the cited file bytes. */
export interface KnowledgeFileProof {
  type: 'file';
  /** Workspace-relative path of the cited file. */
  path: string;
  /** Deterministic SHA-256 of the cited file bytes. */
  sha256: string;
  /**
   * How this proof came to be. Absent for deliberate file proofs; set at
   * creation only when a requested symbol proof was substituted (spec #233:
   * the fallback exists at creation, never silently at read).
   */
  origin?: 'symbol_fallback';
}

/** A `symbol` proof pins the deterministic SHA-256 of the cited symbol's canonical span (spec #233). */
export interface KnowledgeSymbolProof {
  type: 'symbol';
  /** Workspace-relative path of the file carrying the symbol. */
  path: string;
  /** Qualified name of the cited symbol, resolved uniquely within the cited file. */
  symbol: string;
  /** Deterministic SHA-256 of the symbol's canonical (comment- and presentation-stripped) span. */
  sha256: string;
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
  | 'unknown_entry'
  | 'symbol_unresolved'
  | 'symbol_ambiguous'
  | 'unsupported_language'
  | 'symbol_hash_mismatch'
  | 'engine_changed';

/**
 * Outcome of a Knowledge read: the validated Markdown body with its revision,
 * or a typed refusal. A refusal carries the revision whenever the entry file
 * itself was readable — that is what makes an invalid entry repairable without
 * ever serving its body — and none when there is no entry file to hash
 * (`unknown_entry`, `symlink_escape`, a malformed name).
 */
export type KnowledgeValidation =
  | { status: 'valid'; name: string; description: string; body: string; evidence: KnowledgeProof[]; revision: string }
  | { status: 'invalid'; reason: KnowledgeFailureReason; revision?: string };

/**
 * Static outcome of parsing one Knowledge file: the read outcome minus the
 * revision, which only the file bytes can supply.
 */
export type KnowledgeParseResult =
  | Omit<Extract<KnowledgeValidation, { status: 'valid' }>, 'revision'>
  | Extract<KnowledgeValidation, { status: 'invalid' }>;

const fileProofSchema = z.object({
  type: z.literal('file'),
  path: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
  origin: z.literal('symbol_fallback').optional(),
}).strict();

const symbolProofSchema = z.object({
  type: z.literal('symbol'),
  path: z.string().min(1),
  symbol: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
}).strict();

const proofSchema = z.union([fileProofSchema, symbolProofSchema]);

const frontmatterSchema = z.object({
  name: z.string(),
  description: z.string().min(1),
  evidence: z.array(proofSchema).min(1),
}).strict();

/** Location of the Knowledge catalogue inside one workspace. */
export const knowledgeDirectory = (root: string): string => join(root, '.tours', '.memory', 'knowledge');

/**
 * Knowledge Revision of one entry file (ADR 0048): the SHA-256 of its complete
 * bytes. It is computed from the bytes alone, without validating the contract,
 * so it exists for an entry whose contract is already invalid; it stays
 * identical while the file is unchanged and changes with any modified byte.
 */
export const knowledgeRevision = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Deterministic SHA-256 of the cited file bytes (the preparation helper). */
export const fileProofHash = (bytes: Buffer): string => knowledgeRevision(bytes);

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
export function parseKnowledge(source: string, fileName: string): KnowledgeParseResult {
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
  // Complete `symbol` proofs are part of the contract (spec #233) and verify
  // at read time; an incomplete one already failed the schema above, so there
  // is no unsupported proof left to refuse here.
  return {
    status: 'valid',
    name,
    description,
    body,
    evidence,
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

/** Outcome of a deterministic symbol fingerprint (spec #233); no cited path or hash value ever leaves with a refusal. */
export type SymbolFingerprintOutcome =
  | { status: 'ok'; sha256: string }
  | { status: 'refused'; reason: 'symbol_unresolved' | 'symbol_ambiguous' | 'unsupported_language' | 'engine_changed' };

/**
 * Deterministic fingerprint of one cited symbol inside ONE resolved file.
 * Implementations resolve the qualified name uniquely and hash the canonical
 * (comment- and presentation-stripped) span of that symbol — never a hash of
 * mere AST node kinds. The module default is fail-closed: until a grammar-
 * backed canonicalizer is wired, every symbol proof reads as an unsupported
 * language instead of pretending to verify.
 */
export type SymbolFingerprinter = (realRoot: string, realFile: string, proof: KnowledgeSymbolProof) => Promise<SymbolFingerprintOutcome>;

type CitedFile =
  | { status: 'ok'; real: string }
  | { status: 'refused'; reason: 'file_missing' | 'path_outside_workspace' | 'symlink_escape' };

/** Shared path-safety of every proof type: confinement, symlink escape, existence. */
const resolveCitedFile = async (realRoot: string, path: string): Promise<CitedFile> => {
  if (isAbsolute(path) || path.includes('\0')) return { status: 'refused', reason: 'path_outside_workspace' };
  const target = resolve(realRoot, path);
  if (escapes(realRoot, target)) return { status: 'refused', reason: 'path_outside_workspace' };
  let real: string;
  try { real = await realpath(target); }
  catch { return { status: 'refused', reason: 'file_missing' }; }
  if (escapes(realRoot, real)) return { status: 'refused', reason: 'symlink_escape' };
  return { status: 'ok', real };
};

/**
 * Deterministic verification of a parsed Knowledge entry. EVERY declared
 * proof is checked — never a sample — before the body is returned: each cited
 * path must stay inside the workspace, must not escape through a symbolic
 * link, and each proof must hash to its declared SHA-256 — the cited file's
 * bytes for `file`, the symbol's canonical span for `symbol`. The first
 * failing proof stops the check with its reason; no content, path or hash
 * value ever leaves this module with the refusal.
 */
export async function verifyKnowledge(entry: Extract<KnowledgeParseResult, { status: 'valid' }>, root: string, fingerprinter: SymbolFingerprinter = treeSitterSymbolFingerprinter): Promise<KnowledgeParseResult> {
  let realRoot: string;
  try { realRoot = await realpath(root); }
  catch { return { status: 'invalid', reason: 'file_missing' }; }
  for (const proof of entry.evidence) {
    const cited = await resolveCitedFile(realRoot, proof.path);
    if (cited.status === 'refused') return { status: 'invalid', reason: cited.reason };
    let info;
    try { info = await stat(cited.real); }
    catch { return { status: 'invalid', reason: 'file_missing' }; }
    if (!info.isFile()) return { status: 'invalid', reason: 'file_missing' };
    if (proof.type === 'symbol') {
      const fingerprint = await fingerprinter(realRoot, cited.real, proof);
      if (fingerprint.status === 'refused') return { status: 'invalid', reason: fingerprint.reason };
      if (!sameHash(proof.sha256, fingerprint.sha256)) return { status: 'invalid', reason: 'symbol_hash_mismatch' };
    } else {
      const bytes = await readFile(cited.real);
      if (!sameHash(proof.sha256, fileProofHash(bytes))) return { status: 'invalid', reason: 'file_hash_mismatch' };
    }
  }
  return entry;
}

/** Refusal causes of a deterministic path hash, with no bytes and no resolved location. */
export type KnowledgePathHash =
  | { status: 'ok'; path: string; sha256: string }
  | { status: 'absent'; reason: 'file_missing' }
  | { status: 'invalid'; reason: 'path_outside_workspace' | 'symlink_escape' | 'not_a_file' };

/** Creation-side fingerprint of one cited symbol; the twin of `hashWorkspaceFile`. */
export type KnowledgeSymbolHash =
  | { status: 'ok'; path: string; symbol: string; sha256: string }
  | { status: 'absent'; reason: 'file_missing' | 'symbol_unresolved' | 'symbol_ambiguous' }
  | { status: 'invalid'; reason: 'path_outside_workspace' | 'symlink_escape' | 'not_a_file' | 'unsupported_language' | 'engine_changed' };

/**
 * Deterministic fingerprint of one cited symbol through the workspace proof
 * grammar — the creation-side twin of `hashWorkspaceFile`. An entry whose
 * verification contract contains symbol proofs must always obtain this value
 * from the engine, never from the model.
 */
export async function hashWorkspaceSymbol(root: string, path: string, symbol: string): Promise<KnowledgeSymbolHash> {
  if (typeof symbol !== 'string' || !symbol.trim()) return { status: 'absent', reason: 'symbol_unresolved' };
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\0')) return { status: 'invalid', reason: 'path_outside_workspace' };
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
  const fingerprint = await treeSitterSymbolFingerprinter(realRoot, real, { type: 'symbol', path, symbol, sha256: '' });
  if (fingerprint.status !== 'ok') return fingerprint.reason === 'symbol_unresolved' || fingerprint.reason === 'symbol_ambiguous'
    ? { status: 'absent', reason: fingerprint.reason }
    : { status: 'invalid', reason: fingerprint.reason };
  return { status: 'ok', path: relative(realRoot, real).split(sep).join('/'), symbol, sha256: fingerprint.sha256 };
}

/**
 * The catalogue stores the canonicalizer identity that produced its symbol
 * fingerprints, once, not per proof: an engine change reads as
 * `engine_changed` (explicit re-anchoring) instead of a false code-change
 * diagnosis (ADR 0046).
 */
export const catalogueCanonicalizerName = '.canonicalizer';

export const readCatalogueCanonicalizer = async (directory: string): Promise<string | undefined> => {
  try { return (await readFile(join(directory, catalogueCanonicalizerName), 'utf8')).trim() || undefined; }
  catch { return undefined; }
};

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
  /** Discoverable entries: name, description and revision only, sorted by name. */
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
export async function loadKnowledgeLibrary(root: string, directory: string, fingerprinter: SymbolFingerprinter = treeSitterSymbolFingerprinter): Promise<KnowledgeLibrary> {
  const realRoot = await realpath(root).catch(() => undefined);
  const realDirectory = realRoot ? await realpath(directory).catch(() => undefined) : undefined;
  const usable = (): string | undefined => realRoot && realDirectory && !escapes(realRoot, realDirectory) ? realDirectory : undefined;
  const readEntryFile = async (name: string): Promise<{ status: 'valid'; source: string; revision: string } | { status: 'invalid'; reason: KnowledgeFailureReason }> => {
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
      const bytes = await readFile(real);
      // The revision hashes the entry file bytes, never the parsed contract:
      // it exists before, and independently of, every verification.
      return { status: 'valid', source: bytes.toString('utf8'), revision: knowledgeRevision(bytes) };
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
          if (parsed.status === 'valid') metadata.push({ name: parsed.name, description: parsed.description, revision: entryFile.revision });
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
      const { revision } = entryFile;
      const parsed = parseKnowledge(entryFile.source, name);
      if (parsed.status !== 'valid') return { status: 'invalid', reason: parsed.reason, revision };
      // A stale canonicalizer identity is an engine change, never a code
      // change: symbol proofs route to explicit re-anchoring (ADR 0046).
      const marker = await readCatalogueCanonicalizer(usable() ?? '');
      const engineStale = marker !== undefined && marker !== knowledgeCanonicalizer;
      const verified = await verifyKnowledge(parsed, root, engineStale
        ? async () => ({ status: 'refused', reason: 'engine_changed' as const })
        : fingerprinter);
      // The revision accompanies every outcome of a readable entry file, a
      // refusal included: a repair write can be conditioned on what was here.
      return verified.status === 'valid'
        ? { ...verified, revision }
        : { status: 'invalid', reason: verified.reason, revision };
    }
  };
  return library;
}
