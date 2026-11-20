import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import * as path from "node:path";
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
const { setStepChatAgentSelection, setStepChatResponder } = require("./stepChat");

const tour = {
  id: "file:///workspace/.tours/chat.tour",
  title: "1 - Chat Tour",
  description: "A tour with a chat",
  steps: [
    {
      title: "Player entry",
      questions: ["Pourquoi ce point d’entrée ?"],
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
  await host.vscode.commands.executeCommand("codetourIA.startTour", tour);
  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
  await host.waitFor(() =>
    host.panelHtml().includes("Ask a question about this step")
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

interface StepChatUpdate {
  exchanges: {
    question: string;
    answerHtml: string;
    activityHtml?: string;
    forbiddenTools?: {
      toolCallId: string;
      kind?: string;
      status?: string;
      title?: string;
      forbidden: boolean;
    }[];
    failed?: boolean;
    pending?: boolean;
    interrupted?: boolean;
    agent?: { agent: string; model?: string; effective: boolean };
  }[];
  responding?: boolean;
  agent?: { agent: string; model?: string; effective: boolean };
  agents?: {
    name: string;
    state: string;
    detail?: string;
    selected: boolean;
    selectable: boolean;
    signIn: boolean;
  }[];
  unavailable?: boolean;
  modelOptions?: { value: string; name: string }[];
  model?: string;
}

function stepChatUpdates(): StepChatUpdate[] {
  return chatPanel().postedMessages.filter(
    message => (message as { type?: string }).type === "stepChat"
  ) as StepChatUpdate[];
}

function lastChatUpdate(): StepChatUpdate {
  const updates = stepChatUpdates();
  return updates[updates.length - 1];
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
  assert.match(host.panelHtml(), /data-question="Pourquoi ce point d’entrée \?"/);

  chatPanel().receive({ type: "askQuestion", question: "Première question ?" });
  // The answer must complete before a follow-up can be sent: a question
  // is blocked while the step's previous answer is in progress.
  await host.waitFor(
    () =>
      lastChatUpdate().responding === false &&
      lastChatUpdate().exchanges.length === 1
  );

  // A follow-up on the same step carries the previous exchange, raw answer
  // included, and its answer lands under the whole conversation.
  chatPanel().receive({ type: "askQuestion", question: "Et ensuite ?" });
  await host.waitFor(
    () =>
      lastChatUpdate().responding === false &&
      lastChatUpdate().exchanges.length === 2
  );
  assert.deepEqual(received[1].history, [
    { question: "Première question ?", answer: "Réponse 1." }
  ]);
  assert.equal(lastChatUpdate().exchanges[1].question, "Et ensuite ?");

  // Another step starts an isolated conversation with its own target.
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));
  assert.doesNotMatch(host.panelHtml(), /id="step-chat-suggestions"/);
  chatPanel().receive({ type: "askQuestion", question: "Autre fichier ?" });
  await host.waitFor(
    () =>
      lastChatUpdate().responding === false &&
      lastChatUpdate().exchanges.some(
        exchange => exchange.question === "Autre fichier ?"
      )
  );
  assert.equal(received[2].context.path, "src/other.ts");
  assert.deepEqual(received[2].history, []);
  assert.equal(lastChatUpdate().exchanges.length, 1);

  // Refreshing the first step's render keeps its conversation, unmixed.
  await host.vscode.commands.executeCommand("codetourIA.previousTourStep");
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
  await host.waitFor(
    () =>
      lastChatUpdate().responding === false &&
      lastChatUpdate().exchanges.length === 1
  );

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

  await host.vscode.commands.executeCommand("codetourIA.navigateToStep", 3);
  await host.waitFor(() => host.panelHtml().includes("3 / 3"));
  chatPanel().receive({ type: "askQuestion", question: "Que dire sans code ?" });
  await host.waitFor(() =>
    lastChatUpdate().responding === false &&
    lastChatUpdate().exchanges.some(
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
  await host.waitFor(() => lastChatUpdate().responding === false);

  const answerHtml = lastChatUpdate().exchanges[0].answerHtml;
  assert.ok(!answerHtml.includes("<script"));
  assert.ok(!answerHtml.includes('href="javascript:'));

  // The re-rendered panel shows the same sanitized answer.
  await host.vscode.commands.executeCommand("codetourIA.navigateToStep", 2);
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));
  await host.vscode.commands.executeCommand("codetourIA.navigateToStep", 1);
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
  await host.waitFor(() => lastChatUpdate().responding === false);

  const update = lastChatUpdate();
  assert.equal(update.exchanges[0].question, "Et si ça casse ?");
  assert.equal(update.exchanges[0].failed, true);
  assert.match(update.exchanges[0].answerHtml, /The answer to this question failed/);

  // Reading and navigation remain usable after the failure.
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));
  assert.match(host.panelHtml(), /class="step-chat"/);

  setStepChatResponder(undefined);
  chatPanel().dispose();
});

