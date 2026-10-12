import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  callTool, commitFile, headSha, initGitRepo, readTourFile, rmrf,
  structuredCode, tempDir, withServer, writeFile,
} from "../helpers/test-utils";

test("creates a changes tour in an explicitly selected repository below a non-Git workspace", async () => {
  const root = tempDir();
  const repo = path.join(root, "site-de-creation-de-planches-legacy");
  const other = path.join(root, "other-repo");
  try {
    fs.mkdirSync(repo);
    fs.mkdirSync(other);
    await initGitRepo(repo);
    await initGitRepo(other);
    await commitFile(repo, "base.txt", "base\n", "base");
    const baseRef = await headSha(repo);
    await commitFile(repo, "feature.txt", "feature\n", "feature");
    const headRef = await headSha(repo);
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_changes_tour", {
        workspacePath: path.basename(repo), baseRef, headRef,
        steps: [{ description: "The feature.", file: "feature.txt", line: 1 }],
      });
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.path, "site-de-creation-de-planches-legacy/.tours/changes.tour");
    });
    const tour = readTourFile(repo, ".tours/changes.tour");
    assert.equal(tour.ref, headRef);
    assert.equal((tour.steps as Array<{ file: string }>)[0].file, "feature.txt");
    assert.ok(!fs.existsSync(path.join(root, ".tours")));
    assert.ok(!fs.existsSync(path.join(other, ".tours")));
  } finally {
    rmrf(root);
  }
});

test("selects a project directory per call without changing the server's default workspace", async () => {
  const root = tempDir();
  try {
    writeFile(root, "project/main.ts", "export {};\n");
    await withServer(root, async (client) => {
      const selected = await callTool(client, "create_project_tour", {
        workspacePath: "project",
        steps: [{ description: "Entry point.", file: "main.ts", line: 1 }],
      });
      assert.equal(selected.isError, false, selected.text);
      assert.equal(selected.structured.path, "project/.tours/project.tour");
      const defaultWorkspace = await callTool(client, "create_project_tour", {
        steps: [{ description: "Default entry point.", file: "project/main.ts" }],
      });
      assert.equal(defaultWorkspace.isError, false, defaultWorkspace.text);
      assert.equal(defaultWorkspace.structured.path, ".tours/project.tour");
    });
    assert.equal(readTourFile(root, "project/.tours/project.tour").title, "Project Overview");
  } finally {
    rmrf(root);
  }
});

test("rejects invalid or escaping workspace paths without replacing tours", async () => {
  const root = tempDir();
  const outside = tempDir();
  try {
    writeFile(root, ".tours/project.tour", "previous tour\n");
    writeFile(root, "file.txt", "not a directory\n");
    fs.symlinkSync(outside, path.join(root, "escape"));
    await withServer(root, async (client) => {
      for (const workspacePath of [null, 42, "", "../outside", outside, "escape", "missing", "file.txt"]) {
        for (const name of ["create_project_tour", "create_changes_tour"]) {
          const response = await callTool(client, name, {
            workspacePath,
            ...(name === "create_changes_tour" ? { baseRef: "main", headRef: "a".repeat(40) } : {}),
            steps: [{ description: "Must not be written." }],
          });
          assert.equal(response.isError, true, response.text);
          assert.equal(structuredCode(response), "INVALID_PROPOSAL");
          assert.ok((response.structured.issues as Array<{ path: string }>).some(issue => issue.path === "workspacePath"));
        }
      }
    });
    assert.equal(fs.readFileSync(path.join(root, ".tours/project.tour"), "utf8"), "previous tour\n");
    assert.ok(!fs.existsSync(path.join(outside, ".tours")));
  } finally {
    rmrf(root);
    rmrf(outside);
  }
});
