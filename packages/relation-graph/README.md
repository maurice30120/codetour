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
- **Language registry**: the per-language packs of tickets #151–#154
  (TypeScript/TSX, C#, Java, Python) ship in this module and are
  **auto-registered as the registry defaults** by a single
  `registerBuiltinPacks()` (called on first registry use; re-exported from the
  index). One consistent policy: `buildRelationGraph(sources, "typescript")`
  uses the TypeScript pack out of the box. `registerPack(pack)` still plugs a
  custom pack over the default for its language, and `resetLanguagePacks()`
  restores exactly the built-in set. Only a language whose real pack has not
  landed falls back to the generic structural pack. The packs resolve declared
  types, `var` inference, `using`/import aliases, `this.x`, `: base()`/extends
  super proofs, `new X(...)` -> `Type.constructor`, interface relations
  asserted toward the port (`callType: "interface"`, status `"heuristic"`),
  and leave dynamic dispatch as `?` sites with candidates.
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

The per-language packs of tickets #151–#154 ship in this module and are the
registry DEFAULTS: a single `registerBuiltinPacks()` (called automatically on
first registry use, and exported from the index) registers all of them, and
`resetLanguagePacks()` restores exactly that set. `registerPack` still plugs a
custom pack over a default for one language.

- **TypeScript/TSX** (ticket #151): `createTypeScriptPack("typescript" | "tsx")`,
  `registerTypeScriptPacks()` (registers both ids), and
  `extractTypeScriptSymbols()` — declaration extraction with 1-based positions,
  the #114 symbol source that ticket #155 wires into `codetour-mcp`.
- **C#** (ticket #152): `createCSharpPack()` / `csharpPack`.
- **Java** (ticket #153): `createJavaPack()` — explicit imports (single-type,
  `import static`, wildcard), declared types of locals/parameters/fields plus
  `var` inferred from `new`, `extends`/`implements` chains reported as `types`
  so the engine can walk them across files, `this.x` calls, `new X(...)` →
  `X.constructor`, `super` calls. See `docs/pack-java-measurements.md` and
  `test/pack-java.test.ts`.
- **Python** (ticket #154): `createPythonPack()` / `pythonPack` — trivial import
  resolution (`from m import X [as Y]`, module-qualified calls), `self.x` /
  `cls.x` as this-calls, `super().__init__` with a single explicit base as a
  heuristic super edge; everything unprovable stays a `?` site (Python has no
  static types, so ambiguity is expected by nature).

```ts
import { buildRelationGraph, extractTypeScriptSymbols, registerPack } from "codetour-relation-graph";

// No registration call needed: the built-in packs are the registry defaults.
const graph = await buildRelationGraph(sources, "typescript");
const symbols = await extractTypeScriptSymbols(sources); // #114 symbol source

registerPack(myCustomPack);  // optional: replace one language's pack
```

The packs extract declarations (classes/methods/constructors/functions/
properties/imports) via tree-sitter queries over the prebuilt grammars, and
annotate each call site with the pack-resolved receiver type (declared types,
local `var` inference from `new X(...)`, import/`using` aliases, `this.x`
toward the enclosing type or its superclass). The **engine** resolves those
annotations against the whole local graph: exactly one target becomes an
edge (toward the interface port with `callType: "interface"` + `heuristic`
when the type is a known interface), anything else becomes an explicit
ambiguity `site` with candidates — same-named methods never produce a false
edge. `extractTypeScriptSymbols` returns the declarations as
`ExtractedSymbol[]` (`name`, `kind` — class, interface, method, constructor,
function, property, import, type-alias, enum — `filePath`, 1-based
`startLine`/`endLine`/`startColumn`/`endColumn`, plus `importedName`/`source`
for imports); ticket #155 maps that shape onto the existing `extractSymbols`
contract of `codetour-mcp`'s parsing module, replacing the regex spike of #114
while its consumers keep compiling.

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
