import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { createContext } from "../../src/context";
import {
  MAX_RECOMMENDED_STEPS,
  validateSteps,
  validateTourParams,
} from "../../src/validation";
import { rmrf, tempDir, writeFile } from "../helpers/test-utils";

test("validateTourParams rejects non-object arguments", () => {
  const { issues } = validateTourParams("not-an-object");
  assert.ok(issues.some((issue) => issue.path === "$"));
});

test("validateTourParams rejects unknown root fields including ref and Git parameters", () => {
  const { issues } = validateTourParams({
    fileName: "intro.tour",
    title: "T",
    steps: [],
    ref: "abc",
    baseRef: "main",
    headRef: "a".repeat(40),
    includeUncommittedChanges: true,
    when: "true",
  });
  const paths = issues.map((issue) => issue.path);
  assert.ok(paths.includes("ref"));
  assert.ok(paths.includes("baseRef"));
  assert.ok(paths.includes("headRef"));
  assert.ok(paths.includes("includeUncommittedChanges"));
  assert.ok(paths.includes("when"));
});

test("validateTourParams requires fileName, title and steps", () => {
  const { issues } = validateTourParams({});
  const paths = issues.map((issue) => issue.path);
  assert.ok(paths.includes("fileName"));
  assert.ok(paths.includes("title"));
  assert.ok(paths.includes("steps"));
});

test("validateTourParams requires a non-empty title", () => {
  const { issues } = validateTourParams({
    fileName: "intro.tour",
    title: "  ",
    steps: [],
  });
  assert.ok(issues.some((issue) => issue.path === "title"));
});

test("validateTourParams rejects each invalid fileName form", () => {
  const invalid = [
    "intro.txt",
    "",
    "sub/intro.tour",
    "sub\\intro.tour",
    ".",
    "..",
    "/tmp/intro.tour",
    "intro",
  ];
  for (const fileName of invalid) {
    const { issues } = validateTourParams({
      fileName,
      title: "T",
      steps: [],
    });
    assert.ok(
      issues.some((issue) => issue.path === "fileName"),
      `expected fileName "${fileName}" to be rejected`
    );
  }
});

test("validateTourParams requires a string title and description", () => {
  const { issues } = validateTourParams({
    fileName: "intro.tour",
    title: 5,
    description: false,
    steps: [],
  });
  const paths = issues.map((issue) => issue.path);
  assert.ok(paths.includes("title"));
  assert.ok(paths.includes("description"));
});

test("validateTourParams accepts the public create_tour contract", () => {
  const { params, issues } = validateTourParams({
    fileName: "intro.tour",
    title: "My Tour",
    description: "An overview.",
    steps: [{ description: "Explain the change." }],
  });
  assert.deepEqual(issues, []);
  assert.equal(params?.fileName, "intro.tour");
  assert.equal(params?.title, "My Tour");
  assert.equal(params?.description, "An overview.");
  assert.ok(Array.isArray(params?.steps));
});

function workspaceWithFiles(files: Record<string, string>): string {
  const dir = tempDir();
  for (const [name, content] of Object.entries(files)) {
    writeFile(dir, name, content);
  }
  return dir;
}

function validate(rawSteps: unknown[], root: string) {
  return validateSteps(rawSteps, createContext(root));
}

test("a step rejects a file and a directory together", () => {
  const root = workspaceWithFiles({ "a.ts": "x" });
  fs.mkdirSync(path.join(root, "sub"));
  const { issues } = validate(
    [{ description: "d", file: "a.ts", directory: "sub" }],
    root
  );
  assert.ok(issues.some((issue) => issue.path === "steps[0]"));
  rmrf(root);
});

test("line and pattern are mutually exclusive", () => {
  const root = workspaceWithFiles({ "a.ts": "one\ntwo\n" });
  const { issues } = validate(
    [{ description: "d", file: "a.ts", line: 1, pattern: "two" }],
    root
  );
  assert.ok(issues.some((issue) => issue.message.includes("mutually exclusive")));
  rmrf(root);
});

test("line, pattern and selection require a file", () => {
  const root = workspaceWithFiles({ "a.ts": "one\ntwo\n" });
  const { issues } = validate(
    [
      { description: "d", line: 1 },
      { description: "d", pattern: "one" },
      {
        description: "d",
        selection: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } },
      },
    ],
    root
  );
  assert.equal(issues.length, 3);
  rmrf(root);
});

test("line must be a positive integer", () => {
  const root = workspaceWithFiles({ "a.ts": "one\n" });
  const { issues } = validate(
    [
      { description: "d", file: "a.ts", line: 0 },
      { description: "d", file: "a.ts", line: 1.5 },
    ],
    root
  );
  assert.equal(issues.filter((issue) => issue.path.endsWith(".line")).length, 2);
  rmrf(root);
});

test("a pattern must match exactly one occurrence", () => {
  const root = workspaceWithFiles({ "a.ts": "one\ntwo\none\n" });
  const { issues } = validate(
    [
      { description: "d", file: "a.ts", pattern: "one" },
      { description: "d", file: "a.ts", pattern: "three" },
    ],
    root
  );
  assert.equal(issues.length, 2);
  rmrf(root);
});

test("an invalid regular expression is rejected", () => {
  const root = workspaceWithFiles({ "a.ts": "one\n" });
  const { issues } = validate(
    [{ description: "d", file: "a.ts", pattern: "(unclosed" }],
    root
  );
  assert.equal(issues.length, 1);
  rmrf(root);
});

test("steps may anchor files and directories without line targeting", () => {
  const root = workspaceWithFiles({ "a.ts": "one\ntwo\n" });
  fs.mkdirSync(path.join(root, "sub"));
  const { steps, issues } = validate(
    [
      { description: "d", file: "a.ts" },
      { description: "d", directory: "sub" },
    ],
    root
  );
  assert.equal(issues.length, 0);
  assert.ok(steps);
  assert.equal(steps!.length, 2);
  rmrf(root);
});

test("content-only steps without any anchor are allowed", () => {
  const root = workspaceWithFiles({ "a.ts": "one\n" });
  const { steps, issues } = validate(
    [{ description: "intro" }, { description: "deleted file context" }],
    root
  );
  assert.equal(issues.length, 0);
  assert.ok(steps);
  assert.equal(steps!.length, 2);
  rmrf(root);
});

test("the recommended step maximum is fifteen", () => {
  assert.equal(MAX_RECOMMENDED_STEPS, 15);
});
