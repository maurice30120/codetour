# 05: Ressource MCP unifiée pour les Project Tours

**What to build:** Créer une ressource MCP dédiée `codetour://generate/project-tour` qui **force** l'utilisation de l'approche D (Project Tour Targeted Context) pour tous les Project Tours. Cette ressource doit scanner le workspace, extraire les symboles clés des fichiers source, et retourner un contexte architectural complet.

**Blocked by:** 03 (configuration D par défaut)

**Status:** ready-for-agent

- [ ] La ressource `codetour://generate/project-tour` est enregistrée dans le serveur MCP
- [ ] La ressource accepte les paramètres `workspacePath` (optionnel), `fileName` (optionnel)
- [ ] La ressource utilise `extractProjectTargetedContext` (approche D) avec la configuration par défaut
- [ ] La ressource retourne un contexte valide avec les fichiers clés du projet
- [ ] Le coût token est < 400K pour un Project Tour
- [ ] La durée est < 4 secondes pour un Project Tour
- [ ] Des tests valident le bon fonctionnement de la ressource
- [ ] La rétro-compatibilité est maintenue avec les ressources existantes
