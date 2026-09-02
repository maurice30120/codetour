import { test } from "node:test";
import * as assert from "node:assert";
import { renderDescription } from "../src/description";
import { clearMermaidRenderCache, renderMermaidDiagram } from "../src/render";
import {
  assertValidPng,
  captionedDiagram,
  extractPngDataUri,
  FLOWCHART_SOURCE
} from "./helpers/fixtures";

// Regression for the "Save Step" flow not re-rendering Mermaid. After the
// source is edited and saved, the preview must show a PNG for the new source,
// hide the fence, and no longer match the previous diagram.
const PRIOR_SOURCE = FLOWCHART_SOURCE; // Client --> Gateway --> Service
const SAVED_SOURCE = [
  "flowchart TD",
  "    Author --> Reviewer --> Merge"
].join("\n");
const CAPTION = "Diagram — Saved step";

test.beforeEach(() => {
  clearMermaidRenderCache();
});

test("the preview after a save renders the new source as a PNG without a fence", async () => {
  // Before the edit, the step previewed the prior diagram.
  const priorPreview = await renderDescription(
    captionedDiagram(CAPTION, PRIOR_SOURCE),
    "light"
  );
  assertValidPng(extractPngDataUri(priorPreview, CAPTION));

  // After saving the edited source, the preview is regenerated from it.
  const savedPreview = await renderDescription(
    captionedDiagram(CAPTION, SAVED_SOURCE),
    "light"
  );

  assertValidPng(extractPngDataUri(savedPreview, CAPTION));
  assert.ok(!savedPreview.includes("```mermaid"));
  assert.ok(!savedPreview.includes("flowchart TD"));
  assert.ok(!savedPreview.includes("Author --> Reviewer"));
  assert.ok(!savedPreview.includes("Client --> Gateway"));
});

test("the regenerated image matches the saved source, not the prior one", async () => {
  const prior = await renderMermaidDiagram(PRIOR_SOURCE, "light");
  const saved = await renderMermaidDiagram(SAVED_SOURCE, "light");

  assert.ok(prior.svg.includes("Client"));
  assert.ok(!prior.svg.includes("Author"));
  assert.ok(saved.svg.includes("Author"));
  assert.ok(!saved.svg.includes("Client"));
  assert.ok(Buffer.compare(saved.png, prior.png) !== 0);
});
