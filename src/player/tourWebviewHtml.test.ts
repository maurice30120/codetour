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

test("createTourWebviewHtml names the answering agent and captions each answer with it", () => {
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      chatAgent: { agent: "Copilot", model: "gpt-5", effective: true },
      chatExchanges: [
        {
          question: "Qui répond ?",
          answerHtml: "<p>Copilot répond.</p>",
          agent: { agent: "Copilot", model: "gpt-5", effective: true }
        },
        {
          question: "Et lui ?",
          answerHtml: "<p>Vibe répond.</p>",
          agent: { agent: "Vibe", effective: true }
        }
      ]
    },
    "agent-nonce"
  );

  // The conversation says which agent answers right now, and whether a
  // session handshake confirmed it.
  assert.ok(html.includes(
    '<p class="step-chat-agent" id="step-chat-agent">Agent: Copilot · gpt-5 (effective)</p>'
  ));
  // Each answer is captioned with the agent and model that produced it,
  // above the answer and inside the same log entry.
  const firstAnswer = html.indexOf('<span class="step-chat-agent-caption">Copilot · gpt-5</span>');
  assert.ok(firstAnswer > 0, "the first answer is captioned");
  assert.ok(html.indexOf("<p>Copilot répond.</p>") > firstAnswer);
  assert.ok(html.includes(
    '<span class="step-chat-agent-caption">Vibe</span><p>Vibe répond.</p>'
  ));
});

