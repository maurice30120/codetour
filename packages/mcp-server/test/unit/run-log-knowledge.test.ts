import * as assert from "node:assert";
import { test } from "node:test";
import {
  readRunState,
  recordKnowledgeListing,
  recordKnowledgeRead,
  recordTourCreated,
  type KnowledgeObservation,
} from "../../src/run-log";
import { rmrf, tempDir } from "../helpers/test-utils";

// The Knowledge block of the run state (ADR 0045): an additive recording of
// what the run's own discovery verified. These tests pin the merge rules that
// the closing line depends on, and the compatibility rule that an existing run
// state without the block stays valid.

const RUN_ID = "0123456789abcdef01234567";

async function seededWorkspace(kind: "project" | "changes" = "project"): Promise<string> {
  const root = tempDir("codetour-knowledge-run-");
  const created = await recordTourCreated(root, RUN_ID, kind, ".tours/project.tour", "Tour");
  assert.equal(created.persisted, true);
  return root;
}

test("a listing records the verified names, the catalogue size and the invalid set", async () => {
  const root = await seededWorkspace();
  try {
    const first = await recordKnowledgeListing(root, RUN_ID, "project", {
      valid: ["billing-retry", "auth-refresh"],
      total: 2,
      complete: true,
      invalid: [{ name: "stale-auth", reason: "proof_hash_mismatch" }],
    });
    assert.equal(first.persisted, true);
    const knowledge = (await readRunState(root, RUN_ID))?.knowledge as KnowledgeObservation;
    assert.equal(knowledge.version, 1);
    assert.equal(knowledge.observed, true);
    assert.equal(knowledge.listings, 1);
    assert.deepEqual(knowledge.valid, ["billing-retry", "auth-refresh"]);
    assert.equal(knowledge.validTotal, 2);
    assert.equal(knowledge.complete, true);
    assert.deepEqual(knowledge.invalid, [
      { name: "stale-auth", reason: "proof_hash_mismatch" },
    ]);
    assert.deepEqual(knowledge.used, []);
  } finally {
    rmrf(root);
  }
});

test("verified names accumulate across listings while the invalid set is the latest one", async () => {
  const root = await seededWorkspace();
  try {
    await recordKnowledgeListing(root, RUN_ID, "project", {
      valid: ["billing-retry"],
      total: 9,
      complete: false,
      invalid: [{ name: "stale-auth", reason: "proof_hash_mismatch" }],
    });
    // A targeted query returns a subset; the union is what the agent could
    // choose from, so the second listing must not erase the first name.
    const second = await recordKnowledgeListing(root, RUN_ID, "project", {
      valid: ["auth-refresh"],
      total: 4,
      complete: true,
      invalid: [],
    });
    assert.equal(second.persisted, true);
    const knowledge = (await readRunState(root, RUN_ID))?.knowledge as KnowledgeObservation;
    assert.deepEqual(knowledge.valid, ["billing-retry", "auth-refresh"]);
    // The largest catalogue size observed survives a smaller filtered total.
    assert.equal(knowledge.validTotal, 9);
    // One untruncated listing is enough to claim the catalogue was covered.
    assert.equal(knowledge.complete, true);
    // The repaired entry must stop being reported as broken.
    assert.deepEqual(knowledge.invalid, []);
    assert.equal(knowledge.listings, 2);
  } finally {
    rmrf(root);
  }
});

test("a verified read is counted once per entry and a repeated read is not a second use", async () => {
  const root = await seededWorkspace();
  try {
    await recordKnowledgeRead(root, RUN_ID, "project", "billing-retry");
    await recordKnowledgeRead(root, RUN_ID, "project", "billing-retry");
    const third = await recordKnowledgeRead(root, RUN_ID, "project", "auth-refresh");
    assert.equal(third.persisted, true);
    const knowledge = (await readRunState(root, RUN_ID))?.knowledge as KnowledgeObservation;
    assert.deepEqual(knowledge.used, ["billing-retry", "auth-refresh"]);
    // A read without any listing still records an observation: the run did
    // read the catalogue, it just never listed it.
    assert.equal(knowledge.listings, 0);
    assert.deepEqual(knowledge.valid, []);
  } finally {
    rmrf(root);
  }
});

test("a listing kept the consolidation state and a run without the block stays valid", async () => {
  const root = tempDir("codetour-knowledge-run-");
  try {
    const created = await recordTourCreated(root, RUN_ID, "changes", ".tours/changes.tour", "Changes");
    assert.equal(created.persisted, true);
    const untouched = await readRunState(root, RUN_ID);
    assert.equal(untouched?.knowledge, undefined);
    assert.equal(untouched?.tourCreated, true);

    await recordKnowledgeListing(root, RUN_ID, "changes", {
      valid: ["only"],
      total: 1,
      complete: true,
      invalid: [],
    });
    const after = await readRunState(root, RUN_ID);
    // The block is additive: the authenticated outcomes are untouched.
    assert.equal(after?.tourCreated, true);
    assert.equal(after?.kind, "changes");
    assert.equal(after?.tourPath, ".tours/changes.tour");
    assert.equal(after?.knowledge?.validTotal, 1);
  } finally {
    rmrf(root);
  }
});

test("no run identity means no write at all", async () => {
  const root = tempDir("codetour-knowledge-run-");
  try {
    const listing = await recordKnowledgeListing(root, undefined, "project", {
      valid: ["x"],
      total: 1,
      complete: true,
      invalid: [],
    });
    const read = await recordKnowledgeRead(root, undefined, "project", "x");
    assert.equal(listing.persisted, false);
    assert.equal(read.persisted, false);
    assert.equal(await readRunState(root, RUN_ID), undefined);
  } finally {
    rmrf(root);
  }
});
