import * as path from "path";
import * as vscode from "vscode";

export const MCP_PROVIDER_ID = "codetour.tour-generator";

export function bundledMcpServerPath(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, "dist", "mcp-server.js");
}

export function registerMcpProvider(context: vscode.ExtensionContext): void {
  const serverPath = bundledMcpServerPath(context);
  const extensionVersion = String(context.extension.packageJSON.version);
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
      provideMcpServerDefinitions: () =>
        (vscode.workspace.workspaceFolders ?? []).map(folder =>
          new vscode.McpStdioServerDefinition(
            `CodeTour (${folder.name})`,
            process.execPath,
            [serverPath, "--workspace-root", folder.uri.fsPath],
            { ELECTRON_RUN_AS_NODE: "1" },
            extensionVersion
          )
        )
    })
  );
}
