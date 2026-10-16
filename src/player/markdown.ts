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

/** One question asked in the step chat, with its rendered answer. */
export interface TourStepChatExchange {
  question: string;
  // The answer HTML is produced by the shared renderer and sanitizer, like
  // the description; the webview never renders raw responder Markdown.
  answerHtml: string;
  activityHtml?: string;
  failed?: boolean;
  // True while this question's answer is still streaming: the answer is
  // readable as it grows, marked as not yet complete.
  pending?: boolean;
  // True when the reader stopped this question's answer: the partial
  // answer stays readable, marked as interrupted.
  interrupted?: boolean;
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
  questions?: string[];
  chatExchanges?: TourStepChatExchange[];
  // True while the step's latest question is still being answered: the
  // response-in-progress state is visible and the form is locked.
  chatResponding?: boolean;
  previousTourTitle?: string;
  nextTourTitle?: string;
}

function renderStepChatLogHtml(
  exchanges: TourStepChatExchange[] | undefined
): string {
  return (exchanges ?? [])
    .map(
      exchange =>
        `<li class="step-chat-question">${escapeHtml(exchange.question)}</li>` +
        `<li class="step-chat-answer${
          exchange.failed ? " step-chat-error" : ""
        }${exchange.pending ? " step-chat-pending" : ""}${
          exchange.interrupted ? " step-chat-interrupted" : ""
        }">${exchange.activityHtml ? `<details class="step-chat-activity"${exchange.pending ? " open" : ""}><summary>Activité du modèle</summary>${exchange.activityHtml}</details>` : ""}${exchange.answerHtml}</li>`
    )
    .join("");
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
    .step-chat { margin-top: 2.25em; border-top: 1px solid var(--vscode-panel-border); padding-top: 1.25em; }
    .step-chat-log { list-style: none; margin: 0 0 1.25em; padding: 0; display: flex; flex-direction: column; gap: .8em; }
    .step-chat-question { margin: 0; padding: .45em .75em; border-radius: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground, inherit); overflow-wrap: anywhere; }
    .step-chat-answer { margin: 0; padding: 0 .75em; overflow-wrap: anywhere; }
    .step-chat-answer.step-chat-error { color: var(--vscode-errorForeground); border-left: 3px solid var(--vscode-errorForeground); }
    .step-chat-answer.step-chat-pending { color: var(--vscode-descriptionForeground); }
    .step-chat-interrupted { font-style: italic; }
    .step-chat-activity { margin-bottom: 1em; color: var(--vscode-descriptionForeground); }
    .step-chat-activity summary { cursor: pointer; }
    .step-chat-status:not([hidden])::before { content: ""; display: inline-block; width: .7em; height: .7em; margin-right: .6em; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: chat-spin 1s linear infinite; }
    @keyframes chat-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .step-chat-status::before { animation: none; } }
    .step-chat-status { margin: 0 0 1.25em; padding: 0 .75em; font-style: italic; color: var(--vscode-descriptionForeground); }
    .step-chat-suggestions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 1em; }
    .step-chat-suggestions button { max-width: 100%; white-space: normal; text-align: left; overflow-wrap: anywhere; }
    .step-chat-suggestions button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
    .step-chat-input:disabled, .step-chat-suggestion:disabled, .step-chat-submit:disabled { opacity: .55; cursor: default; }
    .step-chat-form { display: flex; gap: 6px; }
    .step-chat-input { flex: 1 1 auto; min-width: 0; padding: 4px 6px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); }
    .step-chat-input:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
    .step-chat-submit { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; font: inherit; font-size: 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    .step-chat-submit:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
    .step-chat-stop { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; font: inherit; font-size: 12px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); cursor: pointer; }
    .step-chat-stop:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }
    .step-chat-stop[hidden] { display: none; }
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
  const questions = (model.questions ?? [])
    .filter(question => typeof question === "string" && question.trim().length > 0)
    .slice(0, 4);
  const suggestions = questions.length
    ? `<div class="step-chat-suggestions" id="step-chat-suggestions" role="group" aria-label="Questions suggérées">${questions.map(question =>
        `<button type="button" class="step-chat-submit step-chat-suggestion" data-action="askQuestion" data-question="${escapeHtml(question.trim())}"${model.chatResponding ? " disabled" : ""}>${escapeHtml(question.trim())}</button>`
      ).join("")}</div>`
    : "";
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
    <section class="step-chat" aria-label="Discussion de l'étape">
      <ol class="step-chat-log" id="step-chat-log">${renderStepChatLogHtml(
        model.chatExchanges
      )}</ol>
      <p class="step-chat-status" id="step-chat-status"${
        model.chatResponding ? "" : " hidden"
      }>Réponse en cours…</p>
      ${suggestions}
      <form class="step-chat-form" id="step-chat-form">
        <input class="step-chat-input" id="step-chat-input" type="text" autocomplete="off" placeholder="Poser une question sur cette étape…" aria-label="Question sur cette étape"${
          model.chatResponding ? " disabled" : ""
        }>
        <button type="submit" class="step-chat-submit" id="step-chat-submit"${
          model.chatResponding ? " disabled" : ""
        }>Envoyer</button>
        <button type="button" class="step-chat-stop" id="step-chat-stop" data-action="stopQuestion" title="Interrompre la réponse en cours"${
          model.chatResponding ? "" : " hidden"
        }>Arrêter</button>
      </form>
    </section>
  </article>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const escapeHtml = value => String(value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const chatForm = document.getElementById("step-chat-form");
    const chatInput = document.getElementById("step-chat-input");
    const chatSubmit = document.getElementById("step-chat-submit");
    const chatStatus = document.getElementById("step-chat-status");
    const chatStop = document.getElementById("step-chat-stop");
    const suggestionButtons = Array.from(document.getElementById("step-chat-suggestions")?.children || []);
    let chatResponding = ${model.chatResponding === true};
    const setResponding = responding => {
      chatResponding = responding;
      if (chatStatus) chatStatus.hidden = !responding;
      if (chatInput) chatInput.disabled = responding;
      if (chatSubmit) chatSubmit.disabled = responding;
      suggestionButtons.forEach(button => { button.disabled = responding; });
      if (chatStop) chatStop.hidden = !responding;
    };
    const askQuestion = question => {
      if (chatResponding || !question || !question.trim()) return;
      setResponding(true);
      vscode.postMessage({ type: "askQuestion", question: question.trim(), token: document.body.dataset.token,
        targetTourId: document.body.dataset.tourId, step: Number(document.body.dataset.step) });
    };
    if (chatForm && chatInput) {
      chatForm.addEventListener("submit", event => {
        event.preventDefault();
        const question = (chatInput.value || "").trim();
        if (!question || chatResponding) return;
        chatInput.value = "";
        askQuestion(question);
      });
    }
    window.addEventListener("message", event => {
      const message = event.data;
      if (!message || message.type !== "stepChat" || !Array.isArray(message.exchanges)) return;
      const log = document.getElementById("step-chat-log");
      if (log) {
        log.innerHTML = message.exchanges.map(exchange =>
          '<li class="step-chat-question">' + escapeHtml(exchange.question) + "</li>" +
          '<li class="step-chat-answer' + (exchange.failed ? " step-chat-error" : "") + (exchange.pending ? " step-chat-pending" : "") + (exchange.interrupted ? " step-chat-interrupted" : "") + '">' +
          (exchange.activityHtml ? '<details class="step-chat-activity"' + (exchange.pending ? ' open' : '') + '><summary>Activité du modèle</summary>' + exchange.activityHtml + '</details>' : '') +
          exchange.answerHtml + "</li>").join("");
      }
      // The response-in-progress state stays visible while the answer
      // streams, and the form stays locked so no new question can be sent
      // before the current answer completes.
      setResponding(message.responding === true);
    });
    document.addEventListener("click", event => {
      const button = event.target.closest("button[data-action]");
      if (button) {
        if (button.dataset.action === "askQuestion") {
          if (!button.disabled) askQuestion(button.dataset.question);
          return;
        }
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