test("a panel whose probed catalogue has no usable agent explains it and disables the composer", async () => {
  const { AGENT_CATALOGUE, AgentSelection } = require("../agent/agentCatalogue");
  resetChatState();
  // Every Agent Profile is installed but refuses: the initial probe settles
  // with nothing usable, which no machine-dependent test could guarantee.
  const selection = new AgentSelection({
    probe: async () => ({ availability: { state: "not-installed" } })
  });
  setStepChatAgentSelection(() => selection);
  try {
    registerPlayerModule(host.extensionContext);
    await startTour();

    // The probe settled with nothing usable: the panel reposts the probed
    // catalogue, which disables the composer and shows the explaining state.
    try {
      await host.waitFor(() => lastChatUpdate()?.unavailable === true);
    } catch (error) {
      // The panel state decides this test; make a failure say which invariant
      // broke instead of only "condition was not met".
      throw new Error(
        `${(error as Error).message}: probeSettled=${selection.initialProbeSettled()}, ` +
          `selected=${JSON.stringify(selection.selectedProfile()?.profile?.name ?? null)}, ` +
          `states=${JSON.stringify(selection.profiles().map((view: { profile: { name: string }; availability: { state: string } }) => [view.profile.name, view.availability.state]))}, ` +
          `lastUpdate=${JSON.stringify(lastChatUpdate())}`
      );
    }
    const probed = lastChatUpdate();
    // Every catalogued profile is listed, in rank order, with the state the
    // probe established: the panel shows the catalogue, not a PATH scan.
    assert.deepEqual(
      probed.agents?.map(agent => [agent.name, agent.state]),
      AGENT_CATALOGUE.map((profile: { name: string }) => [profile.name, "not-installed"])
    );
    assert.equal(probed.agent, undefined, "nothing is preselected");
    assert.deepEqual(probed.exchanges, []);
    // The Tour itself stays readable in the panel.
    assert.match(host.panelHtml(), /<h1>Player entry<\/h1>/);

    chatPanel().receive({ type: "askQuestion", question: "Qui répond ?" });
    await host.waitFor(() => lastChatUpdate()?.responding === false && lastChatUpdate().exchanges.length === 1);

    const update = lastChatUpdate();
    assert.equal(update.exchanges[0].question, "Qui répond ?");
    assert.equal(update.exchanges[0].failed, true);
    assert.match(update.exchanges[0].answerHtml, /No ACP agent available/);
    assert.equal(update.unavailable, true);
  } finally {
    setStepChatAgentSelection(undefined);
    chatPanel().dispose();
  }
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
  await host.waitFor(() => lastChatUpdate().responding === false);
  assert.equal(calls, 1);

  setStepChatResponder(undefined);
  chatPanel().dispose();
});

