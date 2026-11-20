import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { loadTour } from "../store/tourSchema";

// The parcours seam: one temporary workspace, the installed CLI bundle and the
// real CodeTour MCP stdio server. Nothing here re-implements the workflow; the
// test performs the exact calls the served generation prompt prescribes and
// proves that the Knowledge catalogue, the CLI reads and the MCP Tour all
// target the same workspace.
const root = path.resolve(__dirname, "../../..");
const cli = path.join(root, "dist", "cli.js");
const mcpRequire = createRequire(path.join(root, "packages", "mcp-server", "package.json"));
const { Client } = mcpRequire("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = mcpRequire("@modelcontextprotocol/sdk/client/stdio.js");

// No model credential and no network configuration reach the CLI or the MCP
// server: the workflow is deterministic.
function credentialFreeEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  for (const key of ["HOME", "TMPDIR", "TEMP", "TMP", "USERPROFILE", "SystemRoot", "ComSpec", "PATHEXT"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

function runCli(args: string[], cwd: string, env: Record<string, string>) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env, timeout: 60000 });
  let json: any;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = undefined;
  }
  return { ...result, json };
}

// Discovery carries one opaque Knowledge Revision per row (spec #232, ADR
// 0048), so a row is its name and description plus that hex token: the shape
// assertion pins the token and never its value, and no body reaches a listing.
function metadataRows(entries: unknown): Array<Record<string, unknown>> {
  return (entries as Array<Record<string, unknown>>).map((row) => {
    const { revision, ...metadata } = row;
    assert.equal(typeof revision, "string", "a discovery row carries its Knowledge Revision");
    assert.match(revision as string, /^[0-9a-f]{64}$/);
    return metadata;
  });
}

// The installation step drives the real Copilot CLI (Agent Plugins 1.0
// registration); without the binary the parcours cannot exercise it, in line
// with the skip contract of test/copilot-plugin-install.test.mjs.
const copilotProbe = spawnSync("copilot", ["--version"], { encoding: "utf8" });
const copilotSkip = copilotProbe.status === 0 ? undefined : "the 'copilot' CLI is not available on PATH";

