import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { validateCanonicalName } from 'codetour-knowledge';

// ============================================================================
// Catalogue entry model (issue #174 complement)
// ============================================================================

const paramSchemaShape = z.object({
  name: z.string().min(1),
  type: z.string().min(1).max(200).default('unknown'),
  description: z.string().max(200).optional(),
});

const outputContractShape = z.object({
  // Human-readable description of the returned shape, e.g. "SearchMatch[] {file, line, text}".
  returns: z.string().min(1).max(300),
  // Structural fields expected on each item (proof contract).
  itemFields: z.array(z.string()).max(20).default([]),
  // Bounds the output honours.
  bounds: z.object({ maxItems: z.number().int().positive(), maxBytes: z.number().int().positive() }),
});

const uncertaintyCaseShape = z.object({
  // Concrete case in which the output must not be trusted blindly.
  case: z.string().min(1).max(200),
  // Explicit signal the caller receives in that case.
  signal: z.string().min(1).max(200),
});

const entrySchema = z.object({
  id: z.string().min(1),
  objective: z.string().max(500),
  description: z.string().max(300),
  code: z.string().max(32768),
  parameters: z.array(z.string()).max(30),
  paramsSchema: z.array(paramSchemaShape).max(30).default([]),
  outputContract: outputContractShape.optional(),
  limits: z.object({ maxItems: z.number().int().positive().default(50), maxBytes: z.number().int().positive().default(8000) }).optional(),
  uncertaintyCases: z.array(uncertaintyCaseShape).max(10).default([]),
  revision: z.string().max(64).optional(),
  successes: z.number().int().nonnegative().optional(),
  failures: z.number().int().nonnegative().optional(),
  // G0 requirement: NO inactivity tracking or purge
  fingerprint: z.string().optional(),
  version: z.number().int().nonnegative().optional(),
  replacedBy: z.string().optional(),
  variantOf: z.string().optional(),
  validated: z.boolean().optional(),
  executionMode: z.enum(['strict', 'legacy']).optional(),
  referenceCases: z.array(z.object({ params: z.record(z.string(), z.unknown()), ok: z.boolean(), at: z.string() })).max(5).optional()
}).passthrough();
type Entry = z.infer<typeof entrySchema>;

/** Outcome of a catalogue comparison. 'indeterminate' is reported honestly instead of inventing equivalence. */
export type ComparisonOutcome = 'duplicate' | 'distinct' | 'indeterminate';

export interface ReferenceCase { params: Record<string, unknown>; ok: boolean; at: string }

/** Deterministic replay evidence (issue #187): the exact same code and params were re-executed and every citation re-checked. */
export interface ReplayEvidence {
  ok: boolean;
  reason?: string;
  citations?: 'valid' | 'no_references' | 'validation_failed';
}

/** Issue #187: per-candidate reconciliation log — proposed / replayed / accepted / rejected with reason. */
export interface ReconciliationOutcome {
  name: string;
  /** True when the model proposed (selected) the candidate for consolidation. */
  proposed: boolean;
  /** True when the deterministic reconciliation re-executed the exact code and params with all citations re-checked. */
  replayed: boolean;
  accepted: boolean;
  reason?: string;
}

export interface ConsolidationCandidate {
  objective: string;
  description: string;
  code: string;
  parameters: string[];
  paramsSchema?: Array<{ name: string; type: string }>;
  executionMode?: 'strict' | 'legacy';
  /** TypeScript identifier used as the catalogue key. */
  name: string;
  /** Output contract declared with the candidate. */
  returns?: string;
  uncertaintyCases?: Array<{ case: string; signal: string }>;
  verified: boolean;
  /** Concrete operational consolidation signal (correction 3): never a blind benchmark judge. */
  consolidationSignal?: { executedSuccessfully: boolean; proofAvailable: boolean; contractRespected: boolean };
  /** Deterministic replay evidence (issue #187): required — no replay, no persistence. */
  replay?: ReplayEvidence;
  version?: number;
  variantOf?: string;
  revision?: string;
}

export interface ConsolidationReport {
  accepted: string[];
  rejected: Array<{ name: string; reason: string }>;
  duplicates: string[];
  indeterminate: string[];
  /** Issue #187: one entry per candidate that reached the deterministic validator. */
  reconciliation: ReconciliationOutcome[];
}

/** Maximum stored description length (matches the entry schema bound). */
const MAX_DESCRIPTION_LENGTH = 300;

/**
 * Practable English screen — not proof of English: non-ASCII is refused
 * outright, and an accepted description must contain at least one common
 * English function word. A passing text is screened, never proven English
 * (spec #183: a heuristic language detector is never sold as infallible).
 */
