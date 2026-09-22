import * as path from "path";
import * as vscode from "vscode";

export const MCP_PROVIDER_ID = "codetour.tour-generator";

// The MCP server definition provider API (vscode.lm.registerMcpServerDefinitionProvider,
// McpStdioServerDefinition) is stable only since VS Code 1.101. To preserve the
// extension's engine floor of ^1.60, the API is declared locally (see
// vscode-mcp.d.ts) and feature-detected at runtime: on hosts that do not expose
// it, registration is skipped and the feature is simply inactive.

export function bundledMcpServerPath(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, "dist", "mcp-server.js");
}

export function registerMcpProvider(context: vscode.ExtensionContext): void {
  if (
    !vscode.lm?.registerMcpServerDefinitionProvider ||
    !vscode.McpStdioServerDefinition
  ) {
    return;
  }

  const serverPath = bundledMcpServerPath(context);
  const extensionVersion = String(context.extension.packageJSON.version);
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
      provideMcpServerDefinitions: () =>
        (vscode.workspace.workspaceFolders ?? []).map(folder => {
          const definition = new vscode.McpStdioServerDefinition(
            `CodeTour (${folder.name})`,
            process.execPath,
            [serverPath, "--workspace-root", folder.uri.fsPath],
            { ELECTRON_RUN_AS_NODE: "1" },
            extensionVersion
          );
          definition.cwd = folder.uri;
          return definition;
        })
    })
  );
}
