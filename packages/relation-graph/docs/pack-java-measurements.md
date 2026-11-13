# Java pack — measurements on the C# prototype harness (ticket #153)

Acceptance of #153: *"Mesures sur le harnais du prototype C# documentées avant
figage"* — the Java contract was frozen only after measuring it on the
validated C# shootout harness, reusing its ground-truth format.

## Method

- Fixture: `packages/relation-graph/test/fixtures/java/` — a Java port of the
  C# shootout fixture (`prototype-csharp-shootout/fixture/csharp`): same cases
  (inheritance + interface field + this-calls + cross-file callers; homonym
  `getUser` resolved through declared types; `var` + polymorphic ternary
  dispatch; declared port parameter), calibrated with filler methods.
- Harness: a throwaway adaptation of
  `packages/mcp-server/prototype-csharp-shootout/shootout.mjs` (scratchpad, not
  committed) that reuses **unchanged**:
  - the pure payload logic `prototype-codeflow-graph/lib/payload.mjs`
    (`buildIndex`, `relationsFor`, `renderPayloadWithGaps`, `renderBaseline`,
    `actionableCoverage`, `compareToGroundTruth`),
  - the ground-truth format of `prototype-csharp-shootout/ground-truth.mjs`
    (`{from, to, kind, certainty: provable|hard}` rows),
  - the S1 baseline (grep `\btoken\b` + whole-file reads) vs S2 (pack payload +
    explicit `?` lines + targeted slices ±8 lines, merged per file),
  - `gpt-tokenizer` (cl100k) for token counts.
- The graph itself is produced by the **production module**:
  `buildRelationGraph(sources, "java")` from `packages/relation-graph/dist`
  with `registerPack(createJavaPack())` — not by a throwaway pack. Grammar:
  `tree-sitter-java.wasm` (tree-sitter-wasms@0.1.13) via
  web-tree-sitter@~0.25.10, in-process (ADR 0034).
- Environment: Node v26.13.1, run date 2026-11-13.

## Results (scan: 10 files, 29 nodes, 22 edges, 14 sites, 12 ms)

| Case | S1 grep+read | S2 pack+`?`+slices | S2 payload / slices | IN actionable (S2) | OUT (S2) | Ground truth |
|---|---|---|---|---|---|---|
| `java-user-service` (UserService) | **1 018 tok** (3 files, 149 lines) | **375 tok** | 241 / 134 | **4/4** | 5/5 | 9/9 ✓ (2 hard asserted toward the port) |
| `java-admin-service` (homonym) | **1 345 tok** (6 files, 186 lines) | **295 tok** | 161 / 134 | **2/2** | 3/3 | 5/5 ✓ |
| `java-picker-dispatch` (SlowPicker, dynamic dispatch) | **1 345 tok** | **236 tok** | 102 / 134 | **1/1 via `?` line** | 1/1 | 2/2 (hard row found as `? IN RequestHandler.handleViaPicker @api/RequestHandler.java:38 getUser -> 5 candidat(s)` + ±8 slice) |
| `java-picker-port` (IPicker port) | **709 tok** (4 files, 92 lines) | **219 tok** | 85 / 134 | **1/1** | 0/0 | 1/1 ✓ (`handleViaPort -> IPicker.getUser`, port edge) |

Savings 2.7×–5.7× vs grep, growing with file size — same magnitude as the
validated C# pack (370/286/226 tok on the C# fixture), which is the point of
measuring on the C# harness before freezing the Java contract.

## Contract decisions frozen after these measurements

- Interface dispatch through a declared port type is **asserted toward the
  port** (`UserService.getUser -> IRepository.find`, `callType: "interface"`,
  `status: "heuristic"`) — never toward the implementation, never silently
  dropped (#149 story 16/19).
- `super()` / `super.x()` with an explicit `extends` target are **provable**
  in Java's single inheritance → `kind: "super"`, `callType: "super"`,
  `status: "resolved"` (engine keeps `heuristic` for name-matched super
  without a declared base, e.g. the generic default pack).
- Inherited `this.x` resolves through the explicit `extends` chain
  (`status: "resolved"`, `callType: "direct"`).
- `var` infers only from a direct `new X(...)` initializer; a ternary,
  cast or method-call initializer stays unknown → explicit ambiguity site
  with candidates (the `java-picker-dispatch` `?` line above) — never guessed.
- Wildcard imports grant no provable type: `new Thing()` / `t.use()` with no
  local `Thing` become `unresolved` sites, no edge.
- Known honest noise: `new SlowPicker()` inside the ternary still produces a
  `new` edge `handleViaPicker -> SlowPicker.constructor` (the creation site
  really exists; the C# prototype behaves identically). JDK types
  (`StringBuilder.append`, …) produce `unresolved` sites — silence is never
  mistaken for absence of relations.
- Tests pin statuses and file:line evidence, not token budgets (the token
  comparison belongs to the #118 harness).
