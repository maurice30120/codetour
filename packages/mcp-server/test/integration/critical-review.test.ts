import { test } from "node:test";
import * as assert from "node:assert";
import {
  rmrf,
  tempDir,
  withServer,
} from "../helpers/test-utils";
import {
  CODETOUR_CRITICAL_REVIEW_ADAPTATION,
  CRITICAL_REVIEW_RESOURCE_URI,
  UPSTREAM_CODE_REVIEW_LICENSE,
  UPSTREAM_CODE_REVIEW_SKILL,
  UPSTREAM_CODE_REVIEW_SOURCE_REVISION,
  criticalReviewSkillPack,
} from "../../src/review-skill";

// The integration seam plays a fake orchestrator: the tests act as the
// generating agent that reads the skill-pack resource before writing any
// step, then calls create_changes_tour with an explicit review mode.

test("serves the critical review skill pack resource", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await client.readResource({
        uri: CRITICAL_REVIEW_RESOURCE_URI,
      });
      const content = response.contents[0];
      assert.equal(content.uri, CRITICAL_REVIEW_RESOURCE_URI);
      const text = (content as { text?: string }).text ?? "";
      // The resource serves the exact assembled pack: upstream verbatim,
      // CodeTour adaptation, source revision, attribution, and MIT license.
      assert.equal(text, criticalReviewSkillPack());
      assert.ok(text.includes(UPSTREAM_CODE_REVIEW_SKILL));
      assert.ok(text.includes(CODETOUR_CRITICAL_REVIEW_ADAPTATION));
      assert.ok(text.includes(UPSTREAM_CODE_REVIEW_LICENSE));
      assert.ok(text.includes(UPSTREAM_CODE_REVIEW_SOURCE_REVISION));
      assert.ok(text.includes("Matt Pocock"));
      assert.ok(text.includes("MIT"));
    });
  } finally {
    rmrf(root);
  }
});

test("create_changes_tour guidance refers to the skill pack resource", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const { tools } = await client.listTools();
      const changes = tools.find((tool) => tool.name === "create_changes_tour");
      const project = tools.find((tool) => tool.name === "create_project_tour");
      assert.ok(changes, "create_changes_tour must stay exposed");
      assert.ok(project, "create_project_tour must stay exposed");
      assert.equal(tools.length, 2, "no third tool may be added");
      assert.ok(
        (changes.description ?? "").includes(CRITICAL_REVIEW_RESOURCE_URI),
        "the changes tour guidance must reference the skill pack resource"
      );
      assert.ok(
        (changes.description ?? "").includes("critical"),
        "the changes tour guidance must describe the critical mode"
      );
      assert.ok(
        !(project.description ?? "").includes(CRITICAL_REVIEW_RESOURCE_URI),
        "project tours have no review mode"
      );
    });
  } finally {
    rmrf(root);
  }
});
