import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost, Uri } from "../test/vscodeHost";

const BASE_REF = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEAD_REF = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const host = createVscodeHost({
  configuration: {
    codetour: { playbackMode: "webview", showMarkers: true }
  },
  git: {
    branch: "main",
    head: HEAD_REF,
    commits: [BASE_REF, HEAD_REF],
    delayMs: 30,
    objects: {
      [`${BASE_REF}:/workspace/src/alpha.ts`]: {
        content: ["const old = 1;", "const base = 2;"].join("\n")
      },
      [`${HEAD_REF}:/workspace/src/alpha.ts`]: {
        content: ["const fresh = 1;", "const changed = 2;", "const extra = 3;"].join("\n")
      }
    }
  }
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
const { SMALL_ICON_URL, ICON_URL } = require("../constants");

const tourA = {
  id: "file:///workspace/.tours/alpha.tour",
  title: "1 - Alpha Tour",
  description: "The first tour of a series",
  nextTour: "2 - Beta Tour",
  ref: HEAD_REF,
  baseRef: BASE_REF,
  steps: [
    {
      title: "Alpha entry",
      description: "Alpha starts here.",
      file: "src/alpha.ts",
      line: 2
    },
    {
      title: "Alpha diff",
      description: "Alpha changed this file.",
      file: "src/alpha.ts",
      display: "diff",
      line: 2
    }
  ]
};

const tourB = {
  id: "file:///workspace/.tours/beta.tour",
  title: "2 - Beta Tour",
  description: "The second tour of a series",
  steps: [
    {
      title: "Beta entry",
      description: "Beta starts here.",
      file: "src/beta.ts",
      line: 2
    }
  ]
};

function seedWorkspace() {
  host.setFileContent("src/alpha.ts", ["const fresh = 1;", "const changed = 2;", "const extra = 3;"].join("\n"));
  host.setFileContent("src/beta.ts", ["const beta = 1;", "const betaRule = 2;"].join("\n"));
}

function decorationType(iconUrl: string) {
  return host.decorationTypes.find(
    type => (type.options.gutterIconPath as Uri).toString() === iconUrl
  );
}

function anchorRanges(iconUrl: string) {
  const type = decorationType(iconUrl)!;
  return host.visibleTextEditors.flatMap(editor =>
    (editor.decorations.get(type) ?? []).map(range => ({
      uri: editor.document.uri.toString(),
      line: range.start.line
    }))
  );
}

function panel() {
  return host.livePanels("codetour.tour")[0];
}

function progressFor(tourId: string) {
  return ((store.progress as [string, number[]][]).find(
    ([id]) => id === tourId
  )?.[1] ?? []);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("closing the panel keeps the mode and the step, and resume reopens the presentation", async () => {
  registerPlayerModule(host.extensionContext);
  seedWorkspace();
  store.tours = [tourA, tourB];
  await host.vscode.commands.executeCommand("codetour.startTour", tourA);
  await host.waitFor(() => host.panelHtml().includes("Alpha entry"));

  panel()!.dispose();
  await host.waitFor(() => host.livePanels("codetour.tour").length === 0);

  // Closing the presentation changes neither the preference nor the step.
  assert.equal(store.playbackMode, "webview");
  assert.equal(store.activeTour.step, 0);
  assert.equal(
    host.configurationUpdates.filter(([, key]) => key === "playbackMode")
      .length,
    0
  );
  assert.equal(anchorRanges(SMALL_ICON_URL).length, 1);

  // Reprendre reopens the step's presentation without any comment thread.
  await host.vscode.commands.executeCommand("codetour.resumeTour");
  await host.waitFor(() => host.panelHtml().includes("Alpha entry"));
  assert.equal(host.livePanels("codetour.tour").length, 1);
  assert.equal(panel()!.revealed, true);
  assert.equal(host.liveThreads().length, 0);
});

test("closing the panel while a step resolves keeps the panel closed", async () => {
  // The next step resolves a diff, which takes observable time in the Git
  // mock: the panel is closed while that resolution is still in flight.
  panel()!.receive({ type: "next" });
  await sleep(10);
  panel()!.dispose();

  // The anchor side completes, but no reading panel is resurrected.
  await host.waitFor(
    () => anchorRanges(SMALL_ICON_URL).some(({ uri }) => uri.includes(HEAD_REF))
  );
  await sleep(150);
  assert.equal(host.livePanels("codetour.tour").length, 0);
  assert.equal(store.activeTour.step, 1);

  // Reprendre brings the closed presentation back for the current step.
  await host.vscode.commands.executeCommand("codetour.resumeTour");
  await host.waitFor(() => host.panelHtml().includes("Alpha diff"));
  assert.equal(host.livePanels("codetour.tour").length, 1);
});

test("finishing removes the presentation and the active marker, not the passive ones", async () => {
  // Re-assigning the discovered tours retriggers the passive-marker reaction
  // now that the step's editor is open.
  store.tours = [tourA, tourB];
  await host.waitFor(
    () => anchorRanges(ICON_URL).some(({ uri }) => uri.includes("src/alpha.ts"))
  );
  const passiveBefore = anchorRanges(ICON_URL).length;
  assert.ok(passiveBefore > 0);

  await host.vscode.commands.executeCommand("codetour.finishTour");
  await host.waitFor(() => store.activeTour === null);

  assert.equal(host.livePanels("codetour.tour").length, 0);
  assert.equal(host.liveThreads().length, 0);
  assert.equal(anchorRanges(SMALL_ICON_URL).length, 0);
  assert.equal(anchorRanges(ICON_URL).length, passiveBefore);
});

test("the finish action starts the next tour of a series without an extra counted step", async () => {
  await host.vscode.commands.executeCommand("codetour.startTour", tourA);
  await host.waitFor(() => host.panelHtml().includes("Alpha entry"));

  panel()!.receive({ type: "next" });
  await host.waitFor(() => host.panelHtml().includes("2 / 2"));
  assert.match(
    host.panelHtml(),
    /data-action="finish" data-tour="2 - Beta Tour"/
  );

  panel()!.receive({ type: "finish", tour: "2 - Beta Tour" });
  await host.waitFor(() => host.panelHtml().includes("Beta entry"));
  assert.equal(store.activeTour.tour.title, "2 - Beta Tour");
  assert.match(host.panelHtml(), /<small>Beta Tour<\/small>/);
  assert.match(host.panelHtml(), /1 \/ 1/);
  assert.equal(host.liveThreads().length, 0);

  // The transition reuses the reader's progression rules: the last step of
  // the finished tour is counted once, and no step of the next tour is.
  assert.deepEqual([...progressFor(tourA.id)].sort(), [0, 1]);
  assert.deepEqual(progressFor(tourB.id), []);
});

test("the previous action starts the previous tour at its first step", async () => {
  assert.match(
    host.panelHtml(),
    /data-action="previous" data-tour="1 - Alpha Tour"/
  );

  panel()!.receive({ type: "previous", tour: "1 - Alpha Tour" });
  await host.waitFor(() => host.panelHtml().includes("Alpha entry"));
  assert.equal(store.activeTour.tour.title, "1 - Alpha Tour");
  assert.equal(store.activeTour.step, 0);
  assert.match(host.panelHtml(), /1 \/ 2/);
  assert.deepEqual([...progressFor(tourA.id)].sort(), [0, 1]);
  assert.deepEqual(progressFor(tourB.id), []);
});

test("rapid navigation settles on the last requested step", async () => {
  // A slow diff render is superseded by a fast file render while it is
  // still resolving: the late target must never reappear.
  const diffCallsBefore = host.executedCommands.filter(
    ([id]) => id === "vscode.diff"
  ).length;

  panel()!.receive({ type: "next" });
  await sleep(10);
  panel()!.receive({ type: "previous" });
  await host.waitFor(() => host.panelHtml().includes("1 / 2"));
  await sleep(150);

  assert.match(host.panelHtml(), /<h1>Alpha entry<\/h1>/);
  assert.deepEqual(anchorRanges(SMALL_ICON_URL), [
    { uri: "file:/workspace/src/alpha.ts", line: 1 }
  ]);
  assert.equal(
    host.executedCommands.filter(([id]) => id === "vscode.diff").length,
    diffCallsBefore,
    "the superseded diff never opens"
  );

  // The other direction: a slow render requested last wins.
  panel()!.receive({ type: "next" });
  await host.waitFor(() => host.panelHtml().includes("2 / 2"));
  await sleep(150);
  assert.match(host.panelHtml(), /<h1>Alpha diff<\/h1>/);
  assert.ok(
    anchorRanges(SMALL_ICON_URL).some(
      ({ uri, line }) => uri.includes(HEAD_REF) && line === 1
    ),
    "the anchor settles on the modified side of the diff"
  );
});

test("toggling the playback mode during an anchor resolution leaves no stale presentation", async () => {
  panel()!.receive({ type: "previous" });
  await host.waitFor(() => host.panelHtml().includes("1 / 2"));
  await host.waitFor(() => anchorRanges(SMALL_ICON_URL).length === 1);

  // Toggle while the diff step is still resolving its anchor.
  panel()!.receive({ type: "next" });
  await sleep(10);
  await host.vscode.commands.executeCommand("codetour.togglePlaybackMode");

  await host.waitFor(() =>
    host.liveThreads()[0]?.comments[0]?.body.value.includes(
      "Alpha changed this file."
    )
  );

  // The native presentation replaced the panel, and no active anchor is
  // left behind from the aborted webview render.
  assert.equal(host.livePanels("codetour.tour").length, 0);
  assert.equal(anchorRanges(SMALL_ICON_URL).length, 0);
  assert.equal(store.activeTour.step, 1);
});

test("switching tours during an anchor resolution never shows the previous tour's target", async () => {
  await host.vscode.commands.executeCommand("codetour.togglePlaybackMode");
  await host.waitFor(() => host.panelHtml().includes("2 / 2"));

  const diffCallsBefore = host.executedCommands.filter(
    ([id]) => id === "vscode.diff"
  ).length;

  // Start another tour while the diff step is still resolving its anchor.
  panel()!.receive({ type: "previous" });
  await host.waitFor(() => host.panelHtml().includes("1 / 2"));
  panel()!.receive({ type: "next" });
  await sleep(10);
  await host.vscode.commands.executeCommand("codetour.startTour", tourB);

  await host.waitFor(() => host.panelHtml().includes("Beta entry"));
  assert.equal(store.activeTour.tour.title, "2 - Beta Tour");
  assert.match(host.panelHtml(), /1 \/ 1/);

  // The aborted resolution opened no stale comparison and left no marker
  // from the previous tour: only the new tour's anchor is visible.
  assert.equal(
    host.executedCommands.filter(([id]) => id === "vscode.diff").length,
    diffCallsBefore
  );
  assert.deepEqual(
    anchorRanges(SMALL_ICON_URL).map(({ uri }) => uri),
    ["file:/workspace/src/beta.ts"]
  );
});
