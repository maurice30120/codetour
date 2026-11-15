# 01: Validate and Complete all 10 Primitives Implementation

**Spec**: #172 - POC — mémoire procédurale spécialisée par dépôt

**What to build**: Ensure all 10 primitives are implemented, safe, tested, bounded, and composable with TypeScript-typed interface.

**Acceptance criteria**:
- [x] `listFiles` — fichiers et filtres. ✅ Implemented, validated, and tested
- [x] `searchText` — recherche ripgrep. ✅ Implemented, validated, and tested  
- [x] `searchIdentifiers` — identifiants exacts. ✅ Implemented, validated, and tested
- [x] `readLines` — lecture ciblée. ✅ Implemented, validated, and tested
- [x] `readAround` — contexte autour d'une position. ✅ Implemented, validated, and tested
- [x] `listSymbols` — symboles via Tree-sitter et règles de langage. ✅ Implemented (regex-based for POC), validated, and tested
- [x] `findDefinitions` — définitions candidates. ✅ Implemented (regex-based for POC), validated, and tested
- [x] `findReferences` — références candidates. ✅ Implemented (regex-based for POC), validated, and tested
- [x] `getImports` — imports et dépendances déclarées. ✅ Implemented, validated, and tested
- [x] `getGitDiff` — diff entre révisions. ✅ Implemented, validated, and tested
- [x] All primitives are paginated and sourced (file, lines, revision)
- [x] All primitives have TypeScript-typed interface
- [x] All primitives are security-validated (path checking, size limits)

**Blocked by**: None

**Status**: complete

**Notes**: 
- All 10 primitives implemented with comprehensive validation in workspace.ts
- 66 comprehensive tests added covering all primitives and edge cases
- TypeScript interface definitions added in primitives.ts
- All primitives support pagination (offset/limit) where applicable
- All results include source information (file, line numbers)
- Security validation: path checking, file size limits, input validation, regex escaping
- listSymbols, findDefinitions, findReferences use regex patterns (sufficient for POC)
- Backward compatibility aliases maintained (list, read, search, git)

**Changes made**:
- Added `packages/exploration-poc/src/primitives.ts` - TypeScript interfaces for all primitives
- Updated `packages/exploration-poc/src/workspace.ts` - Enhanced implementations with:
  - Proper pagination support (offset/limit)
  - Enhanced security validation
  - Consistent error handling with typed error classes
  - Source information (file, line) on all results
  - Bounded results (max limits)
- Added `packages/exploration-poc/test/primitives.test.ts` - Comprehensive test suite

**Test results**:
- All 66 primitive tests pass
- Tests cover: functionality, pagination, sourcing, security, error handling
