import { test } from "node:test";
import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface CommandContribution {
  command: string;
  title: string;
  category?: string;
}

interface PaletteContribution {
  command: string;
  when?: string;
}

function readManifest() {
  return JSON.parse(
    readFileSync(resolve(__dirname, "../../../package.json"), "utf8")
  );
}

test("the manifest declares a playback mode preference defaulting to comments", () => {
  const manifest = readManifest();
  const properties = manifest.contributes.configuration.properties;

  const preference = properties["codetour.playbackMode"];
  assert.ok(preference, "codetour.playbackMode preference is declared");
  assert.deepEqual(preference.enum, ["comments", "webview"]);
  assert.equal(preference.default, "comments");
});

test("the manifest declares a toggle command visible while touring", () => {
  const manifest = readManifest();

  const command = (manifest.contributes.commands as CommandContribution[]).find(
    command => command.command === "codetour.togglePlaybackMode"
  );
  assert.ok(command, "codetour.togglePlaybackMode command is declared");
  assert.ok(command.title);
  assert.equal(command.category, "CodeTour IA");

  const palette = (
    manifest.contributes.menus.commandPalette as PaletteContribution[]
  ).find(entry => entry.command === "codetour.togglePlaybackMode");
  assert.ok(palette, "the toggle command has a palette contribution");
  assert.equal(palette.when, "codetour:inTour");
});

test("the toggle command does not widen the comment thread toolbar", () => {
  const manifest = readManifest();
  const toolbar = manifest.contributes.menus["comments/commentThread/title"];

  assert.ok(
    !toolbar.some(
      (entry: CommandContribution) =>
        entry.command === "codetour.togglePlaybackMode"
    )
  );
});