test("a project Tour is built from the Knowledge discovered in the same workspace", { skip: copilotSkip }, async () => {
  const workspace = realpathSync(mkdtempSync(path.join(os.tmpdir(), "codetour-parcours-")));
  const env = credentialFreeEnv({
    COPILOT_HOME: path.join(workspace, "copilot-home"),
    CODETOUR_COPILOT_MCP_CONFIG: path.join(workspace, "mcp-config.json"),
    CODETOUR_COPILOT_EXTENSIONS_DIR: path.join(workspace, "copilot-extensions")
  });
  try {
    // 1. The target workspace, and the skill Copilot discovers there.
    mkdirSync(path.join(workspace, "src"));
    const source = "export function dispatch(tool: string): string {\n  return tool;\n}\n";
    writeFileSync(path.join(workspace, "src", "dispatch.ts"), source);

    const installed = runCli(["--install", "copilot"], workspace, env);
    assert.equal(installed.status, 0, installed.stderr);
    assert.ok(
      !existsSync(path.join(env.COPILOT_HOME, "skills", "codetour-knowledge", "SKILL.md")),
      "the retired standalone Knowledge skill is not installed"
    );

    // 2. Consolidation: one reusable Knowledge about the dispatch path.
    const body = "## Dispatch\n\n`dispatch` returns the tool name it receives.\n";
    const proposal = path.join(workspace, "proposal.json");
    writeFileSync(proposal, JSON.stringify({
      entries: [{
        name: "dispatch_flow",
        description: "How a tool call is dispatched",
        body,
        evidence: [{ path: "src/dispatch.ts" }]
      }]
    }));
    const saved = runCli(["knowledge", "save", "--workspace", workspace, "--proposal", proposal], workspace, env);
    assert.equal(saved.status, 0, saved.stderr);
    assert.equal(saved.json.status, "saved");
    assert.deepEqual(saved.json.saved, ["dispatch_flow"]);

    // 3. A second, independent invocation rediscovers the entry by metadata
    // only, then returns the body because every declared proof verifies.
    const listed = runCli(["knowledge", "list", "--workspace", workspace], workspace, env);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(metadataRows(listed.json.entries), [{ name: "dispatch_flow", description: "How a tool call is dispatched" }]);
    assert.doesNotMatch(listed.stdout, /dispatch returns the tool name/);

    const read = runCli(["knowledge", "read", "dispatch_flow", "--workspace", workspace], workspace, env);
    assert.equal(read.status, 0, read.stderr);
    assert.equal(read.json.status, "valid");
    assert.equal(read.json.body, body);

    // 4. The Tour is created by the real MCP server, in the same workspace.
    const client = new Client({ name: "codetour-parcours-test", version: "0.0.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, "mcp"],
      cwd: workspace,
      env,
      stderr: "pipe"
    });
    let created: { status: string; path: string; stepCount: number };
    try {
      await client.connect(transport);
      const response = await client.callTool({
        name: "create_project_tour",
        arguments: {
          title: "How dispatch works",
          steps: [
            { description: "This Tour follows one tool call from its entry point to its result." },
            { file: "src/dispatch.ts", line: 1, description: read.json.body },
            { file: "src/dispatch.ts", line: 2, description: "The returned tool name is the dispatch result." }
          ]
        }
      });
      assert.equal(response.isError ?? false, false, JSON.stringify(response.content));
      created = (response as any).structuredContent;
      assert.equal(created.status, "created");
      assert.equal(created.stepCount, 3);
    } finally {
      await client.close();
    }

    // 5. Open the created file through the reader's own loader: a structural
    // guarantee, separate from whether the explanation is semantically right.
    const tourFile = path.join(workspace, created.path);
    assert.ok(tourFile.startsWith(path.join(workspace, ".tours")), created.path);
    const tour = loadTour(readFileSync(tourFile, "utf8"), pathToFileURL(tourFile).toString());
    assert.equal(tour.title, "How dispatch works");
    assert.equal(tour.steps.length, 3);
    assert.equal(tour.steps[1].file, "src/dispatch.ts");
    assert.equal(tour.steps[1].line, 1);
    assert.match(tour.steps[1].description, /`dispatch` returns the tool name/);
    // The evidence the Knowledge cited is still the file the Tour anchors to.
  } finally {
    rmSync(workspace, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  }
});

test("a second generation reuses the Knowledge validated by the first and opens its Tour", async () => {
  const workspace = realpathSync(mkdtempSync(path.join(os.tmpdir(), "codetour-parcours-reuse-")));
  const env = credentialFreeEnv();
  try {
    mkdirSync(path.join(workspace, "src"));
    execFileSync("git", ["init", "-q", workspace]);
    const source = "export function dispatch(tool: string): string {\n  return tool;\n}\n";
    writeFileSync(path.join(workspace, "src", "dispatch.ts"), source);

    const body = "## Dispatch\n\n`dispatch` returns the tool name it receives.\n";
    const proposal = path.join(workspace, "proposal.json");
    writeFileSync(proposal, JSON.stringify({
      entries: [{
        name: "dispatch_flow",
        description: "How a tool call is dispatched",
        body,
        evidence: [{ path: "src/dispatch.ts" }]
      }]
    }));

    // One independent MCP client per generation, exactly as two separate
    // sessions would connect: the second client knows nothing of the first.
    async function createTour(fileName: string, title: string, description: string) {
      const client = new Client({ name: `codetour-generation-${fileName}`, version: "0.0.0" }, { capabilities: {} });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [cli, "mcp"],
        cwd: workspace,
        env,
        stderr: "pipe"
      });
      try {
        await client.connect(transport);
        const response = await client.callTool({
          name: "create_project_tour",
          arguments: {
            title,
            fileName,
            steps: [
              { description: "This Tour follows one tool call from its entry point to its result." },
              { file: "src/dispatch.ts", line: 1, description }
            ]
          }
        });
        assert.equal(response.isError ?? false, false, JSON.stringify(response.content));
        const created = (response as any).structuredContent;
        assert.equal(created.status, "created");
        return created as { status: string; path: string; stepCount: number };
      } finally {
        await client.close();
      }
    }

    // Generation 1: it publishes the reusable Knowledge, then builds the
    // first Tour from what it just observed.
    const saved = runCli(["knowledge", "save", "--workspace", workspace, "--proposal", proposal], workspace, env);
    assert.equal(saved.status, 0, saved.stderr);
    assert.deepEqual(saved.json.saved, ["dispatch_flow"]);
    const first = await createTour("generation-one", "Generation one: dispatch", "First generation explanation of `dispatch`.");

    // Generation 2: a brand-new process pair. It rediscovers the entry by
    // metadata and rereads the body through the evidence gate; nothing carries
    // over in memory from generation 1.
    const listed = runCli(["knowledge", "list", "--workspace", workspace], workspace, env);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(metadataRows(listed.json.entries), [{ name: "dispatch_flow", description: "How a tool call is dispatched" }]);
    assert.doesNotMatch(listed.stdout, /dispatch returns the tool name/);

    const read = runCli(["knowledge", "read", "dispatch_flow", "--workspace", workspace], workspace, env);
    assert.equal(read.status, 0, read.stderr);
    assert.equal(read.json.status, "valid");
    assert.equal(read.json.body, body);
    assert.equal(typeof read.json.revision, "string", "a read carries the same opaque token");
    assert.deepEqual(read.json.evidence, [{ path: "src/dispatch.ts", sha256: createHash("sha256").update(source).digest("hex") }]);

    // The second Tour is built from the body generation 2 read, not from the
    // source file alone: the validated Knowledge is the reference context.
    const second = await createTour("generation-two", "Generation two: dispatch reused", read.json.body);
    assert.notEqual(second.path, first.path, "the two generations write distinct Tours");

    // Open the second Tour through the CLI's own HTML reader, without a
    // browser: the same loader and renderer a user gets.
    const htmlPath = path.join(workspace, "generation-two.html");
    const resolved = runCli(["--internal-resolve-tour", "Generation two: dispatch reused"], workspace, env);
    assert.equal(resolved.status, 0, resolved.stderr);
    const opened = runCli(["--internal-tour-id", resolved.json.id, "--renderer", "html"], workspace, {
      ...env,
      CODETOUR_TEST_HTML_OUTPUT: htmlPath
    });
    assert.equal(opened.status, 0, opened.stderr);
    const html = readFileSync(htmlPath, "utf8");
    assert.match(html, /Generation two: dispatch reused/);
    assert.match(html, /returns the tool name it receives/);

    // Both Tours still load through the reader's own schema loader; the first
    // generation's output was not overwritten by the second.
    for (const [created, title, description] of [
      [first, "Generation one: dispatch", "First generation explanation of `dispatch`."],
      [second, "Generation two: dispatch reused", body]
    ] as const) {
      const file = path.join(workspace, created.path);
      assert.ok(file.startsWith(path.join(workspace, ".tours")), created.path);
      const tour = loadTour(readFileSync(file, "utf8"), pathToFileURL(file).toString());
      assert.equal(tour.title, title);
      assert.equal(tour.steps.length, 2);
      assert.equal(tour.steps[1].file, "src/dispatch.ts");
      assert.equal(tour.steps[1].line, 1);
      assert.ok(tour.steps[1].description.includes(description.slice(0, 24)));
    }
    // The Knowledge evidence still matches the source both generations cite.
    assert.equal(readFileSync(path.join(workspace, "src", "dispatch.ts"), "utf8"), source);
  } finally {
    rmSync(workspace, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  }
});