test("createTourWebviewHtml hides the agent line without an agent and marks the preselection", () => {
  const idle = createTourWebviewHtml(baseModel(), "agent-nonce");
  assert.ok(idle.includes('<p class="step-chat-agent" id="step-chat-agent" hidden></p>'));

  // No session exists yet: the profile is only preselected, and its name is
  // escaped like every other value the reader's agent produces.
  const preselected = createTourWebviewHtml(
    { ...baseModel(), chatAgent: { agent: 'Vibe "<b>"', effective: false } },
    "agent-nonce"
  );
  assert.ok(preselected.includes(
    'Agent: Vibe &quot;&lt;b&gt;&quot; (preselected)'
  ));
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
  // The four kept questions are the four rendered suggestion buttons; a
  // failed exchange's Retry action is the only other data-question markup.
  assert.equal(
    (html.match(/class="step-chat-submit step-chat-suggestion"/g) || []).length,
    4
  );
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

test("a clicked suggested question is masked until the step renders again", () => {
  const html = createTourWebviewHtml({ ...baseModel(), questions: ["Pourquoi ?", "Comment ?"] }, "nonce");
  const script = html.match(/<script nonce="nonce">([\s\S]*?)<\/script>/)![1];
  const messages: unknown[] = [];
  let click!: (event: unknown) => void;
  let update!: (event: unknown) => void;
  const button = { disabled: false, hidden: false, dataset: { action: "askQuestion", question: "Pourquoi ?" } };
  const other = { disabled: false, hidden: false, dataset: { action: "askQuestion", question: "Comment ?" } };
  const input = { value: "", disabled: false };
  const submit = { disabled: false };
  const suggestions = { hidden: false, children: [button, other] };
  const elements: Record<string, unknown> = {
    "step-chat-input": input, "step-chat-submit": submit, "step-chat-suggestions": suggestions
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
  // Clicking a suggested question masks it immediately; the group hides
  // only once every suggestion has been used.
  click({ target: { closest: () => button } });
  assert.equal(button.hidden, true);
  assert.equal(other.hidden, false);
  assert.equal(suggestions.hidden, false);
  assert.equal(messages.length, 1);
  update({ data: { type: "stepChat", responding: false, exchanges: [] } });
  click({ target: { closest: () => other } });
  assert.equal(other.hidden, true);
  assert.equal(suggestions.hidden, true);
  assert.equal(messages.length, 2);
});

test("the step chat message handler repaints the current agent and the answer captions", () => {
  const html = createTourWebviewHtml(baseModel(), "agent-nonce");
  const script = html.match(/<script nonce="agent-nonce">([\s\S]*?)<\/script>/)![1];
  let messageListener!: (event: unknown) => void;
  const agentElement = { textContent: "", hidden: true };
  const chatLog = { innerHTML: "" };
  const elements: Record<string, unknown> = {
    "step-chat-agent": agentElement,
    "step-chat-log": chatLog
  };
  runInNewContext(script, {
    acquireVsCodeApi: () => ({ postMessage: () => undefined }),
    document: {
      body: { dataset: { token: "agent-nonce", tourId: baseModel().tourId, step: "1" } },
      addEventListener: () => undefined,
      getElementById: (id: string) => elements[id] ?? null
    },
    window: {
      addEventListener: (_name: string, listener: (event: unknown) => void) => {
        messageListener = listener;
      }
    }
  });

  // The handshake confirmed the agent: the line becomes effective and the
  // answer is captioned with the agent that produced it.
  messageListener({
    data: {
      type: "stepChat",
      responding: false,
      agent: { agent: "Copilot", model: "gpt-5", effective: true },
      exchanges: [
        {
          question: "Qui répond ?",
          answerHtml: "<p>Copilot répond.</p>",
          agent: { agent: "Copilot", model: "gpt-5", effective: true }
        }
      ]
    }
  });
  assert.equal(agentElement.hidden, false);
  assert.equal(agentElement.textContent, "Agent: Copilot · gpt-5 (effective)");
  assert.equal(
    chatLog.innerHTML,
    '<li class="step-chat-question">Qui répond ?</li>' +
      '<li class="step-chat-answer"><span class="step-chat-agent-caption">Copilot · gpt-5</span><p>Copilot répond.</p></li>'
  );

  // Before any session, the same line names the preselection.
  messageListener({
    data: { type: "stepChat", responding: false, agent: { agent: "Vibe", effective: false }, exchanges: [] }
  });
  assert.equal(agentElement.textContent, "Agent: Vibe (preselected)");

  // An update without an agent hides the line instead of naming a guess.
  messageListener({ data: { type: "stepChat", responding: false, exchanges: [] } });
  assert.equal(agentElement.hidden, true);
});

test("the Agent control lists every Agent Profile with its state and disables the ones the reader cannot pick", () => {
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      chatAgent: { agent: "Copilot", effective: false },
      chatAgents: [
        { name: "Copilot", state: "available", selected: true, selectable: true },
        { name: "Vibe", state: "unverified", selectable: true },
        { name: "Codex", state: "not-installed", selectable: false },
        {
          name: "Claude Code",
          state: "auth-required",
          detail: "Claude login",
          selectable: true
        },
        { name: 'Another "<b>"', state: "connection-error", detail: "timed out <5 s>", selectable: true },
        { name: "Unknown agent", state: "unknown", selectable: true }
      ]
    },
    "agents-nonce"
  );

  // The whole catalogue is listed, in catalogue order, in one Agent control.
  assert.match(html, /<div class="step-chat-agent-controls" id="step-chat-agent-controls">/);
  assert.match(html, /<label class="step-chat-control-label" for="step-chat-agent-select">Agent<\/label>/);
  assert.match(html, /<select class="step-chat-agent-select" id="step-chat-agent-select" aria-label="Agent">/);
  // The profile that answers is the selected option, and the profile that is
  // not installed is listed but disabled: visible, never selectable.
  assert.ok(html.includes(
    '<option value="Copilot" data-state="available" selected>Copilot — available</option>'
  ));
  assert.ok(html.includes(
    '<option value="Codex" data-state="not-installed" disabled>Codex — not installed</option>'
  ));
  // A profile waiting for authentication or in connection error stays
  // selectable by hand.
  assert.ok(html.includes(
    '<option value="Claude Code" data-state="auth-required">Claude Code — authentication required (Claude login)</option>'
  ));
  assert.ok(html.includes(
    '<option value="Vibe" data-state="unverified">Vibe — installed, not verified</option>'
  ));
  assert.ok(html.includes(
    '<option value="Unknown agent" data-state="unknown">Unknown agent — unknown</option>'
  ));
  // Every name and detail is escaped like the rest of the conversation.
  assert.ok(html.includes(
    '<option value="Another &quot;&lt;b&gt;&quot;" data-state="connection-error">Another &quot;&lt;b&gt;&quot; — connection error (timed out &lt;5 s&gt;)</option>'
  ));
  // The manual Refresh of the reader's own probe sits next to the selector.
  assert.match(html, /<button type="button" class="step-chat-agents-refresh" id="step-chat-agents-refresh" data-action="refreshAgents" title="Probe every agent again">Refresh<\/button>/);
  // An agent can answer: the composer keeps accepting questions.
  assert.match(html, /id="step-chat-unavailable" role="status" hidden>/);
  assert.doesNotMatch(html, /id="step-chat-input"[^>]* disabled/);
});

test("an agent waiting for authentication offers the reader a Sign in action in the availability row", () => {
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      chatAgents: [
        { name: "Copilot", state: "available", selected: false, selectable: true },
        {
          name: "Claude Code",
          state: "auth-required",
          detail: "Claude login",
          selected: true,
          selectable: true,
          signIn: true
        }
      ]
    },
    "sign-in-nonce"
  );

  // The action belongs to the profile the selector shows, next to Refresh.
  assert.match(
    html,
    /<button type="button" class="step-chat-sign-in" id="step-chat-sign-in" data-action="signIn" title="Connect this agent">Sign in<\/button>/
  );
  assert.match(
    html,
    /<option value="Claude Code" data-state="auth-required" selected>Claude Code — authentication required \(Claude login\)<\/option>/
  );

  // A profile that announced no method CodeTour can use has no action: the
  // reader is never offered a sign in that cannot connect anything.
  const noMethod = createTourWebviewHtml(
    {
      ...baseModel(),
      chatAgents: [
        { name: "Copilot", state: "available", selected: true, selectable: true },
        {
          name: "Claude Code",
          state: "auth-required",
          detail: "Claude login",
          selectable: true
        }
      ]
    },
    "sign-in-nonce"
  );
  assert.match(
    noMethod,
    /id="step-chat-sign-in" data-action="signIn" title="Connect this agent" hidden>Sign in<\/button>/
  );

  // While an answer streams the action is locked like the rest of the row, so
  // no answer is ever interrupted by a connection the reader did not ask for
  // right now.
  const responding = createTourWebviewHtml(
    {
      ...baseModel(),
      chatResponding: true,
      chatAgents: [
        {
          name: "Claude Code",
          state: "auth-required",
          detail: "Claude login",
          selected: true,
          selectable: true,
          signIn: true
        }
      ]
    },
    "sign-in-nonce"
  );
  assert.match(
    responding,
    /id="step-chat-sign-in" data-action="signIn" title="Connect this agent" disabled>Sign in<\/button>/
  );
});

