# Distribute and discover the MCP server with the extension

The desktop extension bundles the compiled stdio MCP server and registers one
server definition per workspace folder. This allows VS Code and GitHub Copilot
to discover the tools without a workspace-specific MCP configuration file.

Each server receives one explicit workspace root and remains confined to it.
The web extension does not register or start the Node.js server.

The MCP server definition API requires VS Code 1.101, so the extension's
minimum VS Code version moves to 1.101.
