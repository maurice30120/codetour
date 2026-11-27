# 07: Implement Independent Evaluation

**Spec**: #172 - POC — mémoire procédurale spécialisée par dépôt

**What to build**: Independent evaluator (separate from both agents) that blindly verifies claims and proofs against the repository.

**Acceptance criteria**:
- [ ] Evaluator is distinct from POC and Vibe agents
- [ ] Blind verification (doesn't know which agent produced the result)
- [ ] Verifies claims against the repository code
- [ ] Checks proof quality and coverage
- [ ] Does NOT serve as comparator
- [ ] Does NOT serve as systematic production validation
- [ ] Judgment documented but not considered infallible

**Blocked by**: None (can start immediately)

**Status**: ready-for-agent

**Notes**:
- Current evaluate.mjs verifies file paths and line numbers
- Need to enhance to check claim accuracy
- Need to implement blind verification (remove agent identifiers)
- Need to normalize output format from both agents
- Evaluator should run after each benchmark run
