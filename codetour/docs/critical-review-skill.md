# Critical review skill for Changes Tours

A Changes Tour proposal carries an optional `reviewMode` with exactly two values: `"neutral"` (the default, including when the field is omitted) and `"critical"`. Neutral mode is the historical factual Changes Tour: explain the changes, judge nothing. Critical mode additionally integrates code-review findings into the Tour, following a skill pack shipped with both generation skills.

The mode is generation data only: it lives in the proposal the agent hands to `codetour create-changes-tour` and is never persisted in the `.tour` file. `create-project-tour` and the `.tour` format are unchanged.

## Provenance and license

The critical mode is based on Matt Pocock's [`code-review` skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/code-review/SKILL.md), vendored verbatim in this repository:

- Upstream file: `docs/critical-review/upstream-code-review.md` (blob SHA `83183e0ad36fd0eef25d37c7e483284b7e34c1f0`, byte-identical to upstream).
- Source revision (commit SHA of the upstream file when vendored): `7739eaed7f8f3915437a8def198a6d0d7206dbc7`.
- Upstream license: MIT, Copyright (c) 2026 Matt Pocock — verbatim copy in `docs/critical-review/upstream-LICENSE.txt`.
- The CodeTour adaptation is a distinct document (`docs/critical-review/codetour-adaptation.md`); it is not part of the upstream skill.

No network access or upstream plugin installation is needed for the critical mode. The Markdown files under `docs/critical-review/` are the readable source of truth; `scripts/embed-review-skill.js` copies them byte for byte into `references/` beside each shipped skill:

- `packages/copilot-plugin/skills/codetour-generate/references/`;
- `packages/pi-plugin/skills/codetour-generate/references/`.

The copies travel inside the plugin, and the plugin files are embedded in the standalone CLI bundle, so the pack is present offline in every distribution. A unit test (`src/cli/criticalReviewSkill.test.ts`) fails if a copy diverges from the source, if the license is missing, or if an embedded plugin copy drifts; both `SKILL.md` files name the references they require.

## How the pack reaches the agent

Each skill carries the pack in `references/` beside it, and its critical module (`references/changes-tour-critical.md`, spec #329) is the only place that names it: `codetour-adaptation.md` for the method, `references/upstream-code-review.md` for the upstream skill the adaptation is based on, and `references/upstream-LICENSE.txt` for its MIT license. The agent must read them **before writing any step**: a mode that reached it only at the CLI call would be too late, because the CLI validates a finished proposal rather than reviewing it. A `neutral` Changes Tour and every Project Tour never open the pack.

This replaces the MCP resource `codetour://review/critical-instructions` of the previous release: no server serves the pack any more, and the skill carries it (ADR 0057).

## What the adaptation requires

The adaptation keeps the upstream skill's two separate axes and adapts them to Changes Tours:

- **Standards (always):** documented repository rules are searched first and override the upstream heuristic smell baseline. Each finding is labeled `**Standards:**` and classified as a demonstrated violation (citing the documented rule and the code that breaks it) or as a risk / code smell (explicitly heuristic). Anything a tool already guarantees (compiler, formatter, linter, the creation CLI's own validation) is not recycled as a finding.
- **Spec (only when a source is found):** the agent looks for an associated source — a user indication, issue references in commit messages, or a spec file under `docs/`, `specs/`, or `.scratch/` — keeps a verifiable reference, and quotes the exact requirement for each `**Spec:**` finding. If no source exists, the agent does not ask for a spec and does not block: the tour states `Spec axis not evaluated: no spec source was found.`
- **Integration:** every step keeps its factual explanation of the change; findings complement it at the step whose Tour Anchor locates the motivating code. No extra step is created for a suspicion; the two axes are never merged or reranked.
- **Honesty:** defects, requirements, specs, and test results are never invented; tests inferred from reading the change are never presented as executed; with no established defect the tour remains a useful factual explanation.
- **Git authority:** the review runs on the same merge-base comparison the tour describes; the CLI's Git checks, validation, snapshots, and anchor verification always win.
- **Sub-agents:** the two axes preferably run as parallel sub-agents; a client without sub-agent support degrades to running them sequentially in one context — the execution changes, never the rules.

## Limits

- **The mode question belongs to the skill.** The CLI never asks a conversational question; it validates the proposal it receives, including `reviewMode`, and writes the Tour. An agent that receives the neutral/critical choice before its analysis starts passes the mode explicitly; one that does not carries the neutral default — a documented, deliberate behavior, not a failure.
- **Nothing verifies that the agent followed the pack.** The CLI validates and persists whatever steps are proposed; the review quality is the generating agent's responsibility, and the skill is the only instruction that carries it.
- **Sequential degradation is the agent's choice.** The pack describes when to prefer parallel sub-agents and how to degrade; the CLI does not orchestrate sub-agents itself.
