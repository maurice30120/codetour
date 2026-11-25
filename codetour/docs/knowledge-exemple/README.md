# Example Knowledge cards

Six Knowledge cards that TokenEconomizer produced while working in this repository, exported as
they stood on **24 November 2026**. They are examples of what the product learns and of the shape
it records: one claim, the text it would inject, the files that prove it, a detector that decides
when it is relevant, and a lifecycle state.

They are **not current facts**. All six are `CANDIDATE` and all six are marked `drift: true`: the
files they cite have changed since the proof was taken, and the two cards about the MCP server
describe a surface this branch removed (spec #320). Read them as specimens of the format.

| Card | Title | Source | State |
| --- | --- | --- | --- |
| [`18de2197`](tour-discovery-and-schema.md) | Tour discovery and the schema | `codetour/schema.json` | `CANDIDATE` |
| [`56fe2001`](shared-discovery.md) | One discovery routine for both surfaces | `codetour/src/core/tourDiscovery.ts` | `CANDIDATE` |
| [`ddf2d37a`](runtime-parsing-vs-schema.md) | Runtime parsing versus authoring schema | `codetour/src/store/tourSchema.ts` | `CANDIDATE` |
| [`cb62589a`](root-scripts-and-mcp-package.md) | The root scripts and the MCP workspace package | `codetour/package.json` | `CANDIDATE` |
| [`737fe093`](codetour-mcp-binary.md) | The codetour-mcp binary | `codetour/packages/mcp-server/package.json` | `CANDIDATE` |
| [`adfc643d`](mcp-entry-point.md) | The MCP entry point and its workspace root | `codetour/packages/mcp-server/src/cli.ts` | `CANDIDATE` |

## Shape of a card

| Field | Meaning |
| --- | --- |
| `claim` | what the card asserts, in one sentence |
| `injection` | the words the agent receives, usually the claim |
| `proof` | the files, with the sha256 of each version that was read |
| `detector` | the scope and confirmation pattern that decide whether the card is relevant |
| `provenance` | how it was established: a manual code review of those files, or captured sessions |
| `life` | `CANDIDATE`, `ACTIVE` or `RETIRED`, with the firing ratio that gates injection |

A card is delivered only when its proof still matches the files on disk and its firing ratio
clears the gate; `te microskills` lists the ones that passed. The export lives outside the
product's state: the store is `~/.tokeneconomizer`, never this repository.
