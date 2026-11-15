# 08: Generate Report with Token Analysis

**Spec**: #172 - POC — mémoire procédurale spécialisée par dépôt

**What to build**: Report with token curves, dispersion, break-even point, and verdict (validated/invalidated/indeterminate).

**Acceptance criteria**:
- [ ] Token curves for both solutions across runs
- [ ] Dispersion analysis (min, max, median, standard deviation)
- [ ] Marginal token cost per run
- [ ] Cumulative token cost
- [ ] Tokens per correct Tour
- [ ] Break-even point in tokens (where POC becomes cheaper than Vibe)
- [ ] Verdict: validé / invalidé / indéterminé
- [ ] Document all measurements: exploration, search, diagnostics, corrections, selection, consolidation
- [ ] Document quality and coverage of proofs
- [ ] Document failures and partial Tours
- [ ] Document any configuration differences

**Blocked by**:
- 06-benchmark-infrastructure (need benchmark data)
- 07-independent-evaluation (need evaluation results)

**Status**: ready-for-agent

**Notes**:
- Need to collect and aggregate all benchmark metrics
- Need to generate visualizations (token curves)
- Need to calculate statistical measures
- Need to determine break-even point
- Report format: JSON and Markdown
- Include all raw data for reproducibility
