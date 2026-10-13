import { test } from "node:test";
import * as assert from "node:assert";
import { createTourWebviewHtml } from "./tourWebviewHtml";

function baseModel() {
  return {
    tourTitle: "Tour of the codebase",
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
  assert.match(html, /<p>2 \/ 3<\/p>/);
  assert.match(html, /<progress value="2" max="3"><\/progress>/);

  // Article: step title, anchor target and the shared description rendering.
  assert.match(html, /<article>/);
  assert.match(html, /<h1>Architecture<\/h1>/);
  assert.match(html, /class="anchor">src\/player\/index\.ts : 42</);
  assert.match(html, /<h1>Overview<\/h1>/);
  assert.match(html, /<strong>CodeTour<\/strong>/);

  // Navigation sits below the explanation.
  const articleIndex = html.indexOf("<article>");
  const navIndex = html.indexOf("<nav>");
  assert.ok(articleIndex < navIndex);

  assert.match(html, /data-action="previous"[^>]*>← Précédent</);
  assert.match(html, /data-action="code"[^>]*>Voir le code</);
  assert.match(html, /data-action="next"[^>]*>Suivant →</);
  assert.match(html, /data-action="finish"[^>]*>Fin</);
});

test("createTourWebviewHtml disables navigation only at the tour bounds", () => {
  const firstStep = createTourWebviewHtml(
    { ...baseModel(), stepNumber: 0 },
    "test-nonce"
  );
  assert.match(firstStep, /data-action="previous" disabled/);
  assert.doesNotMatch(firstStep, /data-action="next" disabled/);
  assert.doesNotMatch(firstStep, /data-action="finish" disabled/);

  const lastStep = createTourWebviewHtml(
    { ...baseModel(), stepNumber: 2 },
    "test-nonce"
  );
  assert.doesNotMatch(lastStep, /data-action="previous" disabled/);
  assert.match(lastStep, /data-action="next" disabled/);
  assert.doesNotMatch(lastStep, /data-action="finish" disabled/);
});

test("createTourWebviewHtml forwards clicks through postMessage", () => {
  const html = createTourWebviewHtml(baseModel(), "test-nonce");

  assert.match(html, /const vscode = acquireVsCodeApi\(\)/);
  assert.match(
    html,
    /vscode\.postMessage\(\{ type: button\.dataset\.action, tour \}\)/
  );
  assert.match(html, /vscode\.postMessage\(\{ type: "openLink", href \}\)/);
  assert.match(html, /if \(href\.startsWith\("#"\)\) return/);
});

test("createTourWebviewHtml carries the series transitions at the tour bounds", () => {
  // Without a transition, the bounds keep their disabled step navigation.
  const firstStep = createTourWebviewHtml(
    { ...baseModel(), stepNumber: 0 },
    "test-nonce"
  );
  assert.doesNotMatch(firstStep, /data-tour=/);

  // A previous tour replaces the disabled previous button, and the finish
  // action hands over to the next tour, using the full tour titles.
  const transitionalFirstStep = createTourWebviewHtml(
    { ...baseModel(), stepNumber: 0, nextTourTitle: "2 - Next Tour" },
    "test-nonce"
  );
  assert.match(
    transitionalFirstStep,
    /data-action="finish" data-tour="2 - Next Tour"/
  );

  const transitionalLastStep = createTourWebviewHtml(
    {
      ...baseModel(),
      stepNumber: 2,
      previousTourTitle: "1 - Previous Tour"
    },
    "test-nonce"
  );
  assert.match(
    transitionalLastStep,
    /data-action="previous" data-tour="1 - Previous Tour">← Précédent</
  );
  assert.doesNotMatch(transitionalLastStep, /data-action="previous" disabled/);
});

test("createTourWebviewHtml keeps the shared content policy and sanitization", () => {
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      tourTitle: '<script>alert("title")</script>',
      description:
        '<a href="javascript:alert(1)">Bad link</a>[Step 2](#2)'
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
