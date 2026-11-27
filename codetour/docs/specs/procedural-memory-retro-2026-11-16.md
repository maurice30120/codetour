# Procedural-memory diagnostic retro — 2026-11-16 (fixes to apply later)

**Status:** findings from two completed ten-ticket diagnostic runs (spec #183). Ticket #193 (report + synthesis comment) is still open; this file lists the harness problems to fix **before** the next run. Evidence paths are committed run artifacts.

**Runs compared** (both on `spec-174-integration`, model `mistral-medium-3.5`, budget 2M tokens / 400 calls / 100 iterations / 20 min per ticket, sequential script `poc/exploration-benchmark/spec183-ten-tickets.mjs`):

| Arm | Revision | Protocol | Model calls | Tokens | function_try | Accepted | Catalogue |
| --- | --- | --- | --- | --- | --- | --- | --- |
| v3 | `7a66bc3` | prompt v3 decision rule, anti-loop note, reuse reminder, fence-whitespace fix | 295 | 6.25M | **0** | 0 | empty |
| v4 | `069d77a` | wrapping obligation (primitives removed from exposed tools; prompt v4) + recovery shows the model its own output | 237 | 2.51M | **177** | 0 | empty |

Artifacts: `poc/exploration-benchmark/results-spec183-v3-20261116/`, `poc/exploration-benchmark/results-spec183-v4-20261116/`.

**v3 verdicts:** 6 complete, 1 partial (#165 evidence_missing), 3 failed (#166/#167/#176 — plan-block-only reply, `FinalAnswerNotJson` twice, second fatal).
**v4 verdicts:** 3 complete (#161/#163/#164), 6 partial (evidence_missing), 1 failed (#167 — ZodError, new mode, see F3).

## Blocking chain to the #183 success criterion

The minimal criterion (one procedure created, executed, accepted at Tour A, then reused via `memory_run` in Tour B) is still unmet. The chain, in order:

### F1 — `remember=true` is rare: 3 candidates out of 177 trials

Evidence: reconciliation logs — `161.json` (`exploreOrchestration` ×2), `164.json` (`exploreCodeModePaths`); the other eight tickets produced zero candidates.

The model executes trials but almost never re-submits a successful trial as a consolidation proposal (`remember=true` + canonical `name` + English `description`).

**Fix idea:** prompt v5 — after a trial succeeds and its question is marked `reuse=true`, re-submit it with `remember=true`, a camelCase name and a 1–2 sentence English description. Alternatively a harness-level nudge in the `function_try` result when the trial succeeded and `remember` is absent.

### F2 — `memory-selection` never selects: `{"selected":[]}` every time

Evidence: `memory-selection` trace entries in `161.json` (2300 in / 10 out tokens) and `164.json` (1212 in / 10 out) — a ~10-token reply is `{"selected":[]}`.

The selection prompt (`explore.ts`, "You may select none … prefer reuse over equivalent duplicates") at temperature 0 always declines. Spec #183 says the **deterministic validator** decides persistence; this LLM step is an extra filter that never passes and silently kills every candidate.

**Fix option (protocol change — decision needed):** validated strict candidates proceed directly to deterministic revalidation; the selection LLM stays consultative and its verdict is traced but no longer gating.

### F3 — ZodError is fatal with no recovery (#167, v4)

Evidence: `167.json` error — `resultSchema.parse` rejects `components[*].evidence: []` (`too_small`, expected >=1). The throw happens outside every recovery path; only `FinalAnswerNotJson` has one.

**Fix:** one visible recovery for schema-validation failures, same philosophy as the JSON recovery: inject the model's own output plus the schema error, ask for the required shape once, second failure fatal.

### F4 — `function_try` parameters are not traced (observability hole)

Evidence: script-call `recordCall` entries (`explore.ts`, `type: 'function_try'`) carry no `parameters` field. During the session this caused a wrong interim conclusion ("0 remember=true" — actually unobservable, and false per the reconciliation logs).

**Fix:** include at least `{ remember, name, question }` (and a source hash, not the full source) in script-call trace entries.

### F5 — `evidence_missing` on 6/10 tickets; trial outputs mostly `citations=none` and `TRUNCATED`

Evidence: v4 outcomes — dominant outcome strings are `returned=N; TRUNCATED, not exhaustive; citations=none`.

The model rarely attaches source citations to trial outputs, and most outputs hit the truncation bound — which then starves the final Tour of evidence.

**Fix idea:** require citations on trial outputs serving `reuse=true` questions; investigate why truncation is so frequent (sandbox output bounds vs. trial design).

## Protocol notes (must appear in the #193 report)

- The v4 wrapping obligation is a **spec #183 amendment**: creation is now coerced, so the diagnostic signal shifts entirely to **cross-Tour reuse** (Tour B choosing `memory_run` over rewriting). The report must state this and must not present v4 creation numbers as evidence of model initiative.
- v3 vs v4 token totals (6.25M → 2.51M) are **not** a savings claim: different failure modes dominate each arm (#183 out-of-scope; official comparison stays with #174 / G0–G5).

## Next run checklist (v5)

1. Decide F2 (selection bypass vs. keep gating).
2. Implement F3 (schema-error recovery) and F4 (parameter tracing) — unambiguous harness fixes.
3. Implement F1 (prompt v5 or harness nudge) per F2 decision.
4. Rerun the ten tickets (~2.5M tokens expected), compare v3/v4/v5, write the per-ticket + before/after report in `docs/specs/`, and post the synthesis comment on #183 (completes #193).
