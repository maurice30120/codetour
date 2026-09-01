import { test } from "node:test";
import * as assert from "node:assert";
import { renderDescription } from "../src/description";
import { renderMermaidDiagram } from "../src/render";
import {
  CAPTIONED_FLOWCHART_DESCRIPTION,
  FLOWCHART_SOURCE,
  assertValidPng,
  extractPngDataUri
} from "./helpers/fixtures";

test("renderDescription renders a captioned flowchart as a PNG image", async () => {
  const content = await renderDescription(
    CAPTIONED_FLOWCHART_DESCRIPTION,
    "light"
  );

  const png = extractPngDataUri(content, "Diagram — Request lifecycle");
  assertValidPng(png);
});

test("renderDescription keeps the caption visible and uses it as alt text", async () => {
  const content = await renderDescription(
    CAPTIONED_FLOWCHART_DESCRIPTION,
    "light"
  );

  assert.ok(content.includes("**Diagram — Request lifecycle**"));
  assert.ok(content.includes("![Diagram — Request lifecycle](data:image/png"));
});

test("renderDescription hides the Mermaid source during playback", async () => {
  const content = await renderDescription(
    CAPTIONED_FLOWCHART_DESCRIPTION,
    "light"
  );

  assert.ok(!content.includes("```mermaid"));
  assert.ok(!content.includes("flowchart TD"));
  assert.ok(!content.includes("Client --> Gateway"));
});

test("renderDescription returns descriptions without Mermaid unchanged", async () => {
  const description = [
    "A plain description with text.",
    "",
    "```ts",
    "const answer = 42;",
    "```",
    "",
    "[Next tour](command:codetour.startTourByTitle?%5B%22Next%22%5D)"
  ].join("\n");

  assert.equal(await renderDescription(description, "light"), description);
  assert.equal(await renderDescription(description, "dark"), description);
});

test("renderDescription leaves uncaptioned Mermaid fences untouched", async () => {
  const description = [
    "Some text.",
    "",
    "```mermaid",
    FLOWCHART_SOURCE,
    "```"
  ].join("\n");

  assert.equal(await renderDescription(description, "light"), description);
});

test("renderDescription replaces an invalid diagram with a warning, not its source", async () => {
  const description = [
    "**Diagram — Broken diagram**",
    "",
    "```mermaid",
    "flowchart TD",
    "    this is not mermaid at all (((",
    "```"
  ].join("\n");

  const content = await renderDescription(description, "light");

  assert.ok(!content.includes("```mermaid"));
  assert.ok(!content.includes("this is not mermaid at all"));
  assert.ok(content.includes("could not be rendered"));
  assert.ok(content.includes("**Diagram — Broken diagram**"));
});

test("renderDescription renders diagrams in one description independently", async () => {
  const description = [
    "**Diagram — Valid diagram**",
    "",
    "```mermaid",
    FLOWCHART_SOURCE,
    "```",
    "",
    "**Diagram — Broken diagram**",
    "",
    "```mermaid",
    "nonsense ((((",
    "```"
  ].join("\n");

  const content = await renderDescription(description, "light");

  assertValidPng(extractPngDataUri(content, "Diagram — Valid diagram"));
  assert.ok(content.includes("could not be rendered"));
  assert.ok(!content.includes("nonsense"));
});

test("renderDescription adapts the rendered diagram to the theme", async () => {
  const light = await renderMermaidDiagram(FLOWCHART_SOURCE, "light");
  const dark = await renderMermaidDiagram(FLOWCHART_SOURCE, "dark");

  assertValidPng(light.png);
  assertValidPng(dark.png);
  assert.notEqual(light.svg, dark.svg);
  assert.ok(Buffer.compare(light.png, dark.png) !== 0);
});

test("renderMermaidDiagram returns a sanitized SVG and an in-memory PNG", async () => {
  const { svg, png } = await renderMermaidDiagram(FLOWCHART_SOURCE, "light");

  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes('viewBox="'));
  assert.ok(svg.includes(">Client</tspan>"));
  assertValidPng(png);
});
