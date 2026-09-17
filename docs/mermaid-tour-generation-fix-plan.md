# Problems encountered and correction plan

## Context

A Project Tour was generated to explain how CodeTour works, with an emphasis
on Mermaid diagram generation and rendering.

The final generation succeeded and produced a 10-step tour in
`.tours/project.tour`. This document describes the issues encountered during
that operation and the precise plan for making the process more robust. It
does not include a code fix.

## Problems encountered

### 1. `pattern` anchors rejected by the MCP server

The MCP server validates every anchor against the real workspace content. Two
anchors were rejected:

- the `discoverTours` anchor in `src/store/provider.ts`;
- the `renderMermaidDiagram` anchor in
  `packages/description-renderer/src/render.ts` during an earlier attempt.

The cause was a difference between the proposed regular expression and the
exact form recognized by the validator. The server requires a pattern to match
exactly one occurrence. An invalid proposal does not replace the previous
file, which correctly protected the existing Tour.

The `discoverTours` anchor continued to be rejected despite a matching
signature appearing in search results. To complete the Tour without a fragile
anchor, that secondary step was removed from the final proposal.

### 2. First build interrupted by the environment

The first `npm run build` stopped with exit code 130 after building the renderer
and MCP server. It did not provide a useful compilation error.

The build was rerun with an adjusted execution and completed successfully:

- `packages/description-renderer` build;
- `packages/mcp-server` build;
- extension webpack compilation;
- `resvg` runtime preparation.

This was an execution interruption, not a defect identified in the code or the
generated Tour.

### 3. Validation and rendering dependency risk

Mermaid is validated during generation by the MCP server and rendered later by
the extension. The project already uses a shared engine, but this two-stage
flow remains a point of attention: a version, configuration, or rule mismatch
could accept a diagram during generation and fail to render it during playback.

The final Tour explains this shared contract, while the plan below proposes
protecting it explicitly with contract tests.

## Detailed correction plan

### Step 1 — Make anchor preparation deterministic

**Goal:** avoid rejections caused by approximate patterns.

1. Read the exact signature from the target file instead of reconstructing it from memory.
2. Check the number of occurrences of the pattern in the file.
3. Prefer a stable, unique pattern.
4. Use an explicit line only when a stable pattern cannot be made unique.
5. Avoid removing a step simply because its anchor is difficult to write; document the fallback choice instead.

**Expected validation:** every Tour anchor is accepted by the validator and
identifies exactly one real target.

### Step 2 — Add a local check before the MCP call

**Goal:** detect invalid patterns immediately.

1. Inspect proposed steps before calling `create_project_tour`.
2. For each step with `file` and `pattern`, count matches in the file.
3. Report zero matches and multiple matches locally.
4. Include the file, pattern, and match count in the error message.
5. Submit only proposals that pass this local check to the MCP server.

**Expected validation:** an invalid anchor is detected before generation or
writing with an actionable message.

### Step 3 — Test representative anchors

**Goal:** cover the target types used by Project Tours.

Add or verify tests for:

- a `directory` target;
- a file with a unique pattern;
- a missing pattern;
- an ambiguous pattern;
- an explicit line used as a fallback.

**Expected validation:** the validator remains strict and its errors clearly
identify the cause.

### Step 4 — Guarantee the Mermaid generation/playback contract

**Goal:** verify that content accepted by MCP can be read by the extension.

1. Maintain one shared list of allowed Mermaid kinds.
2. Enforce the same limits on both sides: caption, 20 KB maximum source size, and at most three diagrams per description.
3. Test each accepted kind: `flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram`, and `erDiagram`.
4. Verify that MCP validation and player rendering use the same locked Mermaid version.
5. Test an invalid diagram and confirm that its alternative text and warning are shown without exposing the Mermaid source.

**Expected validation:** every diagram accepted by MCP renders in the player,
unless an explicit rendering error is reported.

### Step 5 — Verify persistence behavior

**Goal:** preserve a valid Tour when a new generation fails.

1. Generate a valid reference Tour.
2. Submit a proposal with an invalid anchor or Mermaid source.
3. Verify that the operation returns every detected error.
4. Verify that `.tours/project.tour` still contains the previous valid Tour.
5. Submit a valid proposal and verify atomic replacement.

**Expected validation:** no partially invalid proposal leaves an incomplete
`.tour` file.

### Step 6 — Stabilize build validation

**Goal:** distinguish environment interruptions from project errors.

1. Run `npm run build` in a standard terminal.
2. If it stops without a compilation error, record the exit code and last completed stage.
3. Rerun in an uninterrupted environment before investigating the code.
4. Keep renderer, MCP, webpack, and `resvg` output in the report.
5. Treat a failure as a regression only when it is reproducible after a second run.

**Expected validation:** two consecutive runs succeed, or any remaining
failure is reproducible and localized.

## Acceptance criteria

- Generated Project Tours contain only validated, unique anchors.
- Pattern errors identify the file, pattern, and cause.
- The five allowed Mermaid kinds are covered by validation and rendering tests.
- A Mermaid error does not erase a valid existing Tour.
- Mermaid sources are replaced by in-memory PNG images during playback.
- The complete build passes after Tour generation.
- This document is the only documentation deliverable from this plan; no code change is requested by the plan itself.

## Current result

The final Project Tour was created successfully after correcting the anchor
proposal. Mermaid diagrams were validated by the MCP server, and the complete
build succeeded on the second run.
