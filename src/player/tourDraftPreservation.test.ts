import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost, Uri } from "../test/vscodeHost";

// The user-level checks for keeping an editing draft across playback mode
// switches, panel close/reopen and theme changes, and for the save/discard/
// cancel prompt every step exit proposes while a draft exists.
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
const { registerRecorderCommands } = require("../recorder/commands");
const { store } = require("../store");
const { endCurrentCodeTour } = require("../store/actions");
const {
  clearStepDraft,
  getStepDraft,
  getEditingSession
} = require("../player/stepEditing");

const tour = {
  id: "file:///workspace/.tours/drafts.tour",
  title: "1 - Drafts Tour",
  description: "A tour with drafts to preserve",
  steps: [
    {
      title: "First step",
      description: "Registered first content.",
      file: "src/player.ts",
      line: 3
    },
    {
      title: "Second step",
      description: "Registered second content.",
      file: "src/player.ts",
      line: 4
    }
  ]
};

const otherTour = {
  id: "file:///workspace/.tours/other.tour",
  title: "2 - Other Tour",
  description: "Another tour to switch to",
  steps: [
    {
      title: "Other step",
      description: "Other registered content.",
      file: "src/player.ts",
      line: 3
    }
  ]
};

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
  // The tour files exist on disk like real workspace tours, so the draft
  // cycle can be observed against their persisted content.
  for (const seeded of [tour, otherTour]) {
    const { id, ...persisted } = seeded;
    host.setFileContent(
      id.replace("file://", ""),
      JSON.stringify(
        { $schema: "https://aka.ms/codetour-schema", ...persisted },
        null,
        2
      )
    );
  }
}

async function startDraftTour() {
  seedWorkspace();
  store.tours = [tour, otherTour];
  await host.vscode.commands.executeCommand("codetourIA.startTour", tour);
  await host.waitFor(() => host.liveThreads().length === 1);
}

async function enterEditingWithDraft(text: string) {
  const before = host.visibleTextEditors.filter(item => item.document.uri.scheme === "untitled").length;
  await host.vscode.commands.executeCommand("codetourIA.editTour");
  await host.waitFor(() => host.visibleTextEditors.filter(item => item.document.uri.scheme === "untitled").length > before);
  await host.waitFor(() => !!nativeSource());
  const editor = nativeSource()!;
  await editor.edit(edit => edit.replace(new host.vscode.Range(0, 0, editor.document.lineCount, 0), text));
  await host.waitFor(() => getStepDraft(tour.id, 0) === text);
}

function nativeSource() {
  return [...host.visibleTextEditors].reverse().find(editor => editor.document.uri.scheme === "untitled" && editor.document.getText() === getStepDraft(tour.id, store.activeTour.step));
}

// Resets the module-level draft state between the tests of this file.
async function resetState() {
  if (store.activeTour) {
    const { hasUnsavedStepDraft } = require("./stepEditing");
    if (hasUnsavedStepDraft()) host.respondToModal("Discard");
    await endCurrentCodeTour(false);
  }
  clearStepDraft(tour.id, 0);
  clearStepDraft(tour.id, 1);
  clearStepDraft(otherTour.id, 0);
  for (const [path] of host.fileWrites) {
    host.allowWrite(path);
  }
  host.fileWrites.length = 0;
  host.resetModals();
  await new Promise(resolve => setTimeout(resolve, 50));
}

// Every draft-preservation test starts and ends from a clean draft state,
// so one failing test cannot leak its leftovers into the next one.
function preservationTest(name: string, fn: () => Promise<void>) {
  test(name, async t => {
    await resetState();
    t.after(() => resetState());
    await fn();
  });
}

function panelHtml() { return host.panelHtml(); }

