import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

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
  successes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  // G0 requirement: NO inactivity tracking or purge
  fingerprint: z.string().optional(),
  version: z.number().int().nonnegative().optional(),
  replacedBy: z.string().optional(),
  variantOf: z.string().optional(),
  validated: z.boolean().optional(),
  executionMode: z.enum(['strict', 'legacy']).optional(),
  referenceCases: z.array(z.object({ params: z.record(z.string(), z.unknown()), ok: z.boolean(), at: z.string() })).max(5).default([])
});
type Entry = z.infer<typeof entrySchema>;

/** Outcome of a catalogue comparison. 'indeterminate' is reported honestly instead of inventing equivalence. */
export type ComparisonOutcome = 'duplicate' | 'distinct' | 'indeterminate';

export interface ReferenceCase { params: Record<string, unknown>; ok: boolean; at: string }

export interface ReplacementVerification {
  /** Candidate executed at least once with its own params, with valid structural proofs. */
  candidateProofOk: boolean;
  /** Reference test set (old version's behaviour) re-executed on the candidate, proofs valid. */
  referenceProofOk: boolean;
  /** How many distinct param sets (candidate + reference cases) were executed. */
  executedParamSets: number;
  /** True when the old entry had no reference cases recorded (gate then refuses). */
  noReferenceCases?: boolean;
}

export interface ConsolidationCandidate {
  objective: string;
  description: string;
  code: string;
  parameters: string[];
  paramsSchema?: Array<{ name: string; type: string }>;
  executionMode?: 'strict' | 'legacy';
  /** Canonical name: camelCase, verbe+domaine+objet. Mandatory for consolidation. */
  name: string;
  /** Output contract declared with the candidate. */
  returns?: string;
  uncertaintyCases?: Array<{ case: string; signal: string }>;
  verified: boolean;
  /** Concrete operational consolidation signal (correction 3): never a blind benchmark judge. */
  consolidationSignal?: { executedSuccessfully: boolean; proofAvailable: boolean; contractRespected: boolean };
  replaces?: string;
  version?: number;
  variantOf?: string;
  /** Replacement gate evidence (B): candidate params + representative reference test set. */
  regression?: ReplacementVerification;
  revision?: string;
}

export interface ConsolidationReport {
  accepted: string[];
  rejected: Array<{ name: string; reason: string }>;
  duplicates: string[];
  indeterminate: string[];
}

const digest = (s: string) => createHash('sha256').update(s).digest('hex');

/** Canonical naming convention: camelCase, verbe+domaine+objet (at least three segments). */
export function validateCanonicalName(name: string): { ok: boolean; reason?: string } {
  if (!name || typeof name !== 'string') return { ok: false, reason: 'Missing canonical name' };
  if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) return { ok: false, reason: `Name "${name}" must be camelCase (no separators, lowercase first letter)` };
  const segments = name.split(/(?=[A-Z])/);
  if (segments.length < 3) return { ok: false, reason: `Name "${name}" must follow verbe+domaine+objet (at least three camelCase segments, e.g. searchPostgresIndexes)` };
  return { ok: true };
}

/**
 * Dedup on question + périmètre + contrat — never on the name alone.
 * No embeddings, no classifier: only normalized exact comparisons. When the
 * comparison cannot be decided, the outcome is 'indeterminate' and BOTH
 * entries are kept (never an invented equivalence).
 */
export function compareCandidates(candidate: { objective: string; description: string; returns?: string }, entry: { objective: string; description: string; outputContract?: { returns: string } }): ComparisonOutcome {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const sameQuestion = norm(candidate.objective) === norm(entry.objective);
  const sameScope = norm(candidate.description) === norm(entry.description);
  if (!sameQuestion || !sameScope) return 'distinct';
  // Same question + same périmètre: the contract decides.
  const candidateContract = candidate.returns ? norm(candidate.returns) : undefined;
  const entryContract = entry.outputContract?.returns ? norm(entry.outputContract.returns) : undefined;
  if (candidateContract && entryContract) return candidateContract === entryContract ? 'duplicate' : 'distinct';
  // Missing contract information on either side: comparison is INDÉTERMINÉ.
  return 'indeterminate';
}

