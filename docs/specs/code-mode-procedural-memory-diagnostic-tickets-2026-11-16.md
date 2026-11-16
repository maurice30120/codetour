# Code Mode procedural-memory diagnostic — ticket map

**Specification:** [Issue #183](https://github.com/maurice30120/codetour/issues/183) · [Committed spec](./code-mode-procedural-memory-diagnostic-2026-11-16.md)  
**Tracking system:** GitHub Issues in `maurice30120/codetour`  
**Baseline branch for the committed documentation:** `spec-174-integration`  
**Prepared from:** 2026-11-16 Grill Me discussion, formalized with Matt Pocock's `to-spec` and `to-tickets` conventions.

The issue tracker is the **live authority for ticket status**. This file is a committed roadmap and dependency snapshot, not a duplicate ticket tracker. Every linked issue includes the skill's `Parent`, `What to build`, `Acceptance criteria` and `Blocked by` sections and the `ready-for-agent` label.

## First milestone: observable CodeTour function learning (diagnostic only)

| GitHub issue | Deliverable (vertical slice) | Blocked by |
| --- | --- | --- |
| [#184 — D01](https://github.com/maurice30120/codetour/issues/184) | A Tour produces a brief, revisable English functional plan, plus traceable decisions versus actual memory/tool calls | None |
| [#185 — D02](https://github.com/maurice30120/codetour/issues/185) | `function_try` reports every invalid citation deterministically and supports agent repair/abandonment in a Tour | None |
| [#186 — D03](https://github.com/maurice30120/codetour/issues/186) | Agent/tool instructions in English while Tours remain in the language requested by the user | None |
| [#187 — D04](https://github.com/maurice30120/codetour/issues/187) | Validated Tour proposals become append-only stored procedures only after deterministic validation and English description checks | #185 |
| [#188 — D05](https://github.com/maurice30120/codetour/issues/188) | Two independently traced Tours prove create/repair/accept in Tour A, then `memory_list` → `memory_run` reuse in Tour B | #184, #185, #186, #187 |

**Diagnostic success:** a real, independently re-executed TypeScript procedure is accepted into a persistent per-repository catalogue at the end of Tour A and actually reused in Tour B. Collect all tokens, but do **not** claim savings or perform the official Vibe comparison during this milestone. Allow generous configurable safety budgets. GLM 5.3 Flash is a candidate only if accessible in the harness.

## Second milestone: official real comparison with native Vibe (separate from diagnostic)

| GitHub issue | Deliverable (vertical slice) | Blocked by |
| --- | --- | --- |
| [#175 — T01](https://github.com/maurice30120/codetour/issues/175) | Freeze and test CodeTour's canonical exploration prompt for the official protocol | #188 |
| [#176 — T02](https://github.com/maurice30120/codetour/issues/176) | Audit technical and functional conformance of the memory engine to #172/#174 | #187 |
| [#177 — T03](https://github.com/maurice30120/codetour/issues/177) | Verify real Vibe native research-subagent invocation and complete, attributable usage | None |
| [#178 — T04](https://github.com/maurice30120/codetour/issues/178) | Seal PostgreSQL fixture, real repeat/transfer questions and independent references | None |
| [#179 — T05](https://github.com/maurice30120/codetour/issues/179) | Fair paired runner with complete true usage and **same effective model on both arms**; mandatory NO-GO gates | #175, #176, #177, #178, #188 |
| [#180 — T06](https://github.com/maurice30120/codetour/issues/180) | Independent blind semantic evaluation of correct Tours | #178 |
| [#181 — T07](https://github.com/maurice30120/codetour/issues/181) | Gate-certified pilot, then 80 actual runs or an evidence-backed NO-GO | #175, #176, #177, #178, #179, #180, #188 |
| [#182 — T08](https://github.com/maurice30120/codetour/issues/182) | Contradictory, reproducible cumulative-token/quality report with honest verdict | #181 |

**Official benchmark authority:** [Issue #174](https://github.com/maurice30120/codetour/issues/174). Its requirements — actual native Vibe search subagent, **identical verified effective model**, real token telemetry, PostgreSQL pinned revision, sealed protocol, independent blind evaluation, and G0–G5 — still govern the 80-run study. A successful diagnostic is **not** evidence of token savings.

## Interpretation and sequencing

- Work can begin immediately on **#184, #185, #186, #177, #178**; this refers to dependencies, not to actual implementation status.
- The diagnostic implementer should prioritize **#184 → #185/#187 → #188** while #186 can proceed independently; #187 needs #185 first.
- None of the new diagnostic tickets force per-question function creation, smart semantic deduplication, function replacement, a new LLM judge or a Vibe model-parity gate **during the diagnostic**. Those later protocol requirements apply only where the official spec expressly calls for them.
- Every ticket is published on GitHub using textual `Blocked by` references. Native issue-subissue and blocking links are **not asserted** by this document.
- No benchmark or TypeScript implementation was executed as part of publishing these specifications and tickets.