async function readTourFile(tourId: string) {
  const bytes = await host.vscode.workspace.fs.readFile(Uri.parse(tourId));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function storeStepDescription(step: number): string {
  return store.activeTour!.tour.steps[step].description;
}

registerPlayerModule(host.extensionContext);
registerRecorderCommands();

preservationTest(
  "the draft exit prompt is a keyboard-driven quick pick",
  async () => {
    await startDraftTour();
    await enterEditingWithDraft("Quick pick draft.");

    const navigation = host.vscode.commands.executeCommand(
      "codetourIA.nextTourStep"
    );
    await host.waitFor(() => host.modalPrompts().length === 1);

    // The save/discard/cancel question is asked through a quick pick, so it
    // is fully operable from the keyboard: arrows to choose, enter to
    // validate, escape to cancel and keep the draft.
    const prompt = host.modalPrompts()[0];
    assert.equal(prompt.quickPick, true);
    assert.ok(prompt.message.includes("unsaved"));
    assert.deepEqual(prompt.items.sort(), ["Cancel", "Discard", "Save"]);

    host.respondToModal("Cancel");
    await navigation;

    assert.equal(store.activeTour.step, 0);
    assert.equal(getStepDraft(tour.id, 0), "Quick pick draft.");
    await resetState();
  }
);

preservationTest(
  "leaving the step with a draft proposes save, discard or cancel",
  async () => {
    await startDraftTour();
    await enterEditingWithDraft("Exit draft.");

    const navigation = host.vscode.commands.executeCommand(
      "codetourIA.nextTourStep"
    );
    await host.waitFor(() => host.modalPrompts().length === 1);

    const prompt = host.modalPrompts()[0];
    assert.ok(prompt.message.includes("unsaved"));
    assert.deepEqual(prompt.items.sort(), ["Cancel", "Discard", "Save"]);

    // While the prompt is open, the author hasn't left the step yet.
    assert.equal(store.activeTour.step, 0);

    host.respondToModal("Cancel");
    await navigation;

    assert.equal(store.activeTour.step, 0);
    assert.equal(getStepDraft(tour.id, 0), "Exit draft.");
    assert.equal(store.isEditing, true);
    assert.equal(getEditingSession()?.step, 0);
    assert.ok(nativeSource());
    await resetState();
  }
);

preservationTest(
  "dismissing the exit prompt keeps the author on the step with the draft",
  async () => {
    await startDraftTour();
    await enterEditingWithDraft("Dismiss draft.");

    const navigation = host.vscode.commands.executeCommand(
      "codetourIA.nextTourStep"
    );
    await host.waitFor(() => host.modalPrompts().length === 1);
    host.respondToModal(undefined);
    await navigation;

    assert.equal(store.activeTour.step, 0);
    assert.equal(getStepDraft(tour.id, 0), "Dismiss draft.");
    assert.equal(store.isEditing, true);
    await resetState();
  }
);

preservationTest(
  "discarding restores the registered content before leaving the step",
  async () => {
    await startDraftTour();
    await enterEditingWithDraft("Discarded draft.");

    const navigation = host.vscode.commands.executeCommand(
      "codetourIA.nextTourStep"
    );
    await host.answerModal("Discard");
    await navigation;

    assert.equal(store.activeTour.step, 1);
    assert.equal(getStepDraft(tour.id, 0), undefined);
    assert.equal(getEditingSession(), undefined);
    assert.equal(store.isEditing, false);
    assert.match(storeStepDescription(0), /Registered first content\./);
    await host.waitFor(() => host.liveThreads()[0]?.comments[0]?.body.value.includes("Registered second content."));
    assert.match(host.liveThreads()[0].comments[0].body.value, /Registered second content\./);
    assert.doesNotMatch(panelHtml(), /tour-step-source/);

    // The discard never touched the tour file.
    const saved = (await readTourFile(tour.id)) as {
      steps: { description: string }[];
    };
    assert.match(saved.steps[0].description, /Registered first content\./);
    await resetState();
  }
);

preservationTest(
  "saving succeeds before the navigation leaves the step",
  async () => {
    await startDraftTour();
    await enterEditingWithDraft("Saved before leaving.");

    const navigation = host.vscode.commands.executeCommand(
      "codetourIA.nextTourStep"
    );
    await host.answerModal("Save");
    await navigation;

    assert.equal(store.activeTour.step, 1);
    assert.equal(getStepDraft(tour.id, 0), undefined);
    assert.equal(store.isEditing, false);
    assert.match(storeStepDescription(0), /Saved before leaving\./);
    const saved = (await readTourFile(tour.id)) as {
      steps: { description: string }[];
    };
    assert.match(saved.steps[0].description, /Saved before leaving\./);
    await resetState();
  }
);

preservationTest(
  "a failed save blocks the exit and keeps the draft for a retry",
  async () => {
    await startDraftTour();
    await enterEditingWithDraft("Retry after failure.");

    host.failWrite("/workspace/.tours/drafts.tour");

    const blocked = host.vscode.commands.executeCommand(
      "codetourIA.nextTourStep"
    );
    await host.answerModal("Save");
    await blocked;

    await host.waitFor(() =>
      host.messages.some(message => message.includes("Unable to save"))
    );
    assert.equal(store.activeTour.step, 0);
    assert.equal(getStepDraft(tour.id, 0), "Retry after failure.");
    assert.equal(store.isEditing, true);
    assert.ok(nativeSource());
    assert.match(storeStepDescription(0), /Registered first content\./);

    // Once the write works again, the same draft saves and the exit proceeds.
    host.allowWrite("/workspace/.tours/drafts.tour");
    const retried = host.vscode.commands.executeCommand(
      "codetourIA.nextTourStep"
    );
    await host.answerModal("Save");
    await retried;

    assert.equal(store.activeTour.step, 1);
    assert.equal(getStepDraft(tour.id, 0), undefined);
    const saved = (await readTourFile(tour.id)) as {
      steps: { description: string }[];
    };
    assert.match(saved.steps[0].description, /Retry after failure\./);
    await resetState();
  }
);

preservationTest(
  "every exit origin proposes the same resolution for the draft",
  async () => {
    // A tour change from a description link proposes the same prompt.
    await startDraftTour();
    await enterEditingWithDraft("Link draft.");
    const byLink = host.vscode.commands.executeCommand(
      "codetourIA.startTourByTitle",
      otherTour.title
    );
    await host.answerModal("Discard");
    await byLink;
    await host.waitFor(() => store.activeTour?.tour.id === otherTour.id);
    assert.equal(getStepDraft(tour.id, 0), undefined);
    await resetState();

    // A tree/marker resume of another step proposes it too.
    await startDraftTour();
    await enterEditingWithDraft("Resume draft.");
    const byResume = host.vscode.commands.executeCommand(
      "codetourIA._startTourById",
      tour.id,
      1
    );
    await host.answerModal("Discard");
    await byResume;
    await host.waitFor(() => store.activeTour?.step === 1);
    assert.equal(getStepDraft(tour.id, 0), undefined);
    await resetState();

    // An explicit end proposes it as well, and saving ends the tour.
    await startDraftTour();
    await enterEditingWithDraft("Finish draft.");
    const finish = host.vscode.commands.executeCommand("codetourIA.finishTour");
    await host.answerModal("Save");
    await finish;
    await host.waitFor(() => store.activeTour === null);
    assert.equal(getStepDraft(tour.id, 0), undefined);
    const saved = (await readTourFile(tour.id)) as {
      steps: { description: string }[];
    };
    assert.match(saved.steps[0].description, /Finish draft\./);
    await resetState();

    // Cancelling the end keeps the tour and the draft.
    await startDraftTour();
    await enterEditingWithDraft("End-cancel draft.");
    const end = host.vscode.commands.executeCommand("codetourIA.endTour");
    await host.answerModal("Cancel");
    await end;
    assert.notEqual(store.activeTour, null);
    assert.equal(store.activeTour.step, 0);
    assert.equal(getStepDraft(tour.id, 0), "End-cancel draft.");
    await resetState();
  }
);

preservationTest(
  "rapid exits resolve once and never save onto another step",
  async () => {
    await startDraftTour();
    await enterEditingWithDraft("Burst draft.");

    const first = host.vscode.commands.executeCommand("codetourIA.nextTourStep");
    await host.waitFor(() => host.modalPrompts().length === 1);

    // A second exit action fired while the prompt is open is ignored.
    const second = host.vscode.commands.executeCommand("codetourIA.nextTourStep");
    await new Promise(resolve => setTimeout(resolve, 200));

    host.respondToModal("Save");
    await Promise.all([first, second]);

    assert.equal(store.activeTour.step, 1);
    assert.equal(host.modalPrompts().length, 1);
    assert.equal(getStepDraft(tour.id, 0), undefined);

    // The saved draft landed on its own step, and only one write happened.
    const saved = (await readTourFile(tour.id)) as {
      steps: { description: string }[];
    };
    assert.match(saved.steps[0].description, /Burst draft\./);
    assert.match(saved.steps[1].description, /Registered second content\./);
    const draftWrites = host.fileWrites.filter(
      ([path]) => path === "/workspace/.tours/drafts.tour"
    );
    assert.equal(draftWrites.length, 1);

    // A late panel message targeting the previous step is still rejected.
    const { saveStepDraft } = require("./stepEditing");
    assert.equal(await saveStepDraft(), false);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.match(storeStepDescription(0), /Burst draft\./);
    await resetState();
  }
);

preservationTest("no prompt appears without an unsaved draft", async () => {
  await startDraftTour();

  // No editing session at all: navigation is silent.
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.liveThreads()[0]?.comments[0]?.body.value.includes("Registered second content."));
  assert.equal(host.modalPrompts().length, 0);
  await host.vscode.commands.executeCommand("codetourIA.previousTourStep");
  await host.waitFor(() => host.liveThreads().length === 1);

  // Entering the editor without typing leaves the draft identical to the
  // registered content: no prompt either.
  await host.vscode.commands.executeCommand("codetourIA.editTour");
  await host.waitFor(() => !!nativeSource());
  await host.vscode.commands.executeCommand("codetourIA.nextTourStep");
  await host.waitFor(() => host.liveThreads()[0]?.comments[0]?.body.value.includes("Registered second content."));
  assert.equal(host.modalPrompts().length, 0);
  assert.equal(getStepDraft(tour.id, 0), undefined);
  assert.equal(store.isEditing, false);
  assert.equal(getEditingSession(), undefined);
  await resetState();
});

