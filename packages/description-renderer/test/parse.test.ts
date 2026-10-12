import { test } from "node:test";
import * as assert from "node:assert";
import { containsMermaidFenceMarker, isMermaidFenceLine } from "../src/parse";

test("isMermaidFenceLine accepts only bare mermaid fence openings", () => {
  assert.equal(isMermaidFenceLine("```mermaid"), true);
  assert.equal(isMermaidFenceLine("  ```mermaid\t"), true);
  assert.equal(isMermaidFenceLine("```mermaid x"), false);
  assert.equal(isMermaidFenceLine("```js"), false);
  assert.equal(isMermaidFenceLine("```"), false);
  assert.equal(isMermaidFenceLine("text"), false);
});

test("containsMermaidFenceMarker reports the raw fence marker", () => {
  assert.equal(containsMermaidFenceMarker("No fences here."), false);
  assert.equal(
    containsMermaidFenceMarker("```mermaid\nflowchart TD\n```"),
    true
  );
});
