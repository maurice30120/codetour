import * as vscode from "vscode";
import { registerMcpProvider } from "./mcp";

export function registerDesktopIntegrations(
  context: vscode.ExtensionContext
): void {
  // The MCP provider and the Codex commands depend on Node.js APIs
  // (child_process), which are not available in the web extension host,
  // so they are only registered when the extension runs on the desktop.
  if (vscode.env.uiKind !== vscode.UIKind.Desktop) {
    return;
  }

  registerMcpProvider(context);

  // Required lazily so that the web bundle never evaluates the Codex
  // module, which imports Node.js-only modules at its top level.
  const { registerCodexCommands } = require("./codex") as typeof import("./codex");
  registerCodexCommands(context);
}
