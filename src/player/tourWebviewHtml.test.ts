import { test } from "node:test";
import * as assert from "node:assert";
import { runInNewContext } from "node:vm";
import { createTourWebviewHtml } from "./markdown";

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
  assert.match(html, />2 \/ 3<\/span>/);
  assert.match(html, /<progress value="2" max="3" aria-label="Tour progress"><\/progress>/);

  // Article: step title, anchor target and the shared description rendering.
  assert.match(html, /<article>/);
  assert.match(html, /<h1>Architecture<\/h1>/);
  assert.match(html, /class="anchor">src\/player\/index\.ts : 42</);
  assert.match(html, /<h1>Overview<\/h1>/);
  assert.match(html, /<strong>CodeTour<\/strong>/);

  assert.match(html, /data-action="previous"/);
  assert.match(html, /data-action="next"/);
  assert.doesNotMatch(html, /<textarea/);

});

test("createTourWebviewHtml renders the step chat field under the description", () => {
  const html = createTourWebviewHtml(baseModel(), "chat-nonce");

  // The chat lives under the rendered explanation, inside the reading article.
  const descriptionIndex = html.indexOf("<strong>CodeTour</strong>");
  const chatIndex = html.indexOf('class="step-chat"');
  assert.ok(descriptionIndex > 0);
  assert.ok(chatIndex > descriptionIndex);
  assert.match(html, /<section class="step-chat" aria-label="Discussion de l'étape">/);
  assert.match(html, /<form class="step-chat-form" id="step-chat-form">/);
  assert.match(html, /<input class="step-chat-input" id="step-chat-input" type="text"/);
  assert.match(html, /aria-label="Question sur cette étape"/);
  assert.match(html, /<button type="submit" class="step-chat-submit"/);
});

test("createTourWebviewHtml renders the step conversation with escaped questions and answers under them", () => {
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      chatExchanges: [
        {
          question: 'Que fait "<b>cette</b>" &lt;fonction&gt; ?',
          answerHtml: "<p>Elle retourne <strong>la valeur</strong>.</p>"
        },
        {
          question: "Et si l'agent échoue ?",
          answerHtml: "<p>Erreur de réponse.</p>",
          failed: true
        }
      ]
    },
    "chat-nonce"
  );

  // Each question appears first, then its answer right under it, in order.
  const questionIndex = html.indexOf("Que fait &quot;&lt;b&gt;cette&lt;/b&gt;&quot; &amp;lt;fonction&amp;gt; ?");
  assert.ok(questionIndex > 0, "the question is escaped in the log");
  const answerIndex = html.indexOf("<li class=\"step-chat-answer\"><p>Elle retourne <strong>la valeur</strong>.</p></li>");
  assert.ok(answerIndex > questionIndex, "the answer appears under its question");
  assert.match(html, /<li class="step-chat-question">/);
  assert.match(html, /step-chat-answer step-chat-error"/);
  const secondQuestionIndex = html.indexOf("Et si l&#39;agent échoue ?");
  assert.ok(secondQuestionIndex > answerIndex);
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


test("the reading view forwards only content links with the active step identity", () => {
  const html = createTourWebviewHtml(baseModel(), "event-nonce");
  const script = html.match(/<script nonce="event-nonce">([\s\S]*?)<\/script>/)![1];
  let click!: (event: unknown) => void;
  const messages: unknown[] = [];
  runInNewContext(script, {
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => messages.push(message) }),
    document: {
      body: { dataset: { token: "event-nonce", tourId: baseModel().tourId, step: "1" } },
      addEventListener: (_name: string, listener: (event: unknown) => void) => { click = listener; },
      getElementById: () => null
    },
    window: { addEventListener: () => undefined }
  });
  let prevented = false;
  click({ target: { closest: (selector: string) => selector.startsWith("button") ? null : ({ getAttribute: () => "https://example.com" }) }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: "openLink", href: "https://example.com", token: "event-nonce", targetTourId: baseModel().tourId, step: 1 }]);
  click({ target: { closest: (selector: string) => selector.startsWith("button") ? null : ({ getAttribute: () => "#section" }) }, preventDefault: () => assert.fail("local anchors stay local") });
  assert.equal(messages.length, 1);
  click({ target: { closest: () => ({ dataset: { action: "next" }, disabled: false }) } });
  assert.deepEqual(JSON.parse(JSON.stringify(messages[1])), { type: "next", token: "event-nonce", targetTourId: baseModel().tourId, step: 1 });
  click({ target: { closest: () => ({ dataset: { action: "previous" }, disabled: true }) } });
  assert.equal(messages.length, 2);
});

