import { test } from "node:test";
import * as assert from "node:assert";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import {
  CLI_PATH,
  callTool,
  rmrf,
  startServer,
  stopServer,
  tempDir,
  writeFile,
} from "../helpers/test-utils";

test("--workspace-root serves a directory other than the process working directory", async () => {
  const root = tempDir();
  const elsewhere = tempDir();
  let client;
  try {
    writeFile(root, "hello.txt", "hello workspace\n");
    client = await startServer(elsewhere, {}, ["--workspace-root", root]);
    const response = await callTool(client, "create_project_tour", {
      title: "Served Workspace",
      steps: [{ file: "hello.txt", description: "Anchored inside the workspace passed to --workspace-root." }],
    });
    assert.equal(response.isError, false, response.text);
    assert.equal(response.structured.status, "created");
    assert.equal(response.structured.path, ".tours/project.tour");
    assert.ok(fs.existsSync(`${root}/.tours/project.tour`));
    assert.ok(!fs.existsSync(`${elsewhere}/.tours/project.tour`));
  } finally {
    if (client) {
      await stopServer(client);
    }
    rmrf(root);
    rmrf(elsewhere);
  }
});

test("--workspace-root=<directory> is accepted like the spaced form", async () => {
  const root = tempDir();
  const elsewhere = tempDir();
  let client;
  try {
    writeFile(root, "hello.txt", "hello workspace\n");
    client = await startServer(elsewhere, {}, [`--workspace-root=${root}`]);
    const response = await callTool(client, "create_project_tour", {
      steps: [{ file: "hello.txt", description: "Anchored inside the workspace passed to --workspace-root." }],
    });
    assert.equal(response.isError, false, response.text);
    assert.ok(fs.existsSync(`${root}/.tours/project.tour`));
  } finally {
    if (client) {
      await stopServer(client);
    }
    rmrf(root);
    rmrf(elsewhere);
  }
});

test("a missing value or an unknown argument is rejected", () => {
  const root = tempDir();
  try {
    const missingValue = spawnSync(
      process.execPath,
      [CLI_PATH, "--workspace-root"],
      { cwd: root, encoding: "utf8", timeout: 5_000 }
    );
    assert.equal(missingValue.status, 1);
    assert.match(missingValue.stderr, /Missing value for --workspace-root/);

    const unknown = spawnSync(process.execPath, [CLI_PATH, "--bogus"], {
      cwd: root,
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown argument: --bogus/);
  } finally {
    rmrf(root);
  }
});

test("an inaccessible --workspace-root fails at startup with a clear error", () => {
  const root = tempDir();
  try {
    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "--workspace-root", `${root}/missing`],
      { cwd: root, encoding: "utf8", timeout: 5_000 }
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not an accessible directory/);
  } finally {
    rmrf(root);
  }
});
