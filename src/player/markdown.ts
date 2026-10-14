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

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The active step displayed in the single expanded reading view. */
export interface TourWebviewModel {
  tourTitle: string;
  tourId: string;
  stepNumber: number;
  stepCount: number;
  stepTitle: string;
  anchorLabel?: string;
  description: string;
  previousTourTitle?: string;
  nextTourTitle?: string;
}

const READING_STYLES = `
    body { box-sizing: border-box; max-width: none; padding: 24px; overflow-wrap: anywhere; font-family: var(--vscode-font-family); font-size: max(14px, var(--vscode-font-size)); line-height: 1.65; color: var(--vscode-editor-foreground); }
    p, ul, ol, pre, blockquote, table { margin: 0 0 1.25em; }
    h1, h2, h3, h4, h5, h6 { margin: 1.75em 0 .65em; line-height: 1.3; }
    ul, ol { padding-left: 1.5em; }
    li + li { margin-top: .75em; }
    li > p { margin-bottom: .5em; }
    li > ul, li > ol { margin-top: .5em; margin-bottom: 0; }
    p > img:only-child { display: block; margin: 1.5rem auto; }
    a { color: var(--vscode-textLink-foreground); }
    img { max-width: 100%; height: auto; }
    pre { overflow: auto; padding: 1rem; background: var(--vscode-textCodeBlock-background); }
    code { font-family: var(--vscode-editor-font-family); }
    blockquote { margin-left: 0; padding-left: 1rem; border-left: 3px solid var(--vscode-textBlockQuote-border); }
    header { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 12px; }
    .tour-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
    .tour-toolbar small { flex: 1 1 160px; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.4; }
    .tour-navigation { display: flex; align-items: center; gap: 6px; margin-left: auto; }
    .tour-position { color: var(--vscode-descriptionForeground); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; padding: 0 4px; }
    .tour-navigation button { display: inline-flex; align-items: center; gap: 5px; min-height: 28px; padding: 3px 8px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; font: inherit; font-size: 12px; line-height: 1.4; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); cursor: pointer; }
    .tour-navigation button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
    .tour-navigation button:disabled { opacity: .45; cursor: default; }
    .tour-navigation button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
    progress { display: block; width: 100%; height: 3px; border: 0; border-radius: 2px; overflow: hidden; appearance: none; background: var(--vscode-widget-border, var(--vscode-panel-border)); accent-color: var(--vscode-progressBar-background); }
    progress::-webkit-progress-bar { background: var(--vscode-widget-border, var(--vscode-panel-border)); }
    progress::-webkit-progress-value { background: var(--vscode-progressBar-background); }
    article { max-width: 80ch; margin: 24px auto; }
    h1 { margin-top: 0; }
    .anchor { font-family: var(--vscode-editor-font-family); opacity: .7; }
    table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
    th, td { padding: 4px 8px; border: 1px solid var(--vscode-panel-border); }`;

export function createTourWebviewHtml(model: TourWebviewModel, nonce: string): string {
  const position = model.stepNumber + 1;
  const anchor = model.anchorLabel
    ? `<p class="anchor">${escapeHtml(model.anchorLabel)}</p>` : "";
  const previousEnabled = model.stepNumber > 0 || !!model.previousTourTitle;
  const nextEnabled = position < model.stepCount || !!model.nextTourTitle;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${createContentSecurityPolicy(nonce)}">
  <title>${escapeHtml(model.tourTitle)}</title>
  <style>${READING_STYLES}
    a:focus-visible { outline: 2px solid var(--vscode-focusBorder); }
    @media (max-width: 480px) { body { padding: 12px; } article { margin: 12px auto; } }
    @media (max-width: 360px) { .tour-navigation { width: 100%; justify-content: space-between; gap: 4px; } .tour-navigation button { padding: 3px 5px; font-size: 11px; } .tour-navigation button span { display: none; } }
  </style>
</head>
<body data-token="${escapeHtml(nonce)}" data-tour-id="${escapeHtml(model.tourId)}" data-step="${model.stepNumber}">
  <header>
    <div class="tour-toolbar">
      <small>${escapeHtml(model.tourTitle)}</small>
      <nav class="tour-navigation" aria-label="Navigation du tour">
        <button type="button" data-action="previous" title="${escapeHtml(model.stepNumber > 0 ? "Étape précédente" : model.previousTourTitle ? `Tour précédent : ${model.previousTourTitle}` : "Aucune étape précédente")}"${previousEnabled ? "" : " disabled"}><span aria-hidden="true">←</span> Précédent</button>
        <span class="tour-position" aria-label="Étape ${position} sur ${model.stepCount}">${position} / ${model.stepCount}</span>
        <button type="button" data-action="next" title="${escapeHtml(position < model.stepCount ? "Étape suivante" : model.nextTourTitle ? `Tour suivant : ${model.nextTourTitle}` : "Aucune étape suivante")}"${nextEnabled ? "" : " disabled"}>Suivant <span aria-hidden="true">→</span></button>
      </nav>
    </div>
    <progress value="${position}" max="${model.stepCount}" aria-label="Tour progress"></progress>
  </header>
  <article>
    <h1>${escapeHtml(model.stepTitle)}</h1>${anchor}
    ${renderMarkdownToHtml(model.description)}
  </article>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener("click", event => {
      const button = event.target.closest("button[data-action]");
      if (button) {
        if (!button.disabled) vscode.postMessage({ type: button.dataset.action, token: document.body.dataset.token,
          targetTourId: document.body.dataset.tourId, step: Number(document.body.dataset.step) });
        return;
      }
      const link = event.target.closest("a[href]");
      if (!link) return;
      const href = link.getAttribute("href");
      if (href.startsWith("#")) return;
      event.preventDefault();
      vscode.postMessage({ type: "openLink", href, token: document.body.dataset.token,
        targetTourId: document.body.dataset.tourId, step: Number(document.body.dataset.step) });
    });
  </script>
</body>
</html>`;
}
