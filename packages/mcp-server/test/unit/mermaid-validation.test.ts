import * as assert from "node:assert";
import { test } from "node:test";
import { MERMAID_TOOL_GUIDANCE, validateMermaidDescriptions } from "../../src/mermaid-validation";
import { ALLOWED_DIAGRAM_SOURCES } from "../helpers/mermaid-fixtures";

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

test("the tool guidance states the exact caption grammar with U+2014", () => {
  assert.ok(
    MERMAID_TOOL_GUIDANCE.includes(
      "a single bold line of the form **Diagram — <descriptive text>**, with a literal em dash " +
        "(U+2014) between Diagram and the descriptive text, and the … in the shorthand " +
        "**Diagram — …** is a placeholder for descriptive text, not a literal ellipsis"
    )
  );
});
