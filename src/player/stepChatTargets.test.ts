import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost } from "../test/vscodeHost";
import { CodeTourStep } from "../store";

// The Tour Step Conversation context resolver, across the Changes Tour's
// Git-grounded targets and every step target kind: a question captures
// what the reader is shown — the Git snapshots of the analyzed commits and,
// for a diff, both displayed sides identified as such — never the current
// workspace file, the embedded contents, URI or directory targets are
// captured as displayed, and an unavailable target is reported as such.

const BASE_REF = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEAD_REF = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
// The checkout has moved past the analyzed commits: like playback, the
// captured context must reproduce the persisted comparison, not the
// moving tip's files.
const MOVED_REF = "cccccccccccccccccccccccccccccccccccccccc";

const BASE_PLAYER = ["const state = 0;", "const old = 1;", "const gone = 2;"].join("\n");
const HEAD_PLAYER = [
  "const state = 0;",
  "const fresh = 1;",
  "const anchor = 2;",
  "const more = 3;"
].join("\n");
const HEAD_ADDED = ["const added = 1;", "const second = 2;"].join("\n");
const HEAD_OTHER = ["const snapshot = 1;", "const kept = 2;"].join("\n");
const CURRENT_OTHER = ["const current = 9;", "const moved = 10;"].join("\n");
const CURRENT_STALE = ["const stale = 1;", "const live = 2;"].join("\n");

const host = createVscodeHost({
  configuration: {
    codetour: { showMarkers: false }
  },
  git: {
    branch: "main",
    head: MOVED_REF,
    commits: [BASE_REF, HEAD_REF],
    delayMs: 10,
    objects: {
      [`${BASE_REF}:/workspace/src/player.ts`]: { content: BASE_PLAYER },
      [`${HEAD_REF}:/workspace/src/player.ts`]: { content: HEAD_PLAYER },
      [`${HEAD_REF}:/workspace/src/added.ts`]: { content: HEAD_ADDED },
      [`${HEAD_REF}:/workspace/src/other.ts`]: { content: HEAD_OTHER }
    }
  },
  failMissingFiles: true
});

// The extension modules resolve a mocked `vscode` host, so they must be
// required after the load hook is in place.
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
const { store } = require("../store");
const { setStepChatResponder } = require("./stepChat");

interface RecordedContext {
  available: boolean;
  path?: string;
  code?: string;
  description: string;
}

const changesTour = {
  id: "file:///workspace/.tours/changes.tour",
  title: "1 - Changes Tour",
  description: "A changes tour",
  ref: HEAD_REF,
  baseRef: BASE_REF,
  steps: [
    {
      title: "Diff step",
      description: "L'étape explique la comparaison affichée.",
      file: "src/player.ts",
      display: "diff",
      line: 3
    },
    {
      title: "Added diff step",
      description: "L'étape explique le fichier ajouté.",
      file: "src/added.ts",
      display: "diff",
      line: 1
    },
    {
      title: "Snapshot step",
      description: "L'étape explique le snapshot affiché.",
      file: "src/other.ts",
      line: 2
    }
  ]
};

// A tour the reader followed before the Changes Tour: its current-file
// editor stays displayed next to every target the Changes Tour opens.
const browsingTour = {
  id: "file:///workspace/.tours/browsing.tour",
  title: "0 - Browsing",
  description: "A tour before the changes",
  steps: [
    {
      title: "Current file",
      description: "Le lecteur parcourt le fichier courant.",
      file: "src/other.ts",
      line: 1
    }
  ]
};

function changesStepTour(
  id: string,
  title: string,
  step: { title: string; description: string; file: string; display: "diff"; line: number }
) {
  return {
    id,
    title,
    description: "A changes tour",
    ref: HEAD_REF,
    baseRef: BASE_REF,
    steps: [step]
  };
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
    responding?: boolean;
  };
}

async function startReading(tour: unknown) {
  await host.vscode.commands.executeCommand("codetourIA.startTour", tour);
  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
}

async function startTourWithSteps(fileName: string, steps: CodeTourStep[]) {
  await host.vscode.commands.executeCommand("codetourIA.startTour", {
    id: `file:///workspace/.tours/${fileName}`,
    title: "1 - Step Targets Tour",
    description: "A tour covering step target types",
    steps
  });
  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
  await host.waitFor(() =>
    host.panelHtml().includes("Ask a question about this step")
  );
}

