import { test } from "node:test";
import * as assert from "node:assert";
import {
  clearMermaidRenderCache,
  invalidateMermaidRenderCache,
  renderMermaidDiagram
} from "../src/render";
import { FLOWCHART_SOURCE } from "./helpers/fixtures";

test.beforeEach(() => {
  clearMermaidRenderCache();
});

test("renderMermaidDiagram reuses the exact source and effective theme", async () => {
  const first = await renderMermaidDiagram(FLOWCHART_SOURCE, "light");
  const second = await renderMermaidDiagram(FLOWCHART_SOURCE, "light");

  assert.strictEqual(second, first);
});

test("renderMermaidDiagram keeps exact source and theme variants separate", async () => {
  const light = await renderMermaidDiagram(FLOWCHART_SOURCE, "light");
  const dark = await renderMermaidDiagram(FLOWCHART_SOURCE, "dark");
  const sourceVariant = await renderMermaidDiagram(
    `${FLOWCHART_SOURCE}\n`,
    "light"
  );

  assert.notStrictEqual(dark, light);
  assert.notStrictEqual(sourceVariant, light);
  assert.notEqual(dark.svg, light.svg);
});

test("theme invalidation drops cached rendered diagrams", async () => {
  const first = await renderMermaidDiagram(FLOWCHART_SOURCE, "light");

  invalidateMermaidRenderCache();

  const second = await renderMermaidDiagram(FLOWCHART_SOURCE, "light");
  assert.notStrictEqual(second, first);
});
