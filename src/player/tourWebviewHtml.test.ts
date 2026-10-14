import { test } from "node:test";
import * as assert from "node:assert";
import { runInNewContext } from "node:vm";
import { createTourWebviewHtml } from "./tourWebviewHtml";

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
  assert.match(html, /<p>2 \/ 3<\/p>/);
  assert.match(html, /<progress value="2" max="3" aria-label="Tour progress"><\/progress>/);

  // Article: step title, anchor target and the shared description rendering.
  assert.match(html, /<article>/);
  assert.match(html, /<h1>Architecture<\/h1>/);
  assert.match(html, /class="anchor">src\/player\/index\.ts : 42</);
  assert.match(html, /<h1>Overview<\/h1>/);
  assert.match(html, /<strong>CodeTour<\/strong>/);

  // Navigation sits below the explanation.
  const articleIndex = html.indexOf("<article>");
  const navIndex = html.indexOf("<nav");
  assert.ok(articleIndex < navIndex);

  assert.match(html, /data-action="previous"[^>]*>← Previous</);
  assert.match(html, /data-action="code"[^>]*>View code</);
  assert.match(html, /data-action="next"[^>]*>Next →</);
  assert.match(html, /data-action="finish"[^>]*>Finish</);
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
    /send\(\{ type: button\.dataset\.action, tour: navigationTour \}\)/
  );
  assert.match(html, /send\(\{ type: "openLink", href \}\)/);
  assert.match(html, /if \(href\.startsWith\("#"\)\) return/);

  // The recorder command buttons of the reading view carry their command
  // through the message, so the panel routes them like the editing view.
  assert.match(
    html,
    /send\(\{ type: "editCommand", command: button\.dataset\.command \}\)/
  );
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
    /data-action="previous" data-tour="1 - Previous Tour">← Previous</
  );
  assert.doesNotMatch(transitionalLastStep, /data-action="previous" disabled/);
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

test("createTourWebviewHtml exposes the edit entry points only for editable tours", () => {
  const html = createTourWebviewHtml(
    { ...baseModel(), editable: true },
    "test-nonce"
  );

  assert.match(html, /data-action="edit"[^>]*>Edit step</);
  // The existing recorder commands stay reachable from the panel as plain
  // buttons, one per documented action: step title, anchor and step order.
  assert.match(
    html,
    /data-action="editCommand" data-command="codetour\.changeTourStepTitle"[^>]*>Rename step</
  );
  assert.match(
    html,
    /data-action="editCommand" data-command="codetour\.changeTourStepLine"[^>]*>Change anchor</
  );
  assert.match(
    html,
    /data-action="editCommand" data-command="codetour\.moveTourStepBack"[^>]*>Move step up</
  );
  assert.match(
    html,
    /data-action="editCommand" data-command="codetour\.moveTourStepForward"[^>]*>Move step down</
  );

  // A tour without edit permissions presents no active editing action at
  // all: no button to enter the editor and no command button.
  const readOnly = createTourWebviewHtml(
    { ...baseModel(), editable: false },
    "test-nonce"
  );
  assert.doesNotMatch(readOnly, /data-action="edit"/);
  assert.doesNotMatch(readOnly, /data-action="editCommand"/);
  assert.doesNotMatch(readOnly, /data-action="save"/);
  assert.doesNotMatch(readOnly, /data-action="cancel"/);
  // The default model (no permission information) stays a pure reading view.
  const plain = createTourWebviewHtml(baseModel(), "test-nonce");
  assert.doesNotMatch(plain, /data-action="edit"/);
});

