# 03: Configuration par défaut - D pour Project Tour

**What to build:** Définir et appliquer la configuration optimale de l'**approche D** (Project Tour Targeted Context) comme défaut pour tous les Project Tours. Cette configuration doit offrir une bonne couverture du projet tout en restant économique : `enabled: true`, `maxFiles: 50`, `maxSymbolsPerFile: 50`, `includeDocumentation: true`, avec un focus sur les répertoires source principaux.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] La configuration par défaut pour D est définie dans `targeted-context/hybrid-config.ts`
- [x] Les Project Tours utilisent automatiquement cette configuration
- [x] `maxFiles: 50` est appliqué
- [x] `maxSymbolsPerFile: 50` est appliqué
- [x] `rootDirectories: ["src", "lib", "packages", "app", "server"]` est configuré
- [x] Les extensions principales sont incluses (TypeScript, JavaScript, Python, etc.)
- [x] Les fichiers de test et node_modules sont exclus
- [x] Des tests valident que la configuration est bien appliquée

**Implementation:** `APPROACH_D_CONFIG` / `getApproachDConfig()` in
`packages/mcp-server/src/targeted-context/hybrid-config.ts`, used by the
`codetour://context/project-tour` handler. Tests: `test/unit/hybrid-targeted-context-benchmark.test.ts`.

**Correction associée :** `scanWorkspaceFiles` comparait un chemin absolu aux entrées relatives de
`rootDirectories`, donc aucun fichier n'était scanné. Corrigé dans `98809d7`.
