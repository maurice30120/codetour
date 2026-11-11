# 04: Ressource MCP unifiée pour les Changes Tours

**What to build:** Créer une ressource MCP dédiée `codetour://generate/changes-tour` qui **force** l'utilisation de l'approche C (Progressive MCP) pour tous les Changes Tours. Cette ressource doit extraire les fichiers changés entre `baseRef` et `headRef`, appliquer la pagination, et retourner un contexte optimisé pour les revues de code.

**Blocked by:** 02 (configuration C par défaut)

**Status:** ready-for-agent

- [ ] La ressource `codetour://generate/changes-tour` est enregistrée dans le serveur MCP
- [ ] La ressource accepte les paramètres `baseRef`, `headRef`, `workspacePath` (optionnel), `fileName` (optionnel)
- [ ] La ressource utilise `extractPaginatedTargetedContext` (approche C) avec la configuration par défaut
- [ ] La ressource retourne un contexte valide avec pagination
- [ ] Le coût token est < 150K pour un Changes Tour moyen
- [ ] La durée est < 3 secondes pour un Changes Tour moyen
- [ ] Des tests valident le bon fonctionnement de la ressource
- [ ] La rétro-compatibilité est maintenue avec les ressources existantes
