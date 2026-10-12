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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
  <title>${safeTitle}</title>
  <style>
    body { max-width: 900px; margin: 0 auto; padding: 2rem; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-editor-foreground); }
    a { color: var(--vscode-textLink-foreground); }
    img { max-width: 100%; height: auto; }
    pre { overflow: auto; padding: 1rem; background: var(--vscode-textCodeBlock-background); }
    code { font-family: var(--vscode-editor-font-family); }
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
