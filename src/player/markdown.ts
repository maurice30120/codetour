// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import MarkdownIt = require("markdown-it");
import sanitizeHtml = require("sanitize-html");
import type { AgentAvailability } from "../agent/agentCatalogue";
import type { StepChatAgentIdentity } from "../agent/stepChatContract";

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
  // The forbidden tools the agent executed during this answer: reported
  // to the reader as they run and kept after the answer settles.
  forbiddenTools?: { kind?: string; status?: string; title?: string }[];
  failed?: boolean;
  // True while this question's answer is still streaming: the answer is
  // readable as it grows, marked as not yet complete.
  pending?: boolean;
  // True when the reader stopped this question's answer: the partial
  // answer stays readable, marked as interrupted.
  interrupted?: boolean;
  // The agent that produced this answer, when the responder named one.
  agent?: StepChatAgentIdentity;
}

/** One Agent Profile as the conversation area lists it (ADR 0048). */
export interface TourAgentAvailability {
  name: string;
  state: AgentAvailability["state"];
  /** The authentication methods' names, or the connection error's reason. */
  detail?: string;
  /** True for the Agent Profile that answers right now. */
  selected?: boolean;
  /** False when the reader may not pick this profile by hand. */
  selectable?: boolean;
}

/** One model value of the Model control, as the agent announces it (ADR 0048). */
export interface TourModelOption {
  value: string;
  name: string;
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
  // The agent answering the step's conversation right now: the effective
  // one after the session handshake, the preselected one before it.
  chatAgent?: StepChatAgentIdentity;
  // The Agent Catalogue with each profile's probed availability, listed so
  // the reader sees what CodeTour knows and what state each agent is in.
  chatAgents?: TourAgentAvailability[];
  // The model values the selected Agent Profile announces — the only list the
  // reader may choose from — and the model the control shows: the one the
  // agent confirmed, or the reader's remembered choice. Empty means the agent
  // manages its own model.
  chatModels?: TourModelOption[];
  chatModel?: string;
  // True when the initial probe settled and no Agent Profile can answer: the
  // explaining state replaces the composer's use and the Tour stays readable.
  chatUnavailable?: boolean;
  previousTourTitle?: string;
  nextTourTitle?: string;
  canEdit?: boolean;
}

/**
 * The agent caption of one answer: the Agent Profile that produced it, and
 * the effective model it confirmed when it announces one.
 */
function agentCaption(identity: StepChatAgentIdentity): string {
  return identity.model ? `${identity.agent} · ${identity.model}` : identity.agent;
}

/**
 * The conversation's agent line: who answers, and whether the session
 * handshake confirmed it or the profile is still only preselected.
 */
function agentLine(identity: StepChatAgentIdentity): string {
  const state = identity.effective ? "effective" : "preselected";
  return `Agent: ${agentCaption(identity)} (${state})`;
}

/** The state of one Agent Profile, as the conversation area spells it. */
const AGENT_STATE_LABELS: Record<AgentAvailability["state"], string> = {
  unknown: "unknown",
  "not-installed": "not installed",
  unverified: "installed, not verified",
  "auth-required": "authentication required",
  available: "available",
  "connection-error": "connection error"
};

/** One catalogue profile with its availability, as the selector spells it. */
function agentStateText(agent: TourAgentAvailability): string {
  const detail = agent.detail ? ` (${agent.detail})` : "";
  return `${agent.name} — ${AGENT_STATE_LABELS[agent.state] ?? "unknown"}${detail}`;
}

/**
 * The Agent control of the conversation area: the whole catalogue with each
 * profile's state, the answering profile selected and the profiles the reader
 * may not pick disabled. It is locked while an answer streams, like the
 * composer, so no answer is ever interrupted by a change of agent.
 */
