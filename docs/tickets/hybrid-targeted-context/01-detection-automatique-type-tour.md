# 01: Détection automatique du type de Tour (Changes vs Project)

**What to build:** Le serveur MCP détermine automatiquement si une demande de Tour est un **Changes Tour** (diff/PR) ou un **Project Tour** (découverte) basé sur les paramètres de la requête. La détection utilise une logique simple : présence de `baseRef` ET `headRef` = Changes Tour → approche C, sinon = Project Tour → approche D.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] La détection identifie correctement un Changes Tour quand `baseRef` et `headRef` sont présents
- [x] La détection identifie correctement un Project Tour quand `baseRef` et/ou `headRef` sont absents
- [x] La détection fonctionne avec les paramètres `workspacePath` seul
- [x] La détection est implémentée dans le serveur MCP (`server.ts`)
- [x] Des tests unitaires valident la logique de détection
- [x] La rétro-compatibilité est maintenue avec les appels existants

**Implementation:** `packages/mcp-server/src/targeted-context/tour-type-detector.ts`, used by the
`codetour://context/changes-tour/...` and `codetour://context/project-tour` handlers in
`packages/mcp-server/src/server.ts`. Tests: `test/unit/tour-type-detector.test.ts`,
`test/unit/hybrid-targeted-context-benchmark.test.ts`.
