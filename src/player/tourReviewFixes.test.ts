import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost } from "../test/vscodeHost";
const host = createVscodeHost({ configuration: { codetour: { playbackMode: "webview", showMarkers: false } } });
const moduleLoader = nodeModule as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
const originalLoad = moduleLoader._load;
moduleLoader._load = function(request: string, ...args: unknown[]) {
  return request === "vscode" ? host.vscode : originalLoad.apply(this, [request, ...args]);
};
const { registerPlayerModule } = require("../player");
const { registerRecorderCommands } = require("../recorder/commands");
const { store } = require("../store");
const tour = { id: "file:///workspace/.tours/review.tour", title: "Review", steps: [
  { title: "First", file: "source.ts", line: 1, description: "Original first" },
  { title: "Second", file: "source.ts", line: 2, description: "Original second" }
] };
const panel = () => host.livePanels("codetour.tour")[0]!;
async function start() {
  host.setFileContent("source.ts", "first\nsecond\n");
  await host.vscode.commands.executeCommand("codetour.startTour", tour);
  await host.waitFor(() => host.panelHtml().includes("<h1>First</h1>"));
}
async function draft(text: string) {
  panel().receive({ type: "edit" });
  await host.waitFor(() => host.panelHtml().includes("tour-step-source"));
  panel().receive({ type: "draft", tour: tour.id, step: 0, text });
  await host.waitFor(() => host.postedMessages().some((message: unknown) => (message as { html?: string }).html?.includes(text)));
}

test("native typing transfers both directions without an implicit tour write", async () => {
  registerPlayerModule(host.extensionContext);
  registerRecorderCommands();
  await start();
  await draft("WebView draft");
  await host.vscode.commands.executeCommand("codetour.togglePlaybackMode");
  await host.waitFor(() => host.visibleTextEditors.some(editor => editor.document.uri.scheme === "untitled"));
  const source = host.visibleTextEditors.find(editor => editor.document.uri.scheme === "untitled")!;
  assert.equal(source.document.getText(), "WebView draft");
  await source.edit(edit => edit.replace(new host.vscode.Range(0, 0, 1, 0), "Typed native draft"));
  await host.vscode.commands.executeCommand("codetour.togglePlaybackMode");
  await host.waitFor(() => host.panelHtml().includes("Typed native draft"));
  assert.equal(host.fileWrites.length, 0);
  assert.equal(host.liveThreads().length, 0);
  panel().receive({ type: "cancel", tour: tour.id, step: 0 });
  await host.waitFor(() => !store.isEditing);
});

test("all messages from a previous render are rejected", async () => {
  const oldToken = host.panelHtml().match(/data-token="([^"]+)"/)![1];
  await host.vscode.commands.executeCommand("codetour.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("<h1>Second</h1>"));
  for (const type of ["previous", "next", "finish", "edit", "editCommand", "openLink"]) {
    panel().receive({ type, token: oldToken, targetTourId: tour.id, step: 0,
      command: "codetour.moveTourStepBack", href: "command:codetour.endTour" });
  }
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(store.activeTour.step, 1);
  assert.equal(store.isEditing, false);
  assert.equal(store.activeTour.tour.steps[1].title, "Second");
  await host.vscode.commands.executeCommand("codetour.endTour");
});

test("a pending failed save blocks navigation and keeps registered content", async () => {
  await start();
  await draft("Pending draft");
  const originalWrite = host.vscode.workspace.fs.writeFile;
  let rejectWrite!: (error: Error) => void;
  host.vscode.workspace.fs.writeFile = async () => new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
  panel().receive({ type: "save", tour: tour.id, step: 0, text: "Pending draft" });
  await host.waitFor(() => !!rejectWrite);
  const move = host.vscode.commands.executeCommand("codetour.nextTourStep");
  assert.equal(store.activeTour.tour.steps[0].description, "Original first");
  rejectWrite(new Error("disk failure"));
  await move;
  await host.waitFor(() => host.messages.some(message => message.includes("Unable to save")));
  assert.equal(store.activeTour.step, 0);
  assert.equal(store.isEditing, true);
  host.vscode.workspace.fs.writeFile = originalWrite;
  await host.waitFor(() => host.panelHtml().includes("Pending draft"));
  panel().receive({ type: "cancel", tour: tour.id, step: 0 });
  await host.waitFor(() => !store.isEditing);
});

