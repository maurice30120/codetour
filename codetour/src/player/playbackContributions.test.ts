import { test } from "node:test";
import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("expanded view is available from the extension without a presentation selector", () => {
  const { contributes } = JSON.parse(readFileSync(resolve(__dirname, "../../../package.json"), "utf8"));
  assert.equal(contributes.configuration.properties["codetour.playbackMode"], undefined);
  assert.ok(!contributes.commands.some((entry: { command: string }) => /togglePlaybackMode|prototypeWebview/.test(entry.command)));
  for (const surface of ["commandPalette", "view/title", "comments/commentThread/title"]) {
    const action = contributes.menus[surface].find((entry: { command: string }) => entry.command === "codetourIA.showStepDescription");
    assert.ok(action && action.when !== "false", surface);
  }
});


test("commands use the CodeTour IA namespace across all contributions", () => {
  const { contributes } = JSON.parse(readFileSync(resolve(__dirname, "../../../package.json"), "utf8"));
  const commands = new Set<string>(contributes.commands.map((entry: { command: string }) => entry.command));
  for (const command of commands) {
    assert.match(command, /^codetourIA\./);
  }
  const references = [
    ...Object.values(contributes.menus).flat() as { command: string }[],
    ...contributes.keybindings
  ];
  for (const entry of references) {
    assert.ok(commands.has(entry.command), entry.command);
  }
  for (const entry of contributes.viewsWelcome) {
    assert.ok(!entry.contents.includes("command:codetour."));
  }
});
