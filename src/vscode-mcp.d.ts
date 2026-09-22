// Narrow local declarations for the VS Code MCP server definition provider
// API (vscode.lm.registerMcpServerDefinitionProvider,
// McpStdioServerDefinition), which is stable only since VS Code 1.101.
// The extension's engine floor stays at ^1.60, so these declarations let
// the integration compile against the older type definitions, while it
// feature-detects the API at runtime and stays inactive on hosts that do
// not provide it. The signatures mirror the official declarations.

declare module "vscode" {
  /**
   * McpStdioServerDefinition represents an MCP server available by running
   * a local process and operating on its stdin and stdout streams.
   */
  export class McpStdioServerDefinition {
    readonly label: string;
    cwd?: Uri;
    command: string;
    args: string[];
    env: Record<string, string | number | null>;
    version?: string;
    constructor(
      label: string,
      command: string,
      args?: string[],
      env?: Record<string, string | number | null>,
      version?: string
    );
  }

  /**
   * A type that can provide Model Context Protocol server definitions.
   * This should be registered using
   * lm.registerMcpServerDefinitionProvider during extension activation.
   */
  export interface McpServerDefinitionProvider {
    provideMcpServerDefinitions(): ProviderResult<
      McpStdioServerDefinition[]
    >;
  }

  export namespace lm {
    /**
     * Registers a Model Context Protocol server definition provider.
     */
    export function registerMcpServerDefinitionProvider(
      id: string,
      provider: McpServerDefinitionProvider
    ): Disposable;
  }
}