test("stopping interrupts the in-flight answer, ignores its late completion and accepts a new question immediately", async () => {
  resetChatState();
  const received: {
    question: string;
    history?: { question: string; answer: string }[];
  }[] = [];
  const pendingAnswers: ((answer: string) => void)[] = [];
  let cancels = 0;
  // The responder streams one chunk, then keeps each turn open until the
  // test releases it: no timing of a real model is ever involved.
  setStepChatResponder({
    answer: (
      request: { question: string; history?: { question: string; answer: string }[] },
      events?: { onAnswerDelta?: (delta: string) => void }
    ) => {
      received.push(request);
      events?.onAnswerDelta?.("Un morceau ");
      return new Promise<string>(resolve => {
        pendingAnswers.push(resolve);
      });
    },
    cancel: () => {
      cancels++;
    }
  });

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Longue réponse ?" });
  await host.waitFor(() =>
    stepChatUpdates().some(
      update =>
        update.responding === true &&
        update.exchanges[0]?.answerHtml?.includes("Un morceau")
    )
  );

  // The reader stops the request that has become useless.
  chatPanel().receive({ type: "stopQuestion" });
  await host.waitFor(() => lastChatUpdate().responding === false);

  // The interrupted state is visible: the streamed part stays readable,
  // marked as interrupted, and the responder was told to cancel.
  const stopped = lastChatUpdate()!;
  assert.equal(stopped.exchanges.length, 1);
  assert.equal(stopped.exchanges[0].interrupted, true);
  assert.equal(stopped.exchanges[0].pending, undefined);
  assert.match(stopped.exchanges[0].answerHtml, /Un morceau/);
  assert.match(stopped.exchanges[0].answerHtml, /Answer interrupted/);
  assert.equal(cancels, 1);

  // The late completion of the stopped answer is ignored: it never
  // overwrites the interrupted state, whatever it answers.
  pendingAnswers[0]!("Réponse tardive, arrivée trop tard.");
  await new Promise(resolve => setTimeout(resolve, 150));
  const afterLate = lastChatUpdate()!;
  assert.equal(afterLate.exchanges[0].interrupted, true);
  assert.ok(
    !afterLate.exchanges[0].answerHtml.includes("Réponse tardive"),
    "the late answer of the stopped exchange never reaches the chat"
  );
  assert.ok(
    !stepChatUpdates().some(update =>
      update.exchanges.some(
        exchange => exchange.answerHtml?.includes("Réponse tardive")
      )
    )
  );

  // A new question is accepted immediately after the stop, without any
  // reload: it reaches the responder, whose interrupted exchange never
  // feeds its history.
  chatPanel().receive({ type: "askQuestion", question: "Nouvelle question ?" });
  await host.waitFor(() =>
    stepChatUpdates().some(
      update =>
        update.responding === true &&
        update.exchanges.some(
          exchange => exchange.question === "Nouvelle question ?"
        )
    )
  );
  await host.waitFor(() => received.length === 2);
  assert.deepEqual(received[1].history, []);
  pendingAnswers[1]!("La nouvelle réponse, complète.");
  await host.waitFor(
    () =>
      lastChatUpdate().responding === false &&
      lastChatUpdate().exchanges[1]?.answerHtml?.includes("La nouvelle réponse")
  );
  assert.equal(lastChatUpdate().exchanges[0].interrupted, true);

  // Stopping with no answer in flight changes nothing.
  chatPanel().receive({ type: "stopQuestion" });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(cancels, 1);
  assert.equal(lastChatUpdate().responding, false);
  assert.equal(lastChatUpdate().exchanges[1].interrupted, undefined);

  setStepChatResponder(undefined);
  chatPanel().dispose();
});

test("the answer streams into the chat with a visible in-progress state and blocks new questions meanwhile", async () => {
  resetChatState();
  const received: {
    question: string;
    history?: { question: string; answer: string }[];
  }[] = [];
  // The responder streams a first chunk, then keeps the turn open until
  // the test releases it: no timing of a real model is ever involved.
  let releaseTail!: () => void;
  const tailGate = new Promise<void>(resolve => {
    releaseTail = resolve;
  });
  setStepChatResponder({
    answer: async (
      request: { question: string },
      events?: { onAnswerDelta?: (delta: string) => void }
    ) => {
      received.push(request);
      events?.onAnswerDelta?.("Premier morceau ");
      await tailGate;
      events?.onAnswerDelta?.("et le second <script>alert(1)</script>.");
      return "Premier morceau et le second <script>alert(1)</script>.";
    }
  });

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Question en flux ?" });

  // The question shows up immediately, with the response-in-progress state
  // visible before any answer text has arrived.
  await host.waitFor(() =>
    stepChatUpdates().some(
      update =>
        update.responding === true &&
        update.exchanges.some(
          exchange =>
            exchange.question === "Question en flux ?" && exchange.pending === true
        )
    )
  );

  // The first chunk is readable on its own as soon as it arrives, still
  // with the in-progress state, and sanitized like every chat content.
  await host.waitFor(() =>
    stepChatUpdates().some(
      update =>
        update.responding === true &&
        update.exchanges.some(
          exchange => exchange.answerHtml.includes("Premier morceau")
        )
    )
  );
  const partial = stepChatUpdates().find(
    update =>
      update.responding === true &&
      update.exchanges[0]?.answerHtml?.includes("Premier morceau")
  )!;
  assert.ok(
    !partial.exchanges[0].answerHtml.includes("<script"),
    "a streamed chunk never bypasses the sanitizer"
  );

  // A new question is blocked while the response is in progress: it never
  // reaches the responder and never enters the conversation.
  chatPanel().receive({ type: "askQuestion", question: "Trop pressé ?" });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(received.length, 1);
  const whileResponding = lastChatUpdate()!;
  assert.equal(whileResponding.responding, true);
  assert.equal(whileResponding.exchanges.length, 1);
  assert.ok(
    !whileResponding.exchanges.some(
      exchange => exchange.question === "Trop pressé ?"
    )
  );

  releaseTail();
  await host.waitFor(() => {
    const update = lastChatUpdate();
    return (
      update?.responding === false &&
      update.exchanges[0]?.answerHtml?.includes("et le second")
    );
  });

  // The completed answer is whole and sanitized, and the chat is ready for
  // a new question again.
  const complete = lastChatUpdate()!;
  assert.equal(complete.exchanges.length, 1);
  assert.notEqual(complete.exchanges[0].failed, true);
  assert.ok(!complete.exchanges[0].answerHtml.includes("<script"));
  chatPanel().receive({ type: "askQuestion", question: "Maintenant ?" });
  await host.waitFor(
    () =>
      lastChatUpdate().responding === false &&
      lastChatUpdate().exchanges.some(
        exchange => exchange.question === "Maintenant ?"
      )
  );
  assert.equal(received.length, 2);
  assert.deepEqual(received[1].history, [
    {
      question: "Question en flux ?",
      answer: "Premier morceau et le second <script>alert(1)</script>."
    }
  ]);

  setStepChatResponder(undefined);
  chatPanel().dispose();
});

