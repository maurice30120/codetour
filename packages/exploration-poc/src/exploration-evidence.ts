import { z } from 'zod';

const evidence = z.object({ file: z.string().min(1), startLine: z.number().int().positive(), endLine: z.number().int().positive() });
const item = z.object({ name: z.string(), evidence: z.array(evidence) });
export const resultSchema = z.object({ objective: z.string(), entryPoints: z.array(item), components: z.array(item), relations: z.array(z.object({ from: z.string(), to: z.string(), evidence: z.array(evidence) })), uncertainties: z.array(z.string()) });


/** Collect observed source lines and attach matching evidence to unsupported result items. */
export function createEvidenceTracker() {
  // Deterministic evidence attachment: every (file, line) range actually
  // observed through tool outputs is recorded here; items the model names
  // without evidence in its final answer are anchored from this buffer.
  const observedEvidence: Array<{ file: string; line: number; text: string }> = [];
  const noteEvidence = (node: unknown, file?: string): void => {
    if (!node || typeof node !== 'object' || observedEvidence.length >= 4000) return;
    if (Array.isArray(node)) { for (const child of node) noteEvidence(child, file); return; }
    const record = node as Record<string, unknown>;
    const currentFile = typeof record.file === 'string' && record.file ? record.file : file;
    if (typeof record.line === 'number' && Number.isInteger(record.line) && record.line > 0 && currentFile) {
      observedEvidence.push({ file: currentFile, line: record.line, text: typeof record.text === 'string' ? record.text : '' });
    }
    for (const value of Object.values(record)) if (value && typeof value === 'object') noteEvidence(value, currentFile);
  };
  const EVIDENCE_STOPWORDS = new Set(['and', 'the', 'for', 'with', 'from', 'this', 'that', 'into', 'onto', 'aux', 'avec', 'des', 'dans', 'dont', 'est', 'les', 'une', 'pour', 'quoi', 'sur', 'entre', 'vers']);
  const attachEvidence = (result: z.infer<typeof resultSchema>): number => {
    let attached = 0;
    for (const target of [...result.entryPoints, ...result.components, ...result.relations]) {
      if (target.evidence.length > 0) continue;
      const label = 'name' in target ? target.name : `${target.from} ${target.to}`;
      const lowered = (label.match(/[A-Za-z0-9]+/g) ?? []).map(token => token.toLowerCase()).filter(token => token.length >= 3 && !EVIDENCE_STOPWORDS.has(token));
      if (!lowered.length) continue;
      const picked: z.infer<typeof resultSchema>['entryPoints'][number]['evidence'] = [];
      const seen = new Set<string>();
      for (const observed of observedEvidence) {
        const haystack = `${observed.file}\n${observed.text}`.toLowerCase();
        if (!lowered.some(term => haystack.includes(term))) continue;
        const key = `${observed.file}:${observed.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        picked.push({ file: observed.file, startLine: observed.line, endLine: observed.line });
        if (picked.length >= 3) break;
      }
      if (picked.length) { target.evidence = picked; attached += picked.length; }
    }
    return attached;
  };
  return { noteEvidence, attachEvidence };
}
