import { test } from "node:test";
import * as assert from "node:assert";
import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as nodeModule from "module";
import * as path from "node:path";
import { createVscodeHost } from "../test/vscodeHost";

// The Tour Step Conversation talks to a real ACP agent process at the
// transport boundary: these tests register the production responder over a
// fake ACP agent entry, exactly like the installed Vibe entry, and observe
// the wire (Ask selection, step context, history) alongside the chat.
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
const { createAcpStepChatResponder } = require("../agent/stepChatAgent");

const fakeAgentScript = path.join(
  __dirname,
  "..",
  "agent",
  "fakeAcpAgent.js"
);

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
  await host.vscode.commands.executeCommand("codetourIA.startTour", tour);
  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
  await host.waitFor(() =>
    host.panelHtml().includes("Ask a question about this step")
  );
}

function chatPanel() {
  return host.livePanels("codetour.tour")[0]!;
}

// Closing any live panel also clears the in-memory conversations and
// releases the registered agent, so every test starts clean.
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
  }[];
  responding?: boolean;
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

/** Waits until the step's answer is complete, not merely streaming. */
async function waitForCompletedAnswer(
  predicate: (update: StepChatUpdate) => boolean
) {
  await host.waitFor(() => {
    const update = lastChatUpdate();
    return update?.responding === false && predicate(update);
  });
}

interface FakeAgentLogRecord {
  method: string;
  params?: Record<string, unknown>;
  outcome?: string;
}

function readLog(logPath: string): FakeAgentLogRecord[] {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as FakeAgentLogRecord);
  } catch {
    return [];
  }
}

async function waitForLog(
  logPath: string,
  predicate: (records: FakeAgentLogRecord[]) => boolean
): Promise<FakeAgentLogRecord[]> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const records = readLog(logPath);
    if (predicate(records)) {
      return records;
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the fake agent log");
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

interface AgentWorkspace {
  workspace: string;
  logPath: string;
  cleanup: () => Promise<void>;
}

function createAgentWorkspace(): AgentWorkspace {
  const workspace = mkdtempSync(path.join(tmpdir(), "codetour-chat-"));
  return {
    workspace,
    logPath: path.join(workspace, "agent.log"),
    // Panel disposal releases the agent asynchronously. Windows may keep its
    // working directory locked briefly while the process exits.
    cleanup: () => rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  };
}

function fakeAgentEntry(agent: AgentWorkspace, behavior?: string) {
  return {
    command: process.execPath,
    args: behavior
      ? [fakeAgentScript, agent.logPath, behavior]
      : [fakeAgentScript, agent.logPath],
    cwd: agent.workspace
  };
}

function registerAcpResponder(
  agent: AgentWorkspace,
  behavior?: string
) {
  setStepChatResponder(
    createAcpStepChatResponder(() => fakeAgentEntry(agent, behavior))
  );
}

function promptBlocks(records: FakeAgentLogRecord[]): { type: string; text: string }[] {
  const prompts = records.filter(record => record.method === "session/prompt");
  const last = prompts[prompts.length - 1];
  return (last!.params as { prompt: { type: string; text: string }[] }).prompt;
}

/** The prompt blocks of the agent's n-th question, oldest first. */
function promptBlocksAt(
  records: FakeAgentLogRecord[],
  index: number
): { type: string; text: string }[] {
  const prompts = records.filter(record => record.method === "session/prompt");
  const prompt = prompts[index]!;
  return (prompt.params as { prompt: { type: string; text: string }[] }).prompt;
}

function promptCount(records: FakeAgentLogRecord[]): number {
  return records.filter(record => record.method === "session/prompt").length;
}

test("follow-up questions carry the step's previous exchanges to the agent over one session", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  registerAcpResponder(agent);

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Première question ?" });
  // The answer must complete before the follow-up can be sent: a question
  // is blocked while the previous answer is still streaming.
  await waitForCompletedAnswer(update => update.exchanges.length === 1);

  chatPanel().receive({ type: "askQuestion", question: "Et ensuite ?" });
  await waitForCompletedAnswer(update => update.exchanges.length === 2);

  const records = await waitForLog(agent.logPath, found =>
    found.filter(record => record.method === "session/prompt").length === 2
  );
  const blocks = promptBlocks(records);
  assert.equal(blocks[0].text, "Et ensuite ?");
  // The previous exchange feeds the follow-up, question and answer alike.
  assert.equal(blocks.length, 3);
  assert.match(blocks[2].text, /Première question \?/);
  assert.match(blocks[2].text, /Tour answer, part two\./);

  // A single agent session answers the whole reading session: no
  // per-question ephemeral relaunch.
  assert.equal(
    records.filter(record => record.method === "initialize").length,
    1
  );

  chatPanel().dispose();
  await agent.cleanup();
});

