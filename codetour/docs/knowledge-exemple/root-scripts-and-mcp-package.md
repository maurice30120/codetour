# The root scripts and the MCP workspace package

**Claim.** The root build and test scripts invoke the MCP server workspace package; that package defines its own build, typecheck and test scripts.

**Injected text.** The root build and test scripts invoke the MCP server workspace package; that package defines its own build, typecheck and test scripts.

| Field | Value |
| --- | --- |
| id | `cb62589a98e14935b5b6b4f70d72fc85` |
| state | `CANDIDATE` (fire 0/0) |
| revision | 2 |
| source | `codetour/package.json` |
| detector | scope `packages/mcp-server`, confirm `packages/mcp-server/(src|test|package\.json)` |
| proof | `codetour/package.json` — sha256 `8a6bce3599197a155aaf9156ba23db235358fd471a6a37c3640c16ee6b2d6114`<br>`codetour/packages/mcp-server/package.json` — sha256 `9828eb6edcf54e28b27b8099e89d06091fe636e6d329afa175044a5d538633c1` |
| provenance | manual code review of `codetour/package.json`, `codetour/packages/mcp-server/package.json` |
| previous record | session `01a20def-b152-7743-9682-2424ff6f1215`, path `codetour/packages/mcp-server/src/cli.ts` |

> The proof hashes were taken on 24 November 2026. The files have changed since (`drift: true`), so this card would be re-proven or left out before any injection.
