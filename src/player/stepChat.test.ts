import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost } from "../test/vscodeHost";

// The Tour Step Conversation base: a question asked under the step
// explanation captures the actually displayed buffer, path and step
// description for the injected responder, and shows its answer in the chat.
const host = createVscodeHost();

const originalLoad = (nodeModule as unknown as { _load: unknown })._load as (
  request: string,
  ...args: unknown[]
) => unknown;
(nodeModule as unknown as { _load: unknown })._load = function (
  request: string,
  ...args: unknown[]
) {
  if (request === "vscode") {
    return host.vscode;
  }
  return originalLoad.apply(this, [request, ...args]);
};

const { registerPlayerModule } = require("../player");
const { setStepChatResponder } = require("./stepChat");

const tour = {
  id: "file:///workspace/.tours/chat.tour",
  title: "1 - Chat Tour",
  description: "A tour with a chat",
  steps: [
    {
      title: "Player entry",
      description: "Le lecteur démarre ici.\n\nBienvenue dans le lecteur.",
      file: "src/player.ts",
      line: 3
    },
    {
      title: "Other file",
      description: "Une autre étape du tour.",
      file: "src/other.ts",
      line: 2
    },
    {
      title: "Presentation",
      description: "Étape sans cible de code."
    }
  ]
};

function seedWorkspace() {
  host.setFileContent(
    "src/player.ts",
    ['import { store } from "./store";', "", "startPlayer();"].join("\n")
  );
  host.setFileContent("src/other.ts", ["const other = true;", "run();"].join("\n"));
}

async function startTour() {
  seedWorkspace();
  await host.vscode.commands.executeCommand("codetour.startTour", tour);
  await host.vscode.commands.executeCommand("codetour.showStepDescription");
  await host.waitFor(() =>
    host.panelHtml().includes("Poser une question sur cette étape")
  );
}

function chatPanel() {
  return host.livePanels("codetour.tour")[0]!;
}

// Closing any live panel also clears the in-memory conversations, so every
// test starts from a clean chat state.
function resetChatState() {
  host.livePanels("codetour.tour").forEach(panel => panel.dispose());
}

function lastChatUpdate() {
  const messages = chatPanel().postedMessages.filter(
    message => (message as { type?: string }).type === "stepChat"
  );
  return messages[messages.length - 1] as {
    exchanges: { question: string; answerHtml: string; failed?: boolean }[];
  };
}

test("each step keeps its own conversation, feeding follow-ups and surviving refreshes", async () => {
  resetChatState();
  interface RecordedRequest {
    question: string;
    context: { available: boolean; path?: string; code?: string };
    history: { question: string; answer: string }[];
  }
  const received: RecordedRequest[] = [];
  setStepChatResponder({
    answer: async (request: {
      question: string;
      context: { available: boolean; path?: string; code?: string };
      history: { question: string; answer: string }[];
    }) => {
      received.push(request);
      return `Réponse ${received.length}.`;
    }
  });

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Première question ?" });
  await host.waitFor(() => !!lastChatUpdate());

  // A follow-up on the same step carries the previous exchange, raw answer
  // included, and its answer lands under the whole conversation.
  chatPanel().receive({ type: "askQuestion", question: "Et ensuite ?" });
  await host.waitFor(() => lastChatUpdate().exchanges.length === 2);
  assert.deepEqual(received[1].history, [
    { question: "Première question ?", answer: "Réponse 1." }
  ]);
  assert.equal(lastChatUpdate().exchanges[1].question, "Et ensuite ?");

  // Another step starts an isolated conversation with its own target.
  await host.vscode.commands.executeCommand("codetour.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));
  chatPanel().receive({ type: "askQuestion", question: "Autre fichier ?" });
  await host.waitFor(() =>
    lastChatUpdate()?.exchanges.some(
      exchange => exchange.question === "Autre fichier ?"
    )
  );
  assert.equal(received[2].context.path, "src/other.ts");
  assert.deepEqual(received[2].history, []);
  assert.equal(lastChatUpdate().exchanges.length, 1);

  // Refreshing the first step's render keeps its conversation, unmixed.
  await host.vscode.commands.executeCommand("codetour.previousTourStep");
  await host.waitFor(() =>
    host.panelHtml().includes("Première question") &&
    host.panelHtml().includes("Et ensuite ?")
  );
  const html = host.panelHtml();
  assert.ok(html.indexOf("Première question ?") < html.indexOf("Réponse 1."));
  assert.ok(html.indexOf("Et ensuite ?") < html.indexOf("Réponse 2."));
  assert.ok(!html.includes("Autre fichier ?"));

  setStepChatResponder(undefined);
  // Closing the reading webview ends the conversations.
  chatPanel().dispose();
});

test("a question sends the displayed buffer, path and description to the responder and shows the answer", async () => {
  resetChatState();
  interface RecordedRequest {
    question: string;
    context: unknown;
    history: unknown;
  }
  const received: RecordedRequest[] = [];
  setStepChatResponder({
    answer: async (request: {
      question: string;
      context: unknown;
      history: unknown;
    }) => {
      received.push({
        question: request.question,
        context: request.context,
        history: request.history
      });
      return "La réponse explique **le démarrage** du lecteur.";
    }
  });

  registerPlayerModule(host.extensionContext);
  await startTour();

  // The displayed buffer diverges from the saved file: the captured context
  // must reflect the code the reader actually sees, not the file on disk.
  const editor = host.editorFor("src/player.ts")!;
  (editor.document as unknown as { replace: (text: string) => void }).replace(
    'import { store } from "./store";\n\n// lecture modifiée\nstartPlayer();'
  );

  chatPanel().receive({
    type: "askQuestion",
    question: "Pourquoi appeler startPlayer ici ?"
  });
  await host.waitFor(() => !!lastChatUpdate());

  assert.equal(received.length, 1);
  const request = received[0];
  assert.equal(request.question, "Pourquoi appeler startPlayer ici ?");
  assert.deepEqual(request.context, {
    available: true,
    path: "src/player.ts",
    code: 'import { store } from "./store";\n\n// lecture modifiée\nstartPlayer();',
    description: "Le lecteur démarre ici.\n\nBienvenue dans le lecteur."
  });
  assert.deepEqual(request.history, []);

  // The answer is displayed in the chat under the question.
  const update = lastChatUpdate();
  assert.equal(update.exchanges.length, 1);
  assert.equal(update.exchanges[0].question, "Pourquoi appeler startPlayer ici ?");
  assert.match(update.exchanges[0].answerHtml, /<strong>le démarrage<\/strong>/);

  setStepChatResponder(undefined);
  chatPanel().dispose();
});

test("a step without a displayed buffer reports the unavailable target, never a substitute", async () => {
  resetChatState();
  const received: {
    question: string;
    context: unknown;
  }[] = [];
  setStepChatResponder({
    answer: async (request: { question: string; context: unknown }) => {
      received.push({ question: request.question, context: request.context });
      return "Réponse sans code.";
    }
  });

  registerPlayerModule(host.extensionContext);
  await startTour();

  await host.vscode.commands.executeCommand("codetour.navigateToStep", 3);
  await host.waitFor(() => host.panelHtml().includes("3 / 3"));
  chatPanel().receive({ type: "askQuestion", question: "Que dire sans code ?" });
  await host.waitFor(() =>
    lastChatUpdate()?.exchanges.some(
      exchange => exchange.question === "Que dire sans code ?"
    )
  );

  // The step has no code target: the context says so instead of silently
  // substituting another file's code.
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].context, {
    available: false,
    description: "Étape sans cible de code."
  });
  assert.match(lastChatUpdate().exchanges[0].answerHtml, /Réponse sans code/);

  setStepChatResponder(undefined);
  chatPanel().dispose();
});