test("a step without displayed code is reported as unavailable to the agent, never substituted", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  registerAcpResponder(agent);

  registerPlayerModule(host.extensionContext);
  await startTour();

  await host.vscode.commands.executeCommand("codetourIA.navigateToStep", 3);
  await host.waitFor(() => host.panelHtml().includes("3 / 3"));
  chatPanel().receive({ type: "askQuestion", question: "Que dire sans code ?" });
  await waitForCompletedAnswer(update =>
    update.exchanges.some(
      exchange => exchange.question === "Que dire sans code ?"
    )
  );

  const records = await waitForLog(agent.logPath, found =>
    found.some(record => record.method === "session/prompt")
  );
  const blocks = promptBlocks(records);
  // The prompt says the step's code target is not displayed instead of
  // silently substituting another file's code.
  assert.match(blocks[1].text, /No code is currently displayed/);
  assert.ok(!/File:/.test(blocks[1].text), "no file path stands in for the missing target");
  assert.ok(
    !/const other = true/.test(blocks[1].text),
    "no other file's code is substituted"
  );
  assert.match(blocks[1].text, /Étape sans cible de code\./);

  // The reader still gets the agent's answer for the described step.
  assert.notEqual(lastChatUpdate().exchanges[0].failed, true);
  assert.match(lastChatUpdate().exchanges[0].answerHtml, /Tour answer, part two\./);

  chatPanel().dispose();
  await agent.cleanup();
});

test("an agent launch failure lands in the chat and the next question retries", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  registerAcpResponder(agent, "launch-fail-once");

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Es-tu là ?" });
  await waitForCompletedAnswer(update => update.exchanges.length === 1);

  const failure = lastChatUpdate();
  assert.equal(failure.exchanges[0].failed, true);
  assert.match(failure.exchanges[0].answerHtml, /Impossible de lancer l'agent/);
  assert.match(failure.exchanges[0].answerHtml, /restart the agent/);

  // The reader keeps reading and navigating without any agent.
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));
  assert.match(host.panelHtml(), /class="step-chat"/);
  await host.vscode.commands.executeCommand("codetourIA.previousTourStep");
  await host.waitFor(() => host.panelHtml().includes("1 / 3"));

  // The next question relaunches the agent and gets its answer.
  chatPanel().receive({ type: "askQuestion", question: "Et maintenant ?" });
  await waitForCompletedAnswer(update => update.exchanges.length === 2);
  assert.notEqual(lastChatUpdate().exchanges[1].failed, true);
  assert.match(lastChatUpdate().exchanges[1].answerHtml, /Tour answer, part two\./);

  chatPanel().dispose();
  await agent.cleanup();
});

test("an agent authentication failure lands in the chat and the next question retries", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  registerAcpResponder(agent, "auth-fail-once");

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Es-tu connecté ?" });
  await waitForCompletedAnswer(update => update.exchanges.length === 1);

  // The failed exchange is visible in the chat with a comprehensible
  // message: the agent's own authentication cause, wrapped in the launch
  // error and the retry hint.
  const failure = lastChatUpdate();
  assert.equal(failure.exchanges[0].failed, true);
  assert.match(failure.exchanges[0].answerHtml, /Impossible de lancer l'agent/);
  assert.match(failure.exchanges[0].answerHtml, /Authentication required/);
  assert.match(failure.exchanges[0].answerHtml, /restart the agent/);

  // Reading and navigation remain fully usable with no authenticated agent.
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));
  assert.match(host.panelHtml(), /class="step-chat"/);
  await host.vscode.commands.executeCommand("codetourIA.previousTourStep");
  await host.waitFor(() => host.panelHtml().includes("1 / 3"));

  // The retry relaunches the agent without reloading the webview; the
  // now-authenticated process answers the question.
  chatPanel().receive({ type: "askQuestion", question: "Et maintenant ?" });
  await waitForCompletedAnswer(update => update.exchanges.length === 2);
  assert.notEqual(lastChatUpdate().exchanges[1].failed, true);
  assert.match(lastChatUpdate().exchanges[1].answerHtml, /Tour answer, part two\./);

  chatPanel().dispose();
  await agent.cleanup();
});

