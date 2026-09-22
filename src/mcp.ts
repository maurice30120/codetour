import * as path from "path";
import * as vscode from "vscode";

export const MCP_PROVIDER_ID = "codetour.tour-generator";

// The MCP server definition provider API (vscode.lm.registerMcpServerDefinitionProvider,
// McpStdioServerDefinition) is stable only since VS Code 1.101, which is why both
// the extension engine version and the @types/vscode dependency floor at ^1.101.0
// and cannot be reverted to the previous ^1.60 range.

export function bundledMcpServerPath(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, "dist", "mcp-server.js");
}

export function registerMcpProvider(context: vscode.ExtensionContext): void {
  const serverPath = bundledMcpServerPath(context);
  const extensionVersion = String(context.extension.packageJSON.version);
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
      provideMcpServerDefinitions: () =>
        (vscode.workspace.workspaceFolders ?? []).map(folder => {
          const definition = new vscode.McpStdioServerDefinition(
            `CodeTour (${folder.name})`,
            process.execPath,
            [serverPath],
            { ELECTRON_RUN_AS_NODE: "1" },
            extensionVersion
          );
          definition.cwd = folder.uri;
          return definition;
        })
    })
  );
}
