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
  assert.match(html, /<section class="step-chat" aria-label="Step discussion">/);
  assert.match(html, /<form class="step-chat-form" id="step-chat-form">/);
  assert.match(html, /<input class="step-chat-input" id="step-chat-input" type="text"/);
  assert.match(html, /aria-label="Question about this step"/);
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
        },
        {
          question: "Et si le lecteur arrête ?",
          answerHtml: '<p>Réponse partielle.</p><p class="step-chat-interrupted" role="status">Answer interrupted.</p>',
          interrupted: true
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

  // A stopped answer keeps its partial text, marked as interrupted.
  const stoppedQuestionIndex = html.indexOf("Et si le lecteur arrête ?");
  assert.ok(stoppedQuestionIndex > secondQuestionIndex);
  assert.match(html, /<li class="step-chat-answer step-chat-interrupted"><p>Réponse partielle.<\/p>/);
});

test("createTourWebviewHtml reports forbidden tools in a collapsed disclosure above the answer", () => {
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      chatExchanges: [
        {
          question: "Que fais-tu ?",
          answerHtml: "<p>Je réponds.</p>",
          forbiddenTools: [
            {
              title: "Editing the workspace anyway",
              kind: "edit",
              status: "completed"
            }
          ]
        }
      ]
    },
    "chat-nonce"
  );

  // The disclosure sits above the answer, closed on a completed answer,
  // with the exact wording the reader clicks to open the tool calls.
  assert.ok(html.includes(
    '<details class="step-chat-forbidden"><summary>⚠️ The agent ran a forbidden tool during this answer</summary>' +
    '<ul><li>Editing the workspace anyway · edit · completed</li></ul></details><p>Je réponds.</p>'
  ));
});

test("createTourWebviewHtml counts several forbidden tools in the summary and falls back to the kind as label", () => {
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      chatExchanges: [
        {
          question: "Que fais-tu ?",
          answerHtml: "<p>Je réponds.</p>",
          forbiddenTools: [
            { title: "Editing the workspace anyway", kind: "edit", status: "completed" },
            { kind: "delete", status: "in_progress" }
          ]
        }
      ]
    },
    "chat-nonce"
  );

  assert.ok(html.includes(
    "<summary>⚠️ The agent ran 2 forbidden tools during this answer</summary>"
  ));
  assert.ok(html.includes(
    "<ul><li>Editing the workspace anyway · edit · completed</li><li>delete · in_progress</li></ul>"
  ));
});

test("createTourWebviewHtml keeps the forbidden tools disclosure open while the answer is pending", () => {
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      chatExchanges: [
        {
          question: "Que fais-tu ?",
          answerHtml: "<p>Un morceau…</p>",
          pending: true,
          forbiddenTools: [
            { title: "Editing the workspace anyway", kind: "edit", status: "completed" }
          ]
        }
      ]
    },
    "chat-nonce"
  );

  assert.ok(html.includes('<details class="step-chat-forbidden" open>'));
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

  // The Stop button of the chat stops the in-flight answer with the
  // same step identity as every other webview message.
  click({ target: { closest: () => ({ dataset: { action: "stopQuestion" }, disabled: false }) } });
  assert.deepEqual(JSON.parse(JSON.stringify(messages[2])), {
    type: "stopQuestion",
    token: "event-nonce",
    targetTourId: baseModel().tourId,
    step: 1
  });
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
        { question: '<script>alert(1)</script>', activityHtml: "<p>Analyse…</p>", answerHtml: "<p>Réponse sûre.</p>" }
      ]
    }
  });
  assert.equal(
    chatLog.innerHTML,
    '<li class="step-chat-question">&lt;script&gt;alert(1)&lt;/script&gt;</li>' +
      '<li class="step-chat-answer"><details class="step-chat-activity"><summary>Model activity</summary><p>Analyse…</p></details><p>Réponse sûre.</p></li>'
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
  assert.match(linked, /Previous tour: Intro &quot;tour&quot;/);
  assert.doesNotMatch(linked, /data-action="previous"[^>]* disabled/);
});

