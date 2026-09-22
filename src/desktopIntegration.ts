import * as vscode from "vscode";
import { registerMcpProvider } from "./mcp";

export function registerDesktopIntegrations(
  context: vscode.ExtensionContext
): void {
  // The MCP provider spawns the bundled server with Node.js APIs
  // (child_process), which are not available in the web extension host,
  // so it is only registered when the extension runs on the desktop.
  if (vscode.env.uiKind !== vscode.UIKind.Desktop) {
    return;
  }

  registerMcpProvider(context);
}
