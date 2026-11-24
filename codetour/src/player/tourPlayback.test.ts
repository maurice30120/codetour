import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost, Uri } from "../test/vscodeHost";

// The webview playback preference is chosen upfront, and the general tour
// markers are hidden: the active anchor must still be visible.
const host = createVscodeHost({
  configuration: {
    codetour: { showMarkers: false }
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
  await host.vscode.commands.executeCommand("codetourIA.startTour", tour);
  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
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
  assert.match(html, /<progress value="1" max="3" aria-label=/);
  assert.match(html, /<h1>Player entry<\/h1>/);
  assert.match(html, /<p>The player starts here\.<\/p>/);
  assert.match(html, /class="anchor">src\/player\.ts : 3</);

  // The editor only shows the small CodeTour logo at the resolved anchor,
  // even though the general tour markers are hidden.
  const decorations = anchorDecoration("src/player.ts");
  assert.ok(decorations, "the active anchor decoration is applied");
  assert.equal(decorations!.length, 1);
  assert.equal(decorations![0].start.line, 2);
  assert.equal(decorations![0].start.character, 0);
  assert.equal(decorations![0].end.character, 0,
    "the gutter marker must not span wrapped continuations of the anchor line");
  const type = activeAnchorType()!;
  assert.ok(!("hoverMessage" in type.options));
  const otherDecorations = [...host.editorFor("src/player.ts")!.decorations.entries()]
    .filter(([decorationType]) => decorationType !== type)
    .map(([, ranges]) => ranges.length);
  assert.deepEqual(otherDecorations, []);
});

test("extension navigation reuses the player actions, progression and bounds", async () => {

  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));
  assert.equal(host.liveThreads().length, 0);
  const selectionDecorations = anchorDecoration("src/player.ts");
  assert.equal(selectionDecorations![0].start.line, 5);
  assert.match(host.panelHtml(), /<h1>Playback rule<\/h1>/);

  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("3 / 3"));
  const patternDecorations = anchorDecoration("src/anchor.ts");
  assert.equal(patternDecorations![0].start.line, 4);

  await host.vscode.commands.executeCommand("codetourIA.previousTourStep");
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));

  // Two steps forward recorded progression; going backward does not add any.
  const progression = (store.progress as [string, number[]][]).find(
    ([id]) => id === tour.id
  )![1];
  assert.deepEqual([...progression].sort(), [0, 1]);
});

test("closing and reopening the expanded view preserves the tour, the step and the native rendering", async () => {
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));

  host.livePanels("codetour.tour")[0]!.dispose();
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

  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));
  assert.equal(host.liveThreads().length, 0);
  assert.equal(anchorDecoration("src/player.ts")![0].start.line, 5);
  assert.equal(store.activeTour.step, 1);

  // The toggles are persisted and never count as a toured step.
  const updates = host.configurationUpdates.filter(
    ([, key]) => key === "playbackMode"
  );
  assert.equal(updates.length, 0);
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

  await host.vscode.commands.executeCommand("codetourIA.resumeTour");
  await host.waitFor(() => editor.revealedRanges.length > revealedCount);
  assert.equal(panel.revealed, true);
  assert.equal(host.liveThreads().length, 0);
});

test("finishing the tour removes the panel, the anchor and the presentation", async () => {
  await host.waitFor(() => host.panelHtml().includes("2 / 3"));

  await host.vscode.commands.executeCommand("codetourIA.finishTour");
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


test("public navigation stays inside the first and final steps", async () => {
  await host.vscode.commands.executeCommand("codetourIA.startTour", tour);
  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
  await host.vscode.commands.executeCommand("codetourIA.previousTourStep");
  assert.equal(store.activeTour.step, 0);
  await host.vscode.commands.executeCommand("codetourIA.startTour", tour, 2);
  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  assert.equal(store.activeTour.step, 2);
  await host.vscode.commands.executeCommand("codetourIA.endTour");
});

test("a whole-file step invents no source logo", async () => {
  await host.vscode.commands.executeCommand("codetourIA.startTour", {
    ...tour, steps: [{ file: "src/player.ts", description: "Whole file" }]
  });
  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
  await host.waitFor(() => host.panelHtml().includes("Whole file"));
  assert.ok(!anchorDecoration("src/player.ts")?.length);
  await host.vscode.commands.executeCommand("codetourIA.endTour");
});


test("the active anchor hover opens the existing webview and only trusts that command", async () => {
  await startTour();
  await host.waitFor(() => host.panelHtml().includes("1 / 3"));
  const type = activeAnchorType()!;
  const options = host.editorFor("src/player.ts")!.decorationOptions.get(type)!;
  const hover = options[0].hoverMessage!;
  assert.match(hover.value, /\[Open the webview\]\(command:codetourIA.showStepDescription/);
  assert.deepEqual(hover.isTrusted, { enabledCommands: ["codetourIA.showStepDescription"] });
  assert.ok(!hover.value.includes("The player starts here"), "the hover stays concise");
  const panel = host.livePanels("codetour.tour")[0];
  panel.revealed = false;
  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
  assert.equal(panel.revealed, true);
  assert.equal(host.livePanels("codetour.tour").length, 1);
  await host.vscode.commands.executeCommand("codetourIA.endTour");
  assert.equal(host.editorFor("src/player.ts")!.decorationOptions.get(type)?.length, 0);
});