preservationTest("a programmatic tour end honours draft cancellation", async () => {
  await startDraftTour();
  await enterEditingWithDraft("Kept draft.");
  host.respondToModal("Cancel");
  await endCurrentCodeTour(false);
  assert.ok(store.activeTour);
  assert.equal(getStepDraft(tour.id, 0), "Kept draft.");
  await resetState();
});

preservationTest("opening expanded reading resolves an unsaved native draft", async () => {
  await startDraftTour();
  await enterEditingWithDraft("Expanded draft.");
  const opening = host.vscode.commands.executeCommand("codetourIA.showStepDescription");
  await host.answerModal("Cancel");
  await opening;
  assert.equal(store.isExpandedViewOpen, false);
  assert.equal(store.isEditing, true);
  assert.equal(getStepDraft(tour.id, 0), "Expanded draft.");
  assert.equal(host.livePanels("codetour.tour").length, 0);
  host.respondToModal("Save");
  await host.vscode.commands.executeCommand("codetourIA.showStepDescription");
  await host.waitFor(() => host.panelHtml().includes("Expanded draft."));
  assert.equal(store.isEditing, false);
  assert.equal(getStepDraft(tour.id, 0), undefined);
  assert.equal((await readTourFile(tour.id)).steps[0].description, "Expanded draft.");
});
