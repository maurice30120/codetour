import * as assert from "node:assert";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { revalidateTourText } from "../../src/revalidation";

// The post-creation validation contract: the same schema and anchor rules the
// creation applied, re-run on an existing Tour document. The anchor checks run
// against real files on disk, so each test works in its own temp workspace.

const SOURCE = "line one\nalpha beta\ngamma delta\n";

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codetour-revalidation-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "a.ts"), SOURCE);
  return root;
}

function tour(steps: unknown[]): string {
  return JSON.stringify({ title: "Revalidation Tour", steps });
}

test("a valid Tour revalidates clean against its workspace", () => {
  const root = workspace();
  const result = revalidateTourText(
    tour([
      { title: "Orientation", description: "Welcome." },
      { title: "Anchored", description: "A step.", file: "src/a.ts", pattern: "alpha beta" }
    ]),
    root
  );
  assert.equal(result.ok, true);
  assert.equal(result.title, "Revalidation Tour");
  assert.equal(result.stepCount, 2);
  assert.deepEqual(result.issues, []);
});

test("a pattern that no longer matches once is reported", () => {
  const root = workspace();
  const result = revalidateTourText(
    tour([
      { title: "Orientation", description: "Welcome." },
      { title: "Drifted", description: "Gone.", file: "src/a.ts", pattern: "no such text" }
    ]),
    root
  );
  assert.equal(result.ok, false);
  const messages = result.issues.map(issue => issue.message);
  assert.ok(
    messages.some(message => message.includes("must match exactly one occurrence")),
    `expected a uniqueness issue, got ${JSON.stringify(result.issues)}`
  );
});

test("a multi-line pattern is matched against the whole file, not line by line", () => {
  const root = workspace();
  const result = revalidateTourText(
    tour([
      { title: "Orientation", description: "Welcome." },
      {
        title: "Anchored",
        description: "Across two lines.",
        file: "src/a.ts",
        pattern: "line one\nalpha beta"
      }
    ]),
    root
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("a document that is not JSON is an invalid Tour, not a crash", () => {
  const root = workspace();
  const result = revalidateTourText("{ not json", root);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].path, "$");
  assert.ok(result.issues[0].message.includes("is not valid JSON"));
});

test("a document that is not an object is an invalid Tour", () => {
  const root = workspace();
  const result = revalidateTourText("[]", root);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].message, "is not a Tour object");
});

test("a document that fails the Tour schema reports schema issues", () => {
  const root = workspace();
  const result = revalidateTourText(JSON.stringify({ title: "No steps" }), root);
  assert.equal(result.ok, false);
  assert.ok(result.issues.length > 0, "expected schema issues");
});

test("an unusable workspace is a usage failure, not an invalid Tour", () => {
  const root = workspace();
  const result = revalidateTourText(
    tour([{ title: "Orientation", description: "Welcome." }]),
    path.join(root, "missing")
  );
  assert.equal(result.ok, false);
  assert.ok(result.usageError !== undefined);
  assert.deepEqual(result.issues, []);
});
