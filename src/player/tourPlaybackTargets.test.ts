import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost, Uri } from "../test/vscodeHost";

const host = createVscodeHost({
  configuration: {
    codetour: { showMarkers: false }
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
const { SMALL_ICON_URL } = require("../constants");

const tour = {
  id: "file:///workspace/.tours/targets.tour",
  title: "1 - Targets Tour",
  description: "A tour of every step target",
  steps: [
    {
      title: "File entry",
      description: "An ordinary anchored step.",
      file: "src/player.ts",
      line: 2
    },
    {
      title: "No anchor",
      description: "This step explains without any code anchor."
    },
    {
      title: "Directory target",
      description: "This step presents a directory.",
      directory: "src"
    },
    {
      title: "View target",
      description: "This step focuses a workbench view.",
      view: "explorer"
    },
    {
      title: "Missing file",
      description: "This step targets a file which is unavailable.",
      file: "src/gone.ts",
      line: 2
    }
  ]
};

async function startTour() {
  host.setFileContent(
    "src/player.ts",
    ["import { store } from \"./store\";", "startPlayer();", "const rule = 1;"].join(
      "\n"
    )
  );
  await host.vscode.commands.executeCommand("codetourIA.startTour", tour);
  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
}

function activeAnchorType() {
  return host.decorationTypes.find(
    type => (type.options.gutterIconPath as Uri).toString() === SMALL_ICON_URL
  );
}

function anchorRanges() {
  const type = activeAnchorType()!;
  return host.visibleTextEditors.flatMap(editor =>
    (editor.decorations.get(type) ?? []).map(range => ({
      path: editor.document.uri.path,
      line: range.start.line
    }))
  );
}

function anchorFreeEditorPaths() {
  return host.visibleTextEditors.map(editor => editor.document.uri.toString());
}

test("a step without any code anchor stays readable and invents no marker", async () => {
  registerPlayerModule(host.extensionContext);
  await startTour();

  await host.waitFor(() => host.panelHtml().includes("File entry"));
  assert.equal(anchorRanges().length, 1);

  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("No anchor"));

  // The step is readable in the panel and nothing is anchored or opened.
  assert.match(host.panelHtml(), /This step explains without any code anchor\./);
  assert.match(host.panelHtml(), /class="anchor">Presentation</);
  assert.equal(anchorRanges().length, 0);
  assert.equal(anchorFreeEditorPaths().length, 1);
  assert.equal(host.liveThreads().length, 0);

  // The tour continues after the unanchored step.
  await host.vscode.commands.executeCommand("codetourIA.previousTourStep");
  await host.waitFor(() => host.panelHtml().includes("File entry"));
  assert.equal(anchorRanges().length, 1);
});

test("directory and view steps keep their target behavior without any marker", async () => {
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("No anchor"));

  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("Directory target"));

  // The directory is revealed in the explorer and no anchor is invented.
  assert.match(host.panelHtml(), /class="anchor">src</);
  const reveal = host.executedCommands.find(
    ([id]) => id === "revealInExplorer"
  );
  assert.ok(reveal, "the directory is revealed in the explorer");
  assert.equal((reveal![1][0] as Uri).path, "/workspace/src");
  assert.equal(anchorRanges().length, 0);
  assert.equal(anchorFreeEditorPaths().length, 1);

  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("View target"));

  // The configured view is focused, again without any anchor.
  assert.match(host.panelHtml(), /class="anchor">explorer</);
  assert.ok(
    host.executedCommands.some(([id, args]) => id === "workbench.view.explorer"),
    "the view command is executed"
  );
  assert.equal(anchorRanges().length, 0);
  assert.equal(anchorFreeEditorPaths().length, 1);
});

test("an unavailable file keeps the current step readable and the tour going", async () => {
  // The previous test left the tour on the view step; the next one is the
  // step whose file is missing.
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("Missing file"));

  // The panel shows the current step, not a stale one, and warns the reader.
  await host.waitFor(() =>
    host.messages.some(message =>
      message.includes("file unavailable: src/gone.ts")
    )
  );
  assert.match(
    host.panelHtml(),
    /This step targets a file which is unavailable\./
  );
  assert.equal(anchorRanges().length, 0);
  assert.ok(
    !anchorFreeEditorPaths().some(path => path.includes("src/gone.ts")),
    "the unavailable file is not opened"
  );
  assert.equal(host.liveThreads().length, 0);

  // The tour continues after the missing file.
  await host.vscode.commands.executeCommand("codetourIA.previousTourStep");
  await host.waitFor(() => host.panelHtml().includes("View target"));
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("Missing file"));
  assert.equal(store.activeTour.step, 4);
});

test("URI and embedded-content steps show the logo at their explicit anchor", async () => {
  for (const step of [
    { uri: "file:///workspace/src/player.ts", line: 2, description: "URI anchor" },
    { contents: "first\nsecond\nthird", line: 2, description: "Embedded anchor" }
  ]) {
    await host.vscode.commands.executeCommand("codetourIA.startTour", { ...tour, steps: [step] });
    await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
    await host.waitFor(() => host.panelHtml().includes(step.description));
    const anchors = anchorRanges();
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].line, 1);
    assert.equal(host.liveThreads().length, 0);
    await host.vscode.commands.executeCommand("codetourIA.endTour");
  }
});