function renderAgentControlsHtml(
  agents: TourAgentAvailability[] | undefined,
  locked: boolean
): string {
  const entries = agents ?? [];
  const options = entries
    .map(
      agent =>
        `<option value="${escapeHtml(agent.name)}" data-state="${escapeHtml(
          agent.state
        )}"${agent.selected ? " selected" : ""}${
          agent.selectable === false ? " disabled" : ""
        }>${escapeHtml(agentStateText(agent))}</option>`
    )
    .join("");
  return `<div class="step-chat-agent-controls" id="step-chat-agent-controls"${
    entries.length === 0 ? " hidden" : ""
  }><label class="step-chat-control-label" for="step-chat-agent-select">Agent</label><select class="step-chat-agent-select" id="step-chat-agent-select" aria-label="Agent"${
    locked ? " disabled" : ""
  }>${options}</select><button type="button" class="step-chat-agents-refresh" id="step-chat-agents-refresh" data-action="refreshAgents" title="Probe every agent again"${
    locked ? " disabled" : ""
  }>Refresh</button></div>`;
}

/** The label of the Model control when the agent announces no model at all. */
const AGENT_MANAGED_MODEL = "Agent-managed model";

/**
 * The Model control of the conversation area: only the model values the
 * selected Agent Profile announces, with the effective one selected, and the
 * agent-managed state when it announces none. It is hidden when no Agent
 * Selection owns the panel, and locked while an answer streams, like the
 * composer and the Agent control.
 */
function renderModelControlsHtml(
  models: TourModelOption[] | undefined,
  selected: string | undefined,
  hidden: boolean,
  locked: boolean
): string {
  const entries = models ?? [];
  const options = entries.length === 0
    ? `<option value="" selected>${AGENT_MANAGED_MODEL}</option>`
    : entries
        .map(
          model =>
            `<option value="${escapeHtml(model.value)}"${
              model.value === selected ? " selected" : ""
            }>${escapeHtml(model.name)}</option>`
        )
        .join("");
  return `<div class="step-chat-model-controls" id="step-chat-model-controls"${
    hidden ? " hidden" : ""
  }><label class="step-chat-control-label" for="step-chat-model-select">Model</label><select class="step-chat-model-select" id="step-chat-model-select" aria-label="Model"${
    locked || entries.length === 0 ? " disabled" : ""
  }>${options}</select></div>`;
}

/**
 * The two actions of a failed exchange: ask the same question again to the
 * same agent, or move the conversation to another one. Both stay disabled
 * while another answer streams.
 */
function renderFailureActionsHtml(
  exchange: TourStepChatExchange,
  locked: boolean
): string {
  if (!exchange.failed) {
    return "";
  }
  return `<p class="step-chat-failure-actions"><button type="button" class="step-chat-failure" data-action="retryQuestion" data-question="${escapeHtml(
    exchange.question
  )}" title="Ask this question again to the same agent"${
    locked ? " disabled" : ""
  }>Retry</button><button type="button" class="step-chat-failure" data-action="changeAgent" title="Choose another agent for this step"${
    locked ? " disabled" : ""
  }>Change agent</button></p>`;
}

/**
 * The explaining state of a panel whose Agent Catalogue has nothing usable:
 * the conversation cannot start, and the Tour stays fully readable.
 */
function renderUnavailableHtml(unavailable: boolean | undefined): string {
  return `<p class="step-chat-unavailable" id="step-chat-unavailable" role="status"${
    unavailable ? "" : " hidden"
  }>No agent can answer this step right now. Tour reading stays fully available: browse the steps, then install or connect one of the agents above and ask again.</p>`;
}

/** The disclosure reporting the forbidden tools an answer ran. */
function renderForbiddenToolsHtml(exchange: TourStepChatExchange): string {
  const tools = exchange.forbiddenTools ?? [];
  if (tools.length === 0) {
    return "";
  }
  const summary =
    tools.length === 1
      ? "⚠️ The agent ran a forbidden tool during this answer"
      : `⚠️ The agent ran ${tools.length} forbidden tools during this answer`;
  const items = tools
    .map(tool => {
      const parts = [tool.title ?? tool.kind ?? "Tool"];
      if (tool.title && tool.kind) {
        parts.push(tool.kind);
      }
      parts.push(tool.status ?? "in progress");
      return `<li>${escapeHtml(parts.join(" · "))}</li>`;
    })
    .join("");
  return `<details class="step-chat-forbidden"${exchange.pending ? " open" : ""}><summary>${summary}</summary><ul>${items}</ul></details>`;
}

