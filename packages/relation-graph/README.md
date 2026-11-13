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
  that extract structural facts only. #152 ships the C# pack
  (`createCSharpPack()` / `csharpPack`): `registerPack(csharpPack)` replaces the
  generic pack for `"csharp"` — declared types, `var` inference, `using X = Y`
  aliases, `this.x`, `: base()` super proof, `new X(...)` -> `Type.constructor`,
  interface relations asserted toward the port (`callType: "interface"`,
  status `"heuristic"`), dynamic dispatch left as `?` sites with candidates.
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

## Language packs (#151–#154)

`registerPack` plugs a per-language pack over the built-in generic one. The
TypeScript pack (ticket #151) ships in this module:

```ts
import {
  registerTypeScriptPacks,        // registerPack under "typescript" and "tsx"
  extractTypeScriptSymbols       // declaration extraction with 1-based positions
} from "codetour-relation-graph";

registerTypeScriptPacks();        // called once by the consumer (#155 wiring)
const graph = await buildRelationGraph(sources, "typescript");
const symbols = await extractTypeScriptSymbols(sources); // #114 symbol source
```

The pack extracts classes/methods/constructors/functions/properties/imports
via tree-sitter queries over the prebuilt `typescript`/`tsx` grammars, and
annotates each call site with the pack-resolved receiver type (declared
types, local `var` inference from `new X(...)`, import aliases, `this.x`
toward the enclosing type or its superclass). The **engine** resolves those
annotations against the whole local graph: exactly one target becomes an
edge (toward the interface port with `callType: "interface"` + `heuristic`
when the type is a known interface), anything else becomes an explicit
ambiguity `site` with candidates — same-named methods never produce a false
edge. `extractTypeScriptSymbols` returns the declarations as
`ExtractedSymbol[]` (`name`, `kind`, `filePath`, 1-based `startLine`/`endLine`,
plus `importedName`/`source` for imports); ticket #155 maps that shape onto
the existing `extractSymbols` contract of `codetour-mcp`'s parsing module,
replacing the regex spike of #114 while its consumers keep compiling.

## Usage

```ts
import { buildRelationGraph, selectDepth1 } from "codetour-relation-graph";

const graph = await buildRelationGraph(
  [{ path: "src/main.ts", content: "..." }],
  "typescript"
);
const packet = selectDepth1(graph, ["Greeter.greet"]);
```

## Language packs (#151–#154)

The per-language packs plug into the registry with `registerPack` and replace
the generic default pack for their language:

- **Java** (ticket #153): `createJavaPack()` — explicit imports (single-type,
  `import static`, wildcard), declared types of locals/parameters/fields plus
  `var` inferred from `new`, `extends`/`implements` chains, `this.x` calls,
  `new X(...)` → `X.constructor`, `super` calls. Unprovable sites become
  ambiguity sites with candidates, never guessed edges. See
  `docs/pack-java-measurements.md` (measured on the C# prototype harness
  before the contract was frozen) and `test/pack-java.test.ts`.

```ts
import { buildRelationGraph, createJavaPack, registerPack } from "codetour-relation-graph";
registerPack(createJavaPack());
const graph = await buildRelationGraph([{ path: "Main.java", content: "..." }], "java");
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
