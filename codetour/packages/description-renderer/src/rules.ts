export const ALLOWED_DIAGRAM_KINDS = [
  "flowchart",
  "sequenceDiagram",
  "stateDiagram-v2",
  "classDiagram",
  "erDiagram"
] as const;

export type AllowedDiagramKind = (typeof ALLOWED_DIAGRAM_KINDS)[number];

export const MAX_DIAGRAMS_PER_DESCRIPTION = 3;

export const MAX_DIAGRAM_SOURCE_BYTES = 20 * 1024;

export type DiagramRuleReason = "caption" | "size" | "kind";

const MERMAID_FENCE_INFO_PATTERN = /^mermaid[ \t]*$/;

const CAPTION_PATTERN = /^\s*\*\*(Diagram — (?:(?!\*\*).)+)\*\*[ \t]*$/;

const SIGNIFICANT_LINE_PATTERN = /^(?!\s*%%)[^\s]/;

export function isMermaidFenceInfo(info: string): boolean {
  return MERMAID_FENCE_INFO_PATTERN.test(info);
}

export function isAllowedDiagramKind(kind: string): kind is AllowedDiagramKind {
  return (ALLOWED_DIAGRAM_KINDS as readonly string[]).includes(kind);
}

export function matchDiagramCaption(line: string): string | undefined {
  const match = line.match(CAPTION_PATTERN);
  return match ? match[1].trim() : undefined;
}

export function diagramKindOf(source: string): string | undefined {
  for (const line of source.split("\n")) {
    if (!SIGNIFICANT_LINE_PATTERN.test(line)) {
      continue;
    }
    return line.trim().split(/\s+/)[0];
  }
  return undefined;
}

export function diagramSourceByteLength(source: string): number {
  return Buffer.byteLength(source, "utf8");
}

export interface DiagramFenceInput {
  caption?: string;
  source: string;
}

export type DiagramFenceEvaluation =
  | { allowed: true; kind: AllowedDiagramKind }
  | { allowed: false; reason: DiagramRuleReason; kind?: string };

export function evaluateDiagramFence(
  fence: DiagramFenceInput
): DiagramFenceEvaluation {
  if (!fence.caption) {
    return { allowed: false, reason: "caption" };
  }

  if (diagramSourceByteLength(fence.source) > MAX_DIAGRAM_SOURCE_BYTES) {
    return { allowed: false, reason: "size" };
  }

  const kind = diagramKindOf(fence.source);
  if (!kind || !isAllowedDiagramKind(kind)) {
    return { allowed: false, reason: "kind", kind };
  }

  return { allowed: true, kind };
}
