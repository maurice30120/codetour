export const ALLOWED_DIAGRAM_SOURCES: Record<string, string> = {
  flowchart: "flowchart TD\n    A --> B",
  sequenceDiagram: "sequenceDiagram\n    A->>B: Hello",
  "stateDiagram-v2": "stateDiagram-v2\n    [*] --> Idle",
  classDiagram: "classDiagram\n    class Account {\n      +String id\n    }",
  erDiagram: "erDiagram\n    CUSTOMER ||--o{ ORDER : places",
};

export function captionedDiagram(caption: string, source: string): string {
  return [`**Diagram — ${caption}**`, "", "```mermaid", source, "```"].join(
    "\n"
  );
}

export function oversizedFlowchartSource(): string {
  const prefix = "flowchart TD\n    A --> B\n%%";
  return prefix + "x".repeat(20 * 1024 + 1 - Buffer.byteLength(prefix, "utf8"));
}

export const INVALID_FLOWCHART_SOURCE = [
  "flowchart TD",
  "    this is not mermaid at all (((",
].join("\n");