/** The answer caption naming the agent that produced it, when it is known. */
function renderAgentCaptionHtml(exchange: TourStepChatExchange): string {
  return exchange.agent
    ? `<span class="step-chat-agent-caption">${escapeHtml(agentCaption(exchange.agent))}</span>`
    : "";
}

function renderStepChatLogHtml(
  exchanges: TourStepChatExchange[] | undefined,
  locked: boolean
): string {
  return (exchanges ?? [])
    .map(
      exchange =>
        `<li class="step-chat-question">${escapeHtml(exchange.question)}</li>` +
        `<li class="step-chat-answer${
          exchange.failed ? " step-chat-error" : ""
        }${exchange.pending ? " step-chat-pending" : ""}${
          exchange.interrupted ? " step-chat-interrupted" : ""
        }">${renderAgentCaptionHtml(exchange)}${renderForbiddenToolsHtml(exchange)}${exchange.activityHtml ? `<details class="step-chat-activity"${exchange.pending ? " open" : ""}><summary>Model activity</summary>${exchange.activityHtml}</details>` : ""}${exchange.answerHtml}${renderFailureActionsHtml(
          exchange,
          locked
        )}</li>`
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
    .step-chat-agent { margin: 0 0 1em; padding: 0 .75em; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .step-chat-agent[hidden] { display: none; }
    .step-chat-agent-caption { display: block; margin-bottom: .35em; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .step-chat-agent-controls { display: flex; align-items: center; gap: 6px; margin: 0 0 .6em; padding: 0 .75em; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .step-chat-agent-controls[hidden] { display: none; }
    .step-chat-control-label { flex: 0 0 auto; }
    .step-chat-model-controls { display: flex; align-items: center; gap: 6px; margin: 0 0 .6em; padding: 0 .75em; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .step-chat-model-controls[hidden] { display: none; }
    .step-chat-model-select { flex: 0 1 auto; min-width: 0; max-width: 60%; padding: 2px 4px; font: inherit; font-size: 12px; color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground)); background: var(--vscode-dropdown-background, var(--vscode-input-background)); border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent)); border-radius: 3px; }
    .step-chat-model-select:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
    .step-chat-model-select:disabled { opacity: .55; cursor: default; }
    .step-chat-agent-select { flex: 0 1 auto; min-width: 0; max-width: 60%; padding: 2px 4px; font: inherit; font-size: 12px; color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground)); background: var(--vscode-dropdown-background, var(--vscode-input-background)); border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent)); border-radius: 3px; }
    .step-chat-agents-refresh { display: inline-flex; align-items: center; min-height: 22px; padding: 2px 8px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; font: inherit; font-size: 12px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); cursor: pointer; }
    .step-chat-agents-refresh:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
    .step-chat-agent-select:focus-visible, .step-chat-agents-refresh:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
    .step-chat-agent-select:disabled, .step-chat-agents-refresh:disabled { opacity: .55; cursor: default; }
    .step-chat-failure-actions { display: flex; gap: 6px; margin: .6em 0 0; }
    .step-chat-failure { display: inline-flex; align-items: center; min-height: 24px; padding: 2px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; font: inherit; font-size: 12px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); cursor: pointer; }
    .step-chat-failure:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
    .step-chat-failure:disabled { opacity: .55; cursor: default; }
    .step-chat-failure:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
    .step-chat-unavailable { margin: 0 0 1em; padding: 0 .75em; color: var(--vscode-descriptionForeground); }
    .step-chat-unavailable[hidden] { display: none; }
    .step-chat-activity { margin-bottom: 1em; color: var(--vscode-descriptionForeground); }
    .step-chat-activity summary { cursor: pointer; }
    .step-chat-forbidden { margin-bottom: 1em; color: var(--vscode-editorWarning-foreground); }
    .step-chat-forbidden summary { cursor: pointer; }
    .step-chat-forbidden ul { margin: .5em 0 0; padding-left: 1.25em; }
    .step-chat-status:not([hidden])::before { content: ""; display: inline-block; width: .7em; height: .7em; margin-right: .6em; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: chat-spin 1s linear infinite; }
    @keyframes chat-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .step-chat-status::before { animation: none; } }
    .step-chat-status { margin: 0 0 1.25em; padding: 0 .75em; font-style: italic; color: var(--vscode-descriptionForeground); }
    .step-chat-suggestions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 1em; }
    .step-chat-suggestions[hidden] { display: none; }
    .step-chat-suggestion[hidden] { display: none; }
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
  // Nothing can be asked while an answer streams, and nothing can be asked
  // when no Agent Profile can answer at all.
  const composerDisabled = model.chatResponding || model.chatUnavailable;
  const anchor = model.anchorLabel
    ? `<p class="anchor">${escapeHtml(model.anchorLabel)}</p>` : "";
  const questions = (model.questions ?? [])
    .filter(question => typeof question === "string" && question.trim().length > 0)
    .slice(0, 4);
  const suggestions = questions.length
    ? `<div class="step-chat-suggestions" id="step-chat-suggestions" role="group" aria-label="Suggested questions">${questions.map(question =>
        `<button type="button" class="step-chat-submit step-chat-suggestion" data-action="askQuestion" data-question="${escapeHtml(question.trim())}"${composerDisabled ? " disabled" : ""}>${escapeHtml(question.trim())}</button>`
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
      <nav class="tour-navigation" aria-label="Tour navigation">
        ${model.canEdit ? '<button type="button" data-action="editStep" title="Edit this step in the Markdown editor">Edit</button>' : ""}
        <button type="button" data-action="previous" title="${escapeHtml(model.stepNumber > 0 ? "Previous step" : model.previousTourTitle ? `Previous tour: ${model.previousTourTitle}` : "No previous step")}"${previousEnabled ? "" : " disabled"}><span aria-hidden="true">←</span> Previous</button>
        <span class="tour-position" aria-label="Step ${position} of ${model.stepCount}">${position} / ${model.stepCount}</span>
        <button type="button" data-action="next" title="${escapeHtml(position < model.stepCount ? "Next step" : model.nextTourTitle ? `Next tour: ${model.nextTourTitle}` : "No next step")}"${nextEnabled ? "" : " disabled"}>Next <span aria-hidden="true">→</span></button>
      </nav>
    </div>
    <progress value="${position}" max="${model.stepCount}" aria-label="Tour progress"></progress>
  </header>
  <article>
    <h1>${escapeHtml(model.stepTitle)}</h1>${anchor}
    ${renderMarkdownToHtml(model.description)}
    <section class="step-chat" aria-label="Step discussion">
      ${renderAgentControlsHtml(model.chatAgents, model.chatResponding === true)}
      ${renderModelControlsHtml(
        model.chatModels,
        model.chatModel,
        (model.chatAgents ?? []).length === 0,
        model.chatResponding === true
      )}
      <p class="step-chat-agent" id="step-chat-agent"${
        model.chatAgent ? "" : " hidden"
      }>${model.chatAgent ? escapeHtml(agentLine(model.chatAgent)) : ""}</p>
      ${renderUnavailableHtml(model.chatUnavailable)}
      <ol class="step-chat-log" id="step-chat-log">${renderStepChatLogHtml(
        model.chatExchanges,
        model.chatResponding === true
      )}</ol>
      <p class="step-chat-status" id="step-chat-status"${
        model.chatResponding ? "" : " hidden"
      }>Answer in progress…</p>
      ${suggestions}
      <form class="step-chat-form" id="step-chat-form">
        <input class="step-chat-input" id="step-chat-input" type="text" autocomplete="off" placeholder="Ask a question about this step…" aria-label="Question about this step"${
          composerDisabled ? " disabled" : ""
        }>
        <button type="submit" class="step-chat-submit" id="step-chat-submit"${
          composerDisabled ? " disabled" : ""
        }>Send</button>
        <button type="button" class="step-chat-stop" id="step-chat-stop" data-action="stopQuestion" title="Interrupt the current answer"${
          model.chatUnavailable ? " disabled" : ""
        }${
          model.chatResponding ? "" : " hidden"
        }>Stop</button>
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
    const chatAgent = document.getElementById("step-chat-agent");
    const chatAgentControls = document.getElementById("step-chat-agent-controls");
    const chatAgentSelect = document.getElementById("step-chat-agent-select");
    const chatAgentsRefresh = document.getElementById("step-chat-agents-refresh");
    const chatModelControls = document.getElementById("step-chat-model-controls");
    const chatModelSelect = document.getElementById("step-chat-model-select");
    const chatUnavailable = document.getElementById("step-chat-unavailable");
    const suggestionButtons = Array.from(document.getElementById("step-chat-suggestions")?.children || []);
    // One spelling for both surfaces: the agent caption of an answer and
    // the conversation's agent line with its handshake state.
    const agentCaption = identity => identity.model ? identity.agent + " · " + identity.model : identity.agent;
    const agentLine = identity => "Agent: " + agentCaption(identity) + (identity.effective ? " (effective)" : " (preselected)");
    // The availability states of the Agent Catalogue, spelled once here and
    // once in the extension-side painter.
    const agentStateLabels = {
      unknown: "unknown",
      "not-installed": "not installed",
      unverified: "installed, not verified",
      "auth-required": "authentication required",
      available: "available",
      "connection-error": "connection error"
    };
    const agentStateText = agent => agent.name + " — " + (agentStateLabels[agent.state] ?? "unknown")
      + (agent.detail ? " (" + agent.detail + ")" : "");
    // The two actions of a failed exchange: the same question to the same
    // agent, or another agent for this step.
    const failureActionsHtml = (exchange, locked) => exchange.failed
      ? '<p class="step-chat-failure-actions">'
        + '<button type="button" class="step-chat-failure" data-action="retryQuestion" data-question="'
        + escapeHtml(exchange.question) + '" title="Ask this question again to the same agent"'
        + (locked ? ' disabled' : '') + '>Retry</button>'
        + '<button type="button" class="step-chat-failure" data-action="changeAgent" title="Choose another agent for this step"'
        + (locked ? ' disabled' : '') + '>Change agent</button>'
        + '</p>'
      : '';
    // The agent-managed state names an agent that announces no model: the
    // reader chooses nothing and the agent alone decides.
    const agentManagedModel = "${AGENT_MANAGED_MODEL}";
    let chatResponding = ${model.chatResponding === true};
    let chatCannotAnswer = ${model.chatUnavailable === true};
    let chatModels = ${JSON.stringify(
      (model.chatModels ?? []).map(option => ({ value: option.value, name: option.name }))
    ).replace(/</g, "\\u003c")};
    // The selector probes the still unverified profiles once per opening.
    let selectorProbed = false;
    // Nothing is asked while an answer streams, and nothing is asked when no
    // Agent Profile can answer: the Tour itself stays fully readable. The
    // Agent control follows the answer, never the other way around.
    const lockComposer = () => {
      const locked = chatResponding || chatCannotAnswer;
      if (chatInput) chatInput.disabled = locked;
      if (chatSubmit) chatSubmit.disabled = locked;
      suggestionButtons.forEach(button => { button.disabled = locked; });
      if (chatStop) { chatStop.hidden = !chatResponding; chatStop.disabled = locked; }
      // The reader may still pick an agent while nothing can answer: only a
      // streaming answer locks the choice.
      if (chatAgentSelect) chatAgentSelect.disabled = chatResponding;
      if (chatAgentsRefresh) chatAgentsRefresh.disabled = chatResponding;
      // The Model control is locked while an answer streams, and has nothing
      // to offer when the agent manages its own model.
      if (chatModelSelect) chatModelSelect.disabled = chatResponding || chatModels.length === 0;
    };
    const setResponding = responding => {
      chatResponding = responding;
      if (chatStatus) chatStatus.hidden = !responding;
      lockComposer();
    };
    const setUnavailable = unavailable => {
      chatCannotAnswer = unavailable;
      if (chatUnavailable) chatUnavailable.hidden = !unavailable;
      lockComposer();
    };
    const setAgents = agents => {
      if (!chatAgentSelect || !Array.isArray(agents)) return;
      chatAgentSelect.innerHTML = agents.map(agent =>
        '<option value="' + escapeHtml(agent.name) + '" data-state="' + escapeHtml(agent.state) + '"'
        + (agent.selected ? ' selected' : '') + (agent.selectable === false ? ' disabled' : '') + '>'
        + escapeHtml(agentStateText(agent)) + '</option>'
      ).join("");
      if (chatAgentControls) chatAgentControls.hidden = agents.length === 0;
    };
    const modelOptionsHtml = (models, selected) => models.length === 0
      ? '<option value="" selected>' + escapeHtml(agentManagedModel) + '</option>'
      : models.map(model =>
          '<option value="' + escapeHtml(model.value) + '"'
          + (model.value === selected ? ' selected' : '') + '>'
          + escapeHtml(model.name) + '</option>'
        ).join("");
    // The Model control stays visible for as long as an Agent Selection owns
    // the panel: an agent that announces no model says so instead of hiding.
    const setModels = (models, selected) => {
      chatModels = Array.isArray(models) ? models : [];
      if (chatModelControls) chatModelControls.hidden = false;
      if (!chatModelSelect) return;
      chatModelSelect.innerHTML = modelOptionsHtml(chatModels, selected);
      lockComposer();
    };
    const postChatMessage = message => vscode.postMessage({ ...message, token: document.body.dataset.token,
      targetTourId: document.body.dataset.tourId, step: Number(document.body.dataset.step) });
    const sendQuestion = (type, question) => {
      if (chatResponding || chatCannotAnswer || !question || !question.trim()) return;
      setResponding(true);
      postChatMessage({ type, question: question.trim() });
    };
    const askQuestion = question => sendQuestion("askQuestion", question);
    // Opening the selector probes the profiles still installed but never
    // verified, once; a manual refresh is the only other probe.
    const probeUnverified = () => {
      if (chatResponding || selectorProbed) return;
      selectorProbed = true;
      postChatMessage({ type: "probeUnverified" });
    };
    if (chatModelSelect) {
      chatModelSelect.addEventListener("change", () => {
        // A locked control never changes the model: no answer is ever
        // interrupted by a change the reader did not ask for now.
        if (chatResponding || chatModelSelect.disabled) return;
        const model = chatModelSelect.value;
        if (model) postChatMessage({ type: "chooseModel", model });
      });
    }
    if (chatAgentSelect) {
      chatAgentSelect.addEventListener("focus", probeUnverified);
      chatAgentSelect.addEventListener("pointerdown", probeUnverified);
      chatAgentSelect.addEventListener("change", () => {
        // A locked control never changes the agent: no answer is ever
        // interrupted by a change the reader did not ask for now.
        if (chatResponding || chatAgentSelect.disabled) return;
        const agent = chatAgentSelect.value;
        if (agent) postChatMessage({ type: "chooseAgent", agent });
      });
    }
    if (chatForm && chatInput) {
      chatForm.addEventListener("submit", event => {
        event.preventDefault();
        const question = (chatInput.value || "").trim();
        if (!question || chatResponding || chatCannotAnswer) return;
        chatInput.value = "";
        askQuestion(question);
      });
    }
    window.addEventListener("message", event => {
      const message = event.data;
      if (!message || message.type !== "stepChat" || !Array.isArray(message.exchanges)) return;
      setAgents(message.agents);
      if (Array.isArray(message.modelOptions)) setModels(message.modelOptions, message.model);
      if (chatAgent) {
        chatAgent.textContent = message.agent ? agentLine(message.agent) : "";
        chatAgent.hidden = !message.agent;
      }
      const log = document.getElementById("step-chat-log");
      if (log) {
        const locked = message.responding === true;
        log.innerHTML = message.exchanges.map(exchange => {
          const agentCaptionHtml = exchange.agent
            ? '<span class="step-chat-agent-caption">' + escapeHtml(agentCaption(exchange.agent)) + '</span>'
            : '';
          const forbiddenTools = exchange.forbiddenTools ?? [];
          const forbiddenHtml = forbiddenTools.length === 0
            ? ""
            : '<details class="step-chat-forbidden"' + (exchange.pending ? ' open' : '') + '><summary>'
              + (forbiddenTools.length === 1
                  ? '⚠️ The agent ran a forbidden tool during this answer'
                  : '⚠️ The agent ran ' + forbiddenTools.length + ' forbidden tools during this answer')
              + '</summary><ul>'
              + forbiddenTools.map(tool => {
                  const parts = [tool.title ?? tool.kind ?? "Tool"];
                  if (tool.title && tool.kind) {
                    parts.push(tool.kind);
                  }
                  parts.push(tool.status ?? "in progress");
                  return '<li>' + escapeHtml(parts.join(" · ")) + '</li>';
                }).join("")
              + '</ul></details>';
          return '<li class="step-chat-question">' + escapeHtml(exchange.question) + "</li>" +
          '<li class="step-chat-answer' + (exchange.failed ? " step-chat-error" : "") + (exchange.pending ? " step-chat-pending" : "") + (exchange.interrupted ? " step-chat-interrupted" : "") + '">'
          + agentCaptionHtml
          + forbiddenHtml
          + (exchange.activityHtml ? '<details class="step-chat-activity"' + (exchange.pending ? ' open' : '') + '><summary>Model activity</summary>' + exchange.activityHtml + '</details>' : '')
          + exchange.answerHtml + failureActionsHtml(exchange, locked) + "</li>";
        }).join("");
      }
      // The response-in-progress state stays visible while the answer
      // streams, and the form stays locked so no new question can be sent
      // before the current answer completes.
      setResponding(message.responding === true);
      // A panel whose catalogue has nothing usable keeps the explaining
      // state and the locked composer until a probe finds an agent.
      if (typeof message.unavailable === "boolean") setUnavailable(message.unavailable);
    });
    document.addEventListener("click", event => {
      const button = event.target.closest("button[data-action]");
      if (button) {
        if (button.dataset.action === "askQuestion") {
          if (!button.disabled) {
            // A clicked suggested question stays hidden only until the step
            // renders again; navigating away and back restores it.
            button.hidden = true;
            if (suggestionButtons.every(candidate => candidate.hidden)) {
              const suggestions = document.getElementById("step-chat-suggestions");
              if (suggestions) suggestions.hidden = true;
            }
            askQuestion(button.dataset.question);
          }
          return;
        }
        // A failed exchange asks the same question again to the same agent,
        // without changing the reader's choice.
        if (button.dataset.action === "retryQuestion") {
          if (!button.disabled) sendQuestion("retryQuestion", button.dataset.question);
          return;
        }
        // The other action of a failed exchange moves the reader to the
        // Agent control: the choice stays the reader's.
        if (button.dataset.action === "changeAgent") {
          if (!button.disabled && chatAgentSelect) chatAgentSelect.focus();
          return;
        }
        // A manual refresh is the reader's own way to re-probe the whole
        // catalogue; opening the selector probes the unverified ones again.
        if (button.dataset.action === "refreshAgents") selectorProbed = false;
        if (!button.disabled) postChatMessage({ type: button.dataset.action });
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
