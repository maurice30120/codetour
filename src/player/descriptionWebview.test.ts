import { test } from "node:test";
import * as assert from "node:assert";
import { createDescriptionWebviewHtml } from "./markdown";

test("createDescriptionWebviewHtml renders Markdown and forwards clicked links", () => {
  const html = createDescriptionWebviewHtml(
    "# Overview\n\n[Open step](command:codetour.navigateToStep?2)",
    "Tour description",
    "test-nonce"
  );

  assert.match(html, /<h1>Overview<\/h1>/);
  assert.match(
    html,
    /href="command:codetour\.navigateToStep\?2"/
  );
  assert.match(html, /vscode\.postMessage\(\{ type: "openLink", href \}\)/);
  assert.match(html, /if \(href\.startsWith\("#"\)\) return/);
  assert.match(html, /content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'nonce-test-nonce'"/);
});

test("createDescriptionWebviewHtml escapes the panel title", () => {
  const html = createDescriptionWebviewHtml(
    "Description",
    '<script aria-label="unsafe">',
    "test-nonce"
  );

  assert.doesNotMatch(html, /<title><script/);
  assert.match(html, /<title>&lt;script aria-label=&quot;unsafe&quot;&gt;<\/title>/);
});

test("createDescriptionWebviewHtml sanitizes unsafe description HTML", () => {
  const html = createDescriptionWebviewHtml(
    '<script>alert("unsafe")</script><a href="javascript:alert(1)">Bad link</a>',
    "Tour description",
    "test-nonce"
  );

  assert.doesNotMatch(html, /alert\(&quot;unsafe&quot;\)/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, />Bad link<\/a>/);
});