test("a missing agent entry reports the launch failure in the chat and the reader keeps reading", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  setStepChatResponder(
    createAcpStepChatResponder(() => ({
      command: "codetour-no-such-acp-agent",
      args: [],
      cwd: agent.workspace
    }))
  );

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Personne ?" });
  await waitForCompletedAnswer(update => update.exchanges.length === 1);

  // An entry that cannot even be spawned is reported in the chat with the
  // retry hint, never as a crash of the reading webview.
  const failure = lastChatUpdate();
  assert.equal(failure.exchanges[0].failed, true);
  assert.match(failure.exchanges[0].answerHtml, /Impossible de lancer l'agent/);
  assert.match(failure.exchanges[0].answerHtml, /restart the agent/);

  // Reading and navigation remain fully usable without any agent process.
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));
  assert.match(host.panelHtml(), /class="step-chat"/);
  await host.vscode.commands.executeCommand("codetourIA.previousTourStep");
  await host.waitFor(() => host.panelHtml().includes("1 / 3"));

  // Retrying attempts a fresh launch of the missing entry and reports the
  // failure again, without blocking the chat or crashing the reader.
  chatPanel().receive({ type: "askQuestion", question: "Toujours personne ?" });
  await waitForCompletedAnswer(update => update.exchanges.length === 2);
  assert.equal(lastChatUpdate().exchanges[1].failed, true);
  assert.match(lastChatUpdate().exchanges[1].answerHtml, /Impossible de lancer l'agent/);

  chatPanel().dispose();
  await agent.cleanup();
});

test("an answer whose turn ran forbidden tools is flagged in the chat", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  registerAcpResponder(agent, "rogue");

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Tente l'interdit ?" });
  await waitForCompletedAnswer(update => update.exchanges.length === 1);

  // The agent's answer is shown, and the forbidden tool call it ran
  // despite the Ask mode policy is reported to the reader as structured
  // data instead of being reduced to a warning sentence.
  const exchange = lastChatUpdate().exchanges[0];
  assert.match(exchange.answerHtml, /I did it anyway\./);
  assert.doesNotMatch(exchange.answerHtml, /forbidden tool/);
  assert.deepEqual(exchange.forbiddenTools, [
    {
      toolCallId: "rogue-edit",
      kind: "edit",
      status: "completed",
      title: "Editing the workspace anyway",
      forbidden: true
    }
  ]);

  chatPanel().dispose();
  await agent.cleanup();
});

test("a lost agent connection lands in the chat and the next question relaunches the agent", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  registerAcpResponder(agent, "exit-mid-prompt-once");

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Tu vas disparaître ?" });
  await waitForCompletedAnswer(update => update.exchanges.length === 1);

  const failure = lastChatUpdate();
  assert.equal(failure.exchanges[0].failed, true);
  assert.match(
    failure.exchanges[0].answerHtml,
    /The conversation agent connection was lost/
  );
  assert.match(failure.exchanges[0].answerHtml, /restart the agent/);

  // The next question relaunches a fresh agent process and gets its answer.
  chatPanel().receive({ type: "askQuestion", question: "Et maintenant ?" });
  await waitForCompletedAnswer(update => update.exchanges.length === 2);
  assert.notEqual(lastChatUpdate().exchanges[1].failed, true);
  assert.match(lastChatUpdate().exchanges[1].answerHtml, /Tour answer, part two\./);

  chatPanel().dispose();
  await agent.cleanup();
});

test("closing the reading webview releases the ACP agent process", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  const processes: { exited: Promise<unknown> }[] = [];
  setStepChatResponder(
    createAcpStepChatResponder(() => fakeAgentEntry(agent), {
      onProcess: (spawned: { exited: Promise<unknown> }) =>
        processes.push(spawned)
    })
  );

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Avant de partir ?" });
  await waitForCompletedAnswer(update => update.exchanges.length === 1);
  assert.equal(processes.length, 1);

  chatPanel().dispose();
  await Promise.race([
    processes[0].exited,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("the agent process did not exit")),
        5000
      )
    )
  ]);

  await agent.cleanup();
});

test("a step question reaches the ACP agent in Ask mode with the displayed context and its answer lands in the chat", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  registerAcpResponder(agent);

  registerPlayerModule(host.extensionContext);
  await startTour();

  // The displayed buffer diverges from the saved file: the prompt must
  // carry the code the reader actually sees, not the file on disk.
  const editor = host.editorFor("src/player.ts")!;
  (editor.document as unknown as { replace: (text: string) => void }).replace(
    'import { store } from "./store";\n\n// lecture modifiée\nstartPlayer();'
  );

  chatPanel().receive({
    type: "askQuestion",
    question: "Pourquoi appeler startPlayer ici ?"
  });
  await waitForCompletedAnswer(update =>
    update.exchanges.some(exchange =>
      /Tour answer, part two\./.test(exchange.answerHtml)
    )
  );

  // Ask is selected and verified before the first prompt.
  const records = await waitForLog(agent.logPath, found =>
    found.some(record => record.method === "session/prompt")
  );
  assert.ok(
    records.findIndex(record => record.method === "session/set_mode") <
      records.findIndex(record => record.method === "session/prompt"),
    "Ask was selected before the prompt was sent"
  );
  const setMode = records.find(record => record.method === "session/set_mode");
  assert.equal((setMode!.params as { modeId: string }).modeId, "ask");

  // The prompt carries the resolver-captured step context.
  const blocks = promptBlocks(records);
  assert.equal(blocks[0].type, "text");
  assert.equal(blocks[0].text, "Pourquoi appeler startPlayer ici ?");
  assert.equal(blocks[1].type, "text");
  assert.match(blocks[1].text, /src\/player\.ts/);
  assert.match(blocks[1].text, /Le lecteur démarre ici/);
  assert.match(blocks[1].text, /\/\/ lecture modifiée/);

  // The real agent answer is displayed in the step's chat, not an error.
  const update = lastChatUpdate();
  assert.equal(update.exchanges[0].question, "Pourquoi appeler startPlayer ici ?");
  assert.notEqual(update.exchanges[0].failed, true);
  assert.match(update.exchanges[0].answerHtml, /Tour answer, part two\./);

  chatPanel().dispose();
  await agent.cleanup();
});

