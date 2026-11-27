import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost } from "../test/vscodeHost";
const host = createVscodeHost({ configuration: { codetour: { showMarkers: false } } });
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
  await host.vscode.commands.executeCommand("codetourIA.startTour", tour);
  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
  await host.waitFor(() => host.panelHtml().includes("<h1>First</h1>"));
}
function sourceEditor() {
  const { getStepDraft } = require("./stepEditing");
  return [...host.visibleTextEditors].reverse().find(editor => editor.document.uri.scheme === "untitled" && editor.document.getText() === getStepDraft(tour.id, store.activeTour.step));
}
async function typeSource(text: string) {
  const editor = sourceEditor()!;
  await editor.edit(edit => edit.replace(new host.vscode.Range(0, 0, editor.document.lineCount, 0), text));
}
async function draft(text: string) {
  const before = host.visibleTextEditors.filter(item => item.document.uri.scheme === "untitled").length;
  await host.vscode.commands.executeCommand("codetourIA.editTour");
  await host.waitFor(() => host.visibleTextEditors.filter(item => item.document.uri.scheme === "untitled").length > before);
  await host.waitFor(() => !!sourceEditor());
  await typeSource(text);
}

test("editing from the extension closes expanded view and saves native Markdown", async () => {
  registerPlayerModule(host.extensionContext);
  registerRecorderCommands();
  await start();
  await draft("Typed native draft");
  assert.equal(store.isExpandedViewOpen, false);
  assert.equal(host.livePanels("codetour.tour").length, 0);
  assert.equal(host.liveThreads().length, 1);
  assert.equal(host.fileWrites.length, 0);
  await host.vscode.commands.executeCommand("codetourIA.saveTourStep");
  assert.equal(store.activeTour.tour.steps[0].description, "Typed native draft");
  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
  await host.waitFor(() => host.panelHtml().includes("Typed native draft"));
  assert.equal(host.liveThreads().length, 0);
});

test("all messages from a previous render are rejected", async () => {
  const oldToken = host.panelHtml().match(/data-token="([^"]+)"/)![1];
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.panelHtml().includes("<h1>Second</h1>"));
  for (const type of ["previous", "next", "finish", "edit", "editCommand", "openLink"]) {
    panel().receive({ type, token: oldToken, targetTourId: tour.id, step: 0,
      command: "codetourIA.moveTourStepBack", href: "command:codetourIA.endTour" });
  }
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(store.activeTour.step, 1);
  assert.equal(store.isEditing, false);
  assert.equal(store.activeTour.tour.steps[1].title, "Second");
  await host.vscode.commands.executeCommand("codetourIA.endTour");
});

test("a pending failed save blocks navigation and keeps registered content", async () => {
  await start();
  await draft("Pending draft");
  const originalWrite = host.vscode.workspace.fs.writeFile;
  let rejectWrite!: (error: Error) => void;
  host.vscode.workspace.fs.writeFile = async () => new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
  const saving = host.vscode.commands.executeCommand("codetourIA.saveTourStep");
  await host.waitFor(() => !!rejectWrite);
  const move = host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  assert.equal(store.activeTour.tour.steps[0].description, "Original first");
  rejectWrite(new Error("disk failure"));
  await Promise.all([move, saving]);
  await host.waitFor(() => host.messages.some(message => message.includes("Unable to save")));
  assert.equal(store.activeTour.step, 0);
  assert.equal(store.isEditing, true);
  host.vscode.workspace.fs.writeFile = originalWrite;
  assert.equal(sourceEditor()!.document.getText(), "Pending draft");
  await host.vscode.commands.executeCommand("codetourIA.cancelTourStepEditing");
  await host.waitFor(() => !store.isEditing);
});

