import { test } from "node:test";
import * as assert from "node:assert";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { runMcpCli } from "../../src/cli";
import {
  CLI_PATH,
  callTool,
  rmrf,
  startServer,
  stopServer,
  tempDir,
  writeFile,
} from "../helpers/test-utils";

const packageRoot = path.join(__dirname, "..", "..", "..");
const serverVersion = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")
).version as string;

test("the programmatic entry reports help on the out sink and returns 0", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runMcpCli(["--help"], {
    out: text => out.push(text),
    err: text => err.push(text),
  });
  assert.equal(code, 0);
  assert.equal(err.length, 0);
  assert.match(out.join("\n"), new RegExp(`codetour-mcp v${serverVersion}`));
  assert.match(out.join("\n"), /--workspace-root <dir>/);
});

test("the programmatic entry reports the MCP server version", async () => {
  const out: string[] = [];
  const code = await runMcpCli(["--version"], {
    out: text => out.push(text),
    err: () => assert.fail("version must not write diagnostics"),
  });
  assert.equal(code, 0);
  assert.deepEqual(out, [serverVersion]);
});

test("the programmatic entry rejects an unknown argument on the err sink", async () => {
  const err: string[] = [];
  const code = await runMcpCli(["--bogus"], {
    out: () => assert.fail("an argument error must not write to out"),
    err: text => err.push(text),
  });
  assert.equal(code, 1);
  assert.match(err.join("\n"), /Unknown argument: --bogus/);
  assert.match(err.join("\n"), /Usage: codetour-mcp/);
});

test("the programmatic entry reports a missing --workspace-root value", async () => {
  const err: string[] = [];
  const code = await runMcpCli(["--workspace-root"], {
    out: () => assert.fail("an argument error must not write to out"),
    err: text => err.push(text),
  });
  assert.equal(code, 1);
  assert.match(err.join("\n"), /Missing value for --workspace-root/);
});

test("the programmatic entry reports an inaccessible workspace before the protocol", async () => {
  const root = tempDir();
  try {
    const err: string[] = [];
    const code = await runMcpCli(["--workspace-root", `${root}/missing`], {
      out: () => assert.fail("a workspace failure must not write to out"),
      err: text => err.push(text),
    });
    assert.equal(code, 1);
    assert.match(err.join("\n"), /not an accessible directory/);
  } finally {
    rmrf(root);
  }
});

test("the codetour-mcp binary prints help and version with a zero exit code", () => {
  const help = spawnSync(process.execPath, [CLI_PATH, "--help"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: codetour-mcp/);
  assert.equal(help.stderr, "");

  const version = spawnSync(process.execPath, [CLI_PATH, "--version"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), serverVersion);
  assert.equal(version.stderr, "");
});

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
