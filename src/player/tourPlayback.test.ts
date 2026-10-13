import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost, Uri } from "../test/vscodeHost";

// The webview playback preference is chosen upfront, and the general tour
// markers are hidden: the active anchor must still be visible.
const host = createVscodeHost({
  configuration: {
    codetour: { playbackMode: "webview", showMarkers: false }
  }
});

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
const { SMALL_ICON_URL } = require("../constants");

const tour = {
  id: "file:///workspace/.tours/demo.tour",
  title: "1 - Demo Tour",
  description: "A demo tour",
  steps: [
    {
      title: "Player entry",
      description: "The player starts here.\n\nWelcome to the player.",
      file: "src/player.ts",
      line: 3
    },
    {
      title: "Playback rule",
      description: "The selection anchors this rule.",
      file: "src/player.ts",
      selection: {
        start: { line: 6, character: 1 },
        end: { line: 6, character: 12 }
      }
    },
    {
      title: "Pattern anchor",
      description: "A pattern anchors this step.",
      file: "src/anchor.ts",
      pattern: "function playbackRule"
    }
  ]
};

function seedWorkspace() {
  host.setFileContent(
    "src/player.ts",
    ["import { store } from \"./store\";", "", "startPlayer();", "", "// step 6", "// step 6 end", "const rule = playbackRule();"].join("\n")
  );
  host.setFileContent(
    "src/anchor.ts",
    ["", "", "", "", "function playbackRule() {", "  return true;", "}"].join("\n")
  );
}

async function startTour() {
  seedWorkspace();
  await host.vscode.commands.executeCommand("codetour.startTour", tour);
}

function activeAnchorType() {
  return host.decorationTypes.find(
    type => (type.options.gutterIconPath as Uri).toString() === SMALL_ICON_URL
  );
}

function anchorDecoration(editorPath: string) {
  const editor = host.editorFor(editorPath);
  const type = activeAnchorType();
  return editor && type ? editor.decorations.get(type) : undefined;
}

test("webview playback reads a step in a layout A panel with the logo alone at the anchor", async () => {
  registerPlayerModule(host.extensionContext);
  await startTour();

  await host.waitFor(() => host.panelHtml().includes("1 / 3"));

  // The description lives in the webview only: no comment thread carries it
  // and no expanded-description panel duplicates it.
  assert.equal(host.liveThreads().length, 0);
  assert.equal(host.livePanels("codetour.description").length, 0);
  assert.equal(host.livePanels("codetour.tour").length, 1);

  const html = host.panelHtml();
  assert.match(html, /<small>Demo Tour<\/small>/);
  assert.match(html, /<progress value="1" max="3">/);
  assert.match(html, /<h1>Player entry<\/h1>/);
  assert.match(html, /<p>The player starts here\.<\/p>/);
  assert.match(html, /class="anchor">src\/player\.ts : 3</);
  assert.match(html, /data-action="previous" disabled/);
  assert.doesNotMatch(html, /data-action="next" disabled/);

  // The editor only shows the small CodeTour logo at the resolved anchor,
  // even though the general tour markers are hidden.
  const decorations = anchorDecoration("src/player.ts");
  assert.ok(decorations, "the active anchor decoration is applied");
  assert.equal(decorations!.length, 1);
  assert.equal(decorations![0].start.line, 2);
  const type = activeAnchorType()!;
  assert.ok(!("hoverMessage" in type.options));
  const otherDecorations = [...host.editorFor("src/player.ts")!.decorations.entries()]
    .filter(([decorationType]) => decorationType !== type)
    .map(([, ranges]) => ranges.length);
  assert.deepEqual(otherDecorations, []);
});

test("the panel navigation reuses the player actions, progression and bounds", async () => {
  const panel = host.livePanels("codetour.tour")[0];

  panel!.receive({ type: "next" });
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));
  assert.equal(host.liveThreads().length, 0);
  const selectionDecorations = anchorDecoration("src/player.ts");
  assert.equal(selectionDecorations![0].start.line, 5);
  assert.match(host.panelHtml(), /<h1>Playback rule<\/h1>/);

  panel!.receive({ type: "next" });
  await host.waitFor(() => host.panelHtml().includes("3 / 3"));
  assert.match(host.panelHtml(), /data-action="next" disabled/);
  assert.doesNotMatch(host.panelHtml(), /data-action="previous" disabled/);
  const patternDecorations = anchorDecoration("src/anchor.ts");
  assert.equal(patternDecorations![0].start.line, 4);

  panel!.receive({ type: "previous" });
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));

  // Two steps forward recorded progression; going backward does not add any.
  const progression = (store.progress as [string, number[]][]).find(
    ([id]) => id === tour.id
  )![1];
  assert.deepEqual([...progression].sort(), [0, 1]);
});

test("toggling playback modes preserves the tour, the step and the native rendering", async () => {
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));

  await host.vscode.commands.executeCommand("codetour.togglePlaybackMode");
  await host.waitFor(() =>
    host.liveThreads()[0]?.comments[0]?.body.value.includes(
      "The selection anchors this rule."
    )
  );
  assert.equal(host.livePanels("codetour.tour").length, 0);
  assert.equal(anchorDecoration("src/player.ts")?.length ?? 0, 0);
  assert.match(
    host.liveThreads()[0].comments[0].body.value,
    /The selection anchors this rule\./
  );
  assert.equal(store.activeTour.step, 1);

  await host.vscode.commands.executeCommand("codetour.togglePlaybackMode");
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));
  assert.equal(host.liveThreads().length, 0);
  assert.equal(anchorDecoration("src/player.ts")![0].start.line, 5);
  assert.equal(store.activeTour.step, 1);

  // The toggles are persisted and never count as a toured step.
  const updates = host.configurationUpdates.filter(
    ([, key]) => key === "playbackMode"
  );
  assert.equal(updates.length, 2);
  const progression = (store.progress as [string, number[]][]).find(
    ([id]) => id === tour.id
  )![1];
  assert.deepEqual([...progression].sort(), [0, 1]);
});

test("resuming returns to the anchor and the panel without a comment thread", async () => {
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));
  const panel = host.livePanels("codetour.tour")[0]!;
  const editor = host.editorFor("src/player.ts")!;
  const revealedCount = editor.revealedRanges.length;

  panel.receive({ type: "code" });
  await host.waitFor(() => editor.revealedRanges.length > revealedCount);
  assert.equal(panel.revealed, true);
  assert.equal(host.liveThreads().length, 0);
});

test("finishing the tour removes the panel, the anchor and the presentation", async () => {
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));

  await host.vscode.commands.executeCommand("codetour.finishTour");
  await host.waitFor(() => store.activeTour === null);

  assert.equal(host.livePanels("codetour.tour").length, 0);
  assert.equal(host.liveThreads().length, 0);
  assert.equal(host.contexts.get("codetour:inTour"), false);

  const type = activeAnchorType();
  for (const editor of host.visibleTextEditors) {
    const ranges = type ? editor.decorations.get(type) : undefined;
    assert.ok(!ranges || ranges.length === 0);
  }
});
