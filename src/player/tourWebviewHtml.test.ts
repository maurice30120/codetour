import { test } from "node:test";
import * as assert from "node:assert";
import { runInNewContext } from "node:vm";
import { createTourWebviewHtml } from "./markdown";

function baseModel() {
  return {
    tourTitle: "Tour of the codebase",
    tourId: "file:///workspace/.tours/base.tour",
    stepNumber: 1,
    stepCount: 3,
    stepTitle: "Architecture",
    anchorLabel: "src/player/index.ts : 42",
    description: "# Overview\n\nWelcome to **CodeTour**."
  };
}

test("createTourWebviewHtml renders the layout A reading structure", () => {
  const html = createTourWebviewHtml(baseModel(), "test-nonce");

  // Header: tour title and step position with a progress bar.
  assert.match(html, /<header>/);
  assert.match(html, /<small>Tour of the codebase<\/small>/);
  assert.match(html, />2 \/ 3<\/span>/);
  assert.match(html, /<progress value="2" max="3" aria-label="Tour progress"><\/progress>/);

  // Article: step title, anchor target and the shared description rendering.
  assert.match(html, /<article>/);
  assert.match(html, /<h1>Architecture<\/h1>/);
  assert.match(html, /class="anchor">src\/player\/index\.ts : 42</);
  assert.match(html, /<h1>Overview<\/h1>/);
  assert.match(html, /<strong>CodeTour<\/strong>/);

  assert.match(html, /data-action="previous"/);
  assert.match(html, /data-action="next"/);
  assert.doesNotMatch(html, /<textarea/);

});

test("createTourWebviewHtml keeps a rich description readable in a narrow panel", () => {
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      description:
        "| Column | Value |\n| --- | --- |\n| Alpha | One |\n\n![Logo](https://example.com/logo.png)"
    },
    "test-nonce"
  );

  // Images and tables stay constrained, and the layout adapts when the
  // webview is narrow.
  assert.match(html, /img \{[^}]*max-width: 100%/);
  assert.match(html, /table \{[^}]*border-collapse: collapse/);
  assert.match(html, /th, td \{[^}]*padding/);
  assert.match(html, /@media \(max-width: \d+px\)/);
});

test("createTourWebviewHtml keeps the shared content policy and sanitization", () => {
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      tourTitle: '<script>alert("title")</script>',
      description: '<a href="javascript:alert(1)">Bad link</a>[Step 2](#2)'
    },
    "test-nonce"
  );

  assert.match(
    html,
    /content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'nonce-test-nonce'"/
  );
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /<script>alert\("title"\)<\/script>/);
  assert.match(html, />Bad link<\/a>/);
});


test("the reading view forwards only content links with the active step identity", () => {
  const html = createTourWebviewHtml(baseModel(), "event-nonce");
  const script = html.match(/<script nonce="event-nonce">([\s\S]*?)<\/script>/)![1];
  let click!: (event: unknown) => void;
  const messages: unknown[] = [];
  runInNewContext(script, {
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => messages.push(message) }),
    document: {
      body: { dataset: { token: "event-nonce", tourId: baseModel().tourId, step: "1" } },
      addEventListener: (_name: string, listener: (event: unknown) => void) => { click = listener; }
    }
  });
  let prevented = false;
  click({ target: { closest: (selector: string) => selector.startsWith("button") ? null : ({ getAttribute: () => "https://example.com" }) }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: "openLink", href: "https://example.com", token: "event-nonce", targetTourId: baseModel().tourId, step: 1 }]);
  click({ target: { closest: (selector: string) => selector.startsWith("button") ? null : ({ getAttribute: () => "#section" }) }, preventDefault: () => assert.fail("local anchors stay local") });
  assert.equal(messages.length, 1);
  click({ target: { closest: () => ({ dataset: { action: "next" }, disabled: false }) } });
  assert.deepEqual(JSON.parse(JSON.stringify(messages[1])), { type: "next", token: "event-nonce", targetTourId: baseModel().tourId, step: 1 });
  click({ target: { closest: () => ({ dataset: { action: "previous" }, disabled: true }) } });
  assert.equal(messages.length, 2);
});

test("navigation disables absent neighbors and names linked tours at the boundaries", () => {
  const first = createTourWebviewHtml({ ...baseModel(), stepNumber: 0 }, "nonce");
  assert.match(first, /data-action="previous"[^>]* disabled/);
  const last = createTourWebviewHtml({ ...baseModel(), stepNumber: 2 }, "nonce");
  assert.match(last, /data-action="next"[^>]* disabled/);
  const linked = createTourWebviewHtml({ ...baseModel(), stepNumber: 0, previousTourTitle: 'Intro "tour"' }, "nonce");
  assert.match(linked, /Tour précédent : Intro &quot;tour&quot;/);
  assert.doesNotMatch(linked, /data-action="previous"[^>]* disabled/);
});