test("the responder's answer is rendered through the shared sanitizer", async () => {
  resetChatState();
  setStepChatResponder({
    answer: async () =>
      'Voici un <script>alert("piège")</script> et [un lien](javascript:alert(1)).'
  });

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Tente une injection ?" });
  await host.waitFor(() => !!lastChatUpdate());

  const answerHtml = lastChatUpdate().exchanges[0].answerHtml;
  assert.ok(!answerHtml.includes("<script"));
  assert.ok(!answerHtml.includes('href="javascript:'));

  // The re-rendered panel shows the same sanitized answer.
  await host.vscode.commands.executeCommand("codetour.navigateToStep", 2);
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));
  await host.vscode.commands.executeCommand("codetour.navigateToStep", 1);
  await host.waitFor(() => host.panelHtml().includes("Tente une injection"));
  assert.ok(!host.panelHtml().includes("<script>alert"));

  setStepChatResponder(undefined);
  chatPanel().dispose();
});

test("errors of the responder land in the chat without disturbing the reading", async () => {
  resetChatState();
  setStepChatResponder({
    answer: async () => {
      throw new Error("agent down");
    }
  });

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Et si ça casse ?" });
  await host.waitFor(() => !!lastChatUpdate());

  const update = lastChatUpdate();
  assert.equal(update.exchanges[0].question, "Et si ça casse ?");
  assert.equal(update.exchanges[0].failed, true);
  assert.match(update.exchanges[0].answerHtml, /La réponse à cette question a échoué/);

  // Reading and navigation remain usable after the failure.
  await host.vscode.commands.executeCommand("codetour.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));
  assert.match(host.panelHtml(), /class="step-chat"/);

  setStepChatResponder(undefined);
  chatPanel().dispose();
});

test("asking without an injected responder explains it in the chat", async () => {
  resetChatState();
  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Qui répond ?" });
  await host.waitFor(() => !!lastChatUpdate());

  const update = lastChatUpdate();
  assert.equal(update.exchanges[0].question, "Qui répond ?");
  assert.equal(update.exchanges[0].failed, true);
  assert.match(update.exchanges[0].answerHtml, /Le répondant de cette étape n'est pas disponible/);

  chatPanel().dispose();
});

test("malformed and stale questions never reach the responder", async () => {
  resetChatState();
  let calls = 0;
  setStepChatResponder({
    answer: async () => {
      calls++;
      return "Réponse.";
    }
  });

  registerPlayerModule(host.extensionContext);
  await startTour();

  // Malformed messages are ignored, without any chat update.
  chatPanel().receive({ type: "askQuestion" });
  chatPanel().receive({ type: "askQuestion", question: "   " });
  chatPanel().receive({ type: "unrelated", question: "Question ?" });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(calls, 0);
  assert.equal(
    chatPanel().postedMessages.filter(
      message => (message as { type?: string }).type === "stepChat"
    ).length,
    0
  );

  // A question for another step than the rendered one is not accepted.
  chatPanel().receive({ type: "askQuestion", question: "Étape périmée ?", step: 99 });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(calls, 0);

  // The reader can still ask for the rendered step afterwards.
  chatPanel().receive({ type: "askQuestion", question: "Question valable ?" });
  await host.waitFor(() => !!lastChatUpdate());
  assert.equal(calls, 1);

  setStepChatResponder(undefined);
  chatPanel().dispose();
});
