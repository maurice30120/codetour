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