test("the step chat renders the response-in-progress state and locks the form while responding", () => {
  const idle = createTourWebviewHtml(baseModel(), "responding-nonce");

  // At rest, no response is in progress: the status is hidden and the
  // question field accepts new questions.
  assert.match(
    idle,
    /<p class="step-chat-status" id="step-chat-status" hidden>Answer in progress…<\/p>/
  );
  assert.doesNotMatch(idle, /id="step-chat-input"[^>]* disabled/);
  assert.doesNotMatch(idle, /class="step-chat-submit"[^>]* disabled/);

  const responding = createTourWebviewHtml(
    {
      ...baseModel(),
      chatResponding: true,
      chatExchanges: [
        {
          question: "Pourquoi cette étape ?",
          answerHtml: "<p>Premier morceau…</p>",
          pending: true
        }
      ]
    },
    "responding-nonce"
  );

  // While the answer streams, the in-progress state is visible and the
  // streaming answer is readable, marked as still in progress.
  assert.match(
    responding,
    /<p class="step-chat-status" id="step-chat-status">Answer in progress…<\/p>/
  );
  assert.match(
    responding,
    /<li class="step-chat-answer step-chat-pending"><p>Premier morceau…<\/p><\/li>/
  );
  assert.match(responding, /id="step-chat-input"[^>]* disabled/);
  assert.match(responding, /class="step-chat-submit"[^>]*disabled/);
});

test("the step chat offers the Stop button only while an answer is in progress", () => {
  const idle = createTourWebviewHtml(baseModel(), "stop-nonce");

  // At rest no answer is in flight: there is nothing to interrupt, so the
  // stop button stays hidden and the form keeps accepting questions.
  assert.match(
    idle,
    /<button type="button" class="step-chat-stop" id="step-chat-stop" data-action="stopQuestion" title="Interrupt the current answer" hidden>Stop<\/button>/
  );

  // While an answer is in progress, the stop button becomes visible and
  // clickable next to the locked form.
  const responding = createTourWebviewHtml(
    {
      ...baseModel(),
      chatResponding: true,
      chatExchanges: [
        {
          question: "Pourquoi cette étape ?",
          answerHtml: "<p>Premier morceau…</p>",
          pending: true
        }
      ]
    },
    "stop-nonce"
  );
  assert.match(
    responding,
    /<button type="button" class="step-chat-stop" id="step-chat-stop" data-action="stopQuestion" title="Interrupt the current answer">Stop<\/button>/
  );
});

test("the step chat message handler reflects the streaming updates and unlocks the form when the answer completes", () => {
  const html = createTourWebviewHtml(baseModel(), "stream-nonce");
  const script = html.match(/<script nonce="stream-nonce">([\s\S]*?)<\/script>/)![1];
  const messages: unknown[] = [];
  const elements: Record<string, unknown> = {};
  let messageListener!: (event: unknown) => void;
  const chatInput = { value: "", disabled: false };
  const submitButton = { disabled: false };
  const chatStatus = { hidden: false };
  const chatStop = { hidden: true };
  const chatLog = { innerHTML: "" };
  elements["step-chat-form"] = { addEventListener: () => undefined };
  elements["step-chat-input"] = chatInput;
  elements["step-chat-submit"] = submitButton;
  elements["step-chat-status"] = chatStatus;
  elements["step-chat-stop"] = chatStop;
  elements["step-chat-log"] = chatLog;
  runInNewContext(script, {
    acquireVsCodeApi: () => ({
      postMessage: (message: unknown) => messages.push(message)
    }),
    document: {
      body: { dataset: { token: "stream-nonce", tourId: baseModel().tourId, step: "1" } },
      addEventListener: () => undefined,
      getElementById: (id: string) => elements[id]
    },
    window: {
      addEventListener: (_name: string, listener: (event: unknown) => void) => {
        messageListener = listener;
      }
    }
  });

  // The question appears immediately with the in-progress state: the form
  // is locked so no new question can be sent meanwhile.
  messageListener({
    data: {
      type: "stepChat",
      responding: true,
      exchanges: [{ question: "En flux ?", answerHtml: "", pending: true }]
    }
  });
  assert.equal(chatStatus.hidden, false);
  assert.equal(chatInput.disabled, true);
  assert.equal(submitButton.disabled, true);
  // While the answer streams, the Stop button is visible: the reader can
  // interrupt a request that has become useless.
  assert.equal(chatStop.hidden, false);
  assert.equal(
    chatLog.innerHTML,
    '<li class="step-chat-question">En flux ?</li>' +
      '<li class="step-chat-answer step-chat-pending"></li>'
  );

  // The first chunk is displayed as soon as it arrives, still in progress.
  messageListener({
    data: {
      type: "stepChat",
      responding: true,
      exchanges: [{ question: "En flux ?", answerHtml: "<p>Premier morceau</p>", pending: true }]
    }
  });
  assert.match(chatLog.innerHTML, /Premier morceau/);
  assert.equal(chatInput.disabled, true);

  // The complete answer turns the in-progress state off and unlocks the form.
  messageListener({
    data: {
      type: "stepChat",
      responding: false,
      exchanges: [{ question: "En flux ?", answerHtml: "<p>Premier morceau complet.</p>" }]
    }
  });
  assert.equal(chatStatus.hidden, true);
  assert.equal(chatInput.disabled, false);
  assert.equal(submitButton.disabled, false);
  assert.equal(
    chatLog.innerHTML,
    '<li class="step-chat-question">En flux ?</li>' +
      '<li class="step-chat-answer"><p>Premier morceau complet.</p></li>'
  );

  // A stopped answer leaves the interrupted state in the chat: the partial
  // answer stays readable, marked as interrupted, and the form accepts a new
  // question without any reload.
  messageListener({
    data: {
      type: "stepChat",
      responding: false,
      exchanges: [
        {
          question: "En flux ?",
          answerHtml: '<p>Premier morceau</p><p class="step-chat-interrupted" role="status">Answer interrupted.</p>',
          interrupted: true
        }
      ]
    }
  });
  assert.equal(chatStop.hidden, true);
  assert.equal(chatInput.disabled, false);
  assert.equal(
    chatLog.innerHTML,
    '<li class="step-chat-question">En flux ?</li>' +
      '<li class="step-chat-answer step-chat-interrupted"><p>Premier morceau</p><p class="step-chat-interrupted" role="status">Answer interrupted.</p></li>'
  );
});