const ENGLISH_FUNCTION_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'with', 'from', 'to', 'in', 'on', 'by', 'is', 'are', 'be', 'been', 'was', 'were', 'has', 'have', 'had', 'does', 'do', 'did', 'returns', 'return', 'returning', 'given', 'when', 'each', 'its', 'this', 'that', 'which', 'not', 'into', 'over', 'under', 'out', 'as', 'at', 'than', 'then', 'can', 'will', 'would', 'should', 'may', 'must', 'never', 'always', 'per', 'via', 'using', 'use', 'uses', 'used', 'searches', 'search', 'finds', 'find', 'reads', 'read', 'lists', 'list', 'counts', 'count', 'reports', 'report']);

/**
 * Deterministic description validation (issue #187, D04): a candidate is kept
 * only with a non-empty, length-bounded English description stating what the
 * procedure does, its scope, its result shape and its key limits. No LLM judges
 * the text: empty and oversized
 * descriptions are refused outright, while the English rule is a practable
 * heuristic screen (see ENGLISH_FUNCTION_WORDS) — a description passing it
 * is screened, not proven English.
 */
export function validateDescription(description: string): { ok: boolean; reason?: string } {
  const trimmed = typeof description === 'string' ? description.trim() : '';
  if (!trimmed) return { ok: false, reason: 'Description is mandatory: state what the procedure does, its scope, the shape of its result and its key limits.' };
  if (trimmed.includes('*/')) return { ok: false, reason: 'Description cannot contain a JSDoc comment terminator.' };
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) return { ok: false, reason: `Description is too long: ${trimmed.length} characters; at most ${MAX_DESCRIPTION_LENGTH} are allowed.` };
  if (/[^\x20-\x7E]/.test(trimmed)) return { ok: false, reason: 'Description must be written in English: non-ASCII (e.g. accented) characters are not accepted.' };
  const words = trimmed.toLowerCase().match(/[a-z']+/g) ?? [];
  if (!words.some(word => ENGLISH_FUNCTION_WORDS.has(word))) return { ok: false, reason: 'Description must be written in English: no common English word was found in the text.' };
  return { ok: true };
}

const digest = (s: string) => createHash('sha256').update(s).digest('hex');

// One canonical-name rule for Memory Methods and Knowledge entries (ADR 0036,
// ADR 0039). Imported for the hardening paths below and re-exported so
// historical harness imports keep working.
export { validateCanonicalName };

/**
 * Dedup on question + scope + contract — never on the name alone.
 * No embeddings, no classifier: only normalized exact comparisons. When the
 * comparison cannot be decided, the outcome is 'indeterminate' and BOTH
 * entries are kept (never an invented equivalence).
 */
export function compareCandidates(candidate: { objective: string; description: string; returns?: string }, entry: { objective: string; description: string; outputContract?: { returns: string } }): ComparisonOutcome {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const sameQuestion = norm(candidate.objective) === norm(entry.objective);
  const sameScope = norm(candidate.description) === norm(entry.description);
  if (!sameQuestion || !sameScope) return 'distinct';
  // Same question + same scope: the contract decides.
  const candidateContract = candidate.returns ? norm(candidate.returns) : undefined;
  const entryContract = entry.outputContract?.returns ? norm(entry.outputContract.returns) : undefined;
  if (candidateContract && entryContract) return candidateContract === entryContract ? 'duplicate' : 'distinct';
  // Missing contract information on either side: comparison is indeterminate.
  return 'indeterminate';
}

/** Local experimental store. The file name derives from the real repository path. */
export async function scriptMemory(root: string, directory: string) {
  const repo = await realpath(root);
  const targetDirectory = resolve(directory);
  const relativeDirectory = relative(repo, targetDirectory);
  const insideWorkspace = relativeDirectory !== '..' && !relativeDirectory.startsWith(`..${sep}`) && !isAbsolute(relativeDirectory);
  const ensureDirectory = async (path: string) => {
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe memory directory: ${path}`);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      await mkdir(path);
    }
  };
  if (insideWorkspace) {
    let current = repo;
    for (const part of relativeDirectory.split(sep).filter(Boolean)) {
      current = join(current, part);
      await ensureDirectory(current);
    }
  } else {
    await mkdir(targetDirectory, { recursive: true });
    await ensureDirectory(targetDirectory);
  }
  const rejectSymlink = async (path: string) => {
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error(`Unsafe memory file: ${path}`); }
    catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  };
  const file = join(directory, `${digest(repo)}.json`);
  await rejectSymlink(file);
  let entries: Entry[];
  try { entries = z.array(entrySchema).parse(JSON.parse(await readFile(file, 'utf8'))); }
  catch (error: any) { if (error?.code === 'ENOENT') entries = []; else throw new Error('Invalid script memory'); }
  const persist = async () => {
    await rejectSymlink(file);
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(entries), { mode: 0o600 });
    await rename(temporary, file);
  };
  const functionDirectory = join(directory, 'functions');
  const writeFunction = async (entry: Entry) => {
    await ensureDirectory(functionDirectory);
    const escapeComment = (value: string) => value.replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ');
    const description = escapeComment(entry.description);
    const params = entry.paramsSchema.map(p => ` * @param ${escapeComment(p.name)} ${escapeComment(p.description ?? p.type)}`).join('\n');
    const limits = entry.uncertaintyCases.map(c => `${c.case}: ${c.signal}`).join('; ') || 'Bounded by the workspace sandbox and output limits.';
    const source = `/**\n * ${description}\n * @question ${escapeComment(entry.objective)}\n${params ? params + '\n' : ''} * @returns ${escapeComment(entry.outputContract?.returns ?? 'See the function result.')}\n * @remarks ${escapeComment(limits)}\n */\nexport const ${entry.id} = ${entry.code};\n`;
    const target = join(functionDirectory, `${entry.id}.ts`);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, source, { mode: 0o600 });
    await rename(temporary, target);
  };

  // Full catalogue projection WITHOUT the function source: id, canonical
  // question, scope, typed params, output contract, limits, uncertainty
  // cases (issue #174 complement: no source leakage through memory_list).
  const project = (entry: Entry) => ({
    id: entry.id,
    objective: entry.objective,
    description: entry.description,
    parameters: entry.parameters,
    paramsSchema: entry.paramsSchema,
    outputContract: entry.outputContract,
    limits: entry.limits,
    uncertaintyCases: entry.uncertaintyCases,
    revision: entry.revision,
  });

  // In-session traces only: the catalogue is NEVER mutated mid-run
  // (correction 3). Failure/reuse traces are applied in finish().
  const sessionFailures: string[] = [];


  return {
    /** Catalogue without sources (public projection). */
    catalog: () => entries.map(project),
    /** memory_list with query support (spec #172 G0 requirement). */
    memory_list: (query?: string) => {
      if (!query) return entries.map(project);
      const lowerQuery = query.toLowerCase();
      const haystack = (entry: Entry) => [entry.objective, entry.description, entry.outputContract?.returns ?? '', ...entry.parameters, entry.id].join('\n').toLowerCase();
      return entries.filter(entry => haystack(entry).includes(lowerQuery)).map(project);
    },
    /** Record an in-run failure trace (applied to the catalogue at finish). */
    recordFailure: (id: string) => { sessionFailures.push(id); },
    /** Peek at stored entry (source included; for execution wiring only). */
    get: (id: string) => entries.find(entry => entry.id === id),
    sources: () => Object.fromEntries(entries.map(({ id, code }) => [id, code])),
    memory_run: (id: string, params: Record<string, unknown> = {}) => {
      const entry = entries.find(item => item.id === id);
      if (!entry) throw new Error('Unknown script');
      // Note: Actual execution happens in explore.ts via runScript with params.
      return { id, code: entry.code, params, outputContract: entry.outputContract, revision: entry.revision };
    },
    async finish(successIds: string[], candidates: ConsolidationCandidate[]): Promise<ConsolidationReport> {
      const report: ConsolidationReport = { accepted: [], rejected: [], duplicates: [], indeterminate: [], reconciliation: [] };
      // Observation and failures stay in the run trace; they are not usage history.
      void successIds;
      for (const candidate of candidates) {
        const canonical = `${candidate.name ?? ''}`;
        const recordOutcome = (accepted: boolean, reason?: string): void => {
          report.reconciliation.push({ name: canonical, proposed: true, replayed: candidate.replay?.ok === true, accepted, ...(reason ? { reason } : {}) });
        };
        // Gate: only consolidate EXECUTED, proven, contract-respecting candidates from a validated Tour.
        const signal = candidate.consolidationSignal;
        if (!candidate.verified) {
          report.rejected.push({ name: canonical, reason: 'Non-executed or unverified candidate: only procedures actually executed during a validated Tour may be consolidated' });
          recordOutcome(false, report.rejected.at(-1)!.reason);
          continue;
        }
        if (!signal || !signal.executedSuccessfully || !signal.proofAvailable || !signal.contractRespected) {
          report.rejected.push({ name: canonical, reason: 'Consolidation signal missing: execution status success + structural proof availability + contract respected are all required' });
          recordOutcome(false, report.rejected.at(-1)!.reason);
          continue;
        }
        // Gate: canonical naming (camelCase verb+domain+object).
        const naming = validateCanonicalName(candidate.name);
        if (!naming.ok) {
          report.rejected.push({ name: canonical, reason: `Naming convention: ${naming.reason}` });
          recordOutcome(false, report.rejected.at(-1)!.reason);
          continue;
        }
        // Gate (issue #187): mandatory exploitable English description, one or
        // two sentences, length-bounded — refused deterministically with a reason.
        const descriptionCheck = validateDescription(candidate.description);
        if (!descriptionCheck.ok) {
          report.rejected.push({ name: canonical, reason: `Description refused: ${descriptionCheck.reason}` });
          recordOutcome(false, report.rejected.at(-1)!.reason);
          continue;
        }
        // Gate: a bare line-range reader is a wrapped primitive, not a reusable procedure.
        const paramNames = (candidate.parameters ?? []).map(name => name.toLowerCase());
        if (paramNames.some(n => /^(start|from)(line)?$/.test(n)) && paramNames.some(n => /^(end|to)(line)?$/.test(n))) {
          report.rejected.push({ name: canonical, reason: 'Primitive wrapper: a procedure parameterized by a line range only re-wraps readLines and is not memorized' });
          recordOutcome(false, report.rejected.at(-1)!.reason);
          continue;
        }
        // Gate (issue #187): deterministic reconciliation replay — the exact
        // same code and params must have been re-executed with all citations
        // re-checked on the submitted version.
        if (!candidate.replay) {
          report.rejected.push({ name: canonical, reason: 'Reconciliation replay missing: the exact code and params must be re-executed with all citations re-checked before persistence' });
          recordOutcome(false, report.rejected.at(-1)!.reason);
          continue;
        }
        if (!candidate.replay.ok) {
          report.rejected.push({ name: canonical, reason: `Reconciliation replay failed: ${candidate.replay.reason ?? 'the re-execution did not reproduce the validated attempt'}` });
          recordOutcome(false, report.rejected.at(-1)!.reason);
          continue;
        }
        const existing = entries.find(entry => entry.id === candidate.name);
        if (existing) {
          const sameContract = existing.objective === candidate.objective && existing.description === candidate.description
            && JSON.stringify(existing.parameters) === JSON.stringify(candidate.parameters)
            && existing.outputContract?.returns === candidate.returns;
          if (!sessionFailures.includes(existing.id) || !sameContract) {
            report.rejected.push({ name: canonical, reason: 'Identifier collision: only a failed existing function with the same contract can be corrected' });
            recordOutcome(false, report.rejected.at(-1)!.reason);
            continue;
          }
        }
        let duplicateOf: Entry | undefined;
        let indeterminateOf: Entry | undefined;
        for (const entry of entries) {
          if (entry === existing) continue;
          const outcome = compareCandidates(candidate, entry);
          if (outcome === 'duplicate') { duplicateOf = entry; break; }
          if (outcome === 'indeterminate') indeterminateOf = entry;
        }
        if (duplicateOf) {
          report.duplicates.push(candidate.name);
          report.rejected.push({ name: canonical, reason: `Duplicate of ${duplicateOf.id}` });
          recordOutcome(false, report.rejected.at(-1)!.reason);
          continue;
        }
        if (indeterminateOf) report.indeterminate.push(candidate.name);
        const newEntry: Entry = {
          id: candidate.name,
          objective: candidate.objective,
          description: candidate.description,
          code: candidate.code,
          parameters: candidate.parameters,
          paramsSchema: candidate.paramsSchema ?? candidate.parameters.map(name => ({ name, type: 'unknown' })),
          executionMode: candidate.executionMode,
          outputContract: candidate.returns ? { returns: candidate.returns, itemFields: ['file', 'line'], bounds: { maxItems: 50, maxBytes: 8000 } } : undefined,
          limits: { maxItems: 50, maxBytes: 8000 },
          uncertaintyCases: candidate.uncertaintyCases ?? [],
          revision: candidate.revision,
          validated: true
        };
        const sourceFile = join(functionDirectory, `${newEntry.id}.ts`);
        await ensureDirectory(functionDirectory);
        await rejectSymlink(sourceFile);
        let previousSource: string | undefined;
        try { previousSource = await readFile(sourceFile, 'utf8'); }
        catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
        if (!existing && previousSource !== undefined) {
          report.rejected.push({ name: canonical, reason: 'A source file with this name already exists outside the catalogue' });
          recordOutcome(false, report.rejected.at(-1)!.reason);
          continue;
        }
        const previousEntries = entries.slice();
        await writeFunction(newEntry);
        if (existing) entries[entries.indexOf(existing)] = newEntry;
        else entries.push(newEntry);
        try { await persist(); }
        catch (error) {
          entries = previousEntries;
          if (previousSource === undefined) await unlink(sourceFile);
          else await writeFile(sourceFile, previousSource, { mode: 0o600 });
          throw error;
        }
        report.accepted.push(candidate.name);
        recordOutcome(true);
      }
      return report;
    }
  };
}
