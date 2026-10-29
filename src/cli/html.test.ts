import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as vm from "node:vm";
import { createStandaloneTourHtml } from "./html";

test("standalone playback navigates and finishes entirely in memory", () => {
  const html = createStandaloneTourHtml({
    id: "file:///example/project.tour",
    title: "Example",
    steps: [
      { title: "First", description: "One **bold** description." },
      { title: "Second", description: "Two", file: "src/a.ts", line: 5 }
    ]
  });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);

  const elements: Record<string, any> = {};
  for (const id of ["title", "description", "anchor", "position", "progress",
    "previous", "next", "finish", "article", "done"]) {
    elements[id] = {
      textContent: "", innerHTML: "", disabled: false, hidden: false, value: 0,
      listeners: {} as Record<string, () => void>,
      addEventListener(event: string, callback: () => void) {
        this.listeners[event] = callback;
      }
    };
  }
  const document = {
    getElementById: (id: string) => elements[id],
    addEventListener: (_event: string, _callback: () => void) => {}
  };

  vm.runInNewContext(script, { document });
  assert.equal(elements.title.textContent, "First");
  assert.equal(elements.position.textContent, "1 / 2");
  assert.equal(elements.previous.disabled, true);
  assert.match(elements.description.innerHTML, /<strong>bold<\/strong>/);

  elements.next.listeners.click();
  assert.equal(elements.title.textContent, "Second");
  assert.equal(elements.anchor.textContent, "src/a.ts : 5");
  assert.equal(elements.progress.value, 2);
  assert.equal(elements.next.disabled, true);

  elements.previous.listeners.click();
  assert.equal(elements.title.textContent, "First");
  elements.finish.listeners.click();
  assert.equal(elements.done.hidden, false);
  assert.equal(elements.article.hidden, true);
});

test("tour-provided text cannot escape the generated HTML script", () => {
  const html = createStandaloneTourHtml({
    id: "example",
    title: "<Unsafe>",
    steps: [{ title: "Script", description: "</script><script>alert(1)</script>" }]
  });
  assert.match(html, /&lt;Unsafe&gt;/);
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
});
