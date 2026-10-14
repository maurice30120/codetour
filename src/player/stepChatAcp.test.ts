import { test } from "node:test";
import * as assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  await host.vscode.commands.executeCommand("codetour.startTour", tour);
  await host.vscode.commands.executeCommand("codetour.showStepDescription");
  await host.waitFor(() =>
    host.panelHtml().includes("Poser une question sur cette étape")
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

function lastChatUpdate() {
  const messages = chatPanel().postedMessages.filter(
    message => (message as { type?: string }).type === "stepChat"
  );
  return messages[messages.length - 1] as {
    exchanges: { question: string; answerHtml: string; failed?: boolean }[];
  };
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
  cleanup: () => void;
}

function createAgentWorkspace(): AgentWorkspace {
  const workspace = mkdtempSync(path.join(tmpdir(), "codetour-chat-"));
  return {
    workspace,
    logPath: path.join(workspace, "agent.log"),
    cleanup: () => rmSync(workspace, { recursive: true, force: true })
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

test("follow-up questions carry the step's previous exchanges to the agent over one session", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  registerAcpResponder(agent);

  registerPlayerModule(host.extensionContext);
  await startTour();

  chatPanel().receive({ type: "askQuestion", question: "Première question ?" });
  await host.waitFor(() => lastChatUpdate()?.exchanges.length === 1);

  chatPanel().receive({ type: "askQuestion", question: "Et ensuite ?" });
  await host.waitFor(() => lastChatUpdate()?.exchanges.length === 2);

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
  agent.cleanup();
});

test("a step without displayed code is reported as unavailable to the agent, never substituted", async () => {
  resetChatState();
  const agent = createAgentWorkspace();
  registerAcpResponder(agent);

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
  agent.cleanup();
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
  await host.waitFor(() =>
    lastChatUpdate()?.exchanges.some(exchange =>
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
  agent.cleanup();
});
