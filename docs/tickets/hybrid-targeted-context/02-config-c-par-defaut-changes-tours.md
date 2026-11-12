# 02: Configuration par défaut - C pour Changes Tour

**What to build:** Définir et appliquer la configuration optimale de l'**approche C** (Progressive MCP) comme défaut pour tous les Changes Tours. Cette configuration doit être optimisée pour l'efficacité token et la rapidité : `enabled: true`, `maxSymbols: 5000`, `pageSize: 200`, `trackCost: true`, avec les bonnes extensions incluses/exclues.

**Blocked by:** None (can start immediately)

**Status:** partial

- [x] La configuration par défaut pour C est définie dans `targeted-context/hybrid-config.ts`
- [x] Les Changes Tours utilisent automatiquement cette configuration
- [x] `maxSymbols: 5000` est appliqué
- [ ] `pageSize: 200` est appliqué pour la pagination
- [x] Les extensions TypeScript/JavaScript/Python/Go sont incluses
- [ ] Les fichiers de test et node_modules sont exclus
- [x] Le tracking de coût est activé
- [x] Des tests valident que la configuration est bien appliquée

**Écarts constatés :**

- `pageSize` n'existe pas dans `TargetedContextConfig`. La pagination vient des variables d'URI
  (`?page=&pageSize=`) et, à défaut, `extractPaginatedTargetedContext` retombe sur
  `maxSymbols` (`context-extractor.ts:639`), soit 5000, pas 200.
- Les fichiers de test sont bien exclus (`excludeExtensions`), mais `TargetedContextConfig`
  n'a pas d'option `excludeNodeModules` : rien ne filtre explicitement `node_modules` côté
  Changes Tour.
