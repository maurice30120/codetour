import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost } from "../test/vscodeHost";

// The playback preference is set at the workspace scope: the toggle must
// update that very scope, or the workspace value keeps overriding the
// global one and the toggle appears to do nothing.
const host = createVscodeHost({
  workspaceConfiguration: {
    codetour: { playbackMode: "webview" }
  }
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

test("toggling the playback mode updates the scope that carries the preference", async () => {
  registerPlayerModule(host.extensionContext);

  // The workspace preference drives the initial mode.
  assert.equal(store.playbackMode, "webview");

  await host.vscode.commands.executeCommand("codetour.togglePlaybackMode");

  assert.equal(store.playbackMode, "comments");
  assert.deepEqual(
    host.configurationUpdates.filter(([, key]) => key === "playbackMode"),
    [["codetour", "playbackMode", "comments", 2]],
    "the toggle writes the workspace scope, which carries the value"
  );
  // The workspace value itself was flipped, so a fresh read sees the toggle.
  assert.equal(
    host.vscode.workspace.getConfiguration("codetour").get("playbackMode"),
    "comments"
  );
});