test("tree step editing uses the native editor and reorder honours draft cancellation", async () => {
  const before = host.visibleTextEditors.filter(item => item.document.uri.scheme === "untitled").length;
  await host.vscode.commands.executeCommand("codetourIA.editTourAtStep", { tour: store.activeTour.tour, stepNumber: 0 });
  await host.waitFor(() => host.visibleTextEditors.filter(item => item.document.uri.scheme === "untitled").length > before);
  await host.waitFor(() => !!sourceEditor());
  assert.equal(store.isRecording, false);
  assert.equal(host.liveThreads().length, 1);
  await typeSource("Owned first draft");
  host.respondToModal("Cancel");
  await host.vscode.commands.executeCommand("codetourIA.moveTourStepForward", { tour: store.activeTour.tour, stepNumber: 0 });
  assert.equal(store.activeTour.tour.steps[0].title, "First");
  host.respondToModal("Save");
  await host.vscode.commands.executeCommand("codetourIA.moveTourStepForward", { tour: store.activeTour.tour, stepNumber: 0 });
  assert.equal(store.activeTour.tour.steps[1].description, "Owned first draft");
  assert.equal(store.activeTour.tour.steps[0].description, "Original second");
  assert.equal(store.activeTour.step, 1);
  await host.vscode.commands.executeCommand("codetourIA.endTour");
});

test("typing during a successful save preserves the newer unsaved draft", async () => {
  await start();
  await draft("Saved snapshot");
  const originalWrite = host.vscode.workspace.fs.writeFile;
  let releaseWrite!: () => Promise<void>;
  host.vscode.workspace.fs.writeFile = async (uri, bytes) => new Promise<void>(resolve => {
    releaseWrite = async () => { await originalWrite(uri, bytes); resolve(); };
  });
  const saving = host.vscode.commands.executeCommand("codetourIA.saveTourStep");
  await host.waitFor(() => !!releaseWrite);
  await typeSource("Newer unsaved typing");
  await releaseWrite();
  await saving;
  host.vscode.workspace.fs.writeFile = originalWrite;
  await host.waitFor(() => store.activeTour.tour.steps[0].description === "Saved snapshot");
  assert.equal(sourceEditor()!.document.getText(), "Newer unsaved typing");
  assert.equal(store.isEditing, true);
  assert.ok(sourceEditor());
  host.respondToModal("Cancel");
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  assert.equal(store.activeTour.step, 0);
  await host.vscode.commands.executeCommand("codetourIA.saveTourStep");
  assert.equal(store.activeTour.tour.steps[0].description, "Newer unsaved typing");
  assert.equal(store.isEditing, false);
  await host.vscode.commands.executeCommand("codetourIA.endTour");
});


test("Save from the exit prompt preserves typing newer than its disk snapshot", async () => {
  await start();
  await draft("Exit saved snapshot");
  const originalWrite = host.vscode.workspace.fs.writeFile;
  let releaseWrite!: () => Promise<void>;
  host.vscode.workspace.fs.writeFile = async (uri, bytes) => new Promise<void>(resolve => {
    releaseWrite = async () => { await originalWrite(uri, bytes); resolve(); };
  });
  host.respondToModal("Save");
  const move = host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => !!releaseWrite);
  await typeSource("Typing during exit save");
  await releaseWrite();
  host.vscode.workspace.fs.writeFile = originalWrite;
  await move;
  assert.equal(store.activeTour.step, 0);
  assert.equal(store.isEditing, true);
  assert.equal(store.activeTour.tour.steps[0].description, "Exit saved snapshot");
  assert.equal(sourceEditor()!.document.getText(), "Typing during exit save");
  await host.vscode.commands.executeCommand("codetourIA.saveTourStep");
  assert.equal(store.activeTour.tour.steps[0].description, "Typing during exit save");
  await host.vscode.commands.executeCommand("codetourIA.endTour");
});

test("tree Edit cannot widen the active tour's read-only permission", async () => {
  const { startCodeTour } = require("../store/actions");
  await startCodeTour(tour, 0, undefined, false, false);
  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
  await host.waitFor(() => host.panelHtml().includes("<h1>First</h1>"));
  const activeTour = store.activeTour.tour;
  await host.vscode.commands.executeCommand("codetourIA.editTourAtStep", { tour: activeTour, stepNumber: 1 });
  assert.equal(store.canEditTour, false);
  assert.equal(store.isEditing, false);
  assert.equal(store.activeTour.step, 0);
  assert.equal(host.liveThreads().length, 0);
  assert.doesNotMatch(host.panelHtml(), /tour-step-source/);
  await host.vscode.commands.executeCommand("codetourIA.endTour");
});

