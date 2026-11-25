# The codetour-mcp binary

**Claim.** The codetour-mcp package declares dist/src/main.js as its binary; src/main.ts delegates startup to runMcpCli.

**Injected text.** The codetour-mcp package declares dist/src/main.js as its binary; src/main.ts delegates startup to runMcpCli.

| Field | Value |
| --- | --- |
| id | `737fe0936e374284a15412150d67e780` |
| state | `CANDIDATE` (fire 0/0) |
| revision | 2 |
| source | `codetour/packages/mcp-server/package.json` |
| detector | scope `mcp_server_pkg`, confirm `packages/mcp-server/(src|package\.json|test)` |
| proof | `codetour/packages/mcp-server/package.json` — sha256 `9828eb6edcf54e28b27b8099e89d06091fe636e6d329afa175044a5d538633c1`<br>`codetour/packages/mcp-server/src/main.ts` — sha256 `399c22ffcf80c9f280c088ec742c40906add2e989bcdb6198c941286ca8e2bb5` |
| provenance | manual code review of `codetour/packages/mcp-server/package.json`, `codetour/packages/mcp-server/src/main.ts` |
| previous record | session `01a20e51-9bac-7255-831f-a4a556dfcdde`, path `codetour/packages/mcp-server/src/cli.ts` |

> The proof hashes were taken on 24 November 2026. The files have changed since (`drift: true`), so this card would be re-proven or left out before any injection.
