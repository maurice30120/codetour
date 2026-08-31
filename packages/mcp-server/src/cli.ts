#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "./context";
import { createServer } from "./server";
import packageJson from "../package.json";

// Point d'entrée du binaire `codetour-mcp`.
// Le serveur ne traite qu'un seul workspace, imposé via `--workspace-root`,
// et ne communique que par le transport `stdio` (aucun accès réseau).

interface ParsedArgs {
  workspaceRoot?: string;
  help: boolean;
  version: boolean;
}

function usage(): string {
  return [
    `codetour-mcp v${packageJson.version}`,
    "Local MCP server for AI-generated CodeTour Project Tours and Changes Tours.",
    "",
    "Usage: codetour-mcp --workspace-root <path>",
    "",
    "Options:",
    "  --workspace-root <path>  Workspace root that all operations are confined to (required)",
    "  --help, -h               Show this help",
    "  --version, -v            Show the version",
  ].join("\n");
}

// Analyse les arguments de la ligne de commande.
// Accepte `--workspace-root <chemin>` et `--workspace-root=<chemin>`.
function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { help: false, version: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      result.help = true;
    } else if (argument === "--version" || argument === "-v") {
      result.version = true;
    } else if (argument === "--workspace-root") {
      result.workspaceRoot = argv[++index];
    } else if (argument.startsWith("--workspace-root=")) {
      result.workspaceRoot = argument.slice("--workspace-root=".length);
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
  // La racine du workspace est obligatoire : toutes les opérations y sont confinées.
  if (!args.workspaceRoot) {
    console.error(`Error: --workspace-root is required.\n\n${usage()}`);
    process.exit(1);
  }
  // Vérifie que la racine existe avant de démarrer, pour échouer clairement.
  try {
    createContext(args.workspaceRoot);
  } catch {
    console.error(
      `Error: the workspace root is not an accessible directory: ${args.workspaceRoot}`
    );
    process.exit(1);
  }

  const server = createServer(args.workspaceRoot);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
