import { test } from "node:test";
import * as assert from "node:assert";
import { renderDescription } from "../src/description";
import { renderMermaidDiagram } from "../src/render";
import { sanitizeSvg } from "../src/sanitize";
import {
  CAPTIONED_FLOWCHART_DESCRIPTION,
  HOSTILE_INTERACTION_SOURCE,
  HOSTILE_LABEL_SOURCES,
  HOSTILE_MARKDOWN_LABEL_SOURCE,
  assertValidPng,
  captionedDiagram,
  extractPngDataUri,
  findImageLine
} from "./helpers/fixtures";

const IMAGE_LINE_PATTERN = /^!\[[^\n]*\]\(data:image\/png;base64,[A-Za-z0-9+/=]+\)$/;

function assertStaticImageLine(content: string, caption: string): void {
  const line = findImageLine(content, caption);
  assert.match(line, IMAGE_LINE_PATTERN);
  assert.ok(!line.includes("<"));
}

test("strict security encodes hostile labels instead of embedding HTML", async () => {
  const source = [
    "flowchart TD",
    '    A["<img src=x onerror=alert(1)>"] --> B["<script>alert(2)</script>"]'
  ].join("\n");

  const { svg } = await renderMermaidDiagram(source, "light");

  assert.ok(!svg.includes("<img"));
  assert.ok(!svg.includes("onerror"));
  assert.ok(!svg.includes("<script"));
  assert.ok(!svg.includes("<foreignObject"));
});

test("strict security renders click interactions without anchors or handlers", async () => {
  const source = [
    "flowchart TD",
    "    A --> B",
    '    click A "https://example.com" "tooltip"'
  ].join("\n");

  const { svg } = await renderMermaidDiagram(source, "light");

  assert.ok(!svg.includes("<a "));
  assert.ok(!svg.includes("onclick"));
  assert.ok(!svg.includes("href"));
});

test("strict security keeps labels as SVG text, not embedded HTML", async () => {
  const { svg } = await renderMermaidDiagram(
    "flowchart TD\n    A[Label] --> B",
    "light"
  );

  assert.ok(!svg.includes("foreignObject"));
  assert.ok(svg.includes("<tspan"));
});

test("hostile labels in every allowed kind render as a static image only", async () => {
  for (const [kind, source] of Object.entries(HOSTILE_LABEL_SOURCES)) {
    const caption = `Diagram — Hostile ${kind}`;
    const content = await renderDescription(captionedDiagram(caption, source), "light");

    assertStaticImageLine(content, caption);
    assertValidPng(extractPngDataUri(content, caption));
    assert.ok(!content.includes("<script"), kind);
    assert.ok(!content.includes("```mermaid"), kind);
  }
});

test("hostile labels that fail to parse fall back to a warning, not the source", async () => {
  const caption = "Diagram — Hostile parse failure";
  const content = await renderDescription(
    captionedDiagram(
      caption,
      'flowchart TD\n    A["<script>alert(1)</script>"] is totally broken ((('
    ),
    "light"
  );

  assert.ok(content.includes("could not be rendered"));
  assert.ok(!content.includes("<script"));
  assert.ok(!content.includes("<img"));
  assert.ok(!content.includes("```mermaid"));
});

test("click callbacks, hrefs and link styles cannot become active output", async () => {
  const caption = "Diagram — Hostile interactions";
  const content = await renderDescription(
    captionedDiagram(caption, HOSTILE_INTERACTION_SOURCE),
    "light"
  );

  assertStaticImageLine(content, caption);
  assertValidPng(extractPngDataUri(content, caption));
  assert.ok(!content.includes("<a "));
  assert.ok(!content.includes("](https://"));
  assert.ok(!content.includes("command:codetour.nextTourStep"));
  assert.ok(!content.includes("```mermaid"));
});

test("markdown links inside labels cannot become active output", async () => {
  const caption = "Diagram — Hostile markdown label";
  const content = await renderDescription(
    captionedDiagram(caption, HOSTILE_MARKDOWN_LABEL_SOURCE),
    "light"
  );

  assertStaticImageLine(content, caption);
  assertValidPng(extractPngDataUri(content, caption));
  assert.ok(!content.includes("](https://evil.example)"));
  assert.ok(!content.includes("](command:"));
});

