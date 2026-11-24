# 06: Scale Benchmark to 20 Runs Per Solution

**Spec**: #172 - POC — mémoire procédurale spécialisée par dépôt

**What to build**: Execute benchmark with 20 runs per solution (Vibe and POC), with two independent series (repetition and transfer).

**Acceptance criteria**:
- [x] Configure benchmark for 20 runs per solution
- [x] Two series: repetition (previously encountered questions) and transfer (new but related questions)
- [x] For POC: preserve memory within series, reset between series
- [x] For Vibe: isolate sessions between runs
- [x] Same questions across both solutions
- [x] Same evaluation grid and token limits
- [x] Measure: tokens (input/output/cache), model calls, tool calls, duration, output bytes
- [x] Track: functions created/reused/replaced, quality and coverage of proofs, failures
- [x] Collect all metrics for analysis

**Blocked by**:
- 05-vibe-comparator (need Vibe integration)
- 01-validate-10-primitives (need primitives working)

**Status**: completed

**Notes**:
- Created run-scaled-benchmark.mjs that executes 20 runs per solution
- Created vibe-adapter.mjs for Vibe integration with session isolation
- Added transfer tasks for testing generalization
- All metrics tracked: tokens, calls, duration, cost, functions, memory operations
- Memory preserved within POC series, reset between series
- Vibe sessions isolated between runs using unique session IDs
- Comprehensive summary.json with per-solution, per-series, per-task metrics
- Documentation in README-SCALED.md

**Files added**:
- `poc/exploration-benchmark/run-scaled-benchmark.mjs` - Main runner
- `poc/exploration-benchmark/vibe-adapter.mjs` - Vibe adapter
- `poc/exploration-benchmark/README-SCALED.md` - Documentation