test("createTourWebviewHtml renders an editing view with source, preview and save or cancel", () => {
  const source = [
    "Edited **source** with <markup>",
    "",
    "**Diagram — Flow**",
    "",
    "```mermaid",
    "flowchart TD",
    "    Start --> Done",
    "```"
  ].join("\n");
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      editable: true,
      editing: { source },
      description: "<p>Preview of the draft.</p>"
    },
    "test-nonce"
  );

  // The Markdown source, mermaid fences included, stays editable text.
  assert.match(html, /<label for="tour-step-source">Markdown source<\/label>/);
  assert.match(
    html,
    /<textarea id="tour-step-source"[^>]*>Edited \*\*source\*\* with &lt;markup&gt;/
  );
  assert.match(html, /```mermaid/);
  assert.match(html, /flowchart TD/);

  // The preview reuses the shared sanitized rendering of the draft.
  assert.match(html, /<div id="tour-draft-preview"[^>]*>/);
  assert.match(html, /<p>Preview of the draft\.<\/p>/);

  // Save and cancel are keyboard-reachable buttons with explicit labels.
  assert.match(html, /data-action="save"[^>]*>Save</);
  assert.match(html, /data-action="cancel"[^>]*>Cancel</);

  // While editing, the reading command buttons are not needed to edit the
  // text; the editing view keeps only its own actions and the navigation.
  assert.doesNotMatch(html, /data-action="editCommand"/);
});

test("createTourWebviewHtml keeps the navigation and editing keyboard accessible", () => {
  const html = createTourWebviewHtml(
    { ...baseModel(), editable: true },
    "test-nonce"
  );

  // The step navigation and the edit actions are labelled landmarks, and
  // the progress bar carries an accessible name since its value has no
  // text of its own.
  assert.match(html, /<nav aria-label="Tour navigation">/);
  assert.match(
    html,
    /<progress value="2" max="3" aria-label="Tour progress">/
  );
  assert.match(html, /<nav class="actions" aria-label="Editing actions">/);

  // Focus stays visible on every keyboard-reachable control.
  assert.match(
    html,
    /button:focus-visible \{ outline: 2px solid var\(--vscode-focusBorder\); \}/
  );

  // Every action stays a native button with an explicit text label, so the
  // whole panel is operable from the keyboard without a pointer.
  assert.doesNotMatch(html, /<div data-action=/);
  assert.match(html, /data-action="previous"[^>]*>← Previous</);
  assert.match(html, /data-action="edit"[^>]*>Edit step</);

  // The editing view keeps the same landmarks, its labelled source field
  // and its visible focus while the author edits.
  const editing = createTourWebviewHtml(
    {
      ...baseModel(),
      editable: true,
      editing: { source: "Draft" },
      description: "<p>P</p>"
    },
    "test-nonce"
  );
  assert.match(editing, /<nav aria-label="Tour navigation">/);
  assert.match(
    editing,
    /<div class="edit-actions" role="group" aria-label="Editing actions">/
  );
  assert.match(editing, /<label for="tour-step-source">Markdown source<\/label>/);
  assert.match(editing, /button:focus-visible/);
});

test("createTourWebviewHtml wires the draft messages and focuses the editor", () => {
  const html = createTourWebviewHtml(
    { ...baseModel(), editing: { source: "Draft" }, description: "<p>P</p>" },
    "test-nonce"
  );

  // The editor focuses itself so keyboard users land in the source, and
  // every draft change reaches the host, which answers with the rendered
  // preview injected into the preview container.
  assert.match(html, /draftSource\.focus\(\)/);
  assert.match(html, /addEventListener\("message"/);
  assert.match(html, /draftPreview\.innerHTML = event\.data\.html/);
  assert.match(html, /type: "draft"/);
  assert.match(html, /type: "save"/);
  assert.match(html, /type: "cancel"/);
  // The same content policy covers the editing view.
  assert.match(
    html,
    /img-src data: https:; style-src 'unsafe-inline'; script-src 'nonce-test-nonce'/
  );
});


test("clicking the generated Save and Cancel buttons sends the current draft identity", () => {
  const html = createTourWebviewHtml({ ...baseModel(), editable: true, editing: { source: "Draft source" } }, "event-nonce");
  const script = html.match(/<script nonce="event-nonce">([\s\S]*?)<\/script>/)![1];
  const listeners = new Map<string, (event: unknown) => void>();
  const messages: unknown[] = [];
  const source = { value: "Typed browser source", focus: () => undefined, addEventListener: () => undefined };
  runInNewContext(script, {
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => messages.push(message) }),
    document: {
      body: { dataset: { token: "event-nonce", tourId: "file:///workspace/.tours/base.tour", step: "1" } },
      getElementById: (id: string) => id === "tour-step-source" ? source : { innerHTML: "" },
      addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener)
    },
    window: { addEventListener: () => undefined }
  });
  for (const action of ["save", "cancel"]) {
    listeners.get("click")!({ target: { closest: () => ({ disabled: false, dataset: { action } }) } });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    { type: "save", tour: "file:///workspace/.tours/base.tour", step: 1, text: "Typed browser source", token: "event-nonce", targetTourId: "file:///workspace/.tours/base.tour" },
    { type: "cancel", tour: "file:///workspace/.tours/base.tour", step: 1, token: "event-nonce", targetTourId: "file:///workspace/.tours/base.tour" }
  ]);
});
