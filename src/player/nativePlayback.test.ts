import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost } from "../test/vscodeHost";

const host = createVscodeHost();

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

test("the native reader presents steps through comment threads", async () => {
  registerPlayerModule(host.extensionContext);
  await startTour();

  await host.waitFor(() =>
    host.liveThreads()[0]?.comments[0]?.body.value.includes(
      "The player starts here."
    )
  );
  const thread = host.liveThreads()[0];
  assert.equal(thread.uri.path, "/workspace/src/player.ts");
  // The preserved default places the comment above its source anchor.
  assert.equal(thread.range.start.line, 1);
  assert.equal(host.editorFor("src/player.ts")!.selection.start.line, 2);
  assert.match(
    thread.comments[0].body.value,
    /The player starts here\./
  );
  assert.match(thread.comments[0].body.value, /command:codetour\.nextTourStep/);
  assert.equal(thread.contextValue, "hasNext");
  assert.equal(host.contexts.get("codetour:inTour"), true);

  // The step's file is revealed and no webview panel exists.
  const editor = host.editorFor("src/player.ts");
  assert.ok(editor, "the step file is open in an editor");
  await host.waitFor(() => editor!.revealedRanges.length === 1);
  assert.equal(host.livePanels().length, 0);

  // Navigation reuses the same actions and progression as before.
  await host.vscode.commands.executeCommand("codetour.nextTourStep");
  await host.waitFor(() =>
    host.liveThreads()[0]?.comments[0]?.body.value.includes(
      "The selection anchors this rule."
    )
  );
  const selectionThread = host.liveThreads()[0];
  assert.match(
    selectionThread.comments[0].body.value,
    /The selection anchors this rule\./
  );
  assert.equal(selectionThread.contextValue, "hasPrevious.hasNext");

  await host.vscode.commands.executeCommand("codetour.previousTourStep");
  await host.waitFor(() =>
    host.liveThreads()[0]?.comments[0]?.body.value.includes(
      "The player starts here."
    )
  );
  assert.equal(host.contexts.get("codetour:hasProgress"), true);

  // Finishing the tour removes the thread and the in-tour context.
  await host.vscode.commands.executeCommand("codetour.finishTour");
  await host.waitFor(() => store.activeTour === null);
  assert.equal(host.liveThreads().length, 0);
  assert.equal(host.contexts.get("codetour:inTour"), false);
});


test("the native comment position preference preserves the source selection", async () => {
  await host.vscode.workspace.getConfiguration("codetour").update("commentPosition", "below", host.vscode.ConfigurationTarget.Workspace);
  await startTour();
  await host.waitFor(() => host.liveThreads()[0]?.comments.length === 1);
  assert.equal(host.liveThreads()[0].range.start.line, 2);
  assert.equal(host.editorFor("src/player.ts")!.selection.start.line, 2);
  await host.vscode.workspace.getConfiguration("codetour").update("commentPosition", "above", host.vscode.ConfigurationTarget.Workspace);
  await startTour();
  await host.waitFor(() => host.liveThreads()[0]?.comments.length === 1);
  assert.equal(host.liveThreads()[0].range.start.line, 1);
  assert.equal(host.editorFor("src/player.ts")!.selection.start.line, 2);
  await host.vscode.commands.executeCommand("codetour.endTour");
});
