import { test } from "node:test";
import * as assert from "node:assert";
import {
  ALLOWED_DIAGRAM_KINDS,
  MAX_DIAGRAMS_PER_DESCRIPTION,
  MAX_DIAGRAM_SOURCE_BYTES,
  diagramKindOf,
  diagramSourceByteLength,
  evaluateDiagramFence,
  isAllowedDiagramKind,
  isMermaidFenceInfo,
  matchDiagramCaption
} from "../src/rules";

test("the allowlist accepts exactly the five first-version diagram kinds", () => {
  assert.deepEqual(ALLOWED_DIAGRAM_KINDS, [
    "flowchart",
    "sequenceDiagram",
    "stateDiagram-v2",
    "classDiagram",
    "erDiagram"
  ]);
  assert.equal(MAX_DIAGRAMS_PER_DESCRIPTION, 3);
  assert.equal(MAX_DIAGRAM_SOURCE_BYTES, 20 * 1024);
});

test("diagramKindOf reads the kind from the first significant line", () => {
  assert.equal(diagramKindOf("flowchart TD\n    A --> B"), "flowchart");
  assert.equal(diagramKindOf("sequenceDiagram\n    A->>B: hi"), "sequenceDiagram");
  assert.equal(
    diagramKindOf("stateDiagram-v2\n    [*] --> Idle"),
    "stateDiagram-v2"
  );
  assert.equal(diagramKindOf("classDiagram\n    class A"), "classDiagram");
  assert.equal(diagramKindOf("erDiagram\n    A ||--o{ B : c"), "erDiagram");
});

test("diagramKindOf skips blank lines, comments and init directives", () => {
  assert.equal(
    diagramKindOf("\n\n%% a comment\n%%{init: {'theme':'base'}}%%\nflowchart TD\n    A --> B"),
    "flowchart"
  );
});

test("diagramKindOf returns undefined for empty or comment-only sources", () => {
  assert.equal(diagramKindOf(""), undefined);
  assert.equal(diagramKindOf("%% only a comment"), undefined);
  assert.equal(diagramKindOf("   \n  \n"), undefined);
});

test("diagramKindOf takes the first token, not the whole line", () => {
  assert.equal(diagramKindOf("pie title Pets"), "pie");
  assert.equal(diagramKindOf("squarewave TD"), "squarewave");
});

test("the allowlist is exact: aliases and other kinds are unsupported", () => {
  assert.equal(isAllowedDiagramKind("graph"), false);
  assert.equal(isAllowedDiagramKind("stateDiagram"), false);
  for (const kind of ["pie", "gantt", "mindmap", "journey", "gitGraph"]) {
    assert.equal(isAllowedDiagramKind(kind), false);
  }
  assert.equal(isAllowedDiagramKind("Flowchart"), false);
});

test("isMermaidFenceInfo accepts only the bare mermaid info string", () => {
  assert.equal(isMermaidFenceInfo("mermaid"), true);
  assert.equal(isMermaidFenceInfo("mermaid "), true);
  assert.equal(isMermaidFenceInfo("mermaid\t"), true);
  assert.equal(isMermaidFenceInfo("ts"), false);
  assert.equal(isMermaidFenceInfo("mermaid x"), false);
  assert.equal(isMermaidFenceInfo("Mermaid"), false);
  assert.equal(isMermaidFenceInfo(""), false);
});

test("matchDiagramCaption accepts a visible Diagram caption line", () => {
  assert.equal(
    matchDiagramCaption("**Diagram — Request lifecycle**"),
    "Diagram — Request lifecycle"
  );
  assert.equal(
    matchDiagramCaption("  **Diagram — Padded**  "),
    "Diagram — Padded"
  );
  assert.equal(
    matchDiagramCaption("**Diagram — Multi word caption with — dashes**"),
    "Diagram — Multi word caption with — dashes"
  );
});

test("matchDiagramCaption rejects malformed caption lines", () => {
  assert.equal(matchDiagramCaption("*Diagram — single stars*"), undefined);
  assert.equal(matchDiagramCaption("**Diagram – hyphen**"), undefined);
  assert.equal(matchDiagramCaption("**Diagram — **"), undefined);
  assert.equal(matchDiagramCaption("**Diagram —**"), undefined);
  assert.equal(matchDiagramCaption("Diagram — bare"), undefined);
  assert.equal(matchDiagramCaption("**Diagram — a** and **b**"), undefined);
  assert.equal(matchDiagramCaption("**Not a diagram — caption**"), undefined);
  assert.equal(matchDiagramCaption("Some intro text"), undefined);
  assert.equal(matchDiagramCaption("```"), undefined);
  assert.equal(matchDiagramCaption(""), undefined);
});

test("diagramSourceByteLength counts UTF-8 bytes, not characters", () => {
  assert.equal(diagramSourceByteLength("flowchart TD"), 12);
  assert.equal(diagramSourceByteLength("ééé"), 6);
  assert.equal(diagramSourceByteLength("—"), 3);
});

test("evaluateDiagramFence allows an in-bounds supported diagram", () => {
  assert.deepEqual(
    evaluateDiagramFence({ caption: "Diagram — x", source: "flowchart TD\n    A --> B" }),
    { allowed: true, kind: "flowchart" }
  );
});

test("evaluateDiagramFence rejects a missing caption before anything else", () => {
  const evaluation = evaluateDiagramFence({
    source: "pie title way too large" + "x".repeat(MAX_DIAGRAM_SOURCE_BYTES)
  });
  assert.deepEqual(evaluation, { allowed: false, reason: "caption" });
});

test("evaluateDiagramFence rejects an oversized source before reading its kind", () => {
  const evaluation = evaluateDiagramFence({
    caption: "Diagram — too big",
    source: "flowchart TD\n%%" + "x".repeat(MAX_DIAGRAM_SOURCE_BYTES)
  });
  assert.deepEqual(evaluation, { allowed: false, reason: "size" });
});

test("evaluateDiagramFence rejects an unsupported kind", () => {
  const evaluation = evaluateDiagramFence({
    caption: "Diagram — pie",
    source: "pie title Pets\n    \"Dogs\" : 386"
  });
  assert.deepEqual(evaluation, { allowed: false, reason: "kind", kind: "pie" });
});

test("evaluateDiagramFence reports the detected kind alongside the rejection", () => {
  const evaluation = evaluateDiagramFence({
    caption: "Diagram — gantt",
    source: "gantt\n    dateFormat YYYY-MM-DD"
  });
  assert.equal(evaluation.allowed, false);
  if (!evaluation.allowed) {
    assert.equal(evaluation.reason, "kind");
    assert.equal(evaluation.kind, "gantt");
  }
});

test("evaluateDiagramFence accepts a source of exactly 20 KB", () => {
  const source = "flowchart TD\n%%" + "x".repeat(
    MAX_DIAGRAM_SOURCE_BYTES - Buffer.byteLength("flowchart TD\n%%", "utf8")
  );
  const evaluation = evaluateDiagramFence({
    caption: "Diagram — boundary",
    source
  });
  assert.deepEqual(evaluation, { allowed: true, kind: "flowchart" });
});
