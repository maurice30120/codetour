# 05: Implement Vibe Sub-Agent Comparator

**Spec**: #172 - POC — mémoire procédurale spécialisée par dépôt

**What to build**: Reproducible benchmark comparing Vibe's native research sub-agent against POC CodeTour with memory.

**Acceptance criteria**:
- [ ] Invoke Vibe's native research sub-agent programmatically
- [ ] Use Vibe's own tools and behavior (no modifications)
- [ ] Same model and configuration as POC (where possible)
- [ ] Same repository, commit, questions, objectives, evaluation grid
- [ ] Same token limits (or explicitly documented differences)
- [ ] Do NOT impose the 10 primitives on Vibe
- [ ] Isolate sessions between runs
- [ ] Normalize responses for comparable evaluation
- [ ] Measure tokens end-to-end (input/output/cache, exploration, search, diagnostics, corrections)
- [ ] Document any missing telemetry

**Blocked by**: None (can start immediately, but depends on Vibe API knowledge)

**Status**: ready-for-agent

**Notes**:
- Need to research how to programmatically invoke Vibe's research sub-agent
- Vibe has agents.spawn() API that can create sub-agents
- Need to extract token counts from Vibe's execution
- Consider: Vibe may not expose token counts through its API
- Alternative: Use Vibe's file_system tools directly as "native research tools"
