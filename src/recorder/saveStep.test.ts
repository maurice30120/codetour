import { test } from "node:test";
import * as assert from "node:assert";
import { planSaveStep } from "./saveStep";

test("planSaveStep re-renders the preview after a successful save", () => {
  const plan = planSaveStep({ saved: true });

  assert.equal(plan.keepEditing, false);
  assert.equal(plan.relaunchPreview, true);
});

test("planSaveStep keeps the editor and its content when the save fails", () => {
  const plan = planSaveStep({ saved: false });

  assert.equal(plan.keepEditing, true);
  assert.equal(plan.relaunchPreview, false);
});
