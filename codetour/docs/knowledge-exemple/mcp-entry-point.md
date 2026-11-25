# The MCP entry point and its workspace root

**Claim.** The MCP binary and the standalone codetour mcp command both call runMcpCli; the server uses the current working directory unless --workspace-root is supplied.

**Injected text.** The MCP binary and the standalone codetour mcp command both call runMcpCli; the server uses the current working directory unless --workspace-root is supplied.

| Field | Value |
| --- | --- |
| id | `adfc643d2833410da407047bf91ceaeb` |
| state | `CANDIDATE` (fire 0/0) |
| revision | 2 |
| source | `codetour/packages/mcp-server/src/cli.ts` |
| detector | scope `mcp_cli_entry`, confirm `runMcpCli|--workspace-root|codetour-mcp` |
| proof | `codetour/packages/mcp-server/src/cli.ts` — sha256 `783820c7e6823eac9b5afd614524ff85ddb0cf7675ca18faf25a3c862cd46afa`<br>`codetour/packages/mcp-server/src/main.ts` — sha256 `399c22ffcf80c9f280c088ec742c40906add2e989bcdb6198c941286ca8e2bb5`<br>`codetour/src/cli/index.ts` — sha256 `aa662d9ca6849641b9c5828053c8ae5336ab910afbe09cd5d90c7c1beee01393` |
| provenance | manual code review of `codetour/packages/mcp-server/src/cli.ts`, `codetour/packages/mcp-server/src/main.ts`, `codetour/src/cli/index.ts` |
| previous record | session `01a20e51-9bac-7255-831f-a4a556dfcdde`, path `codetour/packages/mcp-server/src/cli.ts` |

> The proof hashes were taken on 24 November 2026. The files have changed since (`drift: true`), so this card would be re-proven or left out before any injection.
