import {
  createContentSecurityPolicy,
  renderMarkdownToHtml
} from "./markdown";

/**
 * The step data rendered by the tour reading webview, following the layout A
 * disposition: tour header and progression, step title and content, then
 * navigation below the explanation.
 */
export interface TourWebviewModel {
  tourTitle: string;
  // The id of the tour file. The editing controls echo it back with every
  // draft message so the host can validate the targeted tour and step.
  tourId: string;
  stepNumber: number;
  stepCount: number;
  stepTitle: string;
  anchorLabel?: string;
  description: string;
  // Titles of the tours a series transition hands over to, following the
  // reader's own navigation rules. They reuse the full tour titles, the
  // same values the native links pass to startTourByTitle/finishTour.
  previousTourTitle?: string;
  nextTourTitle?: string;
  // Whether the current edit permissions allow editing the tour from the
  // panel. Without it, no editing action is presented at all.
  editable?: boolean;
  // The editing session of the active step. When present, the panel presents
  // the source editor and its preview instead of the reading view; the
  // draft source stays plain Markdown, mermaid fences included.
  editing?: {
    source: string;
  };
}

// The styles shared by the reading and the editing presentations of a step.
const COMMON_STYLES = `
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
    th, td { padding: 4px 8px; border: 1px solid var(--vscode-panel-border); }`;

const READING_STYLES = `
    nav.actions { margin: 0 0 20px; }`;

const EDITING_STYLES = `
    h2 { font-size: 1rem; margin-bottom: 8px; }
    textarea { display: block; width: 100%; min-height: 12rem; margin: 8px 0 24px; padding: 8px; box-sizing: border-box; resize: vertical; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-font-size); color: var(--vscode-editor-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
    .edit-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0; }`;

const NARROW_PANEL_STYLES = `
    @media (max-width: 480px) {
      body { padding: 12px 12px 60px; }
      article { margin: 12px auto; }
    }`;

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
  // At the tour bounds, a series transition replaces the disabled step
  // navigation: the previous button starts the previous tour, the finish
  // action hands over to the next one.
  const previousDisabled =
    model.stepNumber === 0 && !model.previousTourTitle ? " disabled" : "";
  const nextDisabled =
    model.stepNumber >= model.stepCount - 1 ? " disabled" : "";
  const previousTour = model.previousTourTitle
    ? ` data-tour="${escapeHtml(model.previousTourTitle)}"`
    : "";
  const nextTour = model.nextTourTitle
    ? ` data-tour="${escapeHtml(model.nextTourTitle)}"`
    : "";
  const anchor = model.anchorLabel
    ? `\n    <p class="anchor">${escapeHtml(model.anchorLabel)}</p>`
    : "";

  // The existing recorder editing actions stay reachable from the reading
  // view as plain buttons. They are only presented when the tour is
  // editable and they always route to the very same commands.
  const editActions = model.editable
    ? `\n  <nav class="actions" aria-label="Editing actions">
    <button data-action="edit">Edit step</button>
    <button data-action="editCommand" data-command="codetour.changeTourStepTitle">Rename step</button>
    <button data-action="editCommand" data-command="codetour.changeTourStepLine">Change anchor</button>
    <button data-action="editCommand" data-command="codetour.moveTourStepBack"${previousDisabled}>Move step up</button>
    <button data-action="editCommand" data-command="codetour.moveTourStepForward"${nextDisabled}>Move step down</button>
  </nav>`
    : "";

  // The editing presentation replaces the reading content with the draft
  // source editor and its preview, and adds its own save and cancel
  // actions; everything else — header, navigation, wiring — is shared.
  const editing = !!model.editing;
  const articleBody = editing
    ? `<label for="tour-step-source">Markdown source</label>
    <textarea id="tour-step-source" spellcheck="false">${escapeHtml(model.editing!.source)}</textarea>
    <h2>Preview</h2>
    <div id="tour-draft-preview" aria-live="polite">
    ${renderedContent}
    </div>`
    : renderedContent;
  const editActionsBar = editing
    ? `
  <div class="edit-actions" role="group" aria-label="Editing actions">
    <button data-action="save">Save</button>
    <button data-action="cancel">Cancel</button>
  </div>`
    : "";
  const draftScript = editing
    ? `
    const tour = document.body.dataset.tourId;
    const step = Number(document.body.dataset.step);
    const draftSource = document.getElementById("tour-step-source");
    const draftPreview = document.getElementById("tour-draft-preview");
    if (draftSource) {
      draftSource.focus();
      draftSource.addEventListener("input", () => {
        vscode.postMessage({ type: "draft", tour, step, text: draftSource.value });
      });
    }
    window.addEventListener("message", event => {
      if (event.data && event.data.type === "preview" && draftPreview) {
        draftPreview.innerHTML = event.data.html;
      }
    });`
    : "";
  const draftCases = editing
    ? `
    if (action === "save" && draftSource) {
      vscode.postMessage({ type: "save", tour, step, text: draftSource.value });
      return;
    }
    if (action === "cancel") {
      vscode.postMessage({ type: "cancel", tour, step });
      return;
    }`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${createContentSecurityPolicy(nonce)}">
  <title>${escapeHtml(model.tourTitle)}</title>
  <style>${COMMON_STYLES}${editing ? EDITING_STYLES : READING_STYLES}${NARROW_PANEL_STYLES}
  </style>
</head>
<body data-tour-id="${escapeHtml(model.tourId)}" data-step="${model.stepNumber}">
  <header>
    <small>${escapeHtml(model.tourTitle)}</small>
    <p>${stepPosition} / ${model.stepCount}</p>
    <progress value="${stepPosition}" max="${model.stepCount}" aria-label="Tour progress"></progress>
  </header>
  <article>
    <h1>${escapeHtml(model.stepTitle)}</h1>${anchor}
    ${articleBody}
  </article>${editActionsBar}
  <nav aria-label="Tour navigation">
    <button data-action="previous"${previousDisabled}${previousTour}>← Previous</button>
    <button data-action="code">View code</button>
    <button data-action="next"${nextDisabled}>Next →</button>
    <button data-action="finish"${nextTour}>Finish</button>
  </nav>${editing ? "" : editActions}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();${draftScript}
    document.addEventListener("click", event => {
      const button = event.target.closest("button[data-action]");
      if (button && !button.disabled) {
        const action = button.dataset.action;
        if (action === "editCommand") {
          vscode.postMessage({ type: "editCommand", command: button.dataset.command });
          return;
        }${draftCases}
        const tour = button.dataset.tour || undefined;
        vscode.postMessage({ type: button.dataset.action, tour });
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
