/**
 * Structured, compact, bounded and sourced outputs for script-memory tool
 * calls (memory_run / function_try).
 *
 * Issue #174 complement:
 * - outputs are compact and bounded (byte/item limits honored);
 * - a truncated output is NEVER presented as exhaustive (explicit flag);
 * - outputs are sourced (file/lines/revision) and distinguish
 *   demonstrated relations from uncertainty.
 */

export type BoundedItem = Record<string, unknown>;

export interface BoundedOutput<T> {
  /** The (possibly truncated) value itself. */
  result: T;
  /** Items actually returned after bounding. */
  returned: number;
  /** Items observed before bounding, when countable. */
  observed: number | null;
  /** True when content was cut — the output is then NOT exhaustive. */
  truncated: boolean;
  /** Bounds applied. */
  bounds: { maxItems: number; maxBytes: number };
  /** Byte size of the serialized result. */
  bytes: number;
  /** Sourcing: workspace revision the execution ran against. */
  revision: string;
  /** Provenance of the evidence inside the result. */
  provenance: 'primitive-derived' | 'unverified';
  /** What remains uncertain about this output (empty if fully bounded and proven). */
  uncertainty: string[];
}

const DEFAULT_MAX_ITEMS = 50;
const DEFAULT_MAX_BYTES = 8000;

/** Shallow structural check: does the value look like primitive-derived evidence (file + line)? */
export function looksLikeEvidence(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.length > 0 && value.every(looksLikeEvidence);
  const item = value as Record<string, unknown>;
  return typeof item.file === 'string' && (typeof item.line === 'number' || typeof item.startLine === 'number');
}

/**
 * Wrap a raw script output into a bounded, sourced, explicit-truncation envelope.
 * The wrapper never invents content: it only cuts, counts and annotates.
 */
export function boundedOutput(
  value: unknown,
  options: { revision: string; maxItems?: number; maxBytes?: number; sourceTruncated?: boolean; primitiveDerived?: boolean; unbounded?: Array<{ items?: unknown[]; raw?: unknown }> }
): BoundedOutput<unknown> {
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const uncertainty: string[] = [options.primitiveDerived ? 'Primitive matches provide syntactic evidence, not semantic certainty or proof of absence.' : 'No primitive-derived evidence is verified for this output; relations remain unverified.'];
  let result: unknown = value;
  let observed: number | null = null;
  let truncated = options.sourceTruncated ?? false;

  if (Array.isArray(value)) {
    observed = value.length;
    if (value.length > maxItems) {
      result = value.slice(0, maxItems);
      truncated = true;
    }
  } else if (looksLikeEvidence(value)) {
    observed = 1;
  }

  let bytes = serializedBytes(result);
  if (bytes > maxBytes) {
    if (Array.isArray(result)) {
      let items = result.slice(0, Math.max(1, result.length));
      while (items.length > 0 && serializedBytes(items) > maxBytes) items = items.slice(0, items.length - 1);
      truncated = truncated || items.length < (observed ?? items.length);
      result = items;
    } else {
      const preview = contentPreview(value, maxBytes);
      result = preview;
      truncated = true;
    }
    bytes = serializedBytes(result);
  }

  if (truncated) uncertainty.push(`Output truncated to ${maxItems} items / ${maxBytes} bytes; it is NOT exhaustive. Re-run with narrower params to see the remainder.`);
  if (observed === 0) uncertainty.push('No matches observed for these params.');
  if (typeof result === 'string' && result.length === 0) uncertainty.push('Empty output: the procedure returned nothing usable.');

  return {
    result,
    returned: Array.isArray(result) ? result.length : result === undefined ? 0 : 1,
    observed,
    truncated,
    bounds: { maxItems, maxBytes },
    bytes,
    revision: options.revision,
    provenance: options.primitiveDerived ? 'primitive-derived' : 'unverified',
    uncertainty,
  };
}

function serializedBytes(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value) ?? ''); } catch { return Infinity; }
}

function contentPreview(value: unknown, maxBytes: number): unknown {
  const stringified = typeof value === 'string' ? value : JSON.stringify(value);
  if (stringified === undefined) return { preview: String(value) };
  let text = stringified.slice(0, maxBytes);
  while (serializedBytes({ preview: text }) > maxBytes && text.length) text = text.slice(0, Math.floor(text.length * 0.8));
  return { preview: text };
}

/** Extract a few (file,line) references from an output for proof spot-checks. */
export function sampleEvidenceRefs(value: unknown, limit = 3): Array<{ file: string; line: number }> {
  const refs: Array<{ file: string; line: number }> = [];
  const visit = (item: unknown): void => {
    if (refs.length >= limit || !item || typeof item !== 'object') return;
    if (Array.isArray(item)) { for (const child of item) visit(child); return; }
    const record = item as Record<string, unknown>;
    const file = record.file;
    const line = typeof record.line === 'number' ? record.line : typeof record.startLine === 'number' ? record.startLine : undefined;
    if (typeof file === 'string' && typeof line === 'number') { refs.push({ file, line }); return; }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return refs;
}
