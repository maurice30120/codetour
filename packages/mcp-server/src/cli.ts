#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "./context";
import { createServer } from "./server";
import packageJson from "../package.json";

// Entry point for the `codetour-mcp` binary.
// The server handles exactly one workspace: the process working directory,
// which every MCP client can set without a proprietary launch argument.
// `--workspace-root` is an explicit override for clients that cannot control
// the working directory of the launched process.

interface ParsedArgs {
  help: boolean;
  version: boolean;
  workspaceRoot?: string;
}

function usage(): string {
  return [
    `codetour-mcp v${packageJson.version}`,
    "Local MCP server for AI-generated CodeTour Project Tours and Changes Tours.",
    "",
    "Usage: codetour-mcp [--workspace-root <directory>]",
    "",
    "Options:",
    "  --help, -h               Show this help",
    "  --version, -v            Show the version",
    "  --workspace-root <dir>    Workspace to serve instead of the process working directory",
    "",
    "The server serves exactly one workspace: the process working directory by",
    "default, or the directory passed to --workspace-root. Prefer setting the",
    "working directory; use --workspace-root only when the client cannot.",
  ].join("\n");
}

// Parse command-line arguments.
function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { help: false, version: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      result.help = true;
    } else if (argument === "--version" || argument === "-v") {
      result.version = true;
    } else if (argument.startsWith("--workspace-root=")) {
      result.workspaceRoot = argument.slice("--workspace-root=".length);
    } else if (argument === "--workspace-root") {
      const value = argv[index + 1];
      if (value === undefined) {
        console.error(`Missing value for ${argument}\n\n${usage()}`);
        process.exit(1);
      }
      result.workspaceRoot = value;
      index++;
    } else {
      console.error(`Unknown argument: ${argument}\n\n${usage()}`);
      process.exit(1);
    }
  }
  if (result.workspaceRoot !== undefined && result.workspaceRoot.trim() === "") {
    console.error(`Empty value for --workspace-root\n\n${usage()}`);
    process.exit(1);
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.version) {
    console.log(packageJson.version);
    return;
  }
  const workspaceRoot = args.workspaceRoot ?? process.cwd();
  // Verify the workspace before starting, so failures are clear.
  try {
    createContext(workspaceRoot);
  } catch {
    console.error(
      `Error: the workspace is not an accessible directory: ${workspaceRoot}`
    );
    process.exit(1);
  }

  const server = createServer(workspaceRoot);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
