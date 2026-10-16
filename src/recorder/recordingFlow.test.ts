import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost } from "../test/vscodeHost";

// The delivery-level checks that the existing recording flows keep working
// next to the parallel playback mode: recording a brand new tour, editing
// and previewing the active one. The webview preference must never move
// the recorder, whose flows build on the native comment threads.
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
const { registerRecorderModule } = require("../recorder");
const { store } = require("../store");

const tour = {
  id: "file:///workspace/.tours/editable.tour",
  title: "1 - Editable Tour",
  description: "A tour the recorder can edit",
  steps: [
    {
      title: "Editable step",
      description: "Registered editable content.",
      file: "src/player.ts",
      line: 3
    }
  ]
};

function seedWorkspace() {
  host.setFileContent(
    "src/player.ts",
    ['import { store } from "./store";', "", "startPlayer();"].join("\n")
  );
  const { id, ...persisted } = tour;
  host.setFileContent(
    id.replace("file://", ""),
    JSON.stringify(
      { $schema: "https://aka.ms/codetour-schema", ...persisted },
      null,
      2
    )
  );
}

async function startTour() {
  seedWorkspace();
  await host.vscode.commands.executeCommand("codetourIA.startTour", tour);
}

test("recording a new tour keeps the native flow", async () => {
  registerPlayerModule(host.extensionContext);
  registerRecorderModule();

  // The recording command asks for the tour title through the standard
  // input box, exactly like before the parallel playback mode.
  host.vscode.commands.executeCommand("codetourIA.recordTour");
  await host.waitFor(() => host.inputBoxes().length === 1);
  host.inputBoxes()[0].accept("Recorded Tour");
  await host.waitFor(() => store.isRecording === true, 5000);

  // The empty tour file was created in the usual workspace location, with
  // the title normalized like the recorder has always done.
  assert.ok(
    host.fileWrites.some(([path]) =>
      path.endsWith("/.tours/recorded-tour.tour")
    ),
    "the recording writes the tour file"
  );

  // The recorder owns the native comment flow: the webview preference
  // never presents a reading panel during a recording session.
  assert.equal(store.isRecording, true);
  assert.equal(store.isEditing, true);
  assert.equal(host.contexts.get("codetour:recording"), true);
  assert.equal(host.livePanels("codetour.tour").length, 0);
  assert.equal(store.activeTour!.tour.title, "Recorded Tour");

  // The commenting ranges are available for the author's next step, like
  // in the native recording flow.
  assert.ok(host.liveThreads().length === 0 || store.activeTour!.step === -1);

  // Ending the tour ends the recording session cleanly.
  await host.vscode.commands.executeCommand("codetourIA.endTour");
  assert.equal(store.isRecording, false);
  assert.equal(store.activeTour, null);
  assert.equal(host.contexts.get("codetour:inTour"), false);
});

test("editing and previewing the active tour keep working next to the webview mode", async () => {
  await startTour();

  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
  await host.waitFor(() => host.panelHtml().includes("1 / 1"), 5000);
  assert.equal(host.livePanels("codetour.tour").length, 1);

  await host.vscode.commands.executeCommand("codetourIA.editTour");
  await host.waitFor(() => host.visibleTextEditors.some(editor => editor.document.uri.scheme === "untitled"));
  assert.equal(store.isRecording, false);
  assert.equal(store.isEditing, true);
  assert.equal(host.liveThreads().length, 1);

  await host.vscode.commands.executeCommand("codetourIA.previewTour");
  await host.waitFor(() => host.liveThreads()[0]?.comments[0]?.body.value.includes("Registered editable content."));
  assert.equal(store.isRecording, false);
  assert.equal(store.isEditing, false);
  assert.equal(host.liveThreads().length, 1);
  assert.equal(host.livePanels("codetour.tour").length, 0);
  await host.vscode.commands.executeCommand("codetourIA.endTour");
});