test("the Agent control stays quiet without a catalogue and locks with the composer while an answer streams", () => {
  // No Agent Selection owns the panel (an injected responder): no control.
  assert.ok(createTourWebviewHtml(baseModel(), "agents-nonce").includes(
    '<div class="step-chat-agent-controls" id="step-chat-agent-controls" hidden>'
  ));

  // While an answer streams, the selector and the Refresh are disabled like
  // the composer: no answer is ever interrupted by a change of agent.
  const responding = createTourWebviewHtml(
    {
      ...baseModel(),
      chatResponding: true,
      chatAgents: [
        { name: "Copilot", state: "available", selected: true, selectable: true },
        { name: "Codex", state: "not-installed", selectable: false }
      ],
      chatExchanges: [
        { question: "En flux ?", answerHtml: "<p>Un morceau…</p>", pending: true }
      ]
    },
    "agents-nonce"
  );
  assert.match(responding, /id="step-chat-agent-select" aria-label="Agent" disabled>/);
  assert.match(responding, /id="step-chat-agents-refresh"[^>]* disabled>Refresh<\/button>/);
  assert.match(responding, /id="step-chat-input"[^>]* disabled/);

  // A panel where nothing can answer still lets the reader pick an agent by
  // hand: only a streaming answer locks the choice.
  const unavailable = createTourWebviewHtml(
    {
      ...baseModel(),
      chatUnavailable: true,
      chatAgents: [
        { name: "Copilot", state: "not-installed", selectable: false },
        { name: "Vibe", state: "connection-error", detail: "timed out", selectable: true }
      ]
    },
    "agents-nonce"
  );
  assert.doesNotMatch(unavailable, /id="step-chat-agent-select"[^>]*disabled/);
  assert.doesNotMatch(unavailable, /id="step-chat-agents-refresh"[^>]*disabled/);
  assert.match(unavailable, /id="step-chat-input"[^>]* disabled/);
});

