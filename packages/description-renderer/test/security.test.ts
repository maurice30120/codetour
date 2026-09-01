import { test } from "node:test";
import * as assert from "node:assert";
import { renderDescription } from "../src/description";
import { renderMermaidDiagram } from "../src/render";
import { sanitizeSvg } from "../src/sanitize";
import {
  CAPTIONED_FLOWCHART_DESCRIPTION,
  assertValidPng,
  extractPngDataUri
} from "./helpers/fixtures";

test("strict security encodes hostile labels instead of embedding HTML", async () => {
  const source = [
    "flowchart TD",
    '    A["<img src=x onerror=alert(1)>"] --> B["<script>alert(2)</script>"]'
  ].join("\n");

  const { svg } = await renderMermaidDiagram(source, "light");

  assert.ok(!svg.includes("<img"));
  assert.ok(!svg.includes("onerror"));
  assert.ok(!svg.includes("<script"));
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

test("the final comment content contains no diagram HTML or commands", async () => {
  const content = await renderDescription(
    CAPTIONED_FLOWCHART_DESCRIPTION,
    "light"
  );

  const imageLine = content
    .split("\n")
    .find(line => line.startsWith("![Diagram — Request lifecycle"));
  assert.ok(imageLine);
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