test("the step chat submits questions with the step identity and renders chat updates safely", () => {
  const html = createTourWebviewHtml(baseModel(), "chat-nonce");
  const script = html.match(/<script nonce="chat-nonce">([\s\S]*?)<\/script>/)![1];
  const messages: unknown[] = [];
  const elements: Record<string, unknown> = {};
  let submit!: (event: unknown) => void;
  let messageListener!: (event: unknown) => void;
  const chatInput = { value: "" };
  const chatLog = { innerHTML: "" };
  elements["step-chat-form"] = {
    addEventListener: (_name: string, listener: (event: unknown) => void) => {
      submit = listener;
    }
  };
  elements["step-chat-input"] = chatInput;
  elements["step-chat-log"] = chatLog;
  runInNewContext(script, {
    acquireVsCodeApi: () => ({
      postMessage: (message: unknown) => messages.push(message)
    }),
    document: {
      body: { dataset: { token: "chat-nonce", tourId: baseModel().tourId, step: "1" } },
      addEventListener: () => undefined,
      getElementById: (id: string) => elements[id]
    },
    window: {
      addEventListener: (_name: string, listener: (event: unknown) => void) => {
        messageListener = listener;
      }
    }
  });

  // Submitting the chat field sends the question with the active step identity.
  chatInput.value = "  Pourquoi cette étape ?  ";
  submit({ preventDefault: () => undefined });
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    {
      type: "askQuestion",
      question: "Pourquoi cette étape ?",
      token: "chat-nonce",
      targetTourId: baseModel().tourId,
      step: 1
    }
  ]);
  assert.equal(chatInput.value, "", "the field is cleared after sending");

  // An empty question is never sent.
  chatInput.value = "   ";
  submit({ preventDefault: () => undefined });
  assert.equal(messages.length, 1);

  // A chat update replaces the log with escaped questions and the answers.
  messageListener({
    data: {
      type: "stepChat",
      exchanges: [
        { question: '<script>alert(1)</script>', answerHtml: "<p>Réponse sûre.</p>" }
      ]
    }
  });
  assert.equal(
    chatLog.innerHTML,
    '<li class="step-chat-question">&lt;script&gt;alert(1)&lt;/script&gt;</li>' +
      '<li class="step-chat-answer"><p>Réponse sûre.</p></li>'
  );

  // Malformed updates never touch the displayed conversation.
  messageListener({ data: { type: "stepChat" } });
  messageListener({ data: { type: "unrelated", exchanges: [] } });
  messageListener({ data: undefined });
  assert.match(chatLog.innerHTML, /Réponse sûre/);
});

test("navigation disables absent neighbors and names linked tours at the boundaries", () => {
  const first = createTourWebviewHtml({ ...baseModel(), stepNumber: 0 }, "nonce");
  assert.match(first, /data-action="previous"[^>]* disabled/);
  const last = createTourWebviewHtml({ ...baseModel(), stepNumber: 2 }, "nonce");
  assert.match(last, /data-action="next"[^>]* disabled/);
  const linked = createTourWebviewHtml({ ...baseModel(), stepNumber: 0, previousTourTitle: 'Intro "tour"' }, "nonce");
  assert.match(linked, /Tour précédent : Intro &quot;tour&quot;/);
  assert.doesNotMatch(linked, /data-action="previous"[^>]* disabled/);
});
