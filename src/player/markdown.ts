// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import MarkdownIt = require("markdown-it");
import sanitizeHtml = require("sanitize-html");

const markdown = new MarkdownIt({
  html: true,
  linkify: true
});

/**
 * Converts CodeTour Markdown to HTML for extension-owned surfaces.
 *
 * Raw HTML is accepted by the parser because the shared description pipeline
 * emits responsive image tags. The sanitizer is therefore the security
 * boundary and deliberately keeps only presentation markup and links.
 */
export function renderMarkdownToHtml(content: string): string {
  return sanitizeHtml(markdown.render(content), {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img"
    ],
    allowedAttributes: {
      "*": ["id"],
      a: ["href", "title"],
      code: ["class"],
      img: ["alt", "src", "title", "width"]
    },
    allowedSchemes: ["http", "https", "mailto", "command"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"]
    }
  });
}

/**
 * The Content-Security-Policy shared by every extension-owned HTML surface
 * (ADR 0009): no remote origin, only nonce'd scripts, inline styles and
 * data/https images.
 */
export function createContentSecurityPolicy(nonce: string): string {
  return `default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createDescriptionWebviewHtml(
  content: string,
  title: string,
  nonce: string
): string {
  const renderedContent = renderMarkdownToHtml(content);
  const safeTitle = escapeHtml(title);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${createContentSecurityPolicy(nonce)}">
  <title>${safeTitle}</title>
  <style>
    body { box-sizing: border-box; max-width: 80ch; margin: 0 auto; padding: clamp(1rem, 4vw, 2.5rem); font-family: var(--vscode-font-family); font-size: max(14px, var(--vscode-font-size)); line-height: 1.65; overflow-wrap: anywhere; color: var(--vscode-editor-foreground); }
    p, ul, ol, pre, blockquote, table { margin: 0 0 1.25em; }
    h1, h2, h3, h4, h5, h6 { margin: 1.75em 0 0.65em; line-height: 1.3; }
    body > :first-child { margin-top: 0; }
    ul, ol { padding-left: 1.5em; }
    li + li { margin-top: 0.75em; }
    li > p { margin-bottom: 0.5em; }
    li > ul, li > ol { margin-top: 0.5em; margin-bottom: 0; }
    a { color: var(--vscode-textLink-foreground); }
    img { max-width: 100%; height: auto; vertical-align: middle; margin: 1rem 0; }
    p > img:only-child { display: block; margin: 1.5rem auto; }
    pre { overflow: auto; padding: 1rem; line-height: 1.5; overflow-wrap: normal; background: var(--vscode-textCodeBlock-background); }
    code { font-family: var(--vscode-editor-font-family); }
    table { display: block; overflow-x: auto; border-collapse: collapse; }
    th, td { padding: 0.5em 0.75em; border: 1px solid var(--vscode-panel-border); }
    hr { margin: 1.75em 0; border: 0; border-top: 1px solid var(--vscode-panel-border); }
    blockquote { margin-left: 0; padding-left: 1rem; border-left: 3px solid var(--vscode-textBlockQuote-border); }
  </style>
</head>
<body>
  ${renderedContent}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener("click", event => {
      const link = event.target.closest("a[href]");
      if (!link) return;
      const href = link.getAttribute("href");
      if (href.startsWith("#")) return;
      event.preventDefault();
      vscode.postMessage({ type: "openLink", href });
    });
  </script>
</body>
</html>`;
}
