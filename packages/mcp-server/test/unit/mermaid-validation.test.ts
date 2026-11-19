import * as assert from "node:assert";
import { test } from "node:test";
import { MERMAID_TOOL_GUIDANCE, validateMermaidDescriptions } from "../../src/mermaid-validation";
import {
  ALLOWED_DIAGRAM_SOURCES,
  INVALID_FLOWCHART_SOURCE,
  captionedDiagram,
} from "../helpers/mermaid-fixtures";

const SUPPORTED_KINDS =
  "flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram";

test("a fence without any preceding caption line reports found: undefined", async () => {
  const issues = await validateMermaidDescriptions({
    description: ["```mermaid", ALLOWED_DIAGRAM_SOURCES.flowchart, "```"].join("\n"),
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].path, "description.mermaid[0].caption");
  assert.equal(
    issues[0].message,
    "the Mermaid fence at line 1, column 1 requires a nearest non-blank caption: " +
      "a single bold line of the form **Diagram — <descriptive text>**, with a literal em dash " +
      "(U+2014) between Diagram and the descriptive text, and the … in the shorthand " +
      "**Diagram — …** is a placeholder for descriptive text, not a literal ellipsis; " +
      "found: undefined"
  );
});

test("a caption with a simple hyphen reports the found line verbatim", async () => {
  const issues = await validateMermaidDescriptions({
    description: [
      "**Diagram - Request lifecycle**",
      "",
      "```mermaid",
      ALLOWED_DIAGRAM_SOURCES.flowchart,
      "```",
    ].join("\n"),
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].path, "description.mermaid[0].caption");
  assert.equal(
    issues[0].message,
    "the Mermaid fence at line 3, column 1 requires a nearest non-blank caption: " +
      "a single bold line of the form **Diagram — <descriptive text>**, with a literal em dash " +
      "(U+2014) between Diagram and the descriptive text, and the … in the shorthand " +
      "**Diagram — …** is a placeholder for descriptive text, not a literal ellipsis; " +
      'found: "**Diagram - Request lifecycle**"'
  );
});

test("a caption with invisible characters is revealed by JSON.stringify", async () => {
  const issues = await validateMermaidDescriptions({
    description: [
      "Overview of the\u000barchitecture",
      "",
      "```mermaid",
      ALLOWED_DIAGRAM_SOURCES.flowchart,
      "```",
    ].join("\n"),
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].path, "description.mermaid[0].caption");
  assert.equal(
    issues[0].message,
    "the Mermaid fence at line 3, column 1 requires a nearest non-blank caption: " +
      "a single bold line of the form **Diagram — <descriptive text>**, with a literal em dash " +
      "(U+2014) between Diagram and the descriptive text, and the … in the shorthand " +
      "**Diagram — …** is a placeholder for descriptive text, not a literal ellipsis; " +
      'found: "Overview of the\\u000barchitecture"'
  );
});

test("an unsupported diagram kind reports the found kind and the supported kinds", async () => {
  const issues = await validateMermaidDescriptions({
    description: captionedDiagram("Breakdown", "pie"),
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].path, "description.mermaid[0].kind");
  assert.equal(
    issues[0].message,
    'the Mermaid source at line 3, column 1 uses an unsupported kind; found: "pie"; ' +
      `supported kinds are ${SUPPORTED_KINDS}`
  );
});

test("a diagram without a detectable kind reports found: undefined", async () => {
  const issues = await validateMermaidDescriptions({
    description: captionedDiagram("Breakdown", "%% only a comment"),
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].path, "description.mermaid[0].kind");
  assert.equal(
    issues[0].message,
    "the Mermaid source at line 3, column 1 uses an unsupported kind; found: undefined; " +
      `supported kinds are ${SUPPORTED_KINDS}`
  );
});

test("an invalid Mermaid source reports the engine message and the found source text", async () => {
  const issues = await validateMermaidDescriptions({
    description: captionedDiagram("Request lifecycle", INVALID_FLOWCHART_SOURCE),
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].path, "description.mermaid[0].source");
  // The engine part is pinned exactly on purpose: the engine is locked
  // (DESCRIPTION_RENDERER_VERSION), and a parser wording change must force
  // this contract — and the served guidance — to be re-evaluated.
  assert.equal(
    issues[0].message,
    "the Mermaid source at line 3, column 1 has invalid Mermaid syntax; " +
      "the diagram engine reports: Parse error on line 2: ...owchart TD this is not mermaid at al " +
      "----------------------^ Expecting 'SEMI', 'NEWLINE', 'EOF', 'AMP', 'START_LINK', " +
      "'LINK', 'LINK_ID', got 'NODE_STRING'; " +
      'found: "flowchart TD\\n    this is not mermaid at all ((("'
  );
});

test("the historical colon edge-label refusal reports the engine's expectation", async () => {
  // The form the former guidance example shipped (`Client --> API: places
  // orders (HTTPS)`). What the agent now receives names the offending token,
  // turning the correction into an edit instead of a guess.
  const issues = await validateMermaidDescriptions({
    description: captionedDiagram(
      "Request lifecycle",
      "flowchart LR\nClient --> API: places orders (HTTPS)"
    ),
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].path, "description.mermaid[0].source");
  assert.equal(
    issues[0].message,
    "the Mermaid source at line 3, column 1 has invalid Mermaid syntax; " +
      "the diagram engine reports: Parse error on line 2: ... LRClient --> API: places orders (HTTPS " +
      "----------------------^ Expecting 'SEMI', 'NEWLINE', 'EOF', 'AMP', 'START_LINK', " +
      "'LINK', 'LINK_ID', got 'NODE_STRING'; " +
      'found: "flowchart LR\\nClient --> API: places orders (HTTPS)"'
  );
});

test("an invalid Mermaid source above the excerpt bound reports a bounded excerpt", async () => {
  const junkSource = [
    "flowchart TD",
    ...Array.from(
      { length: 200 },
      (_, index) => `    junk line ${index} ${"x".repeat(78)} (((`
    ),
  ].join("\n");
  assert.ok(junkSource.length > 20 * 1000);
  assert.ok(Buffer.byteLength(junkSource, "utf8") <= 20 * 1024);
  const issues = await validateMermaidDescriptions({
    description: captionedDiagram("Request lifecycle", junkSource),
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].path, "description.mermaid[0].source");
  assert.ok(
    issues[0].message.startsWith(
      "the Mermaid source at line 3, column 1 has invalid Mermaid syntax; the diagram engine reports: "
    )
  );
  assert.ok(issues[0].message.length < 600);
  assert.ok(issues[0].message.includes("[truncated]"));
});

test("the tool guidance states the exact caption grammar with U+2014", () => {
  assert.ok(
    MERMAID_TOOL_GUIDANCE.includes(
      "a single bold line of the form **Diagram — <descriptive text>**, with a literal em dash " +
        "(U+2014) between Diagram and the descriptive text, and the … in the shorthand " +
        "**Diagram — …** is a placeholder for descriptive text, not a literal ellipsis"
    )
  );
});