test("forbidden tools are reported live, stay after a stop, and allowed tools stay activity lines", async () => {
  resetChatState();
  const pendingAnswers: ((answer: string) => void)[] = [];
  let cancels = 0;
  // The responder runs an allowed read, then a forbidden edit, streams one
  // chunk, and keeps the turn open until the test releases it.
  setStepChatResponder({
    answer: (
      _request: unknown,
      events?: {
        onAnswerDelta?: (delta: string) => void;
        onToolUse?: (tool: {
          toolCallId: string;
          kind?: string;
          status?: string;
          title?: string;
          forbidden: boolean;
        }) => void;
      }
    ) => {
      events?.onToolUse?.({
        toolCallId: "read-tool",
        kind: "read",
        status: "in_progress",
        title: "Reading the displayed file",
        forbidden: false
      });
      events?.onToolUse?.({
        toolCallId: "rogue-edit",
        kind: "edit",
        status: "completed",
        title: "Editing the workspace anyway",
        forbidden: true
      });
      events?.onAnswerDelta?.("Un morceau ");
      return new Promise<string>(resolve => {
        pendingAnswers.push(resolve);
      });
    },
    cancel: () => {
      cancels++;
    }
  });

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Et l'interdit ?" });

  // While the answer is still in progress, the forbidden tool call is
  // already reported on the pending exchange, and the allowed read stayed
  // a plain line of model activity.
  await host.waitFor(() =>
    stepChatUpdates().some(
      update =>
        update.exchanges[0]?.pending === true &&
        update.exchanges[0]?.forbiddenTools?.length === 1
    )
  );
  const live = stepChatUpdates().find(
    update => update.exchanges[0]?.forbiddenTools?.length === 1
  )!;
  assert.deepEqual(live.exchanges[0].forbiddenTools, [
    {
      toolCallId: "rogue-edit",
      kind: "edit",
      status: "completed",
      title: "Editing the workspace anyway",
      forbidden: true
    }
  ]);
  assert.match(
    live.exchanges[0].activityHtml ?? "",
    /Reading the displayed file \(in_progress\)/
  );

  // The reader stops the answer: the forbidden tool call already seen is
  // never erased from the reported history of the exchange.
  chatPanel().receive({ type: "stopQuestion" });
  await host.waitFor(() => lastChatUpdate().responding === false);
  const stopped = lastChatUpdate()!;
  assert.equal(stopped.exchanges[0].interrupted, true);
  assert.deepEqual(stopped.exchanges[0].forbiddenTools, [
    {
      toolCallId: "rogue-edit",
      kind: "edit",
      status: "completed",
      title: "Editing the workspace anyway",
      forbidden: true
    }
  ]);
  assert.equal(cancels, 1);

  setStepChatResponder(undefined);
  chatPanel().dispose();
});