test("tree step editing stays in WebView and reorder honours draft cancellation", async () => {
  await host.vscode.commands.executeCommand("codetour.editTourAtStep", { tour: store.activeTour.tour, stepNumber: 0 });
  await host.waitFor(() => host.panelHtml().includes("tour-step-source"));
  assert.equal(store.isRecording, false);
  assert.equal(host.liveThreads().length, 0);
  panel().receive({ type: "draft", tour: tour.id, step: 0, text: "Owned first draft" });
  await host.waitFor(() => host.postedMessages().some((message: unknown) => (message as { html?: string }).html?.includes("Owned first draft")));
  host.respondToModal("Cancel");
  await host.vscode.commands.executeCommand("codetour.moveTourStepForward", { tour: store.activeTour.tour, stepNumber: 0 });
  assert.equal(store.activeTour.tour.steps[0].title, "First");
  host.respondToModal("Save");
  await host.vscode.commands.executeCommand("codetour.moveTourStepForward", { tour: store.activeTour.tour, stepNumber: 0 });
  assert.equal(store.activeTour.tour.steps[1].description, "Owned first draft");
  assert.equal(store.activeTour.tour.steps[0].description, "Original second");
  assert.equal(store.activeTour.step, 1);
  await host.vscode.commands.executeCommand("codetour.endTour");
});

test("changing the real preference updates the active presentation", async () => {
  await start();
  await host.vscode.workspace.getConfiguration("codetour").update("playbackMode", "comments", host.vscode.ConfigurationTarget.Workspace);
  await host.waitFor(() => host.liveThreads().length === 1);
  assert.equal(store.playbackMode, "comments");
  await host.vscode.workspace.getConfiguration("codetour").update("playbackMode", "webview", host.vscode.ConfigurationTarget.Workspace);
  await host.waitFor(() => host.livePanels("codetour.tour").length === 1);
  assert.equal(host.liveThreads().length, 0);
  await host.vscode.commands.executeCommand("codetour.endTour");
});


test("an older Mermaid preview never replaces newer plain text", async () => {
  await start();
  panel().receive({ type: "edit" });
  await host.waitFor(() => host.panelHtml().includes("tour-step-source"));
  const before = host.postedMessages().length;
  panel().receive({ type: "draft", tour: tour.id, step: 0, revision: 1,
    text: "**Diagram — Slow draft**\n\n```mermaid\nflowchart TD\nOld --> Slow\n```" });
  panel().receive({ type: "draft", tour: tour.id, step: 0, revision: 2, text: "Newest plain draft" });
  await host.waitFor(() => host.postedMessages().slice(before).some((message: unknown) => (message as { html?: string }).html?.includes("Newest plain draft")));
  await new Promise(resolve => setTimeout(resolve, 700));
  const previews = host.postedMessages().slice(before).filter((message: unknown) => (message as { type?: string }).type === "preview") as { html: string; revision: number }[];
  assert.equal(previews.length, 1);
  assert.match(previews[0].html, /Newest plain draft/);
  assert.equal(previews[0].revision, 2);
  await host.vscode.commands.executeCommand("codetour.cancelTourStepEditing");
  await host.vscode.commands.executeCommand("codetour.endTour");
});


test("typing during a successful save preserves the newer unsaved draft", async () => {
  await start();
  await draft("Saved snapshot");
  const originalWrite = host.vscode.workspace.fs.writeFile;
  let releaseWrite!: () => Promise<void>;
  host.vscode.workspace.fs.writeFile = async (uri, bytes) => new Promise<void>(resolve => {
    releaseWrite = async () => { await originalWrite(uri, bytes); resolve(); };
  });
  panel().receive({ type: "save", tour: tour.id, step: 0, text: "Saved snapshot" });
  await host.waitFor(() => !!releaseWrite);
  panel().receive({ type: "draft", tour: tour.id, step: 0, text: "Newer unsaved typing" });
  await host.waitFor(() => host.postedMessages().some((message: unknown) => (message as { html?: string }).html?.includes("Newer unsaved typing")));
  await releaseWrite();
  host.vscode.workspace.fs.writeFile = originalWrite;
  await host.waitFor(() => store.activeTour.tour.steps[0].description === "Saved snapshot");
  await host.waitFor(() => host.panelHtml().includes("Newer unsaved typing"));
  assert.equal(store.isEditing, true);
  assert.match(host.panelHtml(), /tour-step-source/);
  host.respondToModal("Cancel");
  await host.vscode.commands.executeCommand("codetour.nextTourStep");
  assert.equal(store.activeTour.step, 0);
  await host.vscode.commands.executeCommand("codetour.saveTourStep");
  assert.equal(store.activeTour.tour.steps[0].description, "Newer unsaved typing");
  assert.equal(store.isEditing, false);
  await host.vscode.commands.executeCommand("codetour.endTour");
});