test("a failed exchange carries Retry and Change agent, locked while another answer streams", () => {
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      chatExchanges: [
        {
          question: 'Et si "ça" casse ?',
          answerHtml: "<p>L'agent a échoué.</p>",
          failed: true
        }
      ]
    },
    "failure-nonce"
  );

  // The failure stays attached to its own exchange, with the two actions
  // the reader decides between.
  assert.ok(html.includes(
    '<p class="step-chat-failure-actions"><button type="button" class="step-chat-failure" data-action="retryQuestion" data-question="Et si &quot;ça&quot; casse ?" title="Ask this question again to the same agent">Retry</button>' +
      '<button type="button" class="step-chat-failure" data-action="changeAgent" title="Choose another agent for this step">Change agent</button></p>'
  ));

  // While another answer streams, both actions stay disabled.
  const responding = createTourWebviewHtml(
    {
      ...baseModel(),
      chatResponding: true,
      chatExchanges: [
        { question: "Question en échec ?", answerHtml: "<p>Erreur.</p>", failed: true },
        { question: "Question en flux ?", answerHtml: "", pending: true }
      ]
    },
    "failure-nonce"
  );
  assert.match(
    responding,
    /data-action="retryQuestion" data-question="Question en échec \?" title="Ask this question again to the same agent" disabled>Retry<\/button>/
  );
  assert.match(
    responding,
    /data-action="changeAgent" title="Choose another agent for this step" disabled>Change agent<\/button>/
  );
});

test("a panel whose catalogue has nothing usable explains it and disables the composer only", () => {
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      questions: ["Pourquoi ?"],
      chatAgents: [
        { name: "Copilot", state: "not-installed" },
        { name: "Vibe", state: "connection-error", detail: "timed out" }
      ],
      chatUnavailable: true
    },
    "unavailable-nonce"
  );

  // The explaining state is visible and says the reading is unaffected.
  assert.match(html, /<p class="step-chat-unavailable" id="step-chat-unavailable" role="status">No agent can answer this step right now\./);
  assert.match(html, /Tour reading stays fully available/);
  // Nothing can be asked: the field, the send button and the suggestions are
  // disabled, and the Stop button cannot be used either.
  assert.match(html, /id="step-chat-input"[^>]* disabled/);
  assert.match(html, /class="step-chat-submit" id="step-chat-submit" disabled/);
  assert.match(html, /data-question="Pourquoi \?" disabled/);
  assert.match(html, /id="step-chat-stop"[^>]*disabled/);
  // The Tour itself stays fully readable and navigable.
  assert.match(html, /<h1>Overview<\/h1>/);
  assert.doesNotMatch(html, /data-action="next"[^>]* disabled/);
  assert.match(html, /data-action="previous"/);
});

