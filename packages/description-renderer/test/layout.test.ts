import { test } from "node:test";
import * as assert from "node:assert";
import { renderMermaidDiagram } from "../src/render";
import { measureContentBounds, parseSvgDocument } from "../src/dom";

test("wide diagrams fit native comments and leave space around their content", async () => {
  const source = [
    "flowchart LR",
    "  Client[Clients des centrales] --> Centrale[Centrale_Cameleon.WebApi]",
    "  Centrale -->|HTTP api/soti| Soti[Soti_Cameleon.WebApi]",
    "  Soti -->|HTTP + X-Config-File| Service[Service SOTI externe]"
  ].join("\n");
  const { png, svg } = await renderMermaidDiagram(source, "dark");
  assert.ok(png.readUInt32BE(16) <= 900, "diagram exceeds the comment reading width");

  const root = parseSvgDocument(svg).documentElement;
  const content = measureContentBounds(root);
  const [x, y, width, height] = root.getAttribute("viewBox")!.split(/\s+/).map(Number);
  assert.ok(content.x - x >= 24, "no left breathing room");
  assert.ok(content.y - y >= 24, "no top breathing room");
  assert.ok(x + width - content.x - content.width >= 24, "no right breathing room");
  assert.ok(y + height - content.y - content.height >= 24, "no bottom breathing room");
});

test("a decision diamond reserves its own vertical space in the layout", async () => {
  const source = [
    "flowchart TD",
    "  A[Agent IA] --> B[Serveur MCP]",
    "  B --> C{HEAD identique}",
    "  C -->|oui| D[merge-base]",
    "  C -->|non| I[Erreur STALE_HEAD]"
  ].join("\n");
  const { svg } = await renderMermaidDiagram(source, "light");

  // Each node group carries its layout position; each shape is measured with
  // the production getBBox() Mermaid feeds to its layout engine, so a shape
  // the polyfill cannot measure (the pre-fix polygon case) is caught here
  // rather than silently reading as an empty box.
  const document = parseSvgDocument(svg);
  const spans = new Map<string, { top: number; bottom: number; height: number }>();
  for (const node of Array.from(document.querySelectorAll("g.node"))) {
    const letter = (node.getAttribute("id") || "").match(/flowchart-([A-Z])-/)?.[1];
    const ty = Number(
      (node.getAttribute("transform") || "").match(/translate\([^,]+,\s*([^)]+)\)/)?.[1]
    );
    const shape = node.firstElementChild as unknown as
      | { getBBox(): { y: number; height: number } }
      | null;
    if (!letter || !shape || shape.getBBox === undefined || isNaN(ty)) {
      continue;
    }
    const box = shape.getBBox();
    spans.set(letter, { top: ty + box.y, bottom: ty + box.y + box.height, height: box.height });
  }

  assert.ok(spans.has("C"), "the decision node was not found in the SVG");
  assert.ok(spans.has("B"), "the node above the decision was not found in the SVG");
  assert.ok(spans.get("C")!.height > 0, "the decision diamond measures as an empty box");
  assert.ok(
    spans.get("C")!.top >= spans.get("B")!.bottom,
    "the decision diamond overlaps the node above it"
  );
  // Both branch targets must exist before the diamond clears them.
  assert.ok(spans.has("D"), "the oui branch was not found in the SVG");
  assert.ok(spans.has("I"), "the non branch was not found in the SVG");
  assert.ok(
    spans.get("C")!.bottom <= spans.get("D")!.top,
    "the decision diamond overlaps the oui branch"
  );
  assert.ok(
    spans.get("C")!.bottom <= spans.get("I")!.top,
    "the decision diamond overlaps the non branch"
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`edge label backgrounds cover their text in ${theme} mode`, async () => {
    const { svg } = await renderMermaidDiagram(
      "flowchart TD\n A{Validation hors ligne} -->|Erreur| B[Correction]\n A -->|OK| C[Fichier de tour]",
      theme
    );
    const labels = parseSvgDocument(svg).querySelectorAll(".edgeLabels .label");
    assert.strictEqual(labels.length, 2);
    for (const label of Array.from(labels)) {
      const rect = label.querySelector("rect.background")!;
      const line = label.querySelector("text > tspan")!;
      // SVG applies dy on top of y, even when both are specified.
      const baseline = (parseFloat(line.getAttribute("y")!) +
        parseFloat(line.getAttribute("dy")!)) * 16;
      const top = Number(rect.getAttribute("y"));
      const bottom = top + Number(rect.getAttribute("height"));
      assert.ok(top <= baseline - 16 * 0.85, "background starts below text");
      assert.ok(bottom >= baseline + 16 * 0.3, "background ends above text");
    }
  });
}
