# codetour-relation-graph

Dedicated module for the relation-graph engine and language registry of
[spec #149](https://github.com/maurice30120/codetour/issues/149) (ticket #150,
decision of record: ADR 0034). Consumed by `codetour-mcp` through this
package's public seam only — the MCP package contains no Tree-sitter code.

## What it does

- **Pure API**: `buildRelationGraph(sources, language) -> Promise<RelationGraph>`
  plus `selectDepth1(graph, seeds, limits?)` for the depth-1 relations packet
  (BFS depth 1, outgoing/incoming indexes, dedup, `maxNodes`/`maxEdges`/
  `maxTokens` limits).
- **Language registry**: a pack is a declarative implementation plugged in with
  `registerPack(pack)`; tickets #151–#154 ship the per-language packs
  (TypeScript, C#, Java, Python). The module ships the five prebuilt grammars
  (`c_sharp`, `java`, `typescript`, `tsx`, `python`) as built-in *generic* packs
  that extract structural facts only.
- **Grammars**: prebuilt `.wasm` from `tree-sitter-wasms@0.1.13`, loaded
  in-process via `web-tree-sitter@~0.25.x` (ABI 13–14 — 0.26/0.27 reject these
  grammars). No JVM/.NET/Python runtime, no native module, no network call at
  runtime.
- **Extraction cache** keyed by (file path, content SHA-256, language,
  analyzer version).
- **Never silent**: a language without a pack yields an explicit
  `status: "unsupported"` graph (with `unsupportedFiles`), never an empty
  graph; anything a pack cannot prove statically becomes an explicit ambiguity
  `site` with `candidates[]` — never a guessed edge.

## Graph format (contract of #149)

```ts
node   = { id, name: "Type.member", filePath, startLine, endLine }        // 1-based lines
edge   = { from, to, line, kind: "call" | "new" | "super",
           callType: "direct" | "interface" | "super" | "new",
           status, filePath }                                            // file:line evidence
site   = { file, line, name, caller, candidates[], status }               // ambiguity "?"
status = "resolved" | "heuristic" | "ambiguous" | "unresolved" | "unsupported"
```

A class is represented by its members plus a synthetic `Type.constructor`
node (class usage is an edge toward it); there is no bare class node.

## Usage

```ts
import { buildRelationGraph, selectDepth1 } from "codetour-relation-graph";

const graph = await buildRelationGraph(
  [{ path: "src/main.ts", content: "..." }],
  "typescript"
);
const packet = selectDepth1(graph, ["Greeter.greet"]);
```

## Build & test

```bash
npm install                 # once, inside packages/relation-graph
npm run build               # tsc -p tsconfig.json -> dist/src, dist/test
npm test                    # build + node --test on compiled dist/test
```

Modelled on `packages/description-renderer`: own `package-lock.json`, no root
workspaces, tests are TypeScript compiled by the package `tsconfig` and run with
`node --test` through `scripts/run-compiled-tests.js`.
