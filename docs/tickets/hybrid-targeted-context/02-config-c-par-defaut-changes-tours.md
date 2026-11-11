# 02: Configuration par défaut - C pour Changes Tour

**What to build:** Définir et appliquer la configuration optimale de l'**approche C** (Progressive MCP) comme défaut pour tous les Changes Tours. Cette configuration doit être optimisée pour l'efficacité token et la rapidité : `enabled: true`, `maxSymbols: 5000`, `pageSize: 200`, `trackCost: true`, avec les bonnes extensions incluses/exclues.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] La configuration par défaut pour C est définie dans `targeted-context/config.ts` ou équivalent
- [ ] Les Changes Tours utilisent automatiquement cette configuration
- [ ] `maxSymbols: 5000` est appliqué
- [ ] `pageSize: 200` est appliqué pour la pagination
- [ ] Les extensions TypeScript/JavaScript/Python/Go sont incluses
- [ ] Les fichiers de test et node_modules sont exclus
- [ ] Le tracking de coût est activé
- [ ] Des tests valident que la configuration est bien appliquée
