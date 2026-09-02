import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as assert from "node:assert";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  callTool,
  readTourFile,
  rmrf,
  tempDir,
} from "../helpers/test-utils";

const execFileAsync = promisify(execFile);
const packageRoot = path.join(__dirname, "..", "..", "..");

async function npm(args: string[], cwd: string, cache: string): Promise<string> {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : "npm";
  const commandArgs = npmCli ? [npmCli, ...args] : args;
  const result = await execFileAsync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: cache,
      npm_config_update_notifier: "false",
    },
  });
  return result.stdout;
}

test("the installed codetour-mcp binary serves the create_tour MCP tool without a ref", async () => {
  const sandbox = tempDir("codetour-mcp-package-test-");
  const archiveDir = path.join(sandbox, "archive");
  const installationRoot = path.join(sandbox, "consumer");
  const workspaceRoot = path.join(sandbox, "workspace");
  const npmCache = path.join(sandbox, "npm-cache");

  try {
    fs.mkdirSync(archiveDir, { recursive: true });
    await npm(
      ["pack", "--json", "--pack-destination", archiveDir],
      packageRoot,
      npmCache
    );
    const filename = fs
      .readdirSync(archiveDir)
      .find((entry) => entry.endsWith(".tgz"));
    assert.ok(filename, "npm pack should create a package archive");
    const archivePath = path.join(archiveDir, filename);

    // Seed the consumer with the already-installed dependency tree, then pass
    // every registry dependency exposed by the packed manifest as a local
    // source. npm still resolves direct dependencies during an install even
    // when their directories already exist; without the local sources, a cold
    // platform-specific cache (notably macOS ARM) fails in --offline mode.
    fs.mkdirSync(installationRoot, { recursive: true });
    fs.cpSync(
      path.join(packageRoot, "node_modules"),
      path.join(installationRoot, "node_modules"),
      { recursive: true }
    );
    await npm(
      [
        "install",
        "--prefix",
        installationRoot,
        "--ignore-scripts",
        "--offline",
        "--package-lock=false",
        "--no-audit",
        "--no-fund",
        archivePath,
        path.join(packageRoot, "node_modules", "@modelcontextprotocol", "sdk"),
        path.join(packageRoot, "node_modules", "ajv"),
        path.join(packageRoot, "node_modules", "@resvg", "resvg-js"),
        path.join(packageRoot, "node_modules", "jsdom"),
        path.join(packageRoot, "node_modules", "mermaid"),
        path.join(packageRoot, "node_modules", "zod"),
      ],
      sandbox,
      npmCache
    );

    // The shared renderer is a local monorepo package, so npm pack cannot
    // carry its sibling path dependency into the isolated consumer. Seed the
    // consumer with the already-built package and its already-installed
    // dependency tree, preserving the test's fully offline contract.
    const rendererRoot = path.join(packageRoot, "..", "description-renderer");
    const rendererTarget = path.join(
      installationRoot,
      "node_modules",
      "codetour-description-renderer"
    );
    let rendererIsAlreadyLinked = false;
    try {
      rendererIsAlreadyLinked = fs.lstatSync(rendererTarget).isSymbolicLink();
    } catch {
      // The package installer may not have created the local dependency.
    }
    if (rendererIsAlreadyLinked) {
      fs.unlinkSync(rendererTarget);
    }
    if (!rendererIsAlreadyLinked || !fs.existsSync(rendererTarget)) {
      fs.cpSync(rendererRoot, rendererTarget, {
        recursive: true,
        filter: (source) =>
          path.basename(source) !== "node_modules" &&
          !source.includes(`${path.sep}node_modules${path.sep}`),
      });
      fs.cpSync(
        path.join(rendererRoot, "node_modules"),
        path.join(installationRoot, "node_modules"),
        { recursive: true }
      );
    }

    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "base.txt"), "base\n");

    const binaryPath = path.join(
      installationRoot,
      "node_modules",
      ".bin",
      "codetour-mcp"
    );
    const client = new Client(
      { name: "packaged-binary-test-client", version: "0.0.0" },
      { capabilities: {} }
    );
    const transport = new StdioClientTransport({
      command: binaryPath,
      cwd: workspaceRoot,
    });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      const tool = tools.tools.find((entry) => entry.name === "create_tour");
      assert.ok(tool, "create_tour should be exposed");
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      assert.deepEqual(
        Object.keys(properties).sort(),
        ["description", "fileName", "steps", "title"]
      );
      assert.ok(
        !Object.prototype.hasOwnProperty.call(properties, "baseRef"),
        "create_tour must not expose Git parameters"
      );

      const tour = await callTool(client, "create_tour", {
        fileName: "overview.tour",
        title: "Overview",
        steps: [{ description: "The base file.", file: "base.txt" }],
      });
      assert.equal(tour.isError, false, tour.text);
    } finally {
      await client.close();
    }

    const written = readTourFile(workspaceRoot, ".tours/overview.tour");
    assert.equal(written.title, "Overview");
    assert.equal(written.ref, undefined);
  } finally {
    rmrf(sandbox);
  }
});
