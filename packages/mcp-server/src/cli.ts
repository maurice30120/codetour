#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "./context";
import { createServer } from "./server";
import packageJson from "../package.json";

// Entry point for the `codetour-mcp` binary.
// The server handles one workspace: the process working directory. MCP
// clients can all set this directory without adding an owner-specific launch
// argument to the protocol.

interface ParsedArgs {
  help: boolean;
  version: boolean;
}

function usage(): string {
  return [
    `codetour-mcp v${packageJson.version}`,
    "Local MCP server for AI-generated CodeTour Project Tours and Changes Tours.",
    "",
    "Usage: codetour-mcp",
    "",
    "Options:",
    "  --help, -h               Show this help",
    "  --version, -v            Show the version",
  ].join("\n");
}

// Analyse les arguments de la ligne de commande.
function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { help: false, version: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      result.help = true;
    } else if (argument === "--version" || argument === "-v") {
      result.version = true;
    } else {
      console.error(`Unknown argument: ${argument}\n\n${usage()}`);
      process.exit(1);
    }
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
  const workspaceRoot = process.cwd();
  // Validate the working directory before starting so failures are explicit.
  try {
    createContext(workspaceRoot);
  } catch {
    console.error(
      `Error: the working directory is not an accessible workspace: ${workspaceRoot}`
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