test("a caption containing brackets cannot break out of the image markdown", async () => {
  const caption = "Diagram — Reads [docs](https://example.com) and [run](command:x)";
  const content = await renderDescription(
    captionedDiagram(caption, "flowchart TD\n    A --> B"),
    "light"
  );

  assertStaticImageLine(content, caption);
  const line = findImageLine(content, caption);
  assert.equal(line.match(/!\[/g)!.length, 1);
  assert.equal(line.match(/\]\(data:image\/png;base64,/g)!.length, 1);
});

test("the final comment content contains no diagram HTML or commands", async () => {
  const content = await renderDescription(
    CAPTIONED_FLOWCHART_DESCRIPTION,
    "light"
  );

  const imageLine = findImageLine(content, "Diagram — Request lifecycle");
  assert.ok(!imageLine.includes("<"));
  assert.ok(!imageLine.includes("command:"));
  assertValidPng(extractPngDataUri(content, "Diagram — Request lifecycle"));
});

test("sanitizeSvg removes scripts, handlers, foreign content and anchors", () => {
  const hostile = [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">',
    "<script>alert(1)</script>",
    '<foreignObject><div>html</div></foreignObject>',
    '<rect x="0" y="0" width="4" height="4" onload="alert(2)"/>',
    '<a xlink:href="javascript:alert(3)"><rect x="5" y="5" width="2" height="2"/></a>',
    '<a href="https://example.com"><rect x="1" y="1" width="2" height="2"/></a>',
    "</svg>"
  ].join("");

  const sanitized = sanitizeSvg(hostile);

  assert.ok(!sanitized.includes("<script"));
  assert.ok(!sanitized.includes("foreignObject"));
  assert.ok(!sanitized.includes("onload"));
  assert.ok(!sanitized.includes("javascript:"));
  assert.ok(!sanitized.includes("href"));
  assert.ok(sanitized.includes("<rect"));
});

test("sanitizeSvg removes remote resource elements and external references", () => {
  const hostile = [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">',
    '<image x="0" y="0" width="4" height="4" xlink:href="https://evil.example/logo.png"/>',
    '<img x="5" y="5" width="2" height="2" href="https://evil.example/pixel.gif"/>',
    '<image x="0" y="6" width="2" height="2" href="data:text/html,hello"/>',
    '<rect x="8" y="8" width="1" height="1" href="https://evil.example/styled"/>',
    "</svg>"
  ].join("");

  const sanitized = sanitizeSvg(hostile);

  assert.ok(!sanitized.includes("<image"));
  assert.ok(!sanitized.includes("<img"));
  assert.ok(!sanitized.includes("evil.example"));
  assert.ok(!sanitized.includes("data:text/html"));
  assert.ok(sanitized.includes("<rect"));
});

test("sanitizeSvg keeps internal fragment references", () => {
  const ordinary = [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">',
    '<defs><path id="label-path" d="M0,0 H10"/></defs>',
    '<text><textPath xlink:href="#label-path">Label</textPath></text>',
    "</svg>"
  ].join("");

  const sanitized = sanitizeSvg(ordinary);

  assert.ok(sanitized.includes('xlink:href="#label-path"'));
  assert.ok(sanitized.includes("<textPath"));
});

test("sanitizeSvg preserves ordinary diagram markup", () => {
  const ordinary = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">',
    '<g transform="translate(1,1)"><text y="1"><tspan>Label</tspan></text></g>',
    '<rect x="0" y="0" width="4" height="4" fill="#ECECFF"/>',
    "</svg>"
  ].join("");

  const sanitized = sanitizeSvg(ordinary);

  assert.ok(sanitized.includes("<tspan>Label</tspan>"));
  assert.ok(sanitized.includes('fill="#ECECFF"'));
  assert.ok(sanitized.includes('transform="translate(1,1)"'));
});
