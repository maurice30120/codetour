import * as assert from "node:assert";
import { test } from "node:test";
import {
  readRunState,
  recordConsolidation,
  recordTourCreated,
  type ConsolidationClosure,
  type ConsolidationStatus,
} from "../../src/run-log";
import { rmrf, tempDir } from "../helpers/test-utils";

// The Consolidation Closure accumulates the facts of every save call of one
// Generation Run (spec #232, ADR 0050). `created` and `changed` are unions of
// names actually published and modified, and the status follows a fixed
// precedence, so the Run State is a function of the set of write outcomes —
// never of the order the agent happened to make them in. A refusal is never
// counted as a success and never erases a fact an earlier call recorded.

const RUN_ID = "0123456789abcdef01234567";

/** One save outcome as the MCP server records it, before name accumulation. */
interface WriteOutcome {
  status: ConsolidationStatus;
  outcome: string;
  created?: string[];
  changed?: string[];
}

const CREATED: WriteOutcome = { status: "created", outcome: "created", created: ["new_flow"] };
const APPENDED: WriteOutcome = { status: "appended", outcome: "appended", changed: ["appended_flow"] };
const REPLACED: WriteOutcome = { status: "replaced", outcome: "replaced", changed: ["rewritten_flow"] };

const closureOf = (write: WriteOutcome): ConsolidationClosure => ({
  status: write.status,
  runId: RUN_ID,
  at: new Date().toISOString(),
  ...(write.created ? { created: write.created } : {}),
  ...(write.changed ? { changed: write.changed } : {}),
  outcome: write.outcome,
});

/** Every ordering of the given write outcomes. */
function permutations(writes: WriteOutcome[]): WriteOutcome[][] {
  if (writes.length <= 1) return [writes];
  return writes.flatMap((write, index) =>
    permutations([...writes.slice(0, index), ...writes.slice(index + 1)]).map((rest) => [write, ...rest])
  );
}

/** The closure with its name lists sorted: a union has no meaningful order. */
function normalised(closure: ConsolidationClosure | null | undefined): Record<string, unknown> {
  assert.ok(closure, "the run carries a closure");
  return {
    status: closure.status,
    outcome: closure.outcome,
    created: [...(closure.created ?? [])].sort(),
    changed: [...(closure.changed ?? [])].sort(),
  };
}

async function runWith(writes: WriteOutcome[]): Promise<ConsolidationClosure | null | undefined> {
  const root = tempDir("codetour-run-order-");
  try {
    await recordTourCreated(root, RUN_ID, "project", ".tours/project.tour", "Project");
    for (const write of writes) {
      const recorded = await recordConsolidation(root, RUN_ID, "project", closureOf(write));
      assert.equal(recorded.persisted, true);
    }
    return (await readRunState(root, RUN_ID))?.consolidation;
  } finally {
    rmrf(root);
  }
}

test("create, append and replace in any order close the run with the same facts", async () => {
  const orders = permutations([CREATED, APPENDED, REPLACED]);
  assert.equal(orders.length, 6);
  const expected = {
    status: "created",
    outcome: "created",
    created: ["new_flow"],
    changed: ["appended_flow", "rewritten_flow"],
  };
  for (const writes of orders) {
    const order = writes.map((write) => write.status).join(" -> ");
    assert.deepEqual(normalised(await runWith(writes)), expected, order);
  }
});

test("a modification and a rewrite share one rank, so their order never decides the status", async () => {
  for (const writes of permutations([APPENDED, REPLACED])) {
    const order = writes.map((write) => write.status).join(" -> ");
    assert.deepEqual(
      normalised(await runWith(writes)),
      {
        status: "replaced",
        outcome: "replaced",
        created: [],
        changed: ["appended_flow", "rewritten_flow"],
      },
      order
    );
  }
});

test("an explicit zero never outranks a write, whichever call came first", async () => {
  for (const writes of permutations([{ status: "completed_zero", outcome: "completed_zero" } as WriteOutcome, REPLACED])) {
    const order = writes.map((write) => write.status).join(" -> ");
    assert.deepEqual(
      normalised(await runWith(writes)),
      { status: "replaced", outcome: "replaced", created: [], changed: ["rewritten_flow"] },
      order
    );
  }
});

for (const refusal of [
  { status: "failed", outcome: "invalid" },
  { status: "failed", outcome: "conflict" },
] as WriteOutcome[]) {
  for (const write of [APPENDED, REPLACED]) {
    test(`${write.status} plus a ${refusal.outcome} refusal close as partial in either order, keeping the changed name`, async () => {
      const expected = {
        status: "partial",
        outcome: refusal.outcome,
        created: [],
        changed: write.changed,
      };
      // The refusal outcome is the one that actually happened, whichever call
      // came first: a refusal never becomes a success and never erases the
      // entry the other call really modified.
      assert.deepEqual(normalised(await runWith([write, refusal])), expected, `${write.status} then refusal`);
      assert.deepEqual(normalised(await runWith([refusal, write])), expected, `refusal then ${write.status}`);
    });
  }
}

test("a refusal survives a later explicit zero instead of degrading to a completed run", async () => {
  const refused: WriteOutcome = { status: "failed", outcome: "invalid" };
  for (const writes of permutations([refused, { status: "completed_zero", outcome: "completed_zero" } as WriteOutcome])) {
    const order = writes.map((write) => write.status).join(" -> ");
    const closure = normalised(await runWith(writes));
    assert.equal(closure.status, "failed", order);
    assert.equal(closure.outcome, "invalid", order);
    assert.deepEqual(closure.created, [], order);
    assert.deepEqual(closure.changed, [], order);
  }
});
