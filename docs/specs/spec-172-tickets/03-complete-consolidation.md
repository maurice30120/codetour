# 03: Complete Consolidation Logic

**Spec**: #172 - POC — mémoire procédurale spécialisée par dépôt

**What to build**: Consolidation must support add/replace/ignore after fingerprint check and re-execution, with simple deduplication.

**Acceptance criteria**:
- [ ] Add new functions to memory
- [ ] Replace existing functions with improved versions
- [ ] Ignore duplicates or unsuitable candidates
- [ ] Verify fingerprint/version matches executed code
- [ ] Re-execute in QuickJS with tested parameters before consolidation
- [ ] Verify structure and consistency of proofs
- [ ] Keep original intact until new version validated
- [ ] Maintain rollback capability
- [ ] Simple deduplication (no sophisticated scoring)
- [ ] Variants suffixées, original préservé

**Blocked by**: None (can start immediately)

**Status**: ready-for-agent

**Notes**:
- Current implementation in memory.ts supports add/ignore
- Missing: replace functionality
- Need to enhance fingerprint tracking
- Need to add re-execution verification before consolidation
- Preserve original code until new version is validated