test("the conversation names the agent that answers: preselected before the handshake, effective after it", async () => {
  resetChatState();
  let identity: { agent: string; model?: string; effective: boolean } = {
    agent: "Copilot",
    effective: false
  };
  setStepChatResponder({
    identity: () => identity,
    answer: async (_request: unknown, events?: {
      onAgentIdentity?: (next: { agent: string; model?: string; effective: boolean }) => void;
    }) => {
      // The handshake happens while the answer is produced.
      identity = { agent: "Copilot", model: "gpt-5", effective: true };
      events?.onAgentIdentity?.(identity);
      return "Réponse de **Copilot**.";
    }
  });

  registerPlayerModule(host.extensionContext);
  await startTour();

  // No session exists yet: the conversation names the preselected profile.
  assert.match(
    host.panelHtml(),
    /<p class="step-chat-agent" id="step-chat-agent">Agent: Copilot \(preselected\)<\/p>/
  );

  chatPanel().receive({ type: "askQuestion", question: "Qui répond ?" });
  await host.waitFor(
    () =>
      lastChatUpdate().responding === false &&
      lastChatUpdate().exchanges.length === 1
  );

  // The message carries the current identity and the identity of the answer.
  const update = lastChatUpdate();
  assert.deepEqual(update.agent, { agent: "Copilot", model: "gpt-5", effective: true });
  assert.deepEqual(update.exchanges[0].agent, {
    agent: "Copilot",
    model: "gpt-5",
    effective: true
  });

  // A re-render paints the effective agent and captions the answer with it.
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));
  await host.vscode.commands.executeCommand("codetourIA.previousTourStep");
  await host.waitFor(() => host.panelHtml().includes("Qui répond ?"));
  const html = host.panelHtml();
  assert.match(
    html,
    /<p class="step-chat-agent" id="step-chat-agent">Agent: Copilot · gpt-5 \(effective\)<\/p>/
  );
  assert.ok(
    html.includes('<span class="step-chat-agent-caption">Copilot · gpt-5</span>'),
    "the answer is captioned with the agent that produced it"
  );

  setStepChatResponder(undefined);
  chatPanel().dispose();
});

/**
 * A catalogue whose profiles can be probed in process and whose entries never
 * launch: the profile's command is this Node binary running a script that does
 * not exist, so a question fails deterministically without any real agent.
 */
/** A model selector as a probed agent announces it. */
function announcedModel(currentValue: string, values: string[]) {
  return {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue,
    options: values.map(value => ({ value, name: value.toUpperCase() }))
  };
}

function unlaunchableCatalogue(workspaceRoot: string, configOptions: unknown[] = []) {
  const { AgentSelection } = require("../agent/agentCatalogue");
  const calls: string[] = [];
  const profile = (name: string, rank: number) => ({
    name,
    rank,
    entry: (cwd: string) => ({
      command: process.execPath,
      args: [path.join(workspaceRoot, "codetour-absent-agent.js")],
      cwd
    })
  });
  const selection = new AgentSelection({
    profiles: [profile("Copilot", 0), profile("Vibe", 1)],
    probe: async (probed: { name: string }) => {
      calls.push(probed.name);
      return { availability: { state: "available" as const, configOptions } };
    }
  });
  return { selection, calls };
}

function registerUnlaunchableAgents(workspaceRoot: string, configOptions: unknown[] = []) {
  const agents = unlaunchableCatalogue(workspaceRoot, configOptions);
  setStepChatAgentSelection(() => agents.selection);
  return agents;
}

/** The terminal authentication method the fake agent declares (ADR 0048). */
const TERMINAL_AUTH_METHODS = [
  {
    id: "terminal-login",
    name: "Sign in from the terminal",
    type: "terminal",
    _meta: {
      "terminal-auth": {
        command: "codetour-fake-login",
        args: ["--connect"],
        env: { CODETOUR_FAKE_AUTH: "1" },
        label: "Copilot sign in"
      }
    }
  }
];

/**
 * A catalogue where Copilot waits for the sign in the reader can ask for and
 * Vibe answers: both entries point at a script that does not exist, so a
 * question fails deterministically and no real agent is launched.
 */
