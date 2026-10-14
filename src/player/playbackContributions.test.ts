import { test } from "node:test";
import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("expanded view is available from the extension without a presentation selector", () => {
  const { contributes } = JSON.parse(readFileSync(resolve(__dirname, "../../../package.json"), "utf8"));
  assert.equal(contributes.configuration.properties["codetour.playbackMode"], undefined);
  assert.ok(!contributes.commands.some((entry: { command: string }) => /togglePlaybackMode|prototypeWebview/.test(entry.command)));
  for (const surface of ["commandPalette", "view/title", "comments/commentThread/title"]) {
    const action = contributes.menus[surface].find((entry: { command: string }) => entry.command === "codetour.showStepDescription");
    assert.ok(action && action.when !== "false", surface);
  }
});
