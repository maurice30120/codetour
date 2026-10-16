import { test } from "node:test";
import * as assert from "node:assert";
import { spaceDescriptionImages, spaceDescriptionLists } from "./readability";
import { renderMarkdownToHtml } from "./markdown";

test("top-level list items render as separate paragraphs", () => {
  for (const markers of [["-", "-"], ["1.", "2."]]) {
    const content = `${markers[0]} First idea\n${markers[1]} Second idea`;
    const spaced = spaceDescriptionLists(content);
    assert.match(renderMarkdownToHtml(spaced), /<li>\s*<p>First idea<\/p>/);
    assert.match(renderMarkdownToHtml(spaced), /<li>\s*<p>Second idea<\/p>/);
    assert.equal(spaceDescriptionLists(spaced), spaced);
  }
});

test("spacing preserves nested lists, code fences, links and paragraph text", () => {
  const content = [
    "Intro with `code` and [a link](https://example.com).",
    "",
    "- First idea",
    "  - Nested detail",
    "  - Another detail",
    "- Second idea",
    "",
    "```md",
    "- Code, not a list",
    "- Still code",
    "```",
    "",
    "> - Quoted item",
    "> - Another quoted item"
  ].join("\n");
  assert.equal(
    spaceDescriptionLists(content),
    content.replace("\n- Second idea", "\n\n- Second idea")
  );
});

test("already spaced descriptions remain unchanged", () => {
  const content = "# Overview\n\nFirst paragraph.\n\n- One\n\n- Two\n";
  assert.equal(spaceDescriptionLists(content), content);
});

test("standalone images get their own paragraph between caption and text", () => {
  const content = "**Diagram — Flow**\n![Flow](data:image/png;base64,AAAA)\nExplanation.";
  const spaced = spaceDescriptionImages(content);
  assert.equal(spaced, "**Diagram — Flow**\n\n![Flow](data:image/png;base64,AAAA)\n\nExplanation.");
  assert.match(renderMarkdownToHtml(spaced), /<p><img[^>]+><\/p>/);
  assert.equal(spaceDescriptionImages(spaced), spaced);
});

test("image spacing preserves inline images, code examples and list indentation", () => {
  const content = [
    "Inline ![icon](https://example.com/icon.png) stays here.",
    "",
    "```md",
    "Example",
    "![image](https://example.com/image.png)",
    "More code",
    "```",
    "",
    "- An item",
    "  ![image](https://example.com/image.png)",
    "  More detail."
  ].join("\n");
  assert.equal(spaceDescriptionImages(content), content);
});
