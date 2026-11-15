# 06: Scale Benchmark to 20 Runs Per Solution

**Spec**: #172 - POC — mémoire procédurale spécialisée par dépôt

**What to build**: Execute benchmark with 20 runs per solution (Vibe and POC), with two independent series (repetition and transfer).

**Acceptance criteria**:
- [ ] Configure benchmark for 20 runs per solution
- [ ] Two series: repetition (previously encountered questions) and transfer (new but related questions)
- [ ] For POC: preserve memory within series, reset between series
- [ ] For Vibe: isolate sessions between runs
- [ ] Same questions across both solutions
- [ ] Same evaluation grid and token limits
- [ ] Measure: tokens (input/output/cache), model calls, tool calls, duration, output bytes
- [ ] Track: functions created/reused/replaced, quality and coverage of proofs, failures
- [ ] Collect all metrics for analysis

**Blocked by**:
- 05-vibe-comparator (need Vibe integration)
- 01-validate-10-primitives (need primitives working)

**Status**: ready-for-agent

**Notes**:
- Current benchmark in poc/exploration-benchmark/ uses 2 repetitions
- Need to scale to 20 runs
- Need to handle two series (repetition and transfer)
- Need to track all required metrics
- Current infrastructure already tracks many metrics, need to add token cache tracking
