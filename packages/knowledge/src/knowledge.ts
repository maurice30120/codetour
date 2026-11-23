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
   * Knowledge Revision of the entry file (ADR 0053): the SHA-256 of its
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
   * How this proof came to be. Absent for deliberate file proofs; set by the
   * engine alone when a requested symbol proof was substituted (spec #233) and
   * carried verbatim by a rewrite that reproduces the identical proof (spec
   * #232). Never an accepted input, never inferred at read.
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

/**
 * One Knowledge Dependency of a Composed Knowledge Entry (spec #288): the
 * daughter's canonical Knowledge name and the SHA-256 of her complete entry
 * file bytes — never a path, never a symbol proof, never a body. The engine
 * resolves the daughter from the catalogue; the contract never transports a
 * location. A `file` proof citing the daughter's Markdown attests bytes of
 * that file and never satisfies this contract.
 */
export interface KnowledgeDependency {
  /** Canonical Knowledge name of the daughter entry. */
  name: string;
  /** SHA-256 of the daughter's complete entry file bytes (her Knowledge Revision). */
  sha256: string;
}

export interface KnowledgeEntry extends KnowledgeMetadata {
  evidence: KnowledgeProof[];
  /**
   * Declared daughters, present only on a composed entry: absence of the field
   * is atomicity, so there is no `kind` discriminator and one spelling per
   * state (spec #288).
   */
  dependencies?: KnowledgeDependency[];
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
  | 'symbol_unparseable'
  | 'unsupported_language'
  | 'symbol_hash_mismatch'
  | 'engine_changed'
  /**
   * Temporary (spec #288, ticket #282): the contract accepts a declaration of
   * dependencies, the read does not yet. A composed body is refused — even
   * when every direct proof verifies — until the daughter graph is validated
   * transitively (ticket #283), so no unverified composition is ever served.
   * This reason disappears with #283.
   */
  | 'dependency_validation_unavailable';

/**
 * Outcome of a Knowledge read: the validated Markdown body with its revision,
 * or a typed refusal. A refusal carries the revision whenever the entry file
 * itself was readable — that is what makes an invalid entry repairable without
 * ever serving its body — and none when there is no entry file to hash
 * (`unknown_entry`, `symlink_escape`, a malformed name).
 */
export type KnowledgeValidation =
  | {
    status: 'valid';
    name: string;
    description: string;
    body: string;
    evidence: KnowledgeProof[];
    /** Declared daughters of a composed entry; absent on an atomic one. */
    dependencies?: KnowledgeDependency[];
    revision: string;
  }
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

// A daughter is named by her canonical Knowledge name and pinned by the digest
// of her entry file bytes; nothing else — no `path`, no `type`, no `symbol`.
const dependencySchema = z.object({
  name: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
}).strict();

const frontmatterSchema = z.object({
  name: z.string(),
  description: z.string().min(1),
  evidence: z.array(proofSchema).min(1),
  dependencies: z.array(dependencySchema).min(2).optional(),
}).strict().superRefine((contract, context) => {
  // Composition is derived from the declaration alone (spec #288): a composed
  // entry needs two direct proofs of its own, and two distinct daughters.
  if (contract.dependencies === undefined) return;
  if (contract.evidence.length < 2) {
    context.addIssue({ code: 'custom', message: 'a composed entry needs at least two direct proofs' });
  }
  if (new Set(contract.dependencies.map(dependency => dependency.name)).size !== contract.dependencies.length) {
    context.addIssue({ code: 'custom', message: 'a daughter is declared twice' });
  }
});

/** Location of the Knowledge catalogue inside one workspace. */
export const knowledgeDirectory = (root: string): string => join(root, '.tours', '.memory', 'knowledge');

/**
 * Knowledge Revision of one entry file (ADR 0053): the SHA-256 of its complete
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
 * The sequences of the Knowledge frontmatter, and the keys each of their items
 * may carry — exactly the keys of their strict schema. Declaring them here
 * once is what refuses a dependency item under `evidence` (and the reverse)
 * instead of attaching it to the block that happens to be open.
 */
const SEQUENCE_ITEM_KEYS = new Map<string, ReadonlySet<string>>([
  ['evidence', new Set(['type', 'path', 'symbol', 'sha256', 'origin'])],
  ['dependencies', new Set(['name', 'sha256'])]
]);

/**
 * Restricted YAML-subset parser for the Knowledge frontmatter: flat scalars
 * (`key: value`) plus a map of sequences keyed by name — `evidence` and
 * `dependencies` — each a list of `- key: value` items. Anything outside this
 * grammar (nested structures, tabs, duplicated keys, an inline sequence value,
 * an item before its key or after a scalar, a sequence key declared twice or
 * with no item, an item whose keys belong to the other sequence) is a
 * malformed contract. The catalogue format is fixed here, so validation stays
 * deterministic without a YAML engine.
 */
function parseFrontmatter(lines: string[]): Record<string, unknown> | undefined {
  const scalars: Record<string, string> = {};
  const sequences: Record<string, Array<Record<string, string>>> = {};
  let active: string | undefined;
  let itemIndent = -1;
  let current: Record<string, string> | undefined;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const inline = line.trimStart();
    if (inline.startsWith('- ')) {
      // An item belongs to the sequence key declared immediately above it.
      if (active === undefined || indent === 0) return undefined;
      if (itemIndent === -1) itemIndent = indent;
      if (indent !== itemIndent) return undefined;
      const pair = parsePair(inline.slice(2).trim());
      // Every item opens fresh; a key of the other sequence refuses the item
      // instead of attaching it to this one.
      if (!pair || !pair.value || !SEQUENCE_ITEM_KEYS.get(active)?.has(pair.key)) return undefined;
      current = { [pair.key]: pair.value };
      sequences[active].push(current);
      continue;
    }
    if (indent === 0) {
      const pair = parsePair(line);
      if (!pair) return undefined;
      if (SEQUENCE_ITEM_KEYS.has(pair.key)) {
        // A sequence is declared once, opens with no item of its own, and an
        // explicit empty list declares nothing — refused below.
        if (pair.key in sequences) return undefined;
        if (pair.value && pair.value !== '[]') return undefined;
        sequences[pair.key] = [];
        active = pair.key;
        current = undefined;
        itemIndent = -1;
        continue;
      }
      if (!pair.value || pair.key in scalars || pair.key in sequences) return undefined;
      scalars[pair.key] = pair.value;
      // A scalar closes the open sequence: the item after it has no key left.
      active = undefined;
      current = undefined;
      itemIndent = -1;
      continue;
    }
    // Continuation: the keys of the current item, deeper than its `- ` marker.
    if (active === undefined || !current || itemIndent === -1 || indent <= itemIndent) return undefined;
    const pair = parsePair(line.trim());
    if (!pair || !pair.value || pair.key in current || !SEQUENCE_ITEM_KEYS.get(active)?.has(pair.key)) return undefined;
    current[pair.key] = pair.value;
  }
  // A declared sequence with no item says nothing: it is a malformed contract,
  // never an empty list.
  if (Object.values(sequences).some(items => items.length === 0)) return undefined;
  return { ...scalars, ...sequences };
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
  const { name, description, evidence, dependencies } = parsed.data;
  if (!validateKnowledgeName(name).ok) return { status: 'invalid', reason: 'malformed_contract' };
  if (name !== fileName.replace(/\.md$/, '')) return { status: 'invalid', reason: 'malformed_contract' };
  // A daughter is looked up in the catalogue by name, so she obeys the same
  // safe flat rule as the entry itself (spec #288).
  if (dependencies?.some(dependency => !validateKnowledgeName(dependency.name).ok)) {
    return { status: 'invalid', reason: 'malformed_contract' };
  }
  // Complete `symbol` proofs are part of the contract (spec #233) and verify
  // at read time; an incomplete one already failed the schema above, so there
  // is no unsupported proof left to refuse here.
  return {
    status: 'valid',
    name,
    description,
    body,
    evidence,
    // Absence of the field IS atomicity (spec #288): a composed entry carries
    // its daughters, an atomic one carries nothing extra.
    ...(dependencies === undefined ? {} : { dependencies })
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

/** Outcome of a deterministic symbol fingerprint (spec #233); no cited path or hash value ever leaves with a refusal. */
export type SymbolFingerprintOutcome =
  | { status: 'ok'; sha256: string }
  | { status: 'refused'; reason: 'symbol_unresolved' | 'symbol_ambiguous' | 'symbol_unparseable' | 'unsupported_language' | 'engine_changed' };

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
  if (isOutsideWorkspace(realRoot, target)) return { status: 'refused', reason: 'path_outside_workspace' };
  let real: string;
  try { real = await realpath(target); }
  catch { return { status: 'refused', reason: 'file_missing' }; }
  if (isOutsideWorkspace(realRoot, real)) return { status: 'refused', reason: 'symlink_escape' };
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
  // Temporary (spec #288, ticket #282): the contract accepts a declaration of
  // dependencies, the verification does not yet. A composed entry is refused
  // before anything is read, even when every direct proof would verify, so no
  // unvalidated composition is ever served; ticket #283 validates the daughter
  // graph here instead and this reason disappears.
  if (entry.dependencies !== undefined) return { status: 'invalid', reason: 'dependency_validation_unavailable' };
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
  | { status: 'invalid'; reason: 'path_outside_workspace' | 'symlink_escape' | 'not_a_file' | 'symbol_unparseable' | 'unsupported_language' | 'engine_changed' };

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
  if (isOutsideWorkspace(realRoot, target)) return { status: 'invalid', reason: 'path_outside_workspace' };
  let real: string;
  try { real = await realpath(target); }
  catch { return { status: 'absent', reason: 'file_missing' }; }
  if (isOutsideWorkspace(realRoot, real)) return { status: 'invalid', reason: 'symlink_escape' };
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
  if (isOutsideWorkspace(realRoot, target)) return { status: 'invalid', reason: 'path_outside_workspace' };
  let real: string;
  try { real = await realpath(target); }
  catch { return { status: 'absent', reason: 'file_missing' }; }
  if (isOutsideWorkspace(realRoot, real)) return { status: 'invalid', reason: 'symlink_escape' };
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
  /** Verified metadata and all refusals, independent of the query. */
  verifiedList(query?: string): Promise<{
    entries: KnowledgeMetadata[];
    invalid: { name: string; reason: KnowledgeFailureReason; revision?: string }[];
  }>;
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
  const usable = (): string | undefined => realRoot && realDirectory && !isOutsideWorkspace(realRoot, realDirectory) ? realDirectory : undefined;
  const readEntryFile = async (name: string): Promise<{ status: 'valid'; source: string; revision: string } | { status: 'invalid'; reason: KnowledgeFailureReason }> => {
    // A catalogue name is a safe flat name (the file-name rule), which
    // also keeps every lookup inside the flat catalogue directory.
    if (!validateKnowledgeName(name).ok) return { status: 'invalid', reason: 'malformed_contract' };
    const dir = usable();
    if (!dir) return { status: 'invalid', reason: 'unknown_entry' };
    let real: string;
    try { real = await realpath(join(dir, `${name}.md`)); }
    catch { return { status: 'invalid', reason: 'unknown_entry' }; }
    if (isOutsideWorkspace(realRoot!, real)) return { status: 'invalid', reason: 'symlink_escape' };
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
    verifiedList: async query => {
      const dir = usable();
      let files: string[] = [];
      if (dir) {
        try { files = (await readdir(dir)).filter(file => file.endsWith('.md')).sort(); }
        catch { /* A missing or unreadable catalogue is empty. */ }
      }
      const entries: KnowledgeMetadata[] = [];
      const invalid: { name: string; reason: KnowledgeFailureReason; revision?: string }[] = [];
      const lowerQuery = query?.toLowerCase();
      for (const file of files) {
        const name = file.slice(0, -3);
        const entry = await library.read(name);
        if (entry.status === 'valid') {
          if (!lowerQuery || `${entry.name} ${entry.description}`.toLowerCase().includes(lowerQuery)) {
            entries.push({ name: entry.name, description: entry.description, revision: entry.revision });
          }
        } else if (entry.revision === undefined) {
          invalid.push({ name, reason: entry.reason });
        } else {
          invalid.push({ name, reason: entry.reason, revision: entry.revision });
        }
      }
      return { entries, invalid };
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
