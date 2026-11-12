# 04: Ressource MCP dédiée pour les Changes Tours

**What to build:** Créer une ressource MCP dédiée qui **force** l'utilisation de l'approche C (Progressive MCP) pour tous les Changes Tours. Cette ressource doit extraire les fichiers changés entre `baseRef` et `headRef`, appliquer la pagination, et retourner un contexte optimisé pour les revues de code.

**Blocked by:** 02 (configuration C par défaut)

**Status:** partial

- [x] La ressource `codetour://context/changes-tour/{baseRef}/{headRef}` est enregistrée dans le serveur MCP
- [ ] La ressource accepte les paramètres `baseRef`, `headRef`, `workspacePath` (optionnel), `fileName` (optionnel)
- [x] La ressource utilise `extractPaginatedTargetedContext` (approche C) avec la configuration par défaut
- [x] La ressource retourne un contexte valide, paginé quand `?page=` est fourni
- [ ] Le coût token est < 150K pour un Changes Tour moyen
- [ ] La durée est < 3 secondes pour un Changes Tour moyen
- [ ] Des tests valident le bon fonctionnement de la ressource
- [x] La rétro-compatibilité est maintenue avec les ressources existantes

**Écarts constatés :**

- Le template d'URI est `{baseRef}/{headRef}?page={page}&pageSize={pageSize}` : ni `workspacePath`
  ni `fileName` ne sont acceptés. Le workspace vient du contexte du serveur.
- Les seuils de tokens et de durée ne sont **pas mesurés** : ils relèvent du ticket 07.
- Aucun test n'exerce les ressources `codetour://context/*` (seuls le détecteur et les
  configurations sont testés).
