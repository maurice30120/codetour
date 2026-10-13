import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost, Uri } from "../test/vscodeHost";

const BASE_REF = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEAD_REF = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const host = createVscodeHost({
  configuration: {
    codetour: { playbackMode: "webview", showMarkers: false }
  },
  git: {
    branch: "main",
    head: HEAD_REF,
    commits: [BASE_REF, HEAD_REF],
    delayMs: 10,
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

const tour = {
  id: "file:///workspace/.tours/changes.tour",
  title: "1 - Changes Tour",
  description: "A changes tour",
  ref: HEAD_REF,
  baseRef: BASE_REF,
  steps: [
    {
      title: "Diff step",
      description: "The diff anchors the modified side.",
      file: "src/player.ts",
      display: "diff",
      line: 3
    }
  ]
};

async function startTour() {
  await host.vscode.commands.executeCommand("codetour.startTour", tour);
}

function activeAnchorType() {
  return host.decorationTypes.find(
    type => (type.options.gutterIconPath as Uri).toString() === SMALL_ICON_URL
  );
}

function gitEditor(ref: string) {
  return host.visibleTextEditors.find(editor =>
    editor.document.uri.query.includes(ref)
  );
}

test("a diff step opens the persisted Git comparison and marks only the modified side", async () => {
  registerPlayerModule(host.extensionContext);
  await startTour();

  await host.waitFor(() => host.panelHtml().includes("Diff step"));

  // The description lives in the webview only.
  assert.equal(host.liveThreads().length, 0);
  assert.match(host.panelHtml(), /class="anchor">src\/player\.ts : 3 · Diff</);

  // The opened comparison reproduces the persisted refs: the modified side
  // is the snapshot at the tour ref, the original side the base ref.
  const diffCall = host.executedCommands.find(
    ([id]) => id === "vscode.diff"
  )!;
  assert.ok(diffCall, "the diff comparison is opened");
  const [original, modified, title] = diffCall[1] as [Uri, Uri, string];
  assert.equal(original.scheme, "git");
  assert.match(original.query, new RegExp(`"ref":"${BASE_REF}"`));
  assert.equal(modified.scheme, "git");
  assert.match(modified.query, new RegExp(`"ref":"${HEAD_REF}"`));
  assert.equal(
    title,
    `src/player.ts (${BASE_REF} ↔ ${HEAD_REF})`
  );

  // The active anchor decorates the modified side alone, at the step line.
  const type = activeAnchorType()!;
  const modifiedEditor = gitEditor(HEAD_REF)!;
  const originalEditor = gitEditor(BASE_REF)!;
  assert.ok(modifiedEditor, "the modified side is open");
  assert.ok(originalEditor, "the original side is open");
  const modifiedDecoration = modifiedEditor.decorations.get(type);
  assert.equal(modifiedDecoration?.length, 1);
  assert.equal(modifiedDecoration![0].start.line, 2);
  assert.equal(modifiedEditor.decorations.get(type)![0].start.character, 0);
  assert.equal((originalEditor.decorations.get(type) ?? []).length, 0);
  assert.equal(modifiedEditor.selection.start.line, 2);
  assert.ok(modifiedEditor.revealedRanges.length > 0);

  // No other decoration is invented on either side.
  for (const editor of [modifiedEditor, originalEditor]) {
    for (const [decorationType, ranges] of editor.decorations.entries()) {
      if (decorationType !== type) {
        assert.equal(ranges.length, 0);
      }
    }
  }
});

test("an unavailable diff follows the existing fallbacks and keeps the tour readable", async () => {
  await host.vscode.commands.executeCommand("codetour.endTour");
  await host.waitFor(() => store.activeTour === null);

  const diffCallsBefore = host.executedCommands.filter(
    ([id]) => id === "vscode.diff"
  ).length;

  const unavailableTour = {
    ...tour,
    id: "file:///workspace/.tours/unavailable.tour",
    steps: [
      {
        title: "Gone diff",
        description: "The explanation survives the missing diff.",
        file: "src/gone.ts",
        display: "diff",
        line: 2
      }
    ]
  };
  await host.vscode.commands.executeCommand(
    "codetour.startTour",
    unavailableTour
  );

  await host.waitFor(() =>
    host.messages.some(message =>
      message.includes("file unavailable: src/gone.ts")
    )
  );
  await host.waitFor(() => host.panelHtml().includes("Gone diff"));

  // The step stays readable in the panel, without any anchor or comparison.
  assert.equal(host.liveThreads().length, 0);
  assert.match(
    host.panelHtml(),
    /The explanation survives the missing diff\./
  );
  const type = activeAnchorType()!;
  for (const editor of host.visibleTextEditors) {
    const ranges = editor.decorations.get(type);
    assert.ok(!ranges || ranges.length === 0);
  }
  assert.equal(
    host.executedCommands.filter(([id]) => id === "vscode.diff").length,
    diffCallsBefore,
    "no comparison is opened for the unavailable diff"
  );
});
