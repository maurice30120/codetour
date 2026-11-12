# 05: Ressource MCP dédiée pour les Project Tours

**What to build:** Créer une ressource MCP dédiée qui **force** l'utilisation de l'approche D (Project Tour Targeted Context) pour tous les Project Tours. Cette ressource doit scanner le workspace, extraire les symboles clés des fichiers source, et retourner un contexte architectural complet.

**Blocked by:** 03 (configuration D par défaut)

**Status:** done

- [x] La ressource `codetour://context/project-tour` est enregistrée dans le serveur MCP
- [x] La ressource utilise `extractProjectTargetedContext` (approche D) avec la configuration par défaut
- [x] La ressource retourne un contexte valide avec les fichiers clés du projet
- [x] Des tests valident le bon fonctionnement de la ressource
- [x] La rétro-compatibilité est maintenue avec les ressources existantes

**Décision de périmètre :** pas de paramètre `workspacePath` ni `fileName`. Le workspace est celui
du serveur (répertoire de démarrage) ; un chemin arbitraire dans l'URI serait une lecture hors
dépôt. Voir la section « Ressources MCP de contexte » de la spec hybride.

**Seuils de tokens et de durée :** mesurés par le ticket 07, pas ici. Voir
`07-benchmark-validation.md`.

**Tests :** `test/integration/targeted-context-resource.test.ts` — la ressource renvoie les
symboles du workspace (`src/app.ts`, `lib/util.ts`) via le protocole MCP.