test("the step chat message handler repaints the Agent control and locks it with the composer", () => {
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      questions: ["Pourquoi ?"],
      chatAgents: [
        { name: "Copilot", state: "unverified", selected: true, selectable: true }
      ]
    },
    "agents-nonce"
  );
  const script = html.match(/<script nonce="agents-nonce">([\s\S]*?)<\/script>/)![1];
  let messageListener!: (event: unknown) => void;
  const controls = { hidden: false };
  const select = {
    innerHTML: "",
    value: "Copilot",
    disabled: false,
    addEventListener: () => undefined
  };
  const refresh = { disabled: false };
  const unavailableNote = { hidden: true };
  const input = { value: "", disabled: false };
  const submitButton = { disabled: false };
  const stopButton = { hidden: true, disabled: false };
  const chatLog = { innerHTML: "" };
  const suggestion = { disabled: false, hidden: false, dataset: { action: "askQuestion", question: "Pourquoi ?" } };
  const elements: Record<string, unknown> = {
    "step-chat-log": chatLog,
    "step-chat-agent-controls": controls,
    "step-chat-agent-select": select,
    "step-chat-agents-refresh": refresh,
    "step-chat-unavailable": unavailableNote,
    "step-chat-input": input,
    "step-chat-submit": submitButton,
    "step-chat-stop": stopButton,
    "step-chat-suggestions": { children: [suggestion] }
  };
  runInNewContext(script, {
    acquireVsCodeApi: () => ({ postMessage: () => undefined }),
    document: {
      body: { dataset: { token: "agents-nonce", tourId: baseModel().tourId, step: "1" } },
      addEventListener: () => undefined,
      getElementById: (id: string) => elements[id] ?? null
    },
    window: {
      addEventListener: (_name: string, listener: (event: unknown) => void) => {
        messageListener = listener;
      }
    }
  });

  // The probe settled with nothing usable: the whole catalogue is listed with
  // its states, the panel explains itself and the composer is locked. The
  // Agent control stays usable, so the reader can still pick an agent by hand.
  messageListener({
    data: {
      type: "stepChat",
      responding: false,
      unavailable: true,
      agents: [
        { name: "Copilot", state: "not-installed", selectable: false },
        { name: 'Vibe "<b>"', state: "connection-error", detail: "did not answer", selectable: true }
      ],
      exchanges: []
    }
  });
  assert.equal(controls.hidden, false);
  assert.equal(
    select.innerHTML,
    '<option value="Copilot" data-state="not-installed" disabled>Copilot — not installed</option>' +
      '<option value="Vibe &quot;&lt;b&gt;&quot;" data-state="connection-error">Vibe &quot;&lt;b&gt;&quot; — connection error (did not answer)</option>'
  );
  assert.equal(unavailableNote.hidden, false);
  assert.equal(input.disabled, true);
  assert.equal(submitButton.disabled, true);
  assert.equal(suggestion.disabled, true);
  assert.equal(stopButton.disabled, true);
  assert.equal(select.disabled, false);
  assert.equal(refresh.disabled, false);

  // A later probe found an agent: the option is selected and the composer
  // follows.
  messageListener({
    data: {
      type: "stepChat",
      responding: false,
      unavailable: false,
      agents: [{ name: "Copilot", state: "available", selected: true, selectable: true }],
      exchanges: []
    }
  });
  assert.equal(unavailableNote.hidden, true);
  assert.equal(input.disabled, false);
  assert.equal(submitButton.disabled, false);
  assert.equal(suggestion.disabled, false);
  assert.equal(
    select.innerHTML,
    '<option value="Copilot" data-state="available" selected>Copilot — available</option>'
  );

  // While an answer streams the Agent control is locked with the composer,
  // and the failed-exchange actions of the log are rendered disabled.
  messageListener({
    data: {
      type: "stepChat",
      responding: true,
      agents: [{ name: "Copilot", state: "available", selected: true, selectable: true }],
      exchanges: [
        { question: "Question en échec ?", answerHtml: "<p>Erreur.</p>", failed: true },
        { question: "Question en flux ?", answerHtml: "", pending: true }
      ]
    }
  });
  assert.equal(select.disabled, true);
  assert.equal(refresh.disabled, true);
  assert.match(
    chatLog.innerHTML,
    /data-action="retryQuestion" data-question="Question en échec \?" title="Ask this question again to the same agent" disabled>Retry<\/button>/
  );
});

