import { test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CodeTour } from "../store";
import { renderTerminalDescription, TerminalStepRenderError } from "./terminalContent";

function tour(description: string): CodeTour {
  return { id: "test", title: "POC Demo",
    steps: [{ title: "Rich Step", description }] };
}

test("rich HTML is derived from the original Markdown, including lists, tables and links", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-rich-"));
  try {
    const html = await renderTerminalDescription(tour(
      "## Intro\n\n- first\n- second\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[Docs](https://example.com)"
    ), 0, root);
    assert.match(html, /<h2>/);
    assert.match(html, /<li>first/);
    assert.match(html, /<table>/);
    assert.match(html, /https:\/\/example.com/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("local PNG images use the authoritative inlining seam", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-image-"));
  try {
    mkdirSync(path.join(root, "images"));
    writeFileSync(path.join(root, "images", "tiny.png"), Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lO0AAAAASUVORK5CYII=", "base64"
    ));
    const html = await renderTerminalDescription(tour("![Small](images/tiny.png)"), 0, root);
    assert.match(html, /data:image\/png;base64,/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the reached step stops instead of silently degrading unsupported CSS or missing images", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-failfast-"));
  try {
    await assert.rejects(
      renderTerminalDescription(tour("<style>p{color:red}</style><p>Do not degrade</p>"), 0, root),
      (error: unknown) => error instanceof TerminalStepRenderError &&
        /POC Demo.*step 1.*Rich Step.*HTML\/CSS/.test(error.message)
    );
    await assert.rejects(
      renderTerminalDescription(tour("![Missing](images/nope.png)"), 0, root),
      /Tour 'POC Demo'.*step 1.*image.*cannot read/
    );
    await assert.rejects(
      renderTerminalDescription(tour("Diagram — Incomplete\n\n\x60\x60\x60mermaid\nflowchart LR\nA-->B"), 0, root),
      /Mermaid.*not closed/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Mermaid uses the shared rasterizer, never a raw terminal code fence", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-mermaid-"));
  try {
    const html = await renderTerminalDescription(tour(
      "Diagram — Processing\n\n\x60\x60\x60mermaid\nflowchart LR\n A --> B\n\x60\x60\x60"
    ), 0, root);
    assert.match(html, /data:image\/png;base64,/);
    assert.doesNotMatch(html, /language-mermaid/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