test("the fake agent's streamed chunks appear progressively in the chat with the in-progress state", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  registerAcpResponder(agent);

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Réponse en flux ?" });

  // The answer completes: the chat is ready for a new question again.
  await waitForCompletedAnswer(update =>
    update.exchanges[0]?.answerHtml?.includes("part two.")
  );

  // The first chunk was already readable on its own, with the
  // response-in-progress state, before the turn completed: the chunk
  // messages arrive over the transport in a fixed order, so the partial
  // update is always posted before the complete one.
  const updates = stepChatUpdates();
  const partial = updates.find(
    update =>
      update.responding === true &&
      update.exchanges[0]?.answerHtml?.includes("Tour answer,") &&
      !update.exchanges[0].answerHtml.includes("part two.")
  );
  assert.ok(
    partial,
    "the first chunk was displayed while the answer was still in progress"
  );
  assert.equal(partial.exchanges[0].pending, true);
  assert.equal(
    updates.findIndex(update => update === partial) <
      updates.findIndex(
        update =>
          update.responding === false &&
          update.exchanges[0]?.answerHtml?.includes("part two.")
      ),
    true
  );

  // Exactly one question was asked and the complete answer is whole.
  const complete = lastChatUpdate();
  assert.equal(complete.exchanges.length, 1);
  assert.equal(complete.exchanges[0].pending, undefined);
  assert.notEqual(complete.exchanges[0].failed, true);
  assert.match(complete.exchanges[0].answerHtml, /Tour answer, part two\./);

  chatPanel().dispose();
  await agent.cleanup();
});

test("the Stop button cancels the in-flight ACP exchange and a new question is answered immediately", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  registerAcpResponder(agent, "slow");

  registerPlayerModule(host.extensionContext);
  await startTour();

  // The slow agent streams one chunk, then keeps the turn open: the
  // answer is visibly in progress when the reader stops it.
  chatPanel().receive({ type: "askQuestion", question: "Réponse longue ?" });
  await host.waitFor(() =>
    stepChatUpdates().some(
      update =>
        update.responding === true &&
        update.exchanges[0]?.answerHtml?.includes("Working")
    )
  );

  // The reader stops the request that has become useless.
  chatPanel().receive({ type: "stopQuestion" });
  await host.waitFor(() => lastChatUpdate().responding === false);

  // The cancellation travelled to the agent over the ACP transport, and
  // the interrupted state is visible in the chat with the streamed part.
  await waitForLog(agent.logPath, found =>
    found.some(record => record.method === "session/cancel")
  );
  const stopped = lastChatUpdate();
  assert.equal(stopped.exchanges[0].interrupted, true);
  assert.match(stopped.exchanges[0].answerHtml, /Working/);
  assert.match(stopped.exchanges[0].answerHtml, /Answer interrupted/);

  // A new question is accepted immediately, without reloading the webview,
  // and answered over the same agent session.
  chatPanel().receive({ type: "askQuestion", question: "Et maintenant ?" });
  await waitForCompletedAnswer(update =>
    update.exchanges.some(exchange => exchange.question === "Et maintenant ?")
  );
  const records = await waitForLog(agent.logPath, found => promptCount(found) === 2);
  assert.equal(
    records.filter(record => record.method === "initialize").length,
    1,
    "the stopped session still serves the next question"
  );
  // The stopped exchange, never completed, feeds no follow-up history.
  const blocks = promptBlocksAt(records, 1);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].text, "Et maintenant ?");
  const answered = lastChatUpdate();
  assert.match(answered.exchanges[1].answerHtml, /Tour answer, part two\./);
  assert.equal(answered.exchanges[1].interrupted, undefined);
  assert.equal(answered.exchanges[0].interrupted, true);

  chatPanel().dispose();
  await agent.cleanup();
});

