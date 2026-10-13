import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost, Uri } from "../test/vscodeHost";

// The delivery-level journey of the parallel playback mode: one tour, one
// continuous session, driven only through the public commands and the
// panel's messages. It crosses the slices' behaviors together — start,
// mode toggle, progression, lone anchor, files, diffs, mermaid, editing
// and saving, closing, resuming and finishing — to validate their
// integration at the reader/editor frontier.
const BASE_REF = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEAD_REF = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const host = createVscodeHost({
  configuration: {
    // No playbackMode entry: the native comment mode must be the default.
    codetour: { showMarkers: false }
  },
  git: {
    branch: "main",
    head: HEAD_REF,
    commits: [BASE_REF, HEAD_REF],
    objects: {
      [`${BASE_REF}:/workspace/src/player.ts`]: {
        content: ["const state = 0;", "const old = 1;", "const gone = 2;"].join(
          "\n"
        )
      },
      [`${HEAD_REF}:/workspace/src/player.ts`]: {
        content: [
          "const state = 0;",
          "const fresh = 1;",
          "const anchor = 2;",
          "const more = 3;"
        ].join("\n")
      }
    }
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
const { getStepDraft } = require("../player/tourDrafts");

const journeyTour = {
  id: "file:///workspace/.tours/journey.tour",
  title: "1 - Journey Tour",
  description: "A tour crossing every playback behavior",
  ref: HEAD_REF,
  baseRef: BASE_REF,
  steps: [
    {
      title: "Entry",
      description: [
        "Journey intro.",
        "",
        "**Diagram — Journey**",
        "",
        "```mermaid",
        "flowchart TD",
        "    Start --> Done",
        "```",
        "",
        "Journey outro."
      ].join("\n"),
      file: "src/player.ts",
      line: 3
    },
    {
      title: "Selection",
      description: "The selection anchors this leg.",
      file: "src/player.ts",
      selection: {
        start: { line: 6, character: 1 },
        end: { line: 6, character: 12 }
      }
    },
    {
      title: "Changes",
      description: "The diff anchors the modified side.",
      file: "src/player.ts",
      display: "diff",
      line: 3
    },
    {
      title: "Directory",
      description: "This leg targets a directory.",
      directory: "src"
    },
    {
      title: "Wrap-up",
      description: "Registered wrap-up."
    },
    {
      title: "Final",
      description: "Registered final content.",
      file: "src/player.ts",
      line: 4
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
      "// step 6",
      "// step 6 end",
      "const rule = playbackRule();"
    ].join("\n")
  );
  // The tour file exists on disk like a real workspace tour, so saves can
  // be observed against its persisted content.
  const { id, ...persisted } = journeyTour;
  host.setFileContent(
    id.replace("file://", ""),
    JSON.stringify(
      { $schema: "https://aka.ms/codetour-schema", ...persisted },
      null,
      2
    )
  );
}

async function startJourney() {
  seedWorkspace();
  await host.vscode.commands.executeCommand("codetour.startTour", journeyTour);
}

function panel() {
  return host.livePanels("codetour.tour")[0]!;
}

function panelHtml() {
  return host.panelHtml();
}

function activeAnchorType() {
  return host.decorationTypes.find(
    type => (type.options.gutterIconPath as Uri).toString() === SMALL_ICON_URL
  );
}

function anchorRanges(editorPath: string) {
  const editor = host.editorFor(editorPath);
  const type = activeAnchorType();
  return editor && type ? editor.decorations.get(type) : undefined;
}

async function readTourFile(): Promise<Record<string, unknown>> {
  const bytes = await host.vscode.workspace.fs.readFile(
    Uri.parse(journeyTour.id)
  );
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<
    string,
    unknown
  >;
}

test("the journey starts in the native mode by default and toggles mid-tour", async () => {
  registerPlayerModule(host.extensionContext);
  await startJourney();

  // Without any playbackMode preference, the tour presents itself through
  // the native comment thread, exactly like before the parallel mode.
  await host.waitFor(() =>
    (host.liveThreads()[0]?.comments[0]?.body?.value ?? "").includes(
      "Journey intro."
    )
  );
  assert.equal(host.livePanels("codetour.tour").length, 0);
  assert.equal(store.playbackMode, "comments");

  // The public toggle switches the very same tour to the webview panel,
  // without restarting it or counting an extra toured step.
  await host.vscode.commands.executeCommand("codetour.togglePlaybackMode");
  await host.waitFor(() => panelHtml().includes("1 / 6"), 5000);

  assert.equal(store.activeTour!.step, 0);
  assert.equal(host.liveThreads().length, 0);
  assert.equal(host.livePanels("codetour.tour").length, 1);
  assert.match(panelHtml(), /<h1>Entry<\/h1>/);
  assert.deepEqual(
    host.configurationUpdates.filter(
      ([, key]) => key === "playbackMode"
    ),
    [["codetour", "playbackMode", "webview", 1]]
  );
  const progression = (store.progress as [string, number[]][]).find(
    ([id]) => id === journeyTour.id
  );
  assert.equal(progression, undefined);
});

test("the multi-step journey reads files, diffs, directories and mermaid in the panel", async () => {
  // The entry step renders its diagram through the shared pipeline, and
  // the editor carries the lone logo at the resolved anchor.
  await host.waitFor(
    () => panelHtml().includes("data:image/png;base64"),
    5000
  );
  assert.match(panelHtml(), /alt="Diagram — Journey"/);
  assert.match(panelHtml(), /class="anchor">src\/player\.ts : 3</);
  const entryDecorations = anchorRanges("src/player.ts");
  assert.equal(entryDecorations!.length, 1);
  assert.equal(entryDecorations![0].start.line, 2);
  const type = activeAnchorType()!;
  assert.ok(!("hoverMessage" in type.options));

  // The public navigation command drives the panel through the selection.
  await host.vscode.commands.executeCommand("codetour.nextTourStep");
  await host.waitFor(() => panelHtml().includes("2 / 6"), 5000);
  const selectionEditor = host.editorFor("src/player.ts")!;
  assert.equal(selectionEditor.selection.start.line, 5);
  assert.equal(anchorRanges("src/player.ts")![0].start.line, 5);

  // The diff step opens the persisted Git comparison and marks its
  // modified side only.
  await host.vscode.commands.executeCommand("codetour.nextTourStep");
  await host.waitFor(() => panelHtml().includes("3 / 6"), 5000);
  assert.ok(
    host.executedCommands.some(([id]) => id === "vscode.diff"),
    "the diff step opens the comparison"
  );
  assert.match(panelHtml(), /class="anchor">src\/player\.ts : 3 · Diff</);
  const modifiedEditor = host.visibleTextEditors.find(
    editor => editor.document.uri.scheme === "git"
      && editor.document.uri.query.includes(HEAD_REF)
  )!;
  assert.equal(modifiedEditor.decorations.get(type)!.length, 1);
  assert.equal(modifiedEditor.decorations.get(type)![0].start.line, 2);
  const originalEditor = host.visibleTextEditors.find(
    editor => editor.document.uri.scheme === "git"
      && editor.document.uri.query.includes(BASE_REF)
  )!;
  assert.ok(
    !originalEditor.decorations.get(type)?.length,
    "the base side carries no active anchor"
  );

  // The directory step reveals its target and invents no code marker.
  await host.vscode.commands.executeCommand("codetour.nextTourStep");
  await host.waitFor(() => panelHtml().includes("4 / 6"), 5000);
  assert.ok(
    host.executedCommands.some(
      ([id, args]) =>
        id === "revealInExplorer" &&
        (args[0] as Uri).path.endsWith("/src")
    ),
    "the directory step reveals its target"
  );
  assert.match(panelHtml(), /class="anchor">src</);
  assert.ok(!anchorRanges("src/player.ts")?.length);

  // The step without a code anchor stays readable in the panel alone.
  await host.vscode.commands.executeCommand("codetour.nextTourStep");
  await host.waitFor(() => panelHtml().includes("5 / 6"), 5000);
  assert.match(panelHtml(), /class="anchor">Présentation</);
  assert.equal(
    host.visibleTextEditors.filter(
      editor => editor.document.uri.scheme === "codetour-content"
    ).length,
    0
  );

  // The panel's own buttons reach the last step, where the forward
  // navigation disables itself at the tour bound.
  panel().receive({ type: "next" });
  await host.waitFor(() => panelHtml().includes("6 / 6"), 5000);
  assert.match(panelHtml(), /data-action="next" disabled/);
  assert.doesNotMatch(panelHtml(), /data-action="previous" disabled/);

  // The whole journey recorded its progression once per step.
  const progression = (store.progress as [string, number[]][]).find(
    ([id]) => id === journeyTour.id
  )![1];
  assert.deepEqual([...progression].sort(), [0, 1, 2, 3, 4]);

  // The public backward command drives the panel again.
  await host.vscode.commands.executeCommand("codetour.previousTourStep");
  await host.waitFor(() => panelHtml().includes("5 / 6"), 5000);
  assert.equal(store.activeTour!.step, 4);
});

test("editing and saving from the panel updates the tour file, then closes and resumes", async () => {
  await host.waitFor(() => panelHtml().includes("5 / 6"), 5000);

  // Entering the editor from the panel works on a step without any code
  // anchor: the panel is the only presentation of this leg.
  panel().receive({ type: "edit" });
  await host.waitFor(
    () => !!panelHtml().match(/<textarea id="tour-step-source"/)
  );
  assert.match(panelHtml(), /Registered wrap-up\./);

  const editedText = "Journey edited wrap-up.";
  panel().receive({
    type: "draft",
    tour: journeyTour.id,
    step: 4,
    text: editedText
  });
  await host.waitFor(() =>
    host.postedMessages().some(
      message =>
        (message as { type?: string; html?: string }).type === "preview" &&
        !!(message as { html?: string }).html?.includes("Journey edited")
    )
  );

  // Saving writes the existing tour file and presents the saved content.
  panel().receive({
    type: "save",
    tour: journeyTour.id,
    step: 4,
    text: editedText
  });
  await host.waitFor(
    () =>
      panelHtml().includes("Journey edited wrap-up.") &&
      !panelHtml().includes("tour-step-source"),
    5000
  );
  assert.equal(store.isEditing, false);
  assert.equal(getStepDraft(journeyTour.id, 4), undefined);
  const saved = (await readTourFile()) as {
    steps: { description: string }[];
  };
  assert.equal(saved.steps[4].description, editedText);

  // Closing the panel keeps the tour and the step; the public resume
  // command reopens the presentation where the journey left it.
  panel().dispose();
  assert.equal(host.livePanels("codetour.tour").length, 0);
  assert.equal(store.activeTour!.step, 4);

  await host.vscode.commands.executeCommand("codetour.resumeTour");
  await host.waitFor(() => panelHtml().includes("5 / 6"), 5000);
  assert.match(panelHtml(), /Journey edited wrap-up\./);
});

test("finishing resolves the unsaved draft first, then removes the presentation", async () => {
  host.resetModals();
  await host.waitFor(() => panelHtml().includes("5 / 6"), 5000);

  // One last edit leaves an unsaved draft when the tour is finished.
  panel().receive({ type: "edit" });
  await host.waitFor(
    () => !!panelHtml().match(/<textarea id="tour-step-source"/)
  );
  panel().receive({
    type: "draft",
    tour: journeyTour.id,
    step: 4,
    text: "Final wrap-up draft."
  });

  const finish = host.vscode.commands.executeCommand("codetour.finishTour");
  await host.answerModal("Save");
  await finish;

  await host.waitFor(() => store.activeTour === null);
  assert.equal(host.livePanels("codetour.tour").length, 0);
  assert.equal(host.liveThreads().length, 0);
  assert.equal(host.contexts.get("codetour:inTour"), false);

  // The draft was saved into the tour file before the tour ended.
  const saved = (await readTourFile()) as {
    steps: { description: string }[];
  };
  assert.equal(saved.steps[4].description, "Final wrap-up draft.");

  // No anchor of the finished tour is left in any editor.
  const type = activeAnchorType();
  for (const editor of host.visibleTextEditors) {
    const ranges = type ? editor.decorations.get(type) : undefined;
    assert.ok(!ranges || ranges.length === 0);
  }
});

test("resuming a step without any anchor reveals the panel without opening a document", async () => {
  // The journey restarts directly on the leg without any code anchor.
  await host.vscode.commands.executeCommand("codetour.startTour", journeyTour, 4);
  await host.waitFor(() => panelHtml().includes("5 / 6"), 5000);
  assert.equal(store.activeTour!.step, 4);

  panel().dispose();
  assert.equal(host.livePanels("codetour.tour").length, 0);

  // Resuming presents the step again through the panel alone: no synthetic
  // content document is opened and no code anchor is invented.
  await host.vscode.commands.executeCommand("codetour.resumeTour");
  await host.waitFor(() => panelHtml().includes("5 / 6"), 5000);
  assert.match(panelHtml(), /class="anchor">Présentation</);
  assert.equal(
    host.visibleTextEditors.filter(
      editor => editor.document.uri.scheme === "codetour-content"
    ).length,
    0,
    "resuming an anchorless step never opens a content document"
  );
  assert.ok(!anchorRanges("src/player.ts")?.length);
});