async function ask(question: string) {
  chatPanel().receive({ type: "askQuestion", question });
  // The answer must complete before the test moves on: a new question is
  // blocked while the previous answer is still streaming.
  await host.waitFor(
    () =>
      lastChatUpdate().responding === false &&
      lastChatUpdate().exchanges.some(exchange => exchange.question === question)
  );
}

function recordContexts() {
  const received: { question: string; context: unknown }[] = [];
  setStepChatResponder({
    answer: async (request: { question: string; context: unknown }) => {
      received.push({ question: request.question, context: request.context });
      return "Réponse du répondant.";
    }
  });
  return received;
}

async function endTour() {
  await host.vscode.commands.executeCommand("codetourIA.endTour");
  await host.waitFor(() => store.activeTour === null);
}

test("a diff step sends both displayed sides, identified as such", async () => {
  registerPlayerModule(host.extensionContext);
  host.setFileContent("src/other.ts", CURRENT_OTHER);
  const received = recordContexts();

  await startReading(browsingTour);
  await host.waitFor(() => host.panelHtml().includes("Current file"));
  await endTour();

  await startReading(changesTour);
  await host.waitFor(() => host.panelHtml().includes("Diff step"));
  await ask("Que compare cette étape ?");

  // The comparison the reader is shown: the base and tour-ref snapshots,
  // each side labeled with its path and commit — never a single flattened
  // file nor the workspace's current content.
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].context, {
    available: true,
    path: "src/player.ts",
    diff: {
      original: { path: "src/player.ts", ref: BASE_REF, code: BASE_PLAYER },
      modified: { path: "src/player.ts", ref: HEAD_REF, code: HEAD_PLAYER }
    },
    description: "L'étape explique la comparaison affichée."
  });
});

test("an added file diff identifies its empty original side", async () => {
  const received = recordContexts();

  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("Added diff step"));
  await ask("D'où vient ce fichier ?");

  assert.deepEqual(received[0].context, {
    available: true,
    path: "src/added.ts",
    diff: {
      original: { path: "src/added.ts", ref: BASE_REF, code: "" },
      modified: { path: "src/added.ts", ref: HEAD_REF, code: HEAD_ADDED }
    },
    description: "L'étape explique le fichier ajouté."
  });
});

test("a snapshot step sends the displayed Git snapshot, not the current file", async () => {
  const received = recordContexts();

  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("Snapshot step"));
  await ask("Que montre ce snapshot ?");

  // The reader still has the current src/other.ts editor displayed from the
  // browsing tour; the captured code is the tour-ref snapshot, without any
  // silent substitution by that current file.
  assert.deepEqual(received[0].context, {
    available: true,
    path: "src/other.ts",
    code: HEAD_OTHER,
    description: "L'étape explique le snapshot affiché."
  });
});

test("an unavailable diff target is reported as such, never substituted", async () => {
  const received = recordContexts();

  await endTour();
  await startReading(
    changesStepTour("file:///workspace/.tours/gone.tour", "2 - Gone", {
      title: "Gone diff",
      description: "L'explication survit au diff manquant.",
      file: "src/gone.ts",
      display: "diff",
      line: 2
    })
  );
  await host.waitFor(() =>
    host.messages.some(message => message.includes("file unavailable: src/gone.ts"))
  );
  await host.waitFor(() => host.panelHtml().includes("Gone diff"));
  await ask("Et sans comparaison ?");

  // The target cannot be displayed: the context says so instead of silently
  // substituting another open file's code.
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].context, {
    available: false,
    path: "src/gone.ts",
    description: "L'explication survit au diff manquant."
  });
});

test("a diff that fell back to the current file sends that displayed file, not an invented comparison", async () => {
  host.setFileContent("src/stale.ts", CURRENT_STALE);
  const received = recordContexts();

  await endTour();
  await startReading(
    changesStepTour("file:///workspace/.tours/stale.tour", "3 - Stale", {
      title: "Stale diff",
      description: "Le fichier courant reste la cible affichée.",
      file: "src/stale.ts",
      display: "diff",
      line: 1
    })
  );
  await host.waitFor(() => host.panelHtml().includes("Stale diff"));
  await ask("Que voit le lecteur ?");

  // The analyzed commits don't contain the file, so playback fell back to
  // the current file: the context mirrors that display, without claiming the
  // comparison the reader does not see.
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].context, {
    available: true,
    path: "src/stale.ts",
    code: CURRENT_STALE,
    description: "Le fichier courant reste la cible affichée."
  });
});

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
  await host.waitFor(() => lastChatUpdate().responding === false);

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
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("2 / 2"));
  chatPanel().receive({ type: "askQuestion", question: "Que trouve-t-on dans src ?" });
  await host.waitFor(() => lastChatUpdate().responding === false);

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

