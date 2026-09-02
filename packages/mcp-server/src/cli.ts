#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "./context";
import { createServer } from "./server";
import packageJson from "../package.json";

// Point d'entrée du binaire `codetour-mcp`.
// Le serveur ne traite qu'un seul workspace : le répertoire de travail du
// processus. Les clients MCP savent tous définir ce répertoire sans ajouter un
// argument propriétaire au protocole de lancement.

interface ParsedArgs {
  help: boolean;
  version: boolean;
}

function usage(): string {
  return [
    `codetour-mcp v${packageJson.version}`,
    "Local MCP server that deterministically validates and persists AI-generated CodeTour Tours.",
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
  // Vérifie le répertoire de travail avant de démarrer, pour échouer clairement.
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
