import { test } from "node:test";
import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface MenuContribution {
  command: string;
  group?: string;
  when?: string;
}

test("the comment toolbar exposes expanded description without replacing End Tour", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(__dirname, "../../../package.json"), "utf8")
  );
  const actions = manifest.contributes.menus[
    "comments/commentThread/title"
  ] as MenuContribution[];

  assert.ok(
    actions.some(
      action =>
        action.command === "codetour.showStepDescription" &&
        action.group === "inline@0" &&
        action.when === "commentController == codetour"
    )
  );
  assert.ok(
    actions.some(
      action =>
        action.command === "codetour.endTour" && action.group === "inline@3"
    )
  );
});
