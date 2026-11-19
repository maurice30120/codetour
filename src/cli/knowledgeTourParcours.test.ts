import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { loadTour } from "../store/tourSchema";

// The parcours seam: one temporary workspace, the installed CLI bundle and the
// real CodeTour MCP stdio server. Nothing here re-implements the workflow; the
// test performs the exact calls the installed skill prescribes and proves that
// the Knowledge catalogue, the CLI reads and the MCP Tour all target the same
// workspace.
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

test("a project Tour is built from the Knowledge the installed skill tells the agent to read", async () => {
  const workspace = realpathSync(mkdtempSync(path.join(os.tmpdir(), "codetour-parcours-")));
  const skillsDir = path.join(workspace, "copilot-skills");
  const env = credentialFreeEnv({
    CODETOUR_COPILOT_MCP_CONFIG: path.join(workspace, "mcp-config.json"),
    CODETOUR_COPILOT_EXTENSIONS_DIR: path.join(workspace, "copilot-extensions"),
    CODETOUR_COPILOT_SKILLS_DIR: skillsDir
  });
  try {
    // 1. The target workspace, and the skill Copilot discovers there.
    mkdirSync(path.join(workspace, "src"));
    const source = "export function dispatch(tool: string): string {\n  return tool;\n}\n";
    writeFileSync(path.join(workspace, "src", "dispatch.ts"), source);

    const installed = runCli(["--install", "copilot"], workspace, env);
    assert.equal(installed.status, 0, installed.stderr);
    const skillFile = path.join(skillsDir, "codetour-knowledge", "SKILL.md");
    assert.equal(
      readFileSync(skillFile, "utf8"),
      readFileSync(path.join(root, "packages", "knowledge", "skills", "codetour-knowledge", "SKILL.md"), "utf8")
    );
    assert.match(readFileSync(skillFile, "utf8"), /codetour knowledge read <name> --workspace/);

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
    assert.deepEqual(listed.json.entries, [{ name: "dispatch_flow", description: "How a tool call is dispatched" }]);
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
    assert.equal(readFileSync(path.join(workspace, "src", "dispatch.ts"), "utf8"), source);
  } finally {
    rmSync(workspace, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  }
});