test("opening the selector probes the unverified profiles once, and a manual refresh re-probes", () => {
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      chatAgents: [
        { name: "Copilot", state: "available", selected: true, selectable: true },
        { name: "Vibe", state: "unverified", selectable: true }
      ]
    },
    "selector-nonce"
  );
  const script = html.match(/<script nonce="selector-nonce">([\s\S]*?)<\/script>/)![1];
  const messages: { type?: string; agent?: string; question?: string }[] = [];
  let click!: (event: unknown) => void;
  let select: {
    innerHTML: string;
    value: string;
    disabled: boolean;
    listeners: Record<string, () => void>;
    addEventListener: (name: string, listener: () => void) => void;
    focus: () => void;
  };
  let focused = 0;
  select = {
    innerHTML: "",
    value: "Copilot",
    disabled: false,
    listeners: {},
    addEventListener: (name: string, listener: () => void) => {
      select.listeners[name] = listener;
    },
    focus: () => {
      focused++;
    }
  };
  const refresh = { disabled: false };
  const elements: Record<string, unknown> = {
    "step-chat-agent-select": select,
    "step-chat-agents-refresh": refresh
  };
  runInNewContext(script, {
    acquireVsCodeApi: () => ({
      postMessage: (message: { type?: string }) => messages.push(message)
    }),
    document: {
      body: { dataset: { token: "selector-nonce", tourId: baseModel().tourId, step: "1" } },
      getElementById: (id: string) => elements[id] ?? null,
      addEventListener: (_name: string, listener: typeof click) => {
        click = listener;
      }
    },
    window: { addEventListener: () => undefined }
  });

  // Opening the selector - by focusing it or by pressing it - probes the
  // profiles still installed but never verified, once.
  select.listeners.focus();
  select.listeners.pointerdown();
  assert.deepEqual(
    messages.filter(message => message.type === "probeUnverified").map(message => message.type),
    ["probeUnverified"]
  );

  // Picking a profile sends the reader's choice with the step identity.
  select.value = "Vibe";
  select.listeners.change();
  const choose = messages[messages.length - 1] as { type?: string; agent?: string; step?: number };
  assert.equal(choose.type, "chooseAgent");
  assert.equal(choose.agent, "Vibe");
  assert.equal(choose.step, 1);

  // The manual Refresh asks the extension to probe the whole catalogue again,
  // and the next opening probes the newly unverified profiles once more.
  click({ target: { closest: () => ({ dataset: { action: "refreshAgents" }, disabled: false }) } });
  assert.equal(messages[messages.length - 1].type, "refreshAgents");
  select.listeners.focus();
  assert.equal(
    messages.filter(message => message.type === "probeUnverified").length,
    2
  );

  // Nothing is probed or chosen while an answer streams: the control is
  // locked, and the script refuses the change as well.
  select.disabled = true;
  const before = messages.length;
  select.listeners.change();
  assert.equal(messages.length, before);
  select.value = "Copilot";
  select.listeners.change();
  assert.equal(messages.length, before);

  // The Change agent action of a failed exchange focuses the Agent control
  // instead of changing anything by itself.
  click({ target: { closest: () => ({ dataset: { action: "changeAgent" }, disabled: false }) } });
  assert.equal(focused, 1);
  assert.equal(messages.length, before);
});