test("each step keeps its own conversation over one agent session, unmixed across renders", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  registerAcpResponder(agent);

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Première étape ?" });
  await waitForCompletedAnswer(update => update.exchanges.length === 1);

  // The reader moves to another step: it starts its own conversation, and
  // no exchange of the first step reaches its questions.
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));
  chatPanel().receive({ type: "askQuestion", question: "Autre fichier ?" });
  await waitForCompletedAnswer(update =>
    update.exchanges.some(exchange => exchange.question === "Autre fichier ?")
  );

  let records = await waitForLog(agent.logPath, found =>
    promptCount(found) === 2
  );
  const stepTwoBlocks = promptBlocksAt(records, 1);
  assert.equal(stepTwoBlocks.length, 2, "the second step starts with no history");
  assert.equal(stepTwoBlocks[0].text, "Autre fichier ?");
  assert.match(stepTwoBlocks[1].text, /src\/other\.ts/);
  assert.ok(
    !stepTwoBlocks.some(block => block.text.includes("Première étape ?")),
    "the first step's exchange never leaks into the second step's question"
  );

  // Coming back to the first step restores its whole conversation, without
  // any trace of the step visited in between.
  await host.vscode.commands.executeCommand("codetourIA.previousTourStep");
  await host.waitFor(() =>
    host.panelHtml().includes("Première étape ?") &&
    !host.panelHtml().includes("Autre fichier ?")
  );

  // A follow-up on the first step is grounded in that step's exchanges only.
  chatPanel().receive({ type: "askQuestion", question: "On revient comment ?" });
  await waitForCompletedAnswer(update =>
    update.exchanges.some(exchange => exchange.question === "On revient comment ?")
  );

  records = await waitForLog(agent.logPath, found => promptCount(found) === 3);
  const followUpBlocks = promptBlocksAt(records, 2);
  assert.equal(followUpBlocks.length, 3, "the follow-up carries the step's history");
  assert.match(followUpBlocks[2].text, /Première étape \?/);
  assert.match(followUpBlocks[2].text, /Tour answer, part two\./);
  assert.ok(
    !followUpBlocks[2].text.includes("Autre fichier ?"),
    "the other step's exchange never leaks into the follow-up"
  );

  // One agent session answers the whole reading session: no relaunch per
  // step and no session split per step.
  assert.equal(
    records.filter(record => record.method === "initialize").length,
    1
  );

  chatPanel().dispose();
  await agent.cleanup();
});

test("conversations are isolated by tour identity while the reading webview stays open", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  registerAcpResponder(agent);

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Question du premier tour ?" });
  await waitForCompletedAnswer(update => update.exchanges.length === 1);

  // The reader starts another tour without closing the reading webview: a
  // step with the same number starts from an empty conversation.
  const secondTour = {
    id: "file:///workspace/.tours/second.tour",
    title: "2 - Second Tour",
    description: "Un autre tour dans la même lecture.",
    steps: [
      {
        title: "Same file, other tour",
        description: "La même étape d'un autre tour.",
        file: "src/player.ts",
        line: 3
      }
    ]
  };
  await host.vscode.commands.executeCommand("codetourIA.startTour", secondTour);
  await host.waitFor(() =>
    host.panelHtml().includes("La même étape d'un autre tour.")
  );
  chatPanel().receive({ type: "askQuestion", question: "Question de l'autre tour ?" });
  await waitForCompletedAnswer(update =>
    update.exchanges.some(exchange => exchange.question === "Question de l'autre tour ?")
  );

  let records = await waitForLog(agent.logPath, found => promptCount(found) === 2);
  const otherTourBlocks = promptBlocksAt(records, 1);
  assert.equal(otherTourBlocks.length, 2, "the other tour's step starts with no history");
  assert.equal(otherTourBlocks[0].text, "Question de l'autre tour ?");
  assert.match(otherTourBlocks[1].text, /La même étape d'un autre tour\./);
  assert.ok(
    !otherTourBlocks.some(block => block.text.includes("Question du premier tour ?")),
    "the first tour's exchange never leaks into the other tour's question"
  );

  // Reopening the first tour recovers its conversation, still unmixed.
  await host.vscode.commands.executeCommand("codetourIA.startTour", tour);
  await host.waitFor(() =>
    host.panelHtml().includes("Question du premier tour ?") &&
    !host.panelHtml().includes("Question de l'autre tour ?")
  );

  chatPanel().receive({ type: "askQuestion", question: "Et le premier, alors ?" });
  await waitForCompletedAnswer(update =>
    update.exchanges.some(exchange => exchange.question === "Et le premier, alors ?")
  );

  records = await waitForLog(agent.logPath, found => promptCount(found) === 3);
  const backBlocks = promptBlocksAt(records, 2);
  assert.equal(backBlocks.length, 3, "the first tour's conversation survived the detour");
  assert.match(backBlocks[2].text, /Question du premier tour \?/);
  assert.ok(
    !backBlocks[2].text.includes("Question de l'autre tour ?"),
    "the other tour's exchange never leaks into the first tour's follow-up"
  );

  // The two tours share the reading session's single agent process.
  assert.equal(
    records.filter(record => record.method === "initialize").length,
    1
  );

  chatPanel().dispose();
  await agent.cleanup();
});