function signInCatalogue(
  workspaceRoot: string,
  authMethods: unknown[],
  options: { staysWaiting?: boolean } = {}
) {
  const { AgentSelection } = require("../agent/agentCatalogue");
  const calls: string[] = [];
  const entry = (cwd: string) => ({
    command: process.execPath,
    args: [path.join(workspaceRoot, "codetour-absent-agent.js")],
    cwd
  });
  const selection = new AgentSelection({
    profiles: [
      { name: "Copilot", rank: 0, entry },
      { name: "Vibe", rank: 1, entry }
    ],
    probe: async (probed: { name: string }) => {
      calls.push(probed.name);
      if (probed.name !== "Copilot") {
        return { availability: { state: "available" as const, configOptions: [] } };
      }
      // Copilot waits for authentication until the reader connects it: the
      // next probe of that one profile is what the Sign in action observes.
      const connected =
        calls.filter(name => name === "Copilot").length > 1 &&
        !options.staysWaiting;
      return connected
        ? { availability: { state: "available" as const, configOptions: [] } }
        : { availability: { state: "auth-required" as const, authMethods }, authMethods };
    }
  });
  setStepChatAgentSelection(() => selection);
  return { selection, calls };
}

test("choosing an agent repaints the panel and changes who answers without asking anything", async () => {
  resetChatState();
  const agents = registerUnlaunchableAgents("/workspace");
  try {
    registerPlayerModule(host.extensionContext);
    await startTour();

    // The initial probe preselected the highest-ranked available profile and
    // stopped there: the panel lists the whole catalogue with its states.
    assert.deepEqual(agents.calls, ["Copilot"]);
    assert.match(host.panelHtml(), /<option value="Copilot" data-state="available" selected>Copilot — available<\/option>/);
    assert.match(host.panelHtml(), /<option value="Vibe" data-state="unverified">Vibe — installed, not verified<\/option>/);

    // The reader chooses another agent: the panel repaints over the same
    // conversations, naming the choice as the agent that answers next.
    chatPanel().receive({ type: "chooseAgent", agent: "Vibe" });
    await host.waitFor(() => lastChatUpdate()?.agent?.agent === "Vibe");
    const chosen = lastChatUpdate();
    assert.equal(chosen.agent?.effective, false, "no session was opened yet");
    assert.deepEqual(
      chosen.agents?.map(agent => [agent.name, agent.selected]),
      [["Copilot", false], ["Vibe", true]]
    );
    assert.deepEqual(chosen.exchanges, [], "the choice asks nothing");
    assert.deepEqual(agents.calls, ["Copilot"], "the choice probes nothing");
  } finally {
    setStepChatAgentSelection(undefined);
    chatPanel().dispose();
  }
});

test("the panel re-probes on request and probes only the unverified profiles when the selector opens", async () => {
  resetChatState();
  const agents = registerUnlaunchableAgents("/workspace");
  try {
    registerPlayerModule(host.extensionContext);
    await startTour();
    // The initial probe stopped at the first available profile.
    assert.deepEqual(agents.calls, ["Copilot"]);

    // Opening the selector verifies the profiles the initial probe left
    // unverified, and reposts the painted catalogue.
    chatPanel().receive({ type: "probeUnverified" });
    await host.waitFor(() => agents.calls.length === 2);
    assert.deepEqual(agents.calls, ["Copilot", "Vibe"]);
    assert.equal(
      lastChatUpdate().agents?.find(agent => agent.name === "Vibe")?.state,
      "available"
    );

    // Opening it again probes nothing more: every profile is established.
    chatPanel().receive({ type: "probeUnverified" });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.deepEqual(agents.calls, ["Copilot", "Vibe"]);

    // The manual refresh probes the catalogue again, in rank order, and stops
    // at the first available profile; the reader sees the repainted states.
    const beforeRefresh = stepChatUpdates().length;
    chatPanel().receive({ type: "refreshAgents" });
    await host.waitFor(
      () => agents.calls.length === 3 && stepChatUpdates().length > beforeRefresh
    );
    assert.deepEqual(agents.calls, ["Copilot", "Vibe", "Copilot"]);
    assert.equal(lastChatUpdate().agent?.agent, "Copilot");
    assert.equal(
      lastChatUpdate().agents?.find(agent => agent.name === "Vibe")?.state,
      "unverified",
      "the refresh re-establishes the catalogue from the probe"
    );
  } finally {
    setStepChatAgentSelection(undefined);
    chatPanel().dispose();
  }
});

