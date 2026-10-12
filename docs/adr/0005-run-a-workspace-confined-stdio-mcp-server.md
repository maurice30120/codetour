# Run a workspace-confined stdio MCP server

The MCP server is a standalone Node.js package under `packages/mcp-server/`, launched locally over `stdio` and confined to exactly one workspace. The original decision required a proprietary `--workspace-root` argument; ADR-0006 supersedes that launch mechanism. The server performs no network access, and it resolves real paths and rejects symlinks that escape the configured root before any read or write. HTTP transport and multi-root instances are deferred beyond V1.
