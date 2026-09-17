import { test } from "node:test";
import * as assert from "node:assert";
import { appendInsertCodeLinks } from "./insertCode";

// The transformation that AppendInsertCodeLinks must preserve verbatim for
// descriptions that contain no Mermaid fence.
const LEGACY_CODE_FENCE_PATTERN = /```[^\n]+\n(.+)\n```/gms;

function legacyTransform(content: string): string {
  return content.replace(
    LEGACY_CODE_FENCE_PATTERN,
    (_, codeBlock) =>
      `${_}\n↪ [Insert Code](command:codetour.insertCodeSnippet?${encodeURIComponent(
        JSON.stringify([codeBlock])
      )} "Insert Code")`
  );
}

function insertCodeLink(codeBlock: string): string {
  return `↪ [Insert Code](command:codetour.insertCodeSnippet?${encodeURIComponent(
    JSON.stringify([codeBlock])
  )} "Insert Code")`;
}

test("appendInsertCodeLinks leaves content without code fences unchanged", () => {
  const content = "Just some prose\nwith no fences at all.";

  assert.equal(appendInsertCodeLinks(content), content);
});

test("appendInsertCodeLinks appends an Insert Code link to an ordinary fence", () => {
  const content = ["Intro", "", "```ts", "const answer = 42;", "```", "", "Outro"].join("\n");

  assert.equal(
    appendInsertCodeLinks(content),
    [
      "Intro",
      "",
      "```ts",
      "const answer = 42;",
      "```",
      insertCodeLink("const answer = 42;"),
      "",
      "Outro"
    ].join("\n")
  );
});

test("appendInsertCodeLinks preserves the existing behavior for ordinary fences", () => {
  const cases = [
    "```ts\nconst a = 1;\n```",
    "```ts\nconst a = 1;\n```\n\n```js\nconst b = 2;\n```",
    "```\nno info string\n```",
    "text before\n```python\nx = 1\n```\ntext between\n```js\ny = 2\n```\ntext after",
    "```ts\nunterminated fence"
  ];

  for (const content of cases) {
    assert.equal(
      appendInsertCodeLinks(content),
      legacyTransform(content),
      content
    );
  }
});

test("appendInsertCodeLinks bypasses a Mermaid fence", () => {
  const content = [
    "**Diagram — Request lifecycle**",
    "",
    "```mermaid",
    "flowchart TD",
    "    Client --> Gateway",
    "```"
  ].join("\n");

  assert.equal(appendInsertCodeLinks(content), content);
});

test("appendInsertCodeLinks bypasses a padded Mermaid fence", () => {
  const content = ["```mermaid  ", "flowchart TD", "    A --> B", "```"].join("\n");

  assert.equal(appendInsertCodeLinks(content), content);
});

test("appendInsertCodeLinks keeps an ordinary fence insertable before a Mermaid fence", () => {
  const content = [
    "```ts",
    "const a = 1;",
    "```",
    "",
    "**Diagram — Flow**",
    "",
    "```mermaid",
    "flowchart TD",
    "    A --> B",
    "```"
  ].join("\n");

  assert.equal(
    appendInsertCodeLinks(content),
    [
      "```ts",
      "const a = 1;",
      "```",
      insertCodeLink("const a = 1;"),
      "",
      "**Diagram — Flow**",
      "",
      "```mermaid",
      "flowchart TD",
      "    A --> B",
      "```"
    ].join("\n")
  );
});

test("appendInsertCodeLinks does not let a Mermaid fence swallow the next fence", () => {
  const content = [
    "```mermaid",
    "flowchart TD",
    "    A --> B",
    "```",
    "",
    "```ts",
    "const a = 1;",
    "```"
  ].join("\n");

  assert.equal(
    appendInsertCodeLinks(content),
    [
      "```mermaid",
      "flowchart TD",
      "    A --> B",
      "```",
      "",
      "```ts",
      "const a = 1;",
      "```",
      insertCodeLink("const a = 1;")
    ].join("\n")
  );
});

test("appendInsertCodeLinks splits a run of ordinary fences around a Mermaid fence", () => {
  const content = [
    "```ts",
    "const a = 1;",
    "```",
    "```js",
    "const b = 2;",
    "```",
    "```mermaid",
    "flowchart TD",
    "    A --> B",
    "```",
    "```python",
    "x = 1",
    "```"
  ].join("\n");

  assert.equal(
    appendInsertCodeLinks(content),
    [
      "```ts",
      "const a = 1;",
      "```",
      "```js",
      "const b = 2;",
      "```",
      insertCodeLink("const a = 1;\n```\n```js\nconst b = 2;"),
      "```mermaid",
      "flowchart TD",
      "    A --> B",
      "```",
      "```python",
      "x = 1",
      "```",
      insertCodeLink("x = 1")
    ].join("\n")
  );
});

test("appendInsertCodeLinks treats other info strings as ordinary fences", () => {
  for (const info of ["Mermaid", "mermaidjs", "mermaid example"]) {
    const content = "```" + info + "\ncode\n```";

    assert.equal(
      appendInsertCodeLinks(content),
      content + "\n" + insertCodeLink("code"),
      info
    );
  }
});

test("appendInsertCodeLinks leaves an unterminated fence without a link", () => {
  const content = "```ts\nconst a = 1;";

  assert.equal(appendInsertCodeLinks(content), content);
});