test("signing in runs the command the agent declares and re-probes only that profile", async () => {
  resetChatState();
  const agents = signInCatalogue("/workspace", TERMINAL_AUTH_METHODS);
  try {
    registerPlayerModule(host.extensionContext);
    await startTour();

    // Copilot waits for authentication and says how to get one; Vibe answers.
    assert.deepEqual(agents.calls, ["Copilot", "Vibe"]);
    assert.match(
      host.panelHtml(),
      /<option value="Copilot" data-state="auth-required">Copilot — authentication required \(Sign in from the terminal\)<\/option>/
    );
    // The profile that answers has nothing to connect, so the action starts
    // hidden.
    assert.match(
      host.panelHtml(),
      /id="step-chat-sign-in"[^>]* hidden>Sign in<\/button>/
    );

    // The reader picks the agent they wanted: its sign in becomes available.
    chatPanel().receive({ type: "chooseAgent", agent: "Copilot" });
    await host.waitFor(() => lastChatUpdate()?.agent?.agent === "Copilot");
    assert.equal(
      lastChatUpdate().agents!.find(agent => agent.name === "Copilot")!.signIn,
      true
    );

    // A failed question leaves a history for the step, which the sign in must
    // not reset.
    chatPanel().receive({ type: "askQuestion", question: "Qui répond ?" });
    await host.waitFor(
      () => lastChatUpdate()?.exchanges?.[0]?.failed === true
    );
    const before = lastChatUpdate();

    chatPanel().receive({ type: "signIn", agent: "Copilot" });
    await host.waitFor(() => agents.calls.length === 3);

    // The command the agent declared runs in a VS Code terminal, in the
    // workspace, and CodeTour types nothing into it.
    const terminals = host.terminals();
    assert.equal(terminals.length, 1);
    const [terminal] = terminals;
    assert.equal(terminal.name, "Copilot sign in");
    assert.equal(terminal.shellPath, "codetour-fake-login");
    assert.deepEqual(terminal.shellArgs, ["--connect"]);
    assert.deepEqual(terminal.env, { CODETOUR_FAKE_AUTH: "1" });
    assert.equal(terminal.cwd, "/workspace");
    assert.equal(terminal.shown, true);
    assert.deepEqual(terminal.sentText, []);

    // Only the profile the reader connected was probed again, and the panel
    // repainted it as available.
    assert.deepEqual(agents.calls, ["Copilot", "Vibe", "Copilot"]);
    const after = lastChatUpdate();
    assert.equal(
      after.agents!.find(agent => agent.name === "Copilot")!.state,
      "available"
    );
    assert.equal(
      after.agents!.find(agent => agent.name === "Copilot")!.signIn,
      false
    );

    // Neither the step history nor the selected agent was reset.
    assert.deepEqual(after.exchanges, before.exchanges);
    assert.equal(after.agent?.agent, "Copilot");
  } finally {
    setStepChatAgentSelection(undefined);
    chatPanel().dispose();
  }
});

test("a profile with no usable authentication method connects nothing", async () => {
  resetChatState();
  // The agent says it needs authentication but offers no method CodeTour can
  // use: the reader is never offered a sign in that cannot connect anything.
  const agents = signInCatalogue("/workspace", []);
  try {
    registerPlayerModule(host.extensionContext);
    await startTour();
    assert.deepEqual(agents.calls, ["Copilot", "Vibe"]);

    chatPanel().receive({ type: "chooseAgent", agent: "Copilot" });
    await host.waitFor(() => lastChatUpdate()?.agent?.agent === "Copilot");
    assert.equal(
      lastChatUpdate().agents!.find(agent => agent.name === "Copilot")!.signIn,
      false
    );

    // No terminal, no ACP method and no probe: the action does nothing.
    const terminalsOpened = host.terminals().length;
    chatPanel().receive({ type: "signIn", agent: "Copilot" });
    await new Promise(resolve => setTimeout(resolve, 150));

    assert.equal(host.terminals().length, terminalsOpened);
    assert.deepEqual(agents.calls, ["Copilot", "Vibe"]);
  } finally {
    setStepChatAgentSelection(undefined);
    chatPanel().dispose();
  }
});