test("closing the reading webview forgets every conversation and nothing is ever written to disk", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  registerAcpResponder(agent);

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Avant de fermer ?" });
  await waitForCompletedAnswer(update => update.exchanges.length === 1);
  chatPanel().receive({ type: "askQuestion", question: "Deuxième avant ?" });
  await waitForCompletedAnswer(update => update.exchanges.length === 2);

  // The whole conversation lived in memory: no file was written at any
  // point of the chat, its answers or the render refreshes.
  assert.equal(host.fileWrites.length, 0);

  // Closing the reading webview ends every conversation.
  chatPanel().dispose();
  await startTour();
  const reopenedHtml = host.panelHtml();
  assert.ok(!reopenedHtml.includes("Avant de fermer ?"));
  assert.ok(!reopenedHtml.includes("Deuxième avant ?"));

  chatPanel().receive({ type: "askQuestion", question: "Nouvelle lecture ?" });
  await waitForCompletedAnswer(update =>
    update.exchanges.some(exchange => exchange.question === "Nouvelle lecture ?")
  );

  // The reopened reading session starts from an empty conversation: the
  // question is the agent's first, with no remembered exchange.
  const records = await waitForLog(agent.logPath, found => promptCount(found) === 3);
  const blocks = promptBlocks(records);
  assert.equal(blocks.length, 2, "the reopened session remembers no exchange");
  assert.ok(
    !blocks.some(block => block.text.includes("Avant de fermer ?")),
    "the closed session's exchanges never reach the reopened session"
  );

  // A fresh agent process serves the reopened reading session.
  assert.equal(
    records.filter(record => record.method === "initialize").length,
    2
  );

  // Closing did not persist anything either.
  assert.equal(host.fileWrites.length, 0);

  chatPanel().dispose();
  await agent.cleanup();
});


test("thinking activity reaches the chat before the answer", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  registerAcpResponder(agent, "thinking");
  try {
    registerPlayerModule(host.extensionContext);
    await startTour();
    chatPanel().receive({ type: "askQuestion", question: "Explique la constante" });
    await waitForCompletedAnswer(update => update.exchanges.length === 1);
    const progress = stepChatUpdates().find(update => update.responding &&
      update.exchanges[0]?.activityHtml?.includes("Analyse de la constante"));
    assert.ok(progress, "thinking must be visible before any answer text");
    assert.equal(progress.exchanges[0].answerHtml, "");
    assert.ok(!progress.exchanges[0].activityHtml!.includes("<script>"));
    assert.match(lastChatUpdate().exchanges[0].answerHtml, /Réponse finale/);
  } finally {
    chatPanel().dispose();
    await agent.cleanup();
  }
});


const { createFallbackStepChatResponder } = require("../agent/fallbackStepChatAgent");

for (const failingBehavior of ["no-ask-mode", "prompt-fails", "silent-start"]) {
  test(`ACP fallback skips ${failingBehavior} and keeps the working session`, async () => {
    resetChatState();
    const first = createAgentWorkspace();
    const second = createAgentWorkspace();
    setStepChatResponder(createFallbackStepChatResponder(() => [
      { name: "Vibe", entry: fakeAgentEntry(first, failingBehavior) },
      { name: "Copilot", entry: fakeAgentEntry(second) }
    ], { startupTimeoutMs: failingBehavior === "silent-start" ? 1000 : 5000 }));
    try {
      registerPlayerModule(host.extensionContext);
      await startTour();
      chatPanel().receive({ type: "askQuestion", question: "Fallback ?" });
      await waitForCompletedAnswer(update => update.exchanges.length === 1);
      assert.match(lastChatUpdate().exchanges[0].answerHtml, /Tour answer/);
      assert.ok(stepChatUpdates().some(update => update.exchanges[0]?.activityHtml?.includes("Copilot")));
      chatPanel().receive({ type: "askQuestion", question: "Encore ?" });
      await waitForCompletedAnswer(update => update.exchanges.length === 2);
      assert.equal(readLog(first.logPath).filter(row => row.method === "initialize").length, 1);
      assert.equal(promptCount(readLog(second.logPath)), 2);
      assert.match(promptBlocks(readLog(second.logPath))[2].text, /Fallback/);
    } finally {
      chatPanel().dispose();
      first.cleanup(); second.cleanup();
    }
  });
}