test("a URI step sends the code displayed at its target", async () => {
  resetChatState();
  const received: RecordedContext[] = [];
  setStepChatResponder({
    answer: async (request: { question: string; context: RecordedContext }) => {
      received.push(request.context);
      return "Réponse URI.";
    }
  });

  registerPlayerModule(host.extensionContext);
  host.setFileContent("src/player.ts", ["const player = true;", "start();"].join("\n"));
  await startTourWithSteps("uri.tour", [
    {
      title: "URI target",
      description: "Étape ancrée à une URI.",
      uri: "file:///workspace/src/player.ts",
      line: 1
    }
  ]);

  chatPanel().receive({ type: "askQuestion", question: "Sur quoi pointe cette URI ?" });
  await host.waitFor(() => lastChatUpdate().responding === false);

  // The reader sees the URI's document, so the question carries that code,
  // not an unavailable target.
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], {
    available: true,
    path: "file:///workspace/src/player.ts",
    code: "const player = true;\nstart();",
    description: "Étape ancrée à une URI."
  });
  assert.match(lastChatUpdate().exchanges[0].answerHtml, /Réponse URI/);

  setStepChatResponder(undefined);
  chatPanel().dispose();
});

test("an unavailable file target is reported as such, never substituted", async () => {
  resetChatState();
  const received: RecordedContext[] = [];
  setStepChatResponder({
    answer: async (request: { question: string; context: RecordedContext }) => {
      received.push(request.context);
      return "Réponse indisponible.";
    }
  });

  registerPlayerModule(host.extensionContext);
  host.setFileContent("src/present.ts", ["const present = true;", "run();"].join("\n"));
  await startTourWithSteps("unavailable.tour", [
    {
      title: "File entry",
      description: "Étape avec fichier présent.",
      file: "src/present.ts",
      line: 1
    },
    {
      title: "Missing file",
      description: "Étape au fichier disparu.",
      file: "src/gone.ts",
      line: 1
    }
  ]);

  // The reader is warned that the target is unavailable and the step stays
  // readable; the previous step's buffer is still open behind the panel.
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("2 / 2"));
  await host.waitFor(() =>
    host.messages.some(message =>
      message.includes("file unavailable: src/gone.ts")
    )
  );
  chatPanel().receive({ type: "askQuestion", question: "Où est le code ?" });
  await host.waitFor(() => lastChatUpdate().responding === false);

  // The question reports the unavailable target as such, with its declared
  // path; the still-open buffer of src/present.ts is never substituted.
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], {
    available: false,
    path: "src/gone.ts",
    description: "Étape au fichier disparu."
  });
  assert.match(lastChatUpdate().exchanges[0].answerHtml, /Réponse indisponible/);

  setStepChatResponder(undefined);
  // Ending the tour stops the player and its panel; a plain panel dispose
  // would re-render the missing target after the test ends.
  await host.vscode.commands.executeCommand("codetourIA.endTour");
});

test("a view step sends only the description, without any code target", async () => {
  resetChatState();
  const received: RecordedContext[] = [];
  setStepChatResponder({
    answer: async (request: { question: string; context: RecordedContext }) => {
      received.push(request.context);
      return "Réponse vue.";
    }
  });

  registerPlayerModule(host.extensionContext);
  await startTourWithSteps("view.tour", [
    {
      title: "View target",
      description: "Étape focalisant une vue.",
      view: "explorer"
    }
  ]);

  chatPanel().receive({ type: "askQuestion", question: "Que montre cette vue ?" });
  await host.waitFor(() => lastChatUpdate().responding === false);

  // A view step presents no code at all: the question carries only the
  // step's explanation, without any invented target.
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], {
    available: false,
    description: "Étape focalisant une vue."
  });
  assert.match(lastChatUpdate().exchanges[0].answerHtml, /Réponse vue/);

  setStepChatResponder(undefined);
  chatPanel().dispose();
});