test("the ACP fallback of a sign in opens no terminal, reports its failure and re-probes the profile", async () => {
  resetChatState();
  // The agent handles authentication itself: no terminal command is declared,
  // so the reader's action goes through ACP `authenticate` instead.
  const agents = signInCatalogue(
    "/workspace",
    [{ id: "copilot-login", name: "Copilot login" }],
    { staysWaiting: true }
  );
  try {
    registerPlayerModule(host.extensionContext);
    await startTour();
    chatPanel().receive({ type: "chooseAgent", agent: "Copilot" });
    await host.waitFor(() => lastChatUpdate()?.agent?.agent === "Copilot");
    const terminalsOpened = host.terminals().length;

    chatPanel().receive({ type: "signIn", agent: "Copilot" });
    await host.waitFor(() => agents.calls.length === 3);

    // An agent-handled method never becomes a terminal command, and the
    // profile the reader connected is the only one probed again — even though
    // this entry cannot be launched, which the reader is told.
    assert.equal(host.terminals().length, terminalsOpened);
    assert.deepEqual(agents.calls, ["Copilot", "Vibe", "Copilot"]);
    assert.ok(host.messages.includes("Could not sign in to Copilot."));
    assert.equal(
      lastChatUpdate().agents!.find(agent => agent.name === "Copilot")!.state,
      "auth-required",
      "a failed connection leaves the real state on display"
    );
  } finally {
    setStepChatAgentSelection(undefined);
    chatPanel().dispose();
  }
});

test("a failed exchange offers Retry and Change agent, and retrying keeps the same agent and exchange", async () => {
  resetChatState();
  const agents = registerUnlaunchableAgents("/workspace");
  try {
    registerPlayerModule(host.extensionContext);
    await startTour();

    // The reader chose Vibe: the choice is the only profile a question may
    // use from now on.
    chatPanel().receive({ type: "chooseAgent", agent: "Vibe" });
    await host.waitFor(() => lastChatUpdate()?.agent?.agent === "Vibe");
    const probesBefore = agents.calls.length;

    chatPanel().receive({ type: "askQuestion", question: "Pourquoi ça casse ?" });
    await host.waitFor(
      () =>
        lastChatUpdate().responding === false &&
        lastChatUpdate().exchanges.length === 1
    );
    const failed = lastChatUpdate();
    assert.equal(failed.exchanges[0].failed, true);
    assert.equal(failed.exchanges[0].question, "Pourquoi ça casse ?");
    assert.equal(failed.agent?.agent, "Vibe", "the choice is never replaced by a failure");
    assert.equal(
      agents.calls.length,
      probesBefore,
      "a conversation failure probes nothing"
    );

    // Retrying asks the same question again, to the same agent, and the
    // failure stays attached to the exchange that failed.
    chatPanel().receive({ type: "retryQuestion", question: "Pourquoi ça casse ?" });
    await host.waitFor(
      () =>
        lastChatUpdate().responding === false &&
        lastChatUpdate().exchanges.length === 2
    );
    const retried = lastChatUpdate();
    assert.equal(retried.exchanges[1].question, "Pourquoi ça casse ?");
    assert.equal(retried.exchanges[1].failed, true);
    assert.equal(retried.exchanges[0].failed, true);
    assert.equal(retried.agent?.agent, "Vibe");
    assert.equal(agents.calls.length, probesBefore);
    assert.deepEqual(
      retried.agents?.map(agent => [agent.name, agent.selected]),
      [["Copilot", false], ["Vibe", true]]
    );
  } finally {
    setStepChatAgentSelection(undefined);
    chatPanel().dispose();
  }
});

test("choosing a model remembers it per agent, repaints the panel and asks nothing", async () => {
  resetChatState();
  const agents = registerUnlaunchableAgents("/workspace", [
    announcedModel("smart", ["fast", "smart"])
  ]);
  try {
    registerPlayerModule(host.extensionContext);
    await startTour();

    // The Model control offers only what the probed agent announces, with
    // the value the agent holds selected.
    assert.match(
      host.panelHtml(),
      /<option value="fast">FAST<\/option><option value="smart" selected>SMART<\/option>/
    );

    // The reader's choice is remembered for the profile that answers and
    // repainted; no question is asked by choosing a model.
    chatPanel().receive({ type: "chooseModel", model: "fast" });
    await host.waitFor(() => lastChatUpdate()?.model === "fast");
    assert.equal(agents.selection.modelFor("Copilot"), "fast");
    assert.deepEqual(lastChatUpdate().exchanges, [], "the choice asks nothing");

    // Each profile keeps its own choice: moving the conversation to another
    // agent does not carry one agent's model identifiers over.
    chatPanel().receive({ type: "chooseAgent", agent: "Vibe" });
    await host.waitFor(() => lastChatUpdate()?.agent?.agent === "Vibe");
    assert.equal(agents.selection.modelFor("Copilot"), "fast");
    assert.equal(agents.selection.modelFor("Vibe"), undefined);
    assert.equal(lastChatUpdate().model, undefined);
  } finally {
    setStepChatAgentSelection(undefined);
    chatPanel().dispose();
  }
});