test("reentering native editing never replaces typing while its source is revealed", async () => {
  await start();
  await draft("Before refresh");
  const source = sourceEditor()!;
  const originalShow = host.vscode.window.showTextDocument;
  let release!: () => void;
  let refreshed = false;
  host.vscode.window.showTextDocument = async (...args) => {
    await new Promise<void>(resolve => { release = resolve; });
    const result = await originalShow(...args);
    refreshed = true;
    return result;
  };
  try {
    const reentry = host.vscode.commands.executeCommand("codetourIA.editTour");
    await host.waitFor(() => !!release);
    await typeSource("Typing during refresh");
    release();
    await reentry;
    await host.waitFor(() => refreshed);
    assert.equal(source.document.getText(), "Typing during refresh");
    assert.equal(sourceEditor()!.document.getText(), "Typing during refresh");
  } finally {
    host.vscode.window.showTextDocument = originalShow;
  }
  await host.vscode.commands.executeCommand("codetourIA.cancelTourStepEditing");
  await host.vscode.commands.executeCommand("codetourIA.endTour");
});

test("reopening a closed native document retains its unsaved draft", async () => {
  await start();
  await draft("Draft before closing");
  const source = sourceEditor()!;
  Object.defineProperty(source.document, "isClosed", { value: true });
  host.visibleTextEditors.splice(host.visibleTextEditors.indexOf(source), 1);
  await host.vscode.commands.executeCommand("codetourIA.editTour");
  const reopened = sourceEditor()!;
  assert.notEqual(reopened.document, source.document);
  assert.equal(reopened.document.getText(), "Draft before closing");
  assert.equal(store.isEditing, true);
  await host.vscode.commands.executeCommand("codetourIA.cancelTourStepEditing");
  await host.vscode.commands.executeCommand("codetourIA.endTour");
});

test("expanded reading has a single panel and ending clears its presentation state", async () => {
  await start();
  const first = panel();
  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
  assert.equal(panel(), first);
  assert.equal(host.livePanels("codetour.tour").length, 1);
  await host.vscode.commands.executeCommand("codetourIA.endTour");
  assert.equal(store.isExpandedViewOpen, false);
  await host.vscode.commands.executeCommand("codetourIA.startTour", tour);
  await host.waitFor(() => host.liveThreads().length === 1);
  assert.equal(host.livePanels("codetour.tour").length, 0);
  await host.vscode.commands.executeCommand("codetourIA.endTour");
});

test("cancel waits for a pending save before discarding newer typing", async () => {
  await start();
  await draft("Saved before cancellation");
  const source = sourceEditor()!;
  const originalWrite = host.vscode.workspace.fs.writeFile;
  let release!: () => Promise<void>;
  host.vscode.workspace.fs.writeFile = async (uri, bytes) => new Promise<void>(resolve => {
    release = async () => { await originalWrite(uri, bytes); resolve(); };
  });
  try {
    const saving = host.vscode.commands.executeCommand("codetourIA.saveTourStep");
    await host.waitFor(() => !!release);
    await typeSource("Newer typing to discard");
    const cancelling = host.vscode.commands.executeCommand("codetourIA.cancelTourStepEditing");
    assert.equal(store.isEditing, true);
    await release();
    await Promise.all([saving, cancelling]);
    assert.equal(store.activeTour.tour.steps[0].description, "Saved before cancellation");
    assert.equal(source.document.getText(), "Saved before cancellation");
    assert.equal(store.isEditing, false);
  } finally {
    host.vscode.workspace.fs.writeFile = originalWrite;
  }
  await host.vscode.commands.executeCommand("codetourIA.endTour");
});