test("initial chat render exposes pending model activity", () => {
  const html = createTourWebviewHtml({
    ...baseModel(), chatResponding: true,
    chatExchanges: [{ question: "Pourquoi ?", answerHtml: "", pending: true,
      activityHtml: "<p>Analyse de la constante…</p>" }]
  }, "activity-nonce");
  assert.ok(html.includes('<details class="step-chat-activity" open><summary>Model activity</summary><p>Analyse de la constante…</p></details>'));
});


test("suggested questions are optional, escaped, capped at four and disabled while responding", () => {
  assert.doesNotMatch(createTourWebviewHtml(baseModel(), "nonce"), /id="step-chat-suggestions"/);
  const html = createTourWebviewHtml({ ...baseModel(), chatResponding: true,
    questions: ['Pourquoi "<script>" ?', "Deux ?", "Trois ?", "Quatre ?", "Cinq ?"]
  }, "nonce");
  assert.equal((html.match(/data-question=/g) || []).length, 4);
  assert.match(html, /data-question="Pourquoi &quot;&lt;script&gt;&quot; \?" disabled/);
  assert.doesNotMatch(html, /Cinq \?/);
});

test("question buttons send directly once, preserve the draft, and unlock after completion or failure", () => {
  const html = createTourWebviewHtml({ ...baseModel(), questions: ["Pourquoi ?"] }, "nonce");
  const script = html.match(/<script nonce="nonce">([\s\S]*?)<\/script>/)![1];
  const messages: unknown[] = [];
  let click!: (event: unknown) => void;
  let update!: (event: unknown) => void;
  const button = { disabled: false, dataset: { action: "askQuestion", question: "Pourquoi ?" } };
  const input = { value: "Mon brouillon", disabled: false };
  const submit = { disabled: false };
  const elements: Record<string, unknown> = {
    "step-chat-input": input, "step-chat-submit": submit,
    "step-chat-suggestions": { children: [button] }
  };
  runInNewContext(script, {
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => messages.push(message) }),
    document: {
      body: { dataset: { token: "nonce", tourId: baseModel().tourId, step: "1" } },
      getElementById: (id: string) => elements[id] || null,
      addEventListener: (_name: string, listener: typeof click) => { click = listener; }
    },
    window: { addEventListener: (_name: string, listener: typeof update) => { update = listener; } }
  });
  const press = () => click({ target: { closest: () => button } });
  press();
  press();
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: "askQuestion", question: "Pourquoi ?",
    token: "nonce", targetTourId: baseModel().tourId, step: 1 }]);
  assert.equal(input.value, "Mon brouillon");
  assert.equal(button.disabled, true);
  assert.equal(submit.disabled, true);
  update({ data: { type: "stepChat", responding: true, exchanges: [] } });
  assert.equal(button.disabled, true);
  update({ data: { type: "stepChat", responding: false, exchanges: [] } });
  assert.equal(button.disabled, false);
  press();
  assert.equal(messages.length, 2);
  update({ data: { type: "stepChat", responding: false,
    exchanges: [{ question: "Pourquoi ?", answerHtml: "Erreur", failed: true }] } });
  assert.equal(button.disabled, false);
});
