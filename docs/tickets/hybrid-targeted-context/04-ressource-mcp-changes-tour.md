# 04: Ressource MCP dédiée pour les Changes Tours

**What to build:** Créer une ressource MCP dédiée qui **force** l'utilisation de l'approche C (Progressive MCP) pour tous les Changes Tours. Cette ressource doit extraire les fichiers changés entre `baseRef` et `headRef`, appliquer la pagination, et retourner un contexte optimisé pour les revues de code.

**Blocked by:** 02 (configuration C par défaut)

**Status:** done

- [x] La ressource `codetour://context/changes-tour/{baseRef}/{headRef}` est enregistrée dans le serveur MCP
- [x] La ressource accepte `baseRef` et `headRef`
- [x] La ressource utilise `extractPaginatedTargetedContext` (approche C) avec la configuration par défaut
- [x] La ressource retourne un contexte valide, paginé (200 symboles par défaut, `?page=&pageSize=` pour choisir)
- [x] Des tests valident le bon fonctionnement de la ressource
- [x] La rétro-compatibilité est maintenue avec les ressources existantes

**Décision de périmètre :** pas de paramètre `workspacePath` ni `fileName`. Le workspace est celui
du serveur, et un chemin arbitraire dans l'URI serait une lecture hors dépôt ; un filtre par fichier
demanderait une ressource dédiée. Les templates MCP ne savent pas exprimer de paramètre optionnel :
la pagination a donc son propre template.

**Seuils de tokens et de durée :** mesurés par le ticket 07, pas ici. Voir
`07-benchmark-validation.md`.

**Tests :** `test/integration/targeted-context-resource.test.ts` — page 1 par défaut (200 symboles)
et page 2 demandée, lus via le protocole MCP.
