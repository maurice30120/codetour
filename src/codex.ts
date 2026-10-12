import { execFile } from "child_process";
import { promisify } from "util";
import * as vscode from "vscode";
import { bundledMcpServerPath } from "./mcp";

const execFileAsync = promisify(execFile);
const CODEX_EXECUTABLE = "codex";
const SERVER_NAME = "codetour";

interface CodexServerConfiguration {
  transport?: {
    type?: string;
    command?: string;
    args?: string[];
  };
}

async function runCodex(args: string[]): Promise<string> {
  const result = await execFileAsync(CODEX_EXECUTABLE, args, {
    encoding: "utf8",
    windowsHide: true
  });
  return result.stdout;
}

async function currentConfiguration(): Promise<CodexServerConfiguration | undefined> {
  try {
    return JSON.parse(
      await runCodex(["mcp", "get", SERVER_NAME, "--json"])
    ) as CodexServerConfiguration;
  } catch (error) {
    const exitCode = (error as { code?: unknown }).code;
    if (typeof exitCode === "number") {
      return undefined;
    }
    throw error;
  }
}

function isExpectedConfiguration(
  configuration: CodexServerConfiguration | undefined,
  serverPath: string
): boolean {
  return (
    configuration?.transport?.type === "stdio" &&
    configuration.transport.command === "node" &&
    configuration.transport.args?.length === 1 &&
    configuration.transport.args[0] === serverPath
  );
}

async function addConfiguration(serverPath: string): Promise<void> {
  await runCodex(["mcp", "add", SERVER_NAME, "--", "node", serverPath]);
}

async function configureCodex(context: vscode.ExtensionContext): Promise<void> {
  const serverPath = bundledMcpServerPath(context);
  const current = await currentConfiguration();
  if (isExpectedConfiguration(current, serverPath)) {
    void vscode.window.showInformationMessage("CodeTour is already configured for Codex.");
    return;
  }
  if (current) {
    const repair = "Repair configuration";
    const selected = await vscode.window.showWarningMessage(
      "Codex already has a different CodeTour MCP configuration.",
      repair
    );
    if (selected === repair) {
      await repairCodex(context);
    }
    return;
  }
  await addConfiguration(serverPath);
  void vscode.window.showInformationMessage("CodeTour MCP was configured for Codex.");
}

async function repairCodex(context: vscode.ExtensionContext): Promise<void> {
  const serverPath = bundledMcpServerPath(context);
  const current = await currentConfiguration();
  if (current) {
    await runCodex(["mcp", "remove", SERVER_NAME]);
  }
  await addConfiguration(serverPath);
  void vscode.window.showInformationMessage("CodeTour MCP configuration for Codex was repaired.");
}

async function reportFailure(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      `Unable to configure CodeTour for Codex. Make sure the Codex CLI and Node.js 18 or newer are available: ${message}`
    );
  }
}

export function registerCodexCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("codetour.configureCodexMcp", () =>
      reportFailure(() => configureCodex(context))
    ),
    vscode.commands.registerCommand("codetour.repairCodexMcp", () =>
      reportFailure(() => repairCodex(context))
    )
  );
}
