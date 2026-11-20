/**
 * Deterministic citation validation for function_try outputs
 * (issue #185, spec #183 — D02).
 *
 * Every mandatory reference a trial emits — any object carrying a `file`
 * field — is verified without any LLM: workspace confinement, file presence,
 * positive line bounds, startLine <= endLine, end within the real file, exact
 * excerpt equality when an excerpt is provided, and revision match when the
 * reference claims one. Partial validity is explicit: valid references stay
 * visible in the diagnostic and only the faulty ones are identified for
 * repair. The validator proves structural integrity only, never semantic
 * relevance — an existing citation is not proof of a business relation.
 */

import { FileTooLargeError, PathOutsideWorkspaceError } from './primitives.ts';
import { DEFAULT_CONFIG } from './config.ts';

/** Confined read of the actual lines [startLine..endLine] plus the real total line count. */
export interface CitationAccess {
  readRange(file: string, startLine: number, endLine: number): Promise<{ lines: string[]; totalLines: number }>;
}

/** A single source reference: confined file path plus an exact line range. */
export interface Reference {
  file: string;
  startLine: number;
  endLine: number;
}

export interface InvalidCitation extends Partial<Reference> {
  /** Short, structured, actionable error strings (type + path/line detail). */
  errors: string[];
}

export interface CitationValidation {
  /** 'valid' only when every emitted reference was verified; a failed trial is never treated as validated. */
  status: 'valid' | 'validation_failed' | 'no_references';
  /** Total mandatory references found in the output. */
  references: number;
  /** References actually verified (bounded by the safety ceiling). */
  validated: number;
  validCount: number;
  /** Bounded list of the valid references (diagnostic visibility). */
  validReferences: Reference[];
  /** Bounded list of only the faulty references, for repair. */
  invalidReferences: InvalidCitation[];
  /** False when the ceiling stopped validation: the output is then NOT proven exhaustive. */
  exhaustive: boolean;
}

/** Safety ceiling: at most this many references are verified per trial (configurable). */
/** Citation spans must fit a single confined read (workspace MAX_READ_LINES). */
const MAX_SPAN_LINES = 100;
/** Bounded diagnostic lists. */
const MAX_LISTED = 10;
/** Per-line excerpt truncation bounds of the permanent primitives (searchText/readLines: 2000, searchIdentifiers/findDefinitions: 500). */
const EXCERPT_PREFIX_BOUNDS = [500, 2000];
/** Fields that carry the reference's own excerpt — never recursed into as nested references. */
const EXCERPT_KEYS = ['text', 'excerpt', 'lineText', 'lines'];

/** Recursively collect every file-bearing object: those are the mandatory references. */
function collectReferences(value: unknown, out: Record<string, unknown>[]): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const child of value) collectReferences(child, out);
    return out;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.file === 'string') out.push(record);
  for (const [key, child] of Object.entries(record)) {
    if (!EXCERPT_KEYS.includes(key)) collectReferences(child, out);
  }
  return out;
}

export async function validateCitations(value: unknown, options: { access: CitationAccess; revision?: string; maxReferences?: number }): Promise<CitationValidation> {
  const references = collectReferences(value, []);
  if (references.length === 0) {
    return { status: 'no_references', references: 0, validated: 0, validCount: 0, validReferences: [], invalidReferences: [], exhaustive: true };
  }
  const ceiling = options.maxReferences ?? DEFAULT_CONFIG.citations.maxReferences;
  const invalid: InvalidCitation[] = [];
  const valid: Reference[] = [];
  let validated = 0;
  for (const reference of references) {
    if (validated >= ceiling) break;
    validated++;
    const check = await checkReference(reference, options);
    if (check.invalid) invalid.push(check.invalid);
    else valid.push(check.valid);
  }
  const exhaustive = validated === references.length;
  if (!exhaustive) {
    invalid.push({ errors: [`${references.length} references emitted; only ${validated} validated — the output is NOT proven exhaustive. Narrow the function output to at most ${ceiling} references and retry.`] });
  }
  return {
    status: invalid.length > 0 ? 'validation_failed' : 'valid',
    references: references.length,
    validated,
    validCount: valid.length,
    validReferences: valid.slice(0, MAX_LISTED),
    invalidReferences: invalid.slice(0, MAX_LISTED),
    exhaustive
  };
}

/** Result of checking one emitted reference: either the verified reference or the faulty one with its errors. */
type ReferenceCheck = { valid: Reference; invalid?: undefined } | { valid?: undefined; invalid: InvalidCitation };

