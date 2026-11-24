# Procedural memory two-Tour feasibility diagnostic — report (D05, issue #188)

Spec: [code-mode-procedural-memory-diagnostic-2026-11-16.md](./code-mode-procedural-memory-diagnostic-2026-11-16.md) (issue #183). Ticket: #188 (D05), the final diagnostic ticket, built on #184 (revisable English plan protocol), #185 (deterministic citation validation in `function_try`), #186 (English internal instructions, user-language answers) and #187 (deterministic consolidation, append-only catalogue).

**Scope statement.** This is the reproducible end-to-end feasibility diagnostic of spec #183: creation, validation, persistence, then real reuse of at least one procedure across two independent Tours. It is **not** the #174 Vibe benchmark, not one of the 80 official runs, and it makes **no token-savings or profitability claim**. No comparative benchmark against Vibe is declared valid here; that would require the official G0–G5 gates of #174.

## What ran

| Run | What | Reproducibility |
| --- | --- | --- |
| Integrated two-Tour test | `packages/exploration-poc/test/two-tours-d05.test.ts`, driven through the public `explore()` seam with deterministic Model stubs, a temporary workspace fixture and a persistent catalogue directory shared by both Tours | `cd packages/exploration-poc && npm test` (188 pass, including the 8 D05 scenarios) |
| Sandbox suite | `packages/exploration-sandbox` (strict TypeScript validation, QuickJS execution) | `cd packages/exploration-sandbox && npm test` (25 pass) |
| Real-provider run | **Not executed.** No `MISTRAL_API_KEY` was available in the environment or `.env.local`, and no GLM provider adapter exists in the harness (only `mistral.ts`); GLM 5.3 Flash availability is unverified | No real-provider result is reported, per the honesty rule: an unexecuted run is never claimed |

The deterministic stubs return usage fields (`inputTokens`/`outputTokens`) through the Model seam exactly as a real provider would; the harness sums those real seam counters and marks `usageMissing` when a response carries none. No counter is simulated and presented as a provider measurement.

## The two-Tour chain, as observed in the traces

**Tour A — creation from an empty catalogue** (French request: « Explique le point d'entrée principal du dépôt et son contexte source »):

1. **Plan.** The model publishes a structured English plan (`decomposition_plan` trace, one question `q1`, reuse marker `true`). After the first trial fails, it publishes a **revised plan** (`plan_revised` trace) appending a question with an explicit reason — the plan history is append-only, ids stay stable.
2. **Trial and repair.** `function_try` (call id `try-1`, `question_id q1`) proposes `traceRepoEntryContext`, a strict TypeScript procedure returning each `searchText` hit with its source context. The first version claims a five-line context window that runs past the end of the file: the #185 validator exhaustively checks every emitted reference without any LLM and returns short structured repair feedback (`citations=validation_failed (0/1 valid)`, the single faulty reference identified). The corrected retry (`try-2`) passes: `returned=1; citations=1 valid`.
3. **Validated Tour.** The structured result carries real evidence (`main.ts:1-1`, re-read and bounds-checked by the harness) and is returned in French, while every internal instruction the model received stayed English (pinned by the #186 tests).
4. **Consolidation.** The model proposes (`selected: ["traceRepoEntryContext"]`); the deterministic validator re-executes the exact code and params (`consolidation-validation` trace, output deep-equal), re-checks every citation, applies the English-description and canonical-naming gates, and appends the entry to the persistent catalogue. Reconciliation log: `{proposed: true, replayed: true, accepted: true}`.

**Tour B — reuse, independent run** (French request, differently phrased): a new `run_id`; the model publishes its own plan, calls `memory_list` (call id `list-1`, `question_id q1`) which lists the capability **without source code**, then `memory_run` (call id `run-1`) with suitable params. The stored code is re-executed in the sandbox (the trace keeps the execution proof), the result is bounded and sourced, and the Tour completes **without any `function_try`** — the same code is never recreated. The catalogue is unchanged by the reuse (still exactly one entry) and Tour B consolidates nothing.

**Correlation chain.** `run_id` (one per `explore()` call, distinct between Tours) links the plan versions, every trace entry and the consolidation report; `question_id` (declared by the plan, traced on each call, rejected as an anomaly if never declared) links calls to plan questions; provider `call_id`s identify the observed calls; the candidate name (`traceRepoEntryContext`) links the trials, the selection, the reconciliation replay and the persisted entry. Observed calls are recorded by the harness, never deduced from model text.

## Diagnostic statuses the traces distinguish without ambiguity

| Status | Observable in the result |
| --- | --- |
| Missing plan | `plan.status: "missing"` + explicit anomaly `no plan was published before the structured result` |
| No candidate considered | validated Tour, `consolidationReport.reconciliation: []` and `accepted: []`, empty catalogue |
| Candidate proposed but never tried | reconciliation entry `{proposed: true, replayed: false, accepted: false, reason: "Trial failed before execution: …"}` (e.g. a TypeScript compile error), plus the failed `function_try` trace entry with its error |
| Validation failure | `function_try` trace outcome `citations=validation_failed (n/m valid)` + structured repair feedback; no candidate reaches the reconciliation log |
| Tour unvalidated | `status: "partial"` (e.g. `stopReason: "evidence_missing"`); the reconciliation log stays empty, nothing persists |
| Reconciliation not reached | reconciliation entry `{proposed: false, replayed: false, …, reason: "Not proposed by the model for consolidation"}` (or `Budget exhausted before the reconciliation replay`) |
| Final refusal | reconciliation entry `{proposed: true, replayed: true, accepted: false}` + a precise `rejected` reason (description refused, naming, replay mismatch, identifier collision — the catalogue is append-only) |

Abandonment is also covered: `memory_unusable` marks a candidate unusable during the Tour and it appears in the reconciliation log as `Marked unusable by memory_unusable during the Tour`; abandoned candidates stay in the logs only and never enter the catalogue. All these scenarios are pinned by the scenario battery in `two-tours-d05.test.ts`, failure cases included.

## Budgets and real consumption

- The two-Tour test runs with a generous but finite budget (`iterations: 12, calls: 48, tokens: 60000, durationMs: 60000`); the budget test pins the explicit stop reason (`stopReason: "iterations"`, `status: "partial"`) that prevents any infinite loop.
- Every LLM call's token consumption is observable: per-call `inputTokens`/`outputTokens` in the `callTrace` from the Model seam usage fields, aggregated in `metrics`, with `usageMissing: true` honestly flagged when a response carries no usage. The test asserts the exact sums.
- No saving is attributed to memory on these two Tours.

## Limits

- The diagnostic observes behaviour at the `explore()` seam with deterministic stubs: it proves the protocol and the machinery (plan, repair, deterministic validation, consolidation, reuse, correlation, budgets), not real-provider behaviour.
- Citation validation proves structural integrity (the referenced lines exist and match), never semantic relevance.
- The catalogue is append-only in this phase: no smart deduplication, no replacement; an id collision is refused, never overwritten.
- No real-provider run was executed (see the table above); the harness has no GLM adapter, and GLM 5.3 Flash availability is unverified.

## Verifiable artifacts

- Integrated two-Tour test and scenario battery: `packages/exploration-poc/test/two-tours-d05.test.ts`
- Harness seams: `packages/exploration-poc/src/explore.ts` (plan protocol, traces, reconciliation), `src/citation-validator.ts` (#185), `src/memory.ts` (#187 gates), `src/decomposition-prompt.ts` (#184 prompt, versioned SHA-256)
- Execution engine: `packages/exploration-sandbox` (strict TypeScript validation, QuickJS worker)
- Spec: `docs/specs/code-mode-procedural-memory-diagnostic-2026-11-16.md`

**Feasibility success criterion (spec #183): met** — at least one new procedure was created, strictly validated, consolidated and persisted during Tour A, then really reused via `memory_list` + `memory_run` by an independent Tour B on the same repository and the same persistent catalogue, with traceable proof and no code recreation.
