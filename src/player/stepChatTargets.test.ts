import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost } from "../test/vscodeHost";

// The Tour Step Conversation context of a Changes Tour: a question captures
// what the reader is shown — the Git snapshots of the analyzed commits and,
// for a diff, both displayed sides identified as such — never the current
// workspace file, and an unavailable target is reported as such.

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

async function startReading(tour: unknown) {
  await host.vscode.commands.executeCommand("codetour.startTour", tour);
  await host.vscode.commands.executeCommand("codetour.showStepDescription");
}

function chatPanel() {
  return host.livePanels("codetour.tour")[0]!;
}

function lastChatUpdate() {
  const messages = chatPanel().postedMessages.filter(
    message => (message as { type?: string }).type === "stepChat"
  );
  return messages[messages.length - 1] as {
    exchanges: { question: string; answerHtml: string; failed?: boolean }[];
  };
}

async function ask(question: string) {
  chatPanel().receive({ type: "askQuestion", question });
  await host.waitFor(() =>
    lastChatUpdate()?.exchanges.some(exchange => exchange.question === question)
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
  await host.vscode.commands.executeCommand("codetour.endTour");
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

  await host.vscode.commands.executeCommand("codetour.nextTourStep");
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

  await host.vscode.commands.executeCommand("codetour.nextTourStep");
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
