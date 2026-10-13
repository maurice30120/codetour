import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost, CommentMode } from "../test/vscodeHost";

// The delivery-level checks that the existing recording flows keep working
// next to the parallel playback mode: recording a brand new tour, editing
// and previewing the active one. The webview preference must never move
// the recorder, whose flows build on the native comment threads.
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
  await host.vscode.commands.executeCommand("codetour.startTour", tour);
}

test("recording a new tour keeps the native flow under a webview preference", async () => {
  registerPlayerModule(host.extensionContext);
  registerRecorderModule();

  // The recording command asks for the tour title through the standard
  // input box, exactly like before the parallel playback mode.
  host.vscode.commands.executeCommand("codetour.recordTour");
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
  await host.vscode.commands.executeCommand("codetour.endTour");
  assert.equal(store.isRecording, false);
  assert.equal(store.activeTour, null);
  assert.equal(host.contexts.get("codetour:inTour"), false);
});

test("editing and previewing the active tour keep working next to the webview mode", async () => {
  await startTour();

  // The tour reads in the webview panel, per the preference.
  await host.waitFor(() => host.panelHtml().includes("1 / 1"), 5000);
  assert.equal(host.livePanels("codetour.tour").length, 1);

  // The existing edit command moves the tour into the recorder's native
  // editing flow: an editing comment thread, no reading panel.
  await host.vscode.commands.executeCommand("codetour.editTour");
  await host.waitFor(() => host.liveThreads().length === 1);
  assert.equal(store.isRecording, true);
  assert.equal(store.isEditing, true);
  assert.equal(host.livePanels("codetour.tour").length, 0);
  assert.equal(host.liveThreads()[0].comments[0].mode, CommentMode.Editing);

  // The existing preview command restores the reading presentation inside
  // the recording session, which keeps the native comment threads by
  // design: the thread is back in preview mode, not the panel.
  await host.vscode.commands.executeCommand("codetour.previewTour");
  await host.waitFor(() =>
    host.liveThreads().some(thread =>
      thread.comments.some(comment => comment.mode === CommentMode.Preview)
    )
  );
  assert.equal(store.isRecording, true);
  assert.equal(store.isEditing, false);
  assert.equal(host.livePanels("codetour.tour").length, 0);

  // Ending the recording session and starting the tour again reads it in
  // the webview panel once more, per the unchanged preference.
  await host.vscode.commands.executeCommand("codetour.endTour");
  assert.equal(store.isRecording, false);
  await startTour();
  await host.waitFor(() => host.panelHtml().includes("1 / 1"), 5000);
  assert.equal(host.liveThreads().length, 0);
  assert.equal(host.livePanels("codetour.tour").length, 1);
});
