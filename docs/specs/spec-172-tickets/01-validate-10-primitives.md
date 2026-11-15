# 01: Validate and Complete all 10 Primitives Implementation

**Spec**: #172 - POC — mémoire procédurale spécialisée par dépôt

**What to build**: Ensure all 10 primitives are implemented, safe, tested, bounded, and composable with TypeScript-typed interface.

**Acceptance criteria**:
- [ ] `listFiles` — fichiers et filtres. ✅ Implemented, needs validation
- [ ] `searchText` — recherche ripgrep. ✅ Implemented, needs validation  
- [ ] `searchIdentifiers` — identifiants exacts. ✅ Implemented, needs testing
- [ ] `readLines` — lecture ciblée. ✅ Implemented, needs validation
- [ ] `readAround` — contexte autour d'une position. ✅ Implemented, needs testing
- [ ] `listSymbols` — symboles via Tree-sitter et règles de langage. ✅ Implemented (basic), needs enhancement
- [ ] `findDefinitions` — définitions candidates. ✅ Implemented (basic), needs enhancement
- [ ] `findReferences` — références candidates. ✅ Implemented (basic), needs enhancement
- [ ] `getImports` — imports et dépendances déclarées. ✅ Implemented (basic), needs enhancement
- [ ] `getGitDiff` — diff entre révisions. ✅ Implemented, needs testing
- [ ] All primitives are paginated and sourced (file, lines, revision)
- [ ] All primitives have TypeScript-typed interface
- [ ] All primitives are security-validated (path checking, size limits)

**Blocked by**: None (can start immediately)

**Status**: ready-for-agent

**Notes**: 
- Basic implementations added in workspace.ts and sandbox worker.js
- Need to verify each primitive works correctly
- Need to add TypeScript interface definitions
- listSymbols, findDefinitions, findReferences currently use regex patterns instead of Tree-sitter
- Consider: for POC, regex-based implementations may be sufficient, but Tree-sitter would be more accurate
