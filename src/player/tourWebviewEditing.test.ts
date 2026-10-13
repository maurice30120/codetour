import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost, Uri } from "../test/vscodeHost";

// The user-level checks for editing a step from the tour webview: entering
// the editor, editing text and mermaid blocks, previewing through the
// shared pipeline, saving to the existing tour file and reading the result
// back in both playback modes, cancelling, save failures and permission
// enforcement on the host side.
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
const { startCodeTour } = require("../store/actions");
const { getStepDraft, getEditingSession } = require("../player/tourDrafts");

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
}

function panel() {
  return host.livePanels("codetour.tour")[0]!;
}

function panelHtml() {
  return host.panelHtml();
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

type PanelMessage = { type?: string; html?: string };

function postedPreview(match: RegExp): PanelMessage | undefined {
  return host
    .postedMessages()
    .find(
      message =>
        (message as PanelMessage).type === "preview" &&
        !!(message as PanelMessage).html &&
        match.test((message as PanelMessage).html!)
    ) as PanelMessage | undefined;
}

async function enterEditing() {
  panel().receive({ type: "edit" });
  await host.waitFor(
    () => !!panelHtml().match(/<textarea id="tour-step-source"/)
  );
}

test("an editable tour presents the edit entry points in the panel", async () => {
  registerPlayerModule(host.extensionContext);
  await startTour();
  await host.waitFor(() => panelHtml().includes("1 / 2"));

  assert.equal(store.canEditTour, true);
  assert.match(panelHtml(), /data-action="edit"/);
  assert.match(panelHtml(), /data-command="codetour\.changeTourStepTitle"/);
});

test("entering edit shows the source, keeps the anchor only and no native thread", async () => {
  await enterEditing();

  // The registered content, mermaid fence included, is editable source text.
  assert.match(panelHtml(), /<textarea id="tour-step-source"/);
  assert.match(panelHtml(), /Registered intro\./);
  assert.match(panelHtml(), /```mermaid/);
  assert.match(panelHtml(), /data-action="save"[^>]*>Sauvegarder</);
  assert.match(panelHtml(), /data-action="cancel"[^>]*>Annuler</);

  // Editing never requires a native comment thread: the editor keeps only
  // the anchor decoration.
  assert.equal(store.isEditing, true);
  assert.equal(host.contexts.get("codetour:isEditing"), true);
  assert.equal(host.liveThreads().length, 0);

  // The initial preview renders the draft through the shared pipeline.
  await host.waitFor(() => !!panelHtml().match(/data:image\/png;base64/), 5000);
  assert.match(panelHtml(), /alt="Diagram — Flow"/);
  assert.equal(getStepDraft(tour.id, 0), storeStepDescription(0));
});

test("draft edits are kept in memory and previewed through the shared pipeline", async () => {
  panel().receive({ type: "draft", tour: tour.id, step: 0, text: draftText });

  await host.waitFor(() => !!postedPreview(/data:image\/png;base64/), 5000);
  const preview = postedPreview(/data:image\/png;base64/)!;
  const previewHtml = preview.html!;

  assert.match(previewHtml, /<p>Draft intro\.<\/p>/);
  assert.match(previewHtml, /<p>Draft outro\.<\/p>/);
  assert.match(previewHtml, /alt="Diagram — Draft"/);
  assert.doesNotMatch(previewHtml, /```mermaid/);

  // The draft is keyed by tour and step, independent of the panel, and the
  // registered content is untouched until an explicit save.
  assert.equal(getStepDraft(tour.id, 0), draftText);
  assert.match(storeStepDescription(0), /Registered intro\./);
  assert.equal(host.liveThreads().length, 0);
});

test("saving writes the existing tour file and reads back in both playback modes", async () => {
  panel().receive({ type: "save", tour: tour.id, step: 0, text: draftText });

  await host.waitFor(
    () =>
      panelHtml().includes("Draft intro.") &&
      !panelHtml().includes("tour-step-source"),
    5000
  );

  assert.equal(store.isEditing, false);
  assert.equal(host.contexts.get("codetour:isEditing"), false);
  assert.equal(getStepDraft(tour.id, 0), undefined);
  assert.equal(getEditingSession(), undefined);

  // The tour file keeps its format: the schema header, no runtime ids and
  // the saved description under the first step.
  const saved = (await readTourFile(tour.id)) as Record<string, unknown>;
  assert.equal(Object.keys(saved)[0], "$schema");
  assert.equal("id" in saved, false);
  const steps = saved.steps as Record<string, unknown>[];
  assert.equal(steps[0].description, draftText);
  assert.equal("markerTitle" in steps[0], false);

  // The saved content reads back in the native mode...
  await host.vscode.commands.executeCommand("codetour.togglePlaybackMode");
  await host.waitFor(() =>
    host.liveThreads()[0]?.comments[0]?.body.value.includes("Draft intro.")
  );
  assert.equal(host.livePanels("codetour.tour").length, 0);

  // ...and in the webview mode.
  await host.vscode.commands.executeCommand("codetour.togglePlaybackMode");
  await host.waitFor(() => panelHtml().includes("Draft intro."), 5000);
  assert.match(panelHtml(), /alt="Diagram — Draft"/);
  assert.equal(store.activeTour?.step, 0);
});

test("cancelling restores the registered content and drops the draft", async () => {
  await enterEditing();
  panel().receive({
    type: "draft",
    tour: tour.id,
    step: 0,
    text: "Cancelled draft text."
  });
  await host.waitFor(() => !!postedPreview(/Cancelled draft text/));

  panel().receive({ type: "cancel", tour: tour.id, step: 0 });

  await host.waitFor(
    () =>
      panelHtml().includes("Draft intro.") &&
      !panelHtml().includes("tour-step-source")
  );
  assert.equal(store.isEditing, false);
  assert.equal(getStepDraft(tour.id, 0), undefined);
  assert.equal(getEditingSession(), undefined);
  // Nothing was ever persisted by the cancelled draft.
  const saved = (await readTourFile(tour.id)) as {
    steps: { description: string }[];
  };
  assert.match(saved.steps[0].description, /Draft intro\./);
});

test("a stale save message never modifies another step or tour", async () => {
  await enterEditing();

  // A save naming another step of the active tour is rejected.
  panel().receive({
    type: "save",
    tour: tour.id,
    step: 1,
    text: "Hijacked step 1."
  });
  // A save naming another tour is rejected.
  panel().receive({
    type: "save",
    tour: "file:///workspace/.tours/other.tour",
    step: 0,
    text: "Hijacked other tour."
  });
  await new Promise(resolve => setTimeout(resolve, 200));

  assert.match(storeStepDescription(1), /Second registered content\./);
  const saved = (await readTourFile(tour.id)) as {
    steps: { description: string }[];
  };
  assert.match(saved.steps[0].description, /Draft intro\./);
  assert.match(saved.steps[1].description, /Second registered content\./);

  // A late save arriving after a navigation is rejected as well: the
  // targeted step is not the active one anymore.
  await host.vscode.commands.executeCommand("codetour.nextTourStep");
  await host.waitFor(() => panelHtml().includes("2 / 2"));
  panel().receive({
    type: "save",
    tour: tour.id,
    step: 0,
    text: "Late save."
  });
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.match(storeStepDescription(0), /Draft intro\./);
  const afterLateSave = (await readTourFile(tour.id)) as {
    steps: { description: string }[];
  };
  assert.match(afterLateSave.steps[0].description, /Draft intro\./);

  // The stale navigation left no editing session on the new step.
  assert.equal(panelHtml().includes("tour-step-source"), false);
});

test("a save error is reported and preserves the draft for a retry", async () => {
  await host.vscode.commands.executeCommand("codetour.previousTourStep");
  await host.waitFor(() => panelHtml().includes("1 / 2"));
  await enterEditing();

  host.failWrite("/workspace/.tours/editing.tour");
  panel().receive({
    type: "draft",
    tour: tour.id,
    step: 0,
    text: "Retry draft."
  });
  await host.waitFor(() => !!postedPreview(/Retry draft/));

  panel().receive({
    type: "save",
    tour: tour.id,
    step: 0,
    text: "Retry draft."
  });
  await host.waitFor(() =>
    host.messages.some(message => message.includes("Unable to save"))
  );

  // The failure is reported, the tour file is untouched and the draft is
  // still the editor's content: nothing was lost.
  const savedOnFailure = (await readTourFile(tour.id)) as {
    steps: { description: string }[];
  };
  assert.match(savedOnFailure.steps[0].description, /Draft intro\./);
  assert.equal(getStepDraft(tour.id, 0), "Retry draft.");
  assert.equal(store.isEditing, true);
  assert.match(panelHtml(), /<textarea id="tour-step-source"/);
  assert.match(panelHtml(), /Retry draft\./);

  // Once the write works again, the same draft saves.
  host.allowWrite("/workspace/.tours/editing.tour");
  panel().receive({
    type: "save",
    tour: tour.id,
    step: 0,
    text: "Retry draft."
  });
  await host.waitFor(
    () =>
      panelHtml().includes("Retry draft.") &&
      !panelHtml().includes("tour-step-source"),
    5000
  );
  assert.equal(getStepDraft(tour.id, 0), undefined);
});

test("a read-only tour presents no edit action and rejects edit messages", async () => {
  startCodeTour(readOnlyTour, undefined, undefined, false, false);
  await host.waitFor(() => panelHtml().includes("Read Only Tour"));

  assert.equal(store.canEditTour, false);
  assert.equal(host.contexts.get("codetour:canEditTour"), false);
  assert.doesNotMatch(panelHtml(), /data-action="edit"/);
  assert.doesNotMatch(panelHtml(), /data-action="editCommand"/);
  assert.doesNotMatch(panelHtml(), /data-action="save"/);

  // A crafted edit message cannot enter the editor...
  panel().receive({ type: "edit" });
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(store.isEditing, false);
  assert.doesNotMatch(panelHtml(), /tour-step-source/);

  // ...and a crafted save message is rejected on the host side without
  // touching the tour.
  panel().receive({
    type: "save",
    tour: readOnlyTour.id,
    step: 0,
    text: "Forbidden edit."
  });
  await host.waitFor(() =>
    host.messages.some(message => message.includes("cannot be edited"))
  );
  assert.equal(storeStepDescription(0), "Locked content.");
  await assert.rejects(readTourFile(readOnlyTour.id));
});

test("the panel routes to the existing recorder commands with permissions", async () => {
  await host.vscode.commands.executeCommand("codetour.startTour", tour);
  await host.waitFor(() => panelHtml().includes("1 / 2"));

  panel().receive({
    type: "editCommand",
    command: "codetour.changeTourStepTitle"
  });
  await host.waitFor(() =>
    host.executedCommands.some(
      ([id, args]) =>
        id === "codetour.changeTourStepTitle" &&
        (args[0] as { tour?: { id?: string }; stepNumber?: number }).tour
          ?.id === tour.id &&
        (args[0] as { stepNumber?: number }).stepNumber === 0
    )
  );

  panel().receive({
    type: "editCommand",
    command: "codetour.changeTourStepLine"
  });
  await host.waitFor(() =>
    host.executedCommands.some(([id]) => id === "codetour.changeTourStepLine")
  );

  // Commands outside the panel's fixed set never execute.
  panel().receive({
    type: "editCommand",
    command: "codetour.deleteTour"
  });
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(
    !host.executedCommands.some(([id]) => id === "codetour.deleteTour")
  );
});

test("finishing the tour during an edit clears the editing state and keeps the draft in memory", async () => {
  await host.vscode.commands.executeCommand("codetour.startTour", tour);
  await host.waitFor(() => panelHtml().includes("1 / 2"));
  await enterEditing();
  panel().receive({
    type: "draft",
    tour: tour.id,
    step: 0,
    text: "Draft kept across the end of the tour."
  });
  await host.waitFor(() => !!postedPreview(/Draft kept across the end/));

  await host.vscode.commands.executeCommand("codetour.finishTour");
  await host.waitFor(() => store.activeTour === null);

  // Ending the tour removes the presentation and leaves clean editing
  // flags, without silently dropping the in-memory draft.
  assert.equal(store.isEditing, false);
  assert.equal(host.contexts.get("codetour:isEditing"), false);
  assert.equal(host.livePanels("codetour.tour").length, 0);
  assert.equal(getEditingSession(), undefined);
  assert.equal(
    getStepDraft(tour.id, 0),
    "Draft kept across the end of the tour."
  );
});
