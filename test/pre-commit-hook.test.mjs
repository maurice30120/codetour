import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";

const repository = path.resolve(import.meta.dirname, "..");
const fixtures = [];

function run(command, args, options = {}) {
  // A nested `node --test` refuses to start when it inherits the outer
  // runner's child context, so the guard runs under a plain shell environment
  // like a contributor's.
  const { NODE_TEST_CONTEXT, ...environment } = process.env;
  return spawnSync(command, args, { encoding: "utf8", env: environment, ...options });
}

function git(cwd, ...args) {
  return run("git", args, { cwd });
}

// Dependencies and the last local build are shared read-only through
// symlinks, like a contributor's working copy or a worktree of this checkout.
function shareSetup(root, { withBuild = true } = {}) {
  symlinkSync(path.join(repository, "node_modules"), path.join(root, "node_modules"), "dir");
  if (!withBuild) return;
  symlinkSync(path.join(repository, "dist"), path.join(root, "dist"), "dir");
  for (const packageName of ["description-renderer", "mcp-server"]) {
    mkdirSync(path.join(root, "packages", packageName), { recursive: true });
    symlinkSync(
      path.join(repository, "packages", packageName, "dist"),
      path.join(root, "packages", packageName, "dist"),
      "dir"
    );
  }
}

// A fixture repository holds the tracked files the fast guard reads: the
// sources it type-checks and the Copilot adapter suite it runs.
function createRepository({ withBuild = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-pre-commit-"));
  fixtures.push(root);
  for (const entry of [
    ".githooks",
    ".gitattributes",
    ".gitignore",
    ".github/extensions",
    "src",
    "tsconfig.json",
    "tsconfig.test.json",
    "package.json"
  ]) {
    cpSync(path.join(repository, entry), path.join(root, entry), { recursive: true });
  }
  mkdirSync(path.join(root, "test"));
  cpSync(
    path.join(repository, "test/copilot-adapter.test.mjs"),
    path.join(root, "test/copilot-adapter.test.mjs")
  );
  shareSetup(root, { withBuild });
  assert.equal(git(root, "init", "-q").status, 0);
  assert.equal(git(root, "config", "user.email", "guard@example.test").status, 0);
  assert.equal(git(root, "config", "user.name", "Guard Fixture").status, 0);
  assert.equal(git(root, "add", "-A").status, 0);
  assert.equal(
    git(root, "commit", "--no-verify", "-q", "-m", "fixture baseline").status,
    0
  );
  // The documented one-line setup, verified against real commits below.
  assert.equal(git(root, "config", "core.hooksPath", ".githooks").status, 0);
  return root;
}

function commit(cwd, message) {
  const staged = git(cwd, "add", "-A");
  assert.equal(staged.status, 0, staged.stderr);
  return git(cwd, "commit", "-m", message);
}

function head(cwd) {
  const result = git(cwd, "rev-parse", "HEAD");
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function breakTypeCheck(root) {
  appendFileSync(
    path.join(root, "src/extension.ts"),
    '\nconst brokenGuardFixture: number = "not a number";\n'
  );
}

test("a valid commit passes the guard", () => {
  const root = createRepository();
  writeFileSync(path.join(root, "NOTES.md"), "# Fixture notes\n");

  const result = commit(root, "a valid change");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /pre-commit: type checking/);
});

test("a commit that breaks the type check is refused before it reaches history", () => {
  const root = createRepository();
  const before = head(root);
  breakTypeCheck(root);

  const result = commit(root, "break the type check");

  assert.notEqual(result.status, 0, "the guard must refuse the commit");
  assert.equal(head(root), before, "a refused commit must leave history untouched");
  assert.match(result.stderr, /pre-commit/);
  assert.match(result.stderr, /src\/extension\.ts\(\d+,\d+\): error TS2322/);
});

test("a commit that breaks the Copilot adapter tests is refused before it reaches history", () => {
  const root = createRepository();
  const before = head(root);
  const adapter = path.join(root, ".github/extensions/codetour/adapter.mjs");
  writeFileSync(
    adapter,
    readFileSync(adapter, "utf8").replace("Starting CodeTour: ", "Starting: ")
  );

  const result = commit(root, "break the Copilot adapter");

  assert.notEqual(result.status, 0, "the guard must refuse the commit");
  assert.equal(head(root), before, "a refused commit must leave history untouched");
  assert.match(result.stderr, /pre-commit/);
  assert.match(result.stderr, /Starting CodeTour/);
});

test("the guard runs from a linked worktree and a subdirectory", () => {
  const root = createRepository();
  const linked = path.join(mkdtempSync(path.join(os.tmpdir(), "codetour-pre-commit-wt-")), "guard");
  fixtures.push(path.dirname(linked));
  const added = git(root, "worktree", "add", "-q", "-b", "guard-probe", linked, "HEAD");
  assert.equal(added.status, 0, added.stderr);
  shareSetup(linked);
  breakTypeCheck(linked);

  const result = commit(path.join(linked, "src"), "break the type check from a linked worktree");

  assert.notEqual(result.status, 0, "the guard must refuse the commit");
  assert.match(result.stderr, /pre-commit/);
  assert.match(result.stderr, /src\/extension\.ts\(\d+,\d+\): error TS2322/);
});

test("a repository without a local build is told to run the documented setup", () => {
  const root = createRepository({ withBuild: false });
  const before = head(root);
  writeFileSync(path.join(root, "NOTES.md"), "# Fixture notes\n");

  const result = commit(root, "a valid change without a build");

  assert.notEqual(result.status, 0, "the guard must not pass without running its checks");
  assert.equal(head(root), before, "a refused commit must leave history untouched");
  assert.match(result.stderr, /pre-commit/);
  assert.match(result.stderr, /npm run build/);
});

after(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

