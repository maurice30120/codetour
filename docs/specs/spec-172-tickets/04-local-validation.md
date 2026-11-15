# 04: Complete Local Technical Validation

**Spec**: #172 - POC — mémoire procédurale spécialisée par dépôt

**What to build**: Local technical validation (types, whitelist, sandbox, traces) without semantic validation claims.

**Acceptance criteria**:
- [ ] Type checking (via TypeScript compiler)
- [ ] Whitelist of allowed primitives (10 only)
- [ ] Sandbox execution with resource limits
- [ ] Trace all calls and their proofs (file, lines, revision)
- [ ] No claims of semantic validation or exhaustiveness
- [ ] Rollback and documentation after validation
- [ ] Re-execution verification before write

**Blocked by**: 
- 02-add-typescript-validation (TypeScript compiler)
- 01-validate-10-primitives (primitive whitelist)

**Status**: ready-for-agent

**Notes**:
- Sandbox execution already implemented
- Need to add TypeScript type checking
- Need to verify primitive whitelist at runtime
- Traces are partially implemented, need enhancement