test("ACP fallback reports all failures and can retry after installing an agent", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  let installed = false;
  setStepChatResponder(createFallbackStepChatResponder(() => installed
    ? [{ name: "Vibe", entry: fakeAgentEntry(agent) }]
    : ["Vibe", "Copilot", "Codex", "Claude Code"].map(name => ({ name,
        entry: { command: "/missing/codetour-agent", cwd: agent.workspace } }))));
  try {
    registerPlayerModule(host.extensionContext); await startTour();
    chatPanel().receive({ type: "askQuestion", question: "Sans agent ?" });
    await waitForCompletedAnswer(update => update.exchanges.length === 1);
    assert.equal(lastChatUpdate().exchanges[0].failed, true);
    for (const name of ["Vibe", "Copilot", "Codex", "Claude Code"]) {
      assert.ok(lastChatUpdate().exchanges[0].answerHtml.includes(name));
    }
    installed = true;
    chatPanel().receive({ type: "askQuestion", question: "Après installation ?" });
    await waitForCompletedAnswer(update => update.exchanges.length === 2);
    assert.match(lastChatUpdate().exchanges[1].answerHtml, /Tour answer/);
  } finally { chatPanel().dispose(); await agent.cleanup(); }
});

test("ACP fallback never replaces an agent after answer text has streamed", async () => {
  resetChatState();
  const first = createAgentWorkspace(); const second = createAgentWorkspace();
  setStepChatResponder(createFallbackStepChatResponder(() => [
    { name: "Vibe", entry: fakeAgentEntry(first, "partial-fails") },
    { name: "Copilot", entry: fakeAgentEntry(second) }
  ]));
  try {
    registerPlayerModule(host.extensionContext); await startTour();
    chatPanel().receive({ type: "askQuestion", question: "Partielle ?" });
    await waitForCompletedAnswer(update => update.exchanges.length === 1);
    assert.ok(stepChatUpdates().some(update => update.exchanges[0]?.answerHtml.includes("Partial answer")));
    assert.equal(lastChatUpdate().exchanges[0].failed, true);
    assert.equal(readLog(second.logPath).length, 0);
  } finally { chatPanel().dispose(); first.cleanup(); second.cleanup(); }
});

test("stopping during ACP startup never starts a fallback provider", async () => {
  resetChatState();
  const first = createAgentWorkspace(); const second = createAgentWorkspace();
  setStepChatResponder(createFallbackStepChatResponder(() => [
    { name: "Vibe", entry: fakeAgentEntry(first, "silent-start") },
    { name: "Copilot", entry: fakeAgentEntry(second) }
  ], { startupTimeoutMs: 200 }));
  try {
    registerPlayerModule(host.extensionContext); await startTour();
    chatPanel().receive({ type: "askQuestion", question: "Arrêter ?" });
    await host.waitFor(() => lastChatUpdate()?.responding === true);
    chatPanel().receive({ type: "stopQuestion" });
    await host.waitFor(() => lastChatUpdate()?.responding === false);
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(lastChatUpdate().exchanges[0].interrupted, true);
    assert.equal(readLog(second.logPath).length, 0);
  } finally { chatPanel().dispose(); first.cleanup(); second.cleanup(); }
});


for (const workingIndex of [0, 2, 3]) {
  test(`ACP fallback reaches provider ${workingIndex + 1} in priority order`, async () => {
    resetChatState();
    const agent = createAgentWorkspace();
    const attempted: string[] = [];
    setStepChatResponder(createFallbackStepChatResponder(() =>
      ["Vibe", "Copilot", "Codex", "Claude Code"].map((name, index) => ({ name,
        entry: index === workingIndex ? fakeAgentEntry(agent)
          : { command: "/missing/codetour-agent", cwd: agent.workspace }
      }))));
    try {
      registerPlayerModule(host.extensionContext); await startTour();
      chatPanel().receive({ type: "askQuestion", question: "Priorité ?" });
      await waitForCompletedAnswer(update => update.exchanges.length === 1);
      for (const update of stepChatUpdates()) {
        const html = update.exchanges[0]?.activityHtml ?? "";
        const match = html.match(/Connecting to (Vibe|Copilot|Codex|Claude Code)\u2026/);
        if (match && !attempted.includes(match[1])) attempted.push(match[1]);
      }
      assert.deepEqual(attempted, ["Vibe", "Copilot", "Codex", "Claude Code"].slice(0, workingIndex + 1));
      assert.match(lastChatUpdate().exchanges[0].answerHtml, /Tour answer/);
    } finally { chatPanel().dispose(); await agent.cleanup(); }
  });
}