/** Check one emitted reference against the actual workspace and return it verified or faulty. */
async function checkReference(reference: Record<string, unknown>, options: { access: CitationAccess; revision?: string }): Promise<ReferenceCheck> {
  const file = reference.file as string;
  const errors: string[] = [];
  const fault: InvalidCitation = { file, errors };
  if (!file) errors.push('file is empty');
  const start = reference.line ?? reference.startLine ?? reference.start;
  if (start === undefined) {
    errors.push('no line number: expected line, startLine or start to be a positive integer');
    return { invalid: fault };
  }
  if (typeof start !== 'number' || !Number.isInteger(start) || start < 1) {
    errors.push(`line must be a positive integer, got ${String(start)}`);
    if (typeof start === 'number') fault.startLine = start;
    return { invalid: fault };
  }
  fault.startLine = start;
  const linesExcerpt = Array.isArray(reference.lines) && reference.lines.every(line => typeof line === 'string') ? (reference.lines as string[]) : undefined;
  const end = reference.endLine ?? (linesExcerpt ? start + linesExcerpt.length - 1 : start);
  if (typeof end !== 'number' || !Number.isInteger(end)) {
    errors.push(`endLine must be an integer, got ${String(end)}`);
    return { invalid: fault };
  }
  fault.endLine = end;
  if (end < start) {
    errors.push(`inverted range: startLine ${start} is greater than endLine ${end}`);
    return { invalid: fault };
  }
  if (end - start + 1 > MAX_SPAN_LINES) {
    errors.push(`range spans ${end - start + 1} lines; citations are limited to ${MAX_SPAN_LINES} lines`);
    return { invalid: fault };
  }
  const claimed = reference.revision;
  if (typeof claimed === 'string' && claimed && options.revision && options.revision !== 'unknown-revision' && !options.revision.startsWith(claimed.slice(0, 12))) {
    errors.push(`reference revision ${claimed.slice(0, 12)} does not match the workspace revision ${options.revision.slice(0, 12)}`);
  }
  let read: { lines: string[]; totalLines: number };
  try {
    read = await options.access.readRange(file, start, end);
  } catch (error) {
    errors.push(String((error as Error)?.message ?? error).slice(0, 200));
    return { invalid: fault };
  }
  if (end > read.totalLines) {
    errors.push(`endLine ${end} is beyond the end of the file (${read.totalLines} lines)`);
    return { invalid: fault };
  }
  if (linesExcerpt) {
    if (linesExcerpt.length !== end - start + 1) errors.push(`excerpt covers ${linesExcerpt.length} lines but the range spans ${end - start + 1}`);
    else linesExcerpt.forEach((excerpt, index) => {
      if (!excerptMatches(read.lines[index], excerpt)) errors.push(`excerpt at line ${start + index} does not match the file content`);
    });
  }
  const textExcerpt = typeof reference.text === 'string' ? reference.text : typeof reference.excerpt === 'string' ? reference.excerpt : typeof reference.lineText === 'string' ? reference.lineText : undefined;
  if (textExcerpt !== undefined && !excerptMatches(read.lines.join('\n'), textExcerpt)) {
    errors.push(`excerpt does not match the file content at lines ${start}-${end}`);
  }
  return errors.length > 0 ? { invalid: fault } : { valid: { file, startLine: start, endLine: end } };
}

/** Exact equality, or a prefix at one of the primitives' documented per-line truncation bounds. */
function excerptMatches(actual: string, excerpt: string): boolean {
  const safeBoundary = EXCERPT_PREFIX_BOUNDS.some(bound => excerpt.length === bound - 1 && /[\uD800-\uDBFF]/.test(actual[bound - 1] ?? '') && /[\uDC00-\uDFFF]/.test(actual[bound] ?? ''));
  return actual === excerpt || ((EXCERPT_PREFIX_BOUNDS.includes(excerpt.length) || safeBoundary) && actual.startsWith(excerpt));
}

/**
 * Short, structured, actionable repair feedback for the model: an error line
 * plus the valid references (visibility) and only the faulty ones (repair).
 */
export function citationRepairFeedback(citations: CitationValidation): { error: string; validation: { status: 'validation_failed'; message: string; validCount: number; validReferences: Reference[]; invalidReferences: InvalidCitation[] } } {
  return {
    error: `invalid_citation: ${citations.invalidReferences.length} of ${citations.references} references invalid`.slice(0, 240),
    validation: {
      status: 'validation_failed',
      message: `The trial is NOT validated: ${citations.validCount} of ${citations.references} references are valid (first ${citations.validReferences.length} listed). Fix only the faulty reference(s) below, then call function_try again with corrected code.`,
      validCount: citations.validCount,
      validReferences: citations.validReferences,
      invalidReferences: citations.invalidReferences
    }
  };
}

/** Adapter from the confined workspace tools to the validator's read contract. */
export function citationAccess(tools: { readLines(file: string, options: { startLine?: number; endLine?: number; fresh?: boolean }): Promise<{ lines: Array<{ line: number; text: string }>; totalLines: number }> }): CitationAccess {
  return {
    async readRange(file, startLine, endLine) {
      try {
        if (/(?:^|\/)\.tours\/\.scratch(?:\/|$)/.test(file.replace(/\\/g, '/').replace(/(?:^|\/)\.\//g, '/'))) throw new Error('temporary scratch results cannot be cited');
        const result = await tools.readLines(file, { startLine, endLine });
        return { lines: result.lines.map(line => line.text), totalLines: result.totalLines };
      } catch (error) {
        throw new Error(classifyReadError(error, file));
      }
    }
  };
}

function classifyReadError(error: unknown, file: string): string {
  const message = String((error as Error)?.message ?? error);
  if (error instanceof PathOutsideWorkspaceError || /outside the workspace/i.test(message)) return `path escapes the workspace: ${file}`;
  if (error instanceof FileTooLargeError || /too large/i.test(message)) return `file too large to read: ${file}`;
  if (/ENOENT|no such file/i.test(message)) return `file not found: ${file}`;
  return `file unreadable: ${message.slice(0, 120)}`;
}
