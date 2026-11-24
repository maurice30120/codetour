import * as vscode from "vscode";
import { registerCodexCommands } from "./codex";
import { registerMcpProvider } from "./mcp";

export function registerDesktopIntegrations(context: vscode.ExtensionContext): void {
  if (vscode.env.uiKind !== vscode.UIKind.Desktop) {
    return;
  }

  registerMcpProvider(context);
  registerCodexCommands(context);
}
