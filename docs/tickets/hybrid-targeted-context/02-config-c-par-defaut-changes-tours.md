# 02: Configuration par défaut - C pour Changes Tour

**What to build:** Définir et appliquer la configuration optimale de l'**approche C** (Progressive MCP) comme défaut pour tous les Changes Tours. Cette configuration doit être optimisée pour l'efficacité token et la rapidité : `enabled: true`, `maxSymbols: 5000`, `pageSize: 200`, `maxFiles: 50`, `excludeNodeModules: true`, `trackCost: true`, avec les bonnes extensions incluses/exclues.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] La configuration par défaut pour C est définie dans `targeted-context/hybrid-config.ts`
- [x] Les Changes Tours utilisent automatiquement cette configuration
- [x] `maxSymbols: 5000` est appliqué
- [x] `pageSize: 200` est appliqué pour la pagination
- [x] Les extensions TypeScript/JavaScript/Python/Go sont incluses
- [x] Les fichiers de test et node_modules sont exclus
- [x] Le tracking de coût est activé
- [x] Des tests valident que la configuration est bien appliquée

**Implémentation :**

- `APPROACH_C_CONFIG` porte `pageSize: 200`, `maxFiles: 50`, `excludeNodeModules: true`,
  et `validateApproachCConfig` refuse toute autre valeur.
- `extractPaginatedTargetedContext` sert `pagination.pageSize ?? config.pageSize ?? maxSymbols` :
  sans paramètre d'URI, une page contient 200 symboles, pas 5000. Une valeur non positive retombe
  sur le défaut.
- `maxSymbols` borne désormais le **total** des symboles paginés (et non la taille de page) ;
  `pageSize` borne ce qui est servi à chaque appel.
- `selectChangedFiles` filtre `node_modules`, puis les extensions, puis applique `maxFiles` — le
  tout avant de lire les fichiers. Chaque troncature produit un warning explicite.
- Le serveur expose deux templates vers le même handler : l'URI de base
  (`codetour://context/changes-tour/{baseRef}/{headRef}`) applique le défaut 200, et
  `?page=&pageSize=` permet de choisir. Le matcher RFC 6570 du SDK exige tous les paramètres de
  query déclarés, d'où les deux entrées ; le template paginé est enregistré en premier pour que
  `{headRef}` ne capture pas la query.

**Tests :** `test/unit/hybrid-targeted-context-benchmark.test.ts` (valeurs par défaut et
validation), `test/unit/targeted-context.test.ts` (taille de page, `maxFiles`, `node_modules`,
économie de tokens page vs contexte complet), `test/integration/targeted-context-resource.test.ts`
(page 1 par défaut, page 2 demandée).
