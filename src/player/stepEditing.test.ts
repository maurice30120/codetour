import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost, Uri } from "../test/vscodeHost";

// Editing is owned by the extension; the webview only reads saved content.
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

const { registerRecorderCommands } = require("../recorder/commands");
const { registerPlayerModule } = require("../player");
const { store } = require("../store");
const { startCodeTour } = require("../store/actions");
const { getStepDraft, getEditingSession } = require("../player/stepEditing");

const tour = {
  id: "file:///workspace/.tours/editing.tour",
  title: "1 - Editing Tour",
  description: "A tour with editable steps",
  steps: [
    {
      title: "Editable step",
      description: [
        "Registered intro.",
        "",
        "**Diagram — Flow**",
        "",
        "```mermaid",
        "flowchart TD",
        "    Start --> Done",
        "```",
        "",
        "Registered outro."
      ].join("\n"),
      file: "src/player.ts",
      line: 3
    },
    {
      title: "Second step",
      description: "Second registered content.",
      file: "src/player.ts",
      line: 4
    }
  ]
};

const readOnlyTour = {
  id: "file:///workspace/.tours/readonly.tour",
  title: "2 - Read Only Tour",
  description: "A tour without edit permissions",
  steps: [
    {
      title: "Read only step",
      description: "Locked content.",
      file: "src/player.ts",
      line: 3
    }
  ]
};

const draftText = [
  "Draft intro.",
  "",
  "**Diagram — Draft**",
  "",
  "```mermaid",
  "flowchart TD",
  "    Draft --> Preview",
  "```",
  "",
  "Draft outro."
].join("\n");

function seedWorkspace() {
  host.setFileContent(
    "src/player.ts",
    [
      'import { store } from "./store";',
      "",
      "startPlayer();",
      "// anchor line",
      "// second anchor line"
    ].join("\n")
  );
}

async function startTour() {
  seedWorkspace();
  await host.vscode.commands.executeCommand("codetour.startTour", tour);
  await host.vscode.commands.executeCommand("codetour.showStepDescription");
}

function panel() {
  return host.livePanels("codetour.tour")[0]!;
}


// The store holds an observable copy of the tour fixture, so in-memory
// assertions read the registered content through the active tour.
function storeStepDescription(step: number): string {
  return store.activeTour!.tour.steps[step].description;
}

async function readTourFile(tourId: string) {
  const bytes = await host.vscode.workspace.fs.readFile(Uri.parse(tourId));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function sourceEditor() {
  return [...host.visibleTextEditors].reverse().find(editor => editor.document.uri.scheme === "untitled" && editor.document.getText() === getStepDraft(tour.id, 0));
}
async function editSource(text: string) {
  const before = host.visibleTextEditors.filter(item => item.document.uri.scheme === "untitled").length;
  await host.vscode.commands.executeCommand("codetour.editTour");
  await host.waitFor(() => host.visibleTextEditors.filter(item => item.document.uri.scheme === "untitled").length > before);
  await host.waitFor(() => !!sourceEditor());
  const editor = sourceEditor()!;
  await editor.edit(edit => edit.replace(new host.vscode.Range(0, 0, editor.document.lineCount, 0), text));
}

test("the expanded view ignores editing and mutation messages", async () => {
  registerPlayerModule(host.extensionContext);
  registerRecorderCommands();
  await startTour();
  await host.waitFor(() => host.panelHtml().includes("1 / 2"));
  assert.doesNotMatch(host.panelHtml(), /<textarea|data-action="(?:edit|save|cancel)"/);
  for (const type of ["finish", "code", "edit", "draft", "save", "cancel", "editCommand"]) {
    panel().receive({ type, tour: tour.id, step: 0, text: "Forbidden mutation", command: "codetour.changeTourStepTitle" });
  }
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(store.activeTour.step, 0);
  assert.equal(store.isEditing, false);
  assert.equal(getStepDraft(tour.id, 0), undefined);
  assert.match(storeStepDescription(0), /Registered intro/);
});

test("native editing saves exact Markdown and Mermaid source for expanded reading", async () => {
  await editSource(draftText);
  assert.equal(host.livePanels("codetour.tour").length, 0);
  assert.equal(host.liveThreads().length, 1);
  assert.equal(store.isEditing, true);
  assert.equal(getStepDraft(tour.id, 0), draftText);
  assert.match(storeStepDescription(0), /Registered intro/);
  await host.vscode.commands.executeCommand("codetour.saveTourStep");
  const saved = await readTourFile(tour.id);
  assert.equal(saved.steps[0].description, draftText);
  assert.equal("id" in saved, false);
  assert.equal(getEditingSession(), undefined);
  await host.vscode.commands.executeCommand("codetour.showStepDescription");
  await host.waitFor(() => host.panelHtml().includes("Draft intro."), 5000);
  assert.match(host.panelHtml(), /alt="Diagram — Draft"/);
  assert.equal(host.liveThreads().length, 0);
});

test("cancel restores the saved source without a tour write", async () => {
  const writes = host.fileWrites.length;
  await editSource("Cancelled draft");
  const editor = sourceEditor()!;
  await host.vscode.commands.executeCommand("codetour.cancelTourStepEditing");
  await host.waitFor(() => editor.document.getText() === draftText);
  assert.equal(getStepDraft(tour.id, 0), undefined);
  assert.equal(store.isEditing, false);
  assert.equal(host.fileWrites.length, writes);
});

test("a save failure preserves native typing for a retry", async () => {
  await editSource("Retry draft");
  host.failWrite("/workspace/.tours/editing.tour");
  await host.vscode.commands.executeCommand("codetour.saveTourStep");
  assert.ok(host.messages.some(message => message.includes("Unable to save")));
  assert.equal(getStepDraft(tour.id, 0), "Retry draft");
  assert.equal(store.isEditing, true);
  assert.equal(sourceEditor()!.document.getText(), "Retry draft");
  assert.equal((await readTourFile(tour.id)).steps[0].description, draftText);
  host.allowWrite("/workspace/.tours/editing.tour");
  await host.vscode.commands.executeCommand("codetour.saveTourStep");
  assert.equal((await readTourFile(tour.id)).steps[0].description, "Retry draft");
  await host.vscode.commands.executeCommand("codetour.endTour");
});

test("read-only tours reject editing from the extension", async () => {
  await startCodeTour(readOnlyTour, undefined, undefined, false, false);
  await host.vscode.commands.executeCommand("codetour.showStepDescription");
  await host.waitFor(() => host.panelHtml().includes("Read only step"));
  await host.vscode.commands.executeCommand("codetour.editTour");
  assert.equal(store.canEditTour, false);
  assert.equal(store.isEditing, false);
  assert.ok(host.messages.some(message => message.includes("cannot be edited")));
  assert.equal(storeStepDescription(0), "Locked content.");
  await host.vscode.commands.executeCommand("codetour.endTour");
});
