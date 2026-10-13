import { renderMarkdownToHtml } from "./markdown";

/**
 * The step data rendered by the tour reading webview, following the layout A
 * disposition: tour header and progression, step title and content, then
 * navigation below the explanation.
 */
export interface TourWebviewModel {
  tourTitle: string;
  stepNumber: number;
  stepCount: number;
  stepTitle: string;
  anchorLabel?: string;
  description: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createTourWebviewHtml(
  model: TourWebviewModel,
  nonce: string
): string {
  const renderedContent = renderMarkdownToHtml(model.description);
  const stepPosition = model.stepNumber + 1;
  const previousDisabled = model.stepNumber === 0 ? " disabled" : "";
  const nextDisabled =
    model.stepNumber >= model.stepCount - 1 ? " disabled" : "";
  const anchor = model.anchorLabel
    ? `\n    <p class="anchor">${escapeHtml(model.anchorLabel)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
  <title>${escapeHtml(model.tourTitle)}</title>
  <style>
    body { max-width: none; padding: 24px 24px 100px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-editor-foreground); }
    a { color: var(--vscode-textLink-foreground); }
    img { max-width: 100%; height: auto; }
    pre { overflow: auto; padding: 1rem; background: var(--vscode-textCodeBlock-background); }
    code { font-family: var(--vscode-editor-font-family); }
    blockquote { margin-left: 0; padding-left: 1rem; border-left: 3px solid var(--vscode-textBlockQuote-border); }
    header { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 16px; }
    header p { margin: 8px 0; }
    progress { width: 100%; accent-color: var(--vscode-button-background); }
    article { max-width: 80ch; margin: 24px auto; }
    h1 { margin-top: 0; }
    button { cursor: pointer; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 8px 12px; border-radius: 4px; }
    button:disabled { opacity: .4; cursor: default; }
    button:focus-visible { outline: 2px solid var(--vscode-focusBorder); }
    nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0; }
    .anchor { font-family: var(--vscode-editor-font-family); opacity: .7; }
    table { border-collapse: collapse; }
    th, td { padding: 4px 8px; border: 1px solid var(--vscode-panel-border); }
    @media (max-width: 480px) {
      body { padding: 12px 12px 60px; }
      article { margin: 12px auto; }
    }
  </style>
</head>
<body>
  <header>
    <small>${escapeHtml(model.tourTitle)}</small>
    <p>${stepPosition} / ${model.stepCount}</p>
    <progress value="${stepPosition}" max="${model.stepCount}"></progress>
  </header>
  <article>
    <h1>${escapeHtml(model.stepTitle)}</h1>${anchor}
    ${renderedContent}
  </article>
  <nav>
    <button data-action="previous"${previousDisabled}>← Précédent</button>
    <button data-action="code">Voir le code</button>
    <button data-action="next"${nextDisabled}>Suivant →</button>
    <button data-action="finish">Fin</button>
  </nav>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener("click", event => {
      const button = event.target.closest("button[data-action]");
      if (button && !button.disabled) {
        vscode.postMessage({ type: button.dataset.action });
        return;
      }
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
