const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { canonicalWorkspacePath, sameWorkspace, stripTrailingSeparator } = require("..");

test("unavailable workspaces retain their resolved spelling", () => {
  const missing = path.resolve("missing", "repo");
  assert.equal(canonicalWorkspacePath(missing + path.sep, () => { throw new Error(); }), missing);
  assert.equal(sameWorkspace(missing, missing), true);
});

test("workspace identity follows native real paths and distinguishes roots", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "codetour-identity-"));
  try {
    const repo = path.join(parent, "repo");
    fs.mkdirSync(repo);
    assert.equal(canonicalWorkspacePath(repo + path.sep), fs.realpathSync.native(repo));
    assert.equal(sameWorkspace(repo, path.join(repo, "..", "repo")), true);
    assert.equal(sameWorkspace(repo, parent), false);
    assert.equal(stripTrailingSeparator(path.parse(repo).root), path.parse(repo).root === path.sep ? path.sep : path.parse(repo).root.slice(0, -1));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
