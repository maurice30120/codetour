# Bilan des optimisations — fonctions et tokens

Date : 17 novembre 2026. Fil Codex `01a1e9d9-bc55-7710-9f93-cc626701c952` (dernières 2-3 h) complété par des vérifications locales. Détails sources : les quatre rapports de `research-reports/` cités en fin de page.

## 1. Conclusion des optimisations du harnais

| Optimisation | État | Preuve | Limite |
| --- | --- | --- | --- |
| Saut de la synthèse mémoire quand une fonction réutilisée fournit une ligne citée par la réponse | Implémentée, testée | Rejeu local de la trace `b578dd37` : 8 203 tokens rejoués contre 14 456 au run initial (les 6 253 tokens des deux synthèses disparaissent) | Rejeu d'une trace fixe ; aucune mesure réelle validée (relance HTTP 503, puis relance sans réemploi) |
| Garde-fou lectures chevauchantes : avertissement dès que 80 % des lignes d'une page ont déjà été renvoyées | Implémenté, testé (43 tests ciblés) | Détection vérifiée en test ; dans la trace réelle, six lectures finales n'apportaient aucune ligne nouvelle | Effet sur une boucle réelle jamais démontré |
| Reprise de l'alerte de chevauchement quand elle ne tient pas dans la page | Implémenté, testé | Test reproduisant l'absence d'alerte avant correction | Aucun gain mesuré en réel |
| Conclusion contrôlée après 3 appels identiques ou 3 échecs identiques, si une preuve valide existe | Implémenté, testé (6 tests ciblés) | Une citation inventée ne peut pas déclencher la persistance | Run `b0806947` sans preuve éligible : le garde-fou n'a rien changé |
| Suppression du quota imposant un `function_try` avant toute conclusion | Implémenté, testé | Run suivant complet avec réemploi : 14 456 tokens, 8 citations | — |
| Essai de fonction réussi reste éligible à la consolidation même si sa sortie dépasse la limite de contexte | Corrigé, test de régression | Le test échouait avant correction, passe après ; 22 tests de consolidation OK | — |
| Propagation de `config.search.exclude` à la sandbox (le catalogue mémoire polluait les résultats) | Corrigé, testé | Test reproduisant la fuite ; suites ciblées OK | Run `128e8255` : une procédure mémorisée renvoie encore des fichiers `.tours` (les configs scoping n'ont pas de `search.exclude`) — voir reste à faire |

## 2. Fonctions réutilisables et livrables

| Livrable | Emplacement | Vérifié par |
| --- | --- | --- |
| Fonction `findSymbolOccurrences` | `packages/exploration-poc/src/.tours/.memory/functions/` | Créée, rejouée (3 citations valides), réutilisée pour `parseConfig`, `explore` |
| Fonctions `findSymbolMatches` + `findTsSymbolMatches` (filtre `.ts`, exclut `.tours/`) | `packages/mcp-server/src/.tours/.memory/functions/` | Créées puis réutilisées pour `handleCreateProjectTour`, `writeTourAtomic` |
| Fonction persistée côté `src` | `src/.tours/.memory/functions/` | Réutilisée pour `registerMcpProvider` dans `mcp.ts` |
| Tour racine « CodeTour : de l'extension au serveur MCP » (9 étapes) | `.tours/architecture_codetour_extension_mcp.tour` | Créé et validé via MCP |
| Tours scoping (6 + 5 étapes) | `src/.tours/` et `packages/mcp-server/src/.tours/` | Créés ; visibles en ouvrant chaque sous-répertoire comme racine |
| Tour harnais (6 étapes) | `packages/exploration-poc/src/.tours/recherche_configuration_memoire.tour` | Créé et validé |
| README du harnais | `packages/exploration-poc/README.md` | Mis à jour : synthèse évitée, garde-fous documentés |

À signaler : le catalogue mémoire étant lié à la racine du workspace, une copie brute de `.memory` vers une autre racine rend les fonctions hors catalogue — c'est pourquoi chaque racine a été ensemencée séparément.

## 3. Mesures de tokens — ce qu'elles disent

| Paire (même question, même modèle `zai-glm-5-3-flash`) | Mémoire activée | Mémoire désactivée | Écart |
| --- | ---: | ---: | --- |
| `loadConfig` (config.ts) — fonction non appelée | 64 829 | 30 859 | +110 % avec mémoire |
| Lancement CLI (cli.ts:90-112) — réemploi effectif | 14 456 | 4 308 | +236 % avec mémoire |
| `handleCreateProjectTour` (server.ts) — réemploi effectif | 12 497 | 15 417 | −19 % avec mémoire |
| Même question après correctif exclusions — réemploi effectif, run complet | 10 760 | 15 417 | −30 % avec réemploi |

**Conclusion honnête : aucune économie de tokens n'est démontrée de façon reproductible.** Sur les questions courtes et ciblées, le mode mémoire coûte plus cher ; la seule paire favorable (~30 %) est une mesure unique, non alternée, avec des outils et instructions différents selon le mode. La création de `findSymbolOccurrences` a coûté 51 474 + 2 980 = 54 454 tokens et n'est amortie dans aucune paire mesurée. Les gains prouvés à ce stade sont **structurels**, pas des économies : suppression de deux synthèses superflues (−6 253 tokens sur la trace rejouée), sortie contrôlée avant épuisement du budget, et des réponses complètes là où les runs expiraient.

## 4. Reste à faire

1. **Exclusions dans les configs scoping** : le run complet `128e8255` (10 760 tokens, réemploi) renvoie encore des fichiers `.tours/architecture_serveur_mcp.tour` via `findSymbolMatches`. Ajouter `search.exclude` dans `packages/exploration-poc/src/.tours/config.json`, `src/.tours/config.json` et `packages/mcp-server/src/.tours/config.json` (ou un défaut `.tours/**` dans le harnais), puis refaire une mesure.
2. **Remesurer les comparaisons tokens proprement** : plusieurs questions, ordre alterné, paires avec réemploi effectif, coût de création inclus dans l'amortissement. Une seule paire ne prouve rien.
3. **Démontrer les garde-fous en run réel** : le warning de chevauchement et la conclusion contrôlée n'ont été prouvés que par tests et rejeu ; aucun run n'a montré qu'ils évitent un épuisement de budget.
4. **État de la suite complète** : `npm test` complet rejoué le 17/11 à ~17:30 — échec (`EXIT=1`) sur 3 tests de `dist/test/cli/terminalSurface.test.js` (`TermDomSurface is not a constructor`, rendu terminal). Ces tests ne touchent pas les fichiers modifiés par la session (harnais, sandbox) ; à diagnostiquer (build `dist` périmé ou régression préexistante) avant de citer un « 238/238 » qui date d'avant les changements sandbox. Le log complet est dans `/private/tmp/codetour-npmtest-final.log`.
5. **Révoquer la clé API Mistral** qui figure en clair dans `.tours/config.json` et qui a été affichée pendant l'inspection ; en créer une nouvelle et la charger hors dépôt.
6. **Git** : nombreux fichiers suivis supprimés (anciens `.tours/*.tour`) et non-commités (`sandbox.d.ts`, `explore.ts`, `exploration-sandbox/`, tours créés, rapports) ; décider et committer, ou restaurer.
7. **Découverte des tours** : les tours scoping ne sont visibles qu'en ouvrant le sous-répertoire comme racine VS Code ; soit les déplacer/copier vers `.tours/` racine avec chemins adaptés, soit documenter la contrainte.
8. **Hygiène** : `/private/tmp/codetour-*.json*` et `.tours/.log/` contiennent du code source et des traces ; nettoyer ou exclure.
9. **Périmètre restant** : exécution détaillée d'une fonction mémorisée après résolution (branche `memory_run` au-delà des lignes 334-348) et la validation interne MCP ne sont pas couvertes par les tours.

## 5. Limites méthodologiques

- Les compteurs de tokens sont déclarés par le modèle ; disponibles dans les runs complets, absents des runs expirés.
- Les modes mémoire et non-mémoire n'exposent pas les mêmes outils et instructions : l'effet propre de la fonction reste confondu.
- Les rejeux sont déterministes mais ne prédisent pas le comportement d'un nouveau run du modèle.
- Les lectures directes hors harnais (vérifications de citations) ne sont pas mesurées.

## Sources

- `comparaison-tokens-memoire-20261117.md` — paires de mesures, rejeu, correctif de synthèse
- `memoire-scoped-20261117-diagnostic.md` — 12 runs tracés, garde-fous, correctifs
- `recherche-configuration-memoire-20261117.md` — tour harnais, fonction, découverte des tours
- Run final `128e8255-9b84-45cd-9e4a-2bb312f9229b` (`/private/tmp/codetour-server-benchmark-exclude-on.json`) — abouti après la coupure de quota
