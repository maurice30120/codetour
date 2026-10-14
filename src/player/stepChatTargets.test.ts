import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost } from "../test/vscodeHost";
import { CodeTourStep } from "../store";

// The step context resolver across the reader's step target types: a
// question on an embedded-content step captures the code the reader
// actually sees — never a substitute target.
const host = createVscodeHost({ failMissingFiles: true });

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

interface RecordedContext {
  available: boolean;
  path?: string;
  code?: string;
  description: string;
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

async function startTourWithSteps(fileName: string, steps: CodeTourStep[]) {
  await host.vscode.commands.executeCommand("codetour.startTour", {
    id: `file:///workspace/.tours/${fileName}`,
    title: "1 - Step Targets Tour",
    description: "A tour covering step target types",
    steps
  });
  await host.vscode.commands.executeCommand("codetour.showStepDescription");
  await host.waitFor(() =>
    host.panelHtml().includes("Poser une question sur cette étape")
  );
}

test("an embedded-content step sends the code the reader actually sees", async () => {
  resetChatState();
  const received: RecordedContext[] = [];
  setStepChatResponder({
    answer: async (request: { question: string; context: RecordedContext }) => {
      received.push(request.context);
      return "Réponse embarquée.";
    }
  });

  registerPlayerModule(host.extensionContext);
  await startTourWithSteps("embedded.tour", [
    {
      title: "Embedded content",
      description: "Étape à contenu embarqué.",
      file: "player.ts",
      contents: 'const embedded = true;\nstartPlayer(embedded);\n',
      line: 1
    }
  ]);

  chatPanel().receive({
    type: "askQuestion",
    question: "Que fait ce contenu ?"
  });
  await host.waitFor(() => !!lastChatUpdate());

  // The embedded contents are what the reader's step displays, so they are
  // what the responder receives, with the step's declared path.
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], {
    available: true,
    path: "player.ts",
    code: 'const embedded = true;\nstartPlayer(embedded);\n',
    description: "Étape à contenu embarqué."
  });
  assert.match(lastChatUpdate().exchanges[0].answerHtml, /Réponse embarquée/);

  setStepChatResponder(undefined);
  chatPanel().dispose();
});

test("a directory-anchored step sends the declared directory, never a buffer", async () => {
  resetChatState();
  const received: RecordedContext[] = [];
  setStepChatResponder({
    answer: async (request: { question: string; context: RecordedContext }) => {
      received.push(request.context);
      return "Réponse répertoire.";
    }
  });

  registerPlayerModule(host.extensionContext);
  host.setFileContent("src/present.ts", ["const present = true;", "run();"].join("\n"));
  await startTourWithSteps("directory.tour", [
    {
      title: "File entry",
      description: "Étape avec fichier présent.",
      file: "src/present.ts",
      line: 1
    },
    {
      title: "Directory target",
      description: "Étape ancrée à un répertoire.",
      directory: "src"
    }
  ]);

  // The file step leaves its buffer open behind the reader; the directory
  // step presents no code, so the question must not capture that buffer.
  await host.vscode.commands.executeCommand("codetour.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("2 / 2"));
  chatPanel().receive({ type: "askQuestion", question: "Que trouve-t-on dans src ?" });
  await host.waitFor(() => !!lastChatUpdate());

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], {
    available: false,
    path: "src",
    description: "Étape ancrée à un répertoire."
  });
  assert.match(lastChatUpdate().exchanges[0].answerHtml, /Réponse répertoire/);

  setStepChatResponder(undefined);
  chatPanel().dispose();
});