test("the Sign in action asks the extension to connect the profile the selector shows", () => {
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      chatAgents: [
        { name: "Copilot", state: "available", selected: true, selectable: true },
        {
          name: "Claude Code",
          state: "auth-required",
          detail: "Claude login",
          selectable: true,
          signIn: true
        }
      ]
    },
    "sign-in-nonce"
  );
  const script = html.match(/<script nonce="sign-in-nonce">([\s\S]*?)<\/script>/)![1];
  const messages: { type?: string; agent?: string; step?: number }[] = [];
  let click!: (event: unknown) => void;
  const signIn = { disabled: false, hidden: true };
  const select = {
    innerHTML: "",
    value: "Copilot",
    disabled: false,
    addEventListener: () => undefined,
    focus: () => undefined
  };
  const elements: Record<string, unknown> = {
    "step-chat-agent-select": select,
    "step-chat-sign-in": signIn
  };
  runInNewContext(script, {
    acquireVsCodeApi: () => ({
      postMessage: (message: { type?: string }) => messages.push(message)
    }),
    document: {
      body: { dataset: { token: "sign-in-nonce", tourId: baseModel().tourId, step: "1" } },
      getElementById: (id: string) => elements[id] ?? null,
      addEventListener: (_name: string, listener: typeof click) => {
        click = listener;
      }
    },
    window: { addEventListener: () => undefined }
  });

  // The profile that answers offers no sign in: the action starts locked and
  // clicking it connects nothing.
  assert.equal(signIn.hidden, true);
  assert.equal(signIn.disabled, true);
  click({ target: { closest: () => ({ dataset: { action: "signIn" }, disabled: signIn.disabled }) } });
  assert.deepEqual(messages, [], "nothing is connected for a profile with no method");

  // Picking the profile that waits for authentication unlocks its action, and
  // clicking it posts the reader's own sign in for that one agent.
  select.value = "Claude Code";
  signIn.disabled = false;
  click({ target: { closest: () => ({ dataset: { action: "signIn" }, disabled: signIn.disabled }) } });
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    {
      type: "signIn",
      agent: "Claude Code",
      token: "sign-in-nonce",
      targetTourId: baseModel().tourId,
      step: 1
    }
  ]);

  // A locked action never reaches the extension.
  click({ target: { closest: () => ({ dataset: { action: "signIn" }, disabled: true }) } });
  assert.equal(messages.length, 1);
});

test("the Retry action of a failed exchange asks the same question to the same agent", () => {
  const html = createTourWebviewHtml(
    {
      ...baseModel(),
      chatExchanges: [
        { question: "Pourquoi ça casse ?", answerHtml: "<p>Erreur.</p>", failed: true }
      ]
    },
    "retry-nonce"
  );
  const script = html.match(/<script nonce="retry-nonce">([\s\S]*?)<\/script>/)![1];
  const messages: unknown[] = [];
  let click!: (event: unknown) => void;
  const retry = {
    disabled: false,
    hidden: false,
    dataset: { action: "retryQuestion", question: "Pourquoi ça casse ?" }
  };
  runInNewContext(script, {
    acquireVsCodeApi: () => ({
      postMessage: (message: unknown) => messages.push(message)
    }),
    document: {
      body: { dataset: { token: "retry-nonce", tourId: baseModel().tourId, step: "1" } },
      getElementById: () => null,
      addEventListener: (_name: string, listener: typeof click) => {
        click = listener;
      }
    },
    window: { addEventListener: () => undefined }
  });

  click({ target: { closest: () => retry } });
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    {
      type: "retryQuestion",
      question: "Pourquoi ça casse ?",
      token: "retry-nonce",
      targetTourId: baseModel().tourId,
      step: 1
    }
  ]);

  // A locked action never reaches the extension.
  retry.disabled = true;
  click({ target: { closest: () => retry } });
  assert.equal(messages.length, 1);
});
