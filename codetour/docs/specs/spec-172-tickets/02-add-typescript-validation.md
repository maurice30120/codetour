# 02: Add TypeScript Validation to function_try

**Spec**: #172 - POC — mémoire procédurale spécialisée par dépôt

**What to build**: `function_try` must control TypeScript syntax and types (strict mode), validate structure, check exclusive use of 10 primitives, then transpile to JavaScript and execute in QuickJS.

**Acceptance criteria**:
- [ ] Accept TypeScript source code (not just JavaScript)
- [ ] Validate syntax using TypeScript compiler
- [ ] Validate types in strict mode
- [ ] Check structure (function parameters, return types)
- [ ] Verify exclusive use of 10 primitives (no other functions)
- [ ] Transpile TypeScript to JavaScript
- [ ] Execute in QuickJS with existing resource limits
- [ ] Return compact error messages (code/line/message) without verbose output
- [ ] Trace: version, identifier/fingerprint, parameters, executed calls, results, errors

**Blocked by**: None (can start immediately)

**Status**: ready-for-agent

**Notes**:
- Currently sandbox accepts JavaScript only
- Need to add TypeScript compiler as dependency
- Need to parse TypeScript AST to check for primitive-only usage
- Error messages must be short and targeted
- Local controls must not require LLM calls
