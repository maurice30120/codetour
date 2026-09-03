import { test } from "node:test";
import * as assert from "node:assert";
import { appendCommentNavigation } from "./navigation";

test("appendCommentNavigation gives each action its own wrapping block", () => {
  const content = appendCommentNavigation("Description", [
    '← [Previous (A very long previous step)](command:codetour.previousTourStep "Previous")',
    '[Finish Tour](command:codetour.finishTour "Finish")'
  ]);

  assert.equal(
    content,
    [
      "Description",
      "",
      "---",
      "",
      '- ← [Previous (A very long previous step)](command:codetour.previousTourStep "Previous")',
      '- [Finish Tour](command:codetour.finishTour "Finish")'
    ].join("\n")
  );
  assert.doesNotMatch(content, / \| /);
});

test("appendCommentNavigation leaves content unchanged without actions", () => {
  assert.equal(appendCommentNavigation("Description", []), "Description");
});