test("stopping after the handshake begins prevents timed-out startup from falling back", async () => {
  resetChatState();
  const first = createAgentWorkspace(); const second = createAgentWorkspace();
  setStepChatResponder(createFallbackStepChatResponder(() => [
    { name: "Vibe", entry: fakeAgentEntry(first, "silent-start") },
    { name: "Copilot", entry: fakeAgentEntry(second) }
  ], { startupTimeoutMs: 500 }));
  try {
    registerPlayerModule(host.extensionContext); await startTour();
    chatPanel().receive({ type: "askQuestion", question: "Annuler le démarrage" });
    await waitForLog(first.logPath, found => found.some(row => row.method === "initialize"));
    chatPanel().receive({ type: "stopQuestion" });
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal(lastChatUpdate().exchanges[0].interrupted, true);
    assert.equal(readLog(second.logPath).length, 0);
  } finally { chatPanel().dispose(); first.cleanup(); second.cleanup(); }
});


test("concurrent step questions share ordered fallback without skipping the working provider", async () => {
  resetChatState();
  const first = createAgentWorkspace();
  const second = createAgentWorkspace();
  const processes: { dispose(): Promise<void> }[] = [];
  const responder = createFallbackStepChatResponder(() => [
    { name: "Vibe", entry: fakeAgentEntry(first, "no-ask-mode") },
    { name: "Copilot", entry: fakeAgentEntry(second) }
  ], { onProcess: (agent: { dispose(): Promise<void> }) => processes.push(agent) });
  const request = (question: string) => ({
    question, workspaceRoot: first.workspace, history: [],
    context: { available: false as const, description: "A tour step" }
  });
  try {
    const results = await Promise.allSettled([
      responder.answer(request("First step question")),
      responder.answer(request("Second step question"))
    ]);
    assert.deepEqual(results.map(result => result.status), ["fulfilled", "fulfilled"]);
    for (const result of results) {
      if (result.status === "fulfilled") assert.match(result.value, /Tour answer/);
    }
    assert.equal(promptCount(readLog(second.logPath)), 2);
    assert.equal(readLog(second.logPath).filter(row => row.method === "initialize").length, 1);
  } finally {
    await responder.dispose();
    await Promise.all(processes.map(agent => agent.dispose()));
    first.cleanup();
    second.cleanup();
  }
});


test("cancelling the ACP queue rejects waiting questions and accepts a fresh question", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  let restarted = false;
  const responder = createFallbackStepChatResponder(() => [
    { name: "Vibe", entry: fakeAgentEntry(agent, restarted ? "default" : "slow") }
  ]);
  const request = (question: string) => ({
    question, workspaceRoot: agent.workspace, history: [],
    context: { available: false as const, description: "A tour step" }
  });
  try {
    const first = responder.answer(request("In flight"));
    await waitForLog(agent.logPath, found => promptCount(found) === 1);
    const waiting = responder.answer(request("Waiting"));
    const stopped = Promise.allSettled([first, waiting]);
    responder.cancel();
    restarted = true;
    const fresh = responder.answer(request("Fresh"));
    const results = await stopped;
    assert.equal(results[1].status, "rejected");
    assert.match(await fresh, /Tour answer/);
    const records = readLog(agent.logPath);
    assert.equal(promptCount(records), 2, "the cancelled queued question never reaches the agent");
    assert.equal(promptBlocksAt(records, 1)[0].text, "Fresh");
  } finally {
    await responder.dispose();
    await agent.cleanup();
  }
});


test("a fresh question starts after cancelling an ACP agent that never acknowledges cancel", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  const responder = createFallbackStepChatResponder(() => [
    { name: "Vibe", entry: fakeAgentEntry(agent, "ignore-cancel-once") }
  ]);
  const request = (question: string) => ({
    question, workspaceRoot: agent.workspace, history: [],
    context: { available: false as const, description: "A tour step" }
  });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const first = responder.answer(request("Unresponsive"));
    const finished = Promise.allSettled([first]);
    await waitForLog(agent.logPath, found => promptCount(found) === 1);
    responder.cancel();
    const fresh = responder.answer(request("After stop"));
    const answer = await Promise.race([
      fresh,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error("fresh question stayed blocked after cancel")), 2000);
      })
    ]);
    assert.match(answer, /Tour answer after restart/);
    await finished;
    const records = readLog(agent.logPath);
    assert.equal(records.filter(row => row.method === "initialize").length, 2);
    assert.equal(promptBlocksAt(records, 1)[0].text, "After stop");
  } finally {
    clearTimeout(deadline);
    await responder.dispose();
    await agent.cleanup();
  }
});
