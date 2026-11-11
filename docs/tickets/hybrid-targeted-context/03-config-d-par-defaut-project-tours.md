# 03: Configuration par défaut - D pour Project Tour

**What to build:** Définir et appliquer la configuration optimale de l'**approche D** (Project Tour Targeted Context) comme défaut pour tous les Project Tours. Cette configuration doit offrir une bonne couverture du projet tout en restant économique : `enabled: true`, `maxFiles: 50`, `maxSymbolsPerFile: 50`, `includeDocumentation: true`, avec un focus sur les répertoires source principaux.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] La configuration par défaut pour D est définie dans `targeted-context/project-config.ts` ou équivalent
- [ ] Les Project Tours utilisent automatiquement cette configuration
- [ ] `maxFiles: 50` est appliqué
- [ ] `maxSymbolsPerFile: 50` est appliqué
- [ ] `rootDirectories: ["src", "lib", "packages", "app", "server"]` est configuré
- [ ] Les extensions principales sont incluses (TypeScript, JavaScript, Python, etc.)
- [ ] Les fichiers de test et node_modules sont exclus
- [ ] Des tests valident que la configuration est bien appliquée
