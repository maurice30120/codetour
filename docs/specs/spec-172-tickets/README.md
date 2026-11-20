# Spec #172 Implementation Tickets

**Spec**: [POC — mémoire procédurale spécialisée par dépôt](https://github.com/maurice30120/codetour/issues/172)

**Integration Branch**: `spec-172-integration`

**Status**: Work in progress

## Summary

This spec implements a POC to verify if a CodeTour agent that **learns procedures for answering questions about its repository** progressively reduces LLM token consumption without degrading Tour quality. The **only optimization objective is token cost**.

## Completed Work

✅ **T1-CRITICAL**: Removed cross-function calls (spec violation fixed)
- Removed `script()` function from sandbox
- Removed `scripts` parameter from runScript
- Updated all call sites and tests
- Changed terminology from "scripts" to "functions" for consistency

## Ticket Breakdown

### Phase 1: Core Implementation (High Priority)

| # | Ticket | Blocked By | Status |
|---|--------|------------|--------|
| 01 | [Validate and Complete all 10 Primitives](01-validate-10-primitives.md) | None | ⏳ Ready |
| 02 | [Add TypeScript Validation to function_try](02-add-typescript-validation.md) | None | ⏳ Ready |
| 03 | [Complete Consolidation Logic](03-complete-consolidation.md) | None | ⏳ Ready |
| 04 | [Complete Local Technical Validation](04-local-validation.md) | 01, 02 | ⏳ Ready |

### Phase 2: Benchmark Setup (High Priority)

| # | Ticket | Blocked By | Status |
|---|--------|------------|--------|
| 05 | [Implement Vibe Sub-Agent Comparator](05-vibe-comparator.md) | None | ⏳ Ready |
| 06 | [Scale Benchmark to 20 Runs](06-benchmark-infrastructure.md) | 05, 01 | ⏳ Ready |

### Phase 3: Evaluation & Reporting (Medium Priority)

| # | Ticket | Blocked By | Status |
|---|--------|------------|--------|
| 07 | [Implement Independent Evaluation](07-independent-evaluation.md) | None | ⏳ Ready |
| 08 | [Generate Report with Token Analysis](08-report-generation.md) | 06, 07 | ⏳ Ready |

## Current Status

### ✅ Completed
- Integration branch created: `spec-172-integration`
- Critical spec violation fixed (no cross-function calls)
- All existing tests passing

### 📋 In Progress
- 10 primitives implemented (basic versions)
- Need validation and testing

### ⏳ Not Started
- TypeScript validation for function_try
- Enhanced consolidation logic (replace functionality)
- Vibe sub-agent comparator
- Full-scale benchmark (20 runs)
- Independent evaluation
- Report generation

## Workflow

All tickets are **ready-for-agent** and can be grabbed from the **frontier**:

1. **Immediate frontier** (no blockers):
   - 01-validate-10-primitives
   - 02-add-typescript-validation
   - 03-complete-consolidation
   - 05-vibe-comparator
   - 07-independent-evaluation

2. **After 01 & 02**:
   - 04-local-validation

3. **After 05 & 01**:
   - 06-benchmark-infrastructure

4. **After 06 & 07**:
   - 08-report-generation

## Estimated Effort

| Ticket | Effort | Complexity |
|--------|--------|------------|
| 01 | Medium | Testing 10 primitives |
| 02 | High | TypeScript compiler integration |
| 03 | Medium | Consolidation logic |
| 04 | Low | Validation integration |
| 05 | High | Vibe API research + integration |
| 06 | Medium | Benchmark scaling |
| 07 | Medium | Evaluation logic |
| 08 | Medium | Reporting and analysis |

**Total**: ~3-4 weeks of focused work

## Recommendations

Given the user's concern about the work being "un peu gros" (a bit big), I recommend:

1. **Start with Phase 1** (tickets 01-04) to complete the core POC implementation
2. **Then Phase 2** (tickets 05-06) to set up the benchmark
3. **Finally Phase 3** (tickets 07-08) for evaluation and reporting

This allows for incremental progress and validation at each phase.

Alternatively, we could:
- **Focus on minimal viable benchmark first**: Tickets 01, 05, 06
- **Complete core implementation**: Tickets 01-04

What approach would you prefer?
