# Spec #174 Implementation Tickets

**Spec**: [Benchmark PostgreSQL réel vs sous-agent Vibe natif + décomposition des tâches](https://github.com/maurice30120/codetour/issues/174)

**Spec Document**: [docs/specs/postgres-real-benchmark-2026-11-15.md](../../specs/postgres-real-benchmark-2026-11-15.md)

**Integration Branch**: `spec-174-integration`

**Status**: Paused at the user's request — current **NO-GO G2**, diagnostic ten-run Medium batch incomplete, new 80-run campaign not started. Use [REPRISE-2026-11-16.md](./REPRISE-2026-11-16.md) and the [session retrospective](../../retros/retro-spec-174-medium-2026-11-16.md). Two historical measured runs remain preserved separately; old seals and old green gates cannot authorize the changed configuration.

## Summary

This spec implements a **real, contradictory, and reproducible measurement** of token savings from CodeTour's procedural memory on `postgres/postgres`, compared to the **native Vibe research sub-agent**. The **only optimization objective is token cost** per correct Tour.

**Key Constraints:**
- PostgreSQL fixed at commit `70c4a57b64d39c526eb4c44a925eb92a6e56f3c5`
- No mocks, no simulated agents, no invented results
- Real native Vibe sub-agent invocation required (G1)
- Complete instrumentation of all LLM calls (G2)
- 80 real executions minimum (2 series × 2 agents × 20 requests)
- Independent blind evaluation required
- Verdict can be VALIDATED, INVALIDATED, INDETERMINED, or NO-GO

## Blocking Gates (G0-G5)

All gates must be satisfied before main benchmark:

| Gate | Description | Status |
|------|-------------|--------|
| G0 | POC conformance to #172: 10 primitives, TypeScript strict, QuickJS, memory_list, memory_run, consolidation | ✅ |
| G1 | Authentic Vibe: proof of real native sub-agent invocation | ✅ |
| G2 | Total instrumentation: reliable counters for every model call | ❌ Native journal coverage incomplete; strict reconciliation required |
| G3 | Real fixture: PostgreSQL at fixed SHA, read-only clone | ✅ |
| G4 | Independent evaluator: blind verification protocol | ✅ |
| G5 | Pre-registration: manifesto hashed, not modified during benchmark | ❌ Historical seal differs from corrected sources and Medium configuration |

**NO-GO if any gate fails**

## Ticket Breakdown

### Phase 0: Blocking Gates (Must complete before benchmark)

| # | Ticket | Blocked By | Status |
|---|--------|------------|--------|
| T01 | [Prompt de décomposition](01-prompt-decomposition.md) | None | ⏳ Ready |
| T02 | [Audit conformité #172](02-audit-conformite-172.md) | None | ⏳ Ready |
| T03 | [Connecteur Vibe natif](03-connecteur-vibe-natif.md) | None | ⏳ Ready |
| T04 | [Fixture PostgreSQL](04-fixture-postgres.md) | None | ⏳ Ready |
| T05 | [Runner et compteurs](05-runner-compteurs.md) | T02, T03, T04 | ⏳ Blocked |
| T06 | [Évaluateur aveugle](06-evaluateur-aveugle.md) | T04 | ⏳ Blocked |

### Phase 1: Benchmark Execution

| # | Ticket | Blocked By | Status |
|---|--------|------------|--------|
| T07 | [Pilote + 80 runs](07-pilote-80-runs.md) | T01, T02, T03, T04, T05, T06 | ⏳ Blocked |

### Phase 2: Reporting

| # | Ticket | Blocked By | Status |
|---|--------|------------|--------|
| T08 | [Rapport réel](08-rapport-reel.md) | T07 | ⏳ Blocked |

## Dependencies Graph

```
T01, T02 → T07
T03, T04 → (T05, T06)
T05 → T07 (depends on T02, T03, T04)
T06 → T07 (depends on T04)
T07 → T08
```

**Frontier (Ready to start):** T01, T02, T03, T04

## Current Status

### ✅ Completed
- Integration branch created: `spec-174-integration`
- Spec document available

### 📋 Not Started
- All tickets pending

## Workflow

All tickets are **ready-for-agent** and can be grabbed from the **frontier**:

1. **Immediate frontier** (no blockers):
   - T01: Prompt de décomposition
   - T02: Audit conformité #172
   - T03: Connecteur Vibe natif
   - T04: Fixture PostgreSQL

2. **After T02, T03, T04**:
   - T05: Runner et compteurs

3. **After T04**:
   - T06: Évaluateur aveugle

4. **After T01-T06**:
   - T07: Pilote + 80 runs

5. **After T07**:
   - T08: Rapport réel

## Estimated Effort

| Ticket | Effort | Complexity | Priority |
|--------|--------|------------|----------|
| T01 | Medium | Prompt engineering + tests | High |
| T02 | High | Code audit + TypeScript validation | Critical |
| T03 | High | Vibe integration + authentication | Critical |
| T04 | Medium | Fixture setup + manifest | High |
| T05 | High | Instrumentation + runner | High |
| T06 | Medium | Evaluation logic | High |
| T07 | High | 80 real executions | High |
| T08 | Medium | Analysis + reporting | Medium |

**Total**: ~4-6 weeks of focused work

## Blocking Gates Status

- **G0** (POC #172 conformance): Must pass before T07
- **G1** (Authentic Vibe): Must pass before benchmark
- **G2** (Instrumentation): Must pass before benchmark
- **G3** (Fixture): Must pass before benchmark
- **G4** (Evaluator): Must pass before benchmark
- **G5** (Pre-registration): Must pass before benchmark

**NO benchmark without all gates G0-G5 satisfied**

## Recommendations

Given the complexity and the NO-GO constraints:

1. **Start with T02 (Audit #172)** - This is critical and blocks T05/T07
2. **Parallelize T01, T03, T04** - These have no dependencies
3. **Validate all gates G0-G5** before proceeding to T07
4. **Ensure real Vibe native sub-agent access** (T03) - This is a hard requirement

## Important Notes

- **No mocks allowed**: All measurements must be from real executions
- **No simulated agents**: Must use actual Vibe native research sub-agent
- **80 minimum executions**: 2 series × 2 agents × 20 requests
- **Blind evaluation**: Evaluator must not see agent or token costs
- **Pre-registration**: All protocols must be hashed and immutable
- **Verdict options**: VALIDATED, INVALIDATED, INDETERMINED, NO-GO

**Failure to meet any requirement = NO-GO, not a failed benchmark**