/** Local experimental store. The file name derives from the real repository path. */
export async function scriptMemory(root: string, directory: string, options: { deduplicate?: boolean } = {}) {
  const repo = await realpath(root);
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${digest(repo)}.json`);
  let entries: Entry[];
  try { entries = z.array(entrySchema).parse(JSON.parse(await readFile(file, 'utf8'))); }
  catch (error: any) { if (error?.code === 'ENOENT') entries = []; else throw new Error('Invalid script memory'); }
  let purges = 0;
  const persist = async () => {
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(entries), { mode: 0o600 });
    await rename(temporary, file);
  };
  const prune = () => {
    const original = entries.length;
    entries = entries.filter(e => !(e.successes + e.failures >= 3 && e.failures >= 2 && e.successes + e.failures === 3));
    purges += original - entries.length;
  };

  const generateFingerprint = (code: string, parameters: string[]): string => digest(`${code}\0${[...parameters].sort().join(',')}`).slice(0, 16);

  // Full catalogue projection WITHOUT the function source: id, canonical
  // question, périmètre, typed params, output contract, limits, uncertainty
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
    version: entry.version,
    variantOf: entry.variantOf,
    supersededBy: entry.replacedBy,
    successes: entry.successes,
    failures: entry.failures
  });

  // In-session traces only: the catalogue is NEVER mutated mid-run
  // (correction 3). Failure/reuse traces are applied in finish().
  const sessionFailures: string[] = [];
  const sessionObservations: Array<{ id: string; params: Record<string, unknown>; ok: boolean }> = [];

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
    /** Record an in-run observation (parameters + proof validity) used for replacement regression gates. */
    observeRun: (id: string, params: Record<string, unknown>, ok: boolean) => { sessionObservations.push({ id, params, ok }); },
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
      const report: ConsolidationReport = { accepted: [], rejected: [], duplicates: [], indeterminate: [] };
      // 1. Update success/failure counts. G0 requirement: NO inactivity tracking.
      for (const entry of entries) {
        const successes = successIds.filter(id => id === entry.id).length;
        if (successes) entry.successes += successes;
        const failures = sessionFailures.filter(id => id === entry.id).length;
        if (failures) entry.failures += failures;
      }
      // 2. Record reference cases (for replacement regression gates), capped.
      for (const observation of sessionObservations) {
        const entry = entries.find(item => item.id === observation.id);
        if (entry) entry.referenceCases = [
          ...entry.referenceCases.filter(existing => JSON.stringify(existing.params) !== JSON.stringify(observation.params)).slice(-4),
          { params: observation.params, ok: observation.ok, at: new Date().toISOString() }
        ];
      }
      // 3. Consolidation of candidates — every gate must pass.
      for (const candidate of candidates) {
        let pendingReplacedEntryForThisCandidate: Entry | undefined;
        const canonical = `${candidate.name ?? ''}`;
        // Gate (complement): only consolidate EXECUTED, proven, contract-respecting candidates from a validated Tour.
        const signal = candidate.consolidationSignal;
        if (!candidate.verified) { report.rejected.push({ name: canonical, reason: 'Non-executed or unverified candidate: only procedures actually executed during a validated Tour may be consolidated' }); continue; }
        if (!signal || !signal.executedSuccessfully || !signal.proofAvailable || !signal.contractRespected) {
          report.rejected.push({ name: canonical, reason: 'Consolidation signal missing: execution status success + structural proof availability + contract respected are all required' });
          continue;
        }
        // Gate: canonical naming (camelCase verbe+domaine+objet).
        const naming = validateCanonicalName(candidate.name);
        if (!naming.ok) { report.rejected.push({ name: canonical, reason: `Naming convention: ${naming.reason}` }); continue; }
        // Gate: preserve old-version behaviour before ANY replacement (rollback kept).
        if (candidate.replaces) {
          const oldEntry = entries.find(entry => entry.id === candidate.replaces);
          if (!oldEntry) { report.rejected.push({ name: canonical, reason: `Unknown replacement target "${candidate.replaces}"` }); continue; }
          const regression = candidate.regression;
          if (!oldEntry.referenceCases.length || !regression) {
            report.rejected.push({ name: canonical, reason: !regression
              ? 'Replacement gate: no verification evidence provided (candidate params AND reference test set required)'
              : 'Replacement gate: the old version has no recorded reference cases; record runs of the old version before replacing it' });
            continue;
          }
          const requiredSets = Math.min(3, oldEntry.referenceCases.length) + 1; // + candidate's own params
          if (regression.executedParamSets < requiredSets) {
            report.rejected.push({ name: canonical, reason: `Replacement gate: verified only ${regression.executedParamSets} param set(s); ${requiredSets} required (candidate params + ${requiredSets - 1} reference cases)` });
            continue;
          }
          if (!regression.candidateProofOk || !regression.referenceProofOk) {
            report.rejected.push({ name: canonical, reason: `Replacement gate: proofs invalid (candidateProofOk=${regression.candidateProofOk}, referenceProofOk=${regression.referenceProofOk})` });
            continue;
          }
          pendingReplacedEntryForThisCandidate = oldEntry; // marked only once the new version is accepted below
        }
        // Gate: dedup decided ONLY on question + périmètre + contrat (never the
        // name alone). The entry being replaced is excluded from the scan: the
        // candidate IS its declared successor. An INDÉTERMINÉ comparison against
        // any OTHER entry is never silently merged: both entries stay, the new
        // one flagged variantOf (no invented equivalence).
        let duplicateOf: Entry | undefined;
        let indeterminateOf: Entry | undefined;
        for (const entry of entries) {
          if (entry === pendingReplacedEntryForThisCandidate) continue;
          const outcome = compareCandidates(candidate, entry);
          if (outcome === 'duplicate') { duplicateOf = entry; break; }
          if (outcome === 'indeterminate') indeterminateOf = entry;
        }
        if (duplicateOf && options.deduplicate !== false) { report.duplicates.push(candidate.name); continue; }
        // Rollback kept: the old entry is retained and marked superseded only
        // now, i.e. when the new version is actually accepted.
        if (pendingReplacedEntryForThisCandidate) pendingReplacedEntryForThisCandidate.replacedBy = candidate.name;
        // New entry, keyed by canonical name (code-digest suffix only on id collision).
        const codeSuffix = digest(candidate.code).slice(0, 8);
        const id = entries.some(entry => entry.id === candidate.name) ? `${candidate.name}-${codeSuffix}` : candidate.name;
        if (indeterminateOf) {
          report.indeterminate.push(candidate.name);
          entries.push({
            id,
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
            successes: 1,
            failures: 0,
            fingerprint: digest(`${candidate.code}\0${[...candidate.parameters].sort().join(',')}`).slice(0, 16),
            version: candidate.version ?? 1,
            variantOf: indeterminateOf.id,
            validated: true,
            referenceCases: []
          });
          report.accepted.push(id);
          continue;
        }
        const existing = entries.find(entry => entry.id === id);
        if (existing) {
          existing.code = candidate.code;
          existing.description = candidate.description;
          existing.objective = candidate.objective;
          existing.parameters = candidate.parameters;
          existing.paramsSchema = candidate.paramsSchema ?? candidate.parameters.map(name => ({ name, type: 'unknown' }));
          existing.executionMode = candidate.executionMode;
          if (candidate.returns) existing.outputContract = { returns: candidate.returns, itemFields: ['file', 'line'], bounds: { maxItems: 50, maxBytes: 8000 } };
          existing.fingerprint = digest(`${candidate.code}\0${[...candidate.parameters].sort().join(',')}`).slice(0, 16);
          existing.version = Math.max(existing.version || 1, candidate.version ?? 1);
          existing.validated = true;
          existing.successes += 1;
          existing.revision = candidate.revision ?? existing.revision;
        } else {
          entries.push({
            id,
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
            successes: 1,
            failures: 0,
            fingerprint: digest(`${candidate.code}\0${[...candidate.parameters].sort().join(',')}`).slice(0, 16),
            version: candidate.version ?? 1,
            variantOf: candidate.variantOf,
            validated: true,
            referenceCases: []
          });
        }
        report.accepted.push(id);
      }
      prune();
      await persist();
      return report;
    },
    purges: () => purges
  };
}
