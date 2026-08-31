# Run a workspace-confined stdio MCP server

The MCP server is a standalone Node.js package under `packages/mcp-server/`, launched locally over `stdio` and configured for exactly one workspace root through a required `--workspace-root` argument. Keeping it separate avoids coupling the server to the VS Code extension and its web bundle. The server performs no network access, and it resolves real paths and rejects symlinks that escape the configured root before any read or write. HTTP transport and multi-root instances are deferred beyond V1.
