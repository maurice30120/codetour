# POC Code Mode avec mémoire sur PostgreSQL

## Conclusion

La composition de scripts fonctionne dans les tests locaux, mais **son intérêt n'est pas validé sur PostgreSQL**. Sur les 18 explorations Mistral, deux appels ont réutilisé un script ; aucune composition de plusieurs scripts mémorisés n'a été observée. Quatorze explorations sont restées partielles et la qualité des quatre résultats complets présente des lacunes. Les scripts enregistrés comportent aussi un défaut de paramétrage.

## Dispositif

- Dépôt public `postgres/postgres`, clone local complet à la profondeur 1, commit `70c4a57b64d39c526eb4c44a925eb92a6e56f3c5` (7 755 fichiers suivis). Les extraits consultés ont été transmis à Mistral.
- Trois questions liées : parsing de la requête, analyse/réécriture, puis flux complet jusqu'à la planification. Trois séquences par variante, avec les questions dans le même ordre ; alternance de l'ordre des variantes. Chaque séquence avec mémoire démarre avec une bibliothèque vide. La constitution de la bibliothèque et les échecs sont inclus.
- Modèle `mistral-small-latest`, température 0. Chaque exploration dispose de 10 appels modèle, 40 appels modèle/outils, 48 000 tokens et 90 s. Code Mode est actif dans les deux variantes ; seule la variante on dispose de la mémoire et des instructions associées.
- Recherche bornée à 30 000 fichiers et 50 correspondances, lecture limitée à 100 lignes et aux fichiers d'au plus 1 Mio. La liste reste limitée à 500 fichiers. Ces limites et l'ordre des résultats peuvent cacher des informations ; l'absence d'un résultat de recherche ne prouve pas son absence du dépôt.

Les références utiles préparées avant l'évaluation sont dans `src/backend/tcop/postgres.c` : définition de `pg_parse_query` lignes 617 et suivantes, appel à `raw_parser` ligne 626 ; appel à `pg_parse_query` dans `exec_simple_query` ligne 1083 ; définition de `pg_analyze_and_rewrite_fixedparams` ligne 683, appels à `parse_analyze_fixedparams` puis `pg_rewrite_query` lignes 701–710 ; appels à l'analyse/réécriture puis à `pg_plan_queries` lignes 1213–1217. Le code réel est la référence, pas ces seules lignes.

## Mesures

| Mesure cumulée | Mémoire off | Mémoire on |
|---|---:|---:|
| Explorations | 9 | 9 |
| Résultats complets | 1 | 3 |
| Résultats partiels | 8 | 6 |
| Erreurs levées | 0 | 0 |
| Tokens d'entrée | 320 470 | 330 359 |
| Tokens de sortie | 4 031 | 4 071 |
| Appels modèle | 80 | 83 |
| Appels outils | 86 | 79 |
| Durée cumulée d'exploration | 82,0 s | 67,4 s |
| Réutilisations de script | 0 | 2 |

Ces durées sont des sommes, pas une comparaison de latence contrôlée. Toutes les explorations partielles ont atteint la limite d'itérations. Les tokens incluent les runs partiels ; le coût facturé n'est pas disponible. Les différences de prompt, la variance et le petit échantillon interdisent d'attribuer les écarts au seul stockage des scripts.

## Revue de qualité

Les quatre résultats complets concernent la première question. Ils identifient `raw_parser` et son appel depuis `pg_parse_query`, mais aucun ne cite l'appel de `pg_parse_query` dans `exec_simple_query` à la ligne 1083 ; le lien avec le traitement des requêtes simples n'est donc pas pleinement étayé. Dans la troisième répétition on, plusieurs citations présentées comme des appels de la fonction correspondent en fait à la remontée de `debug_query_string` dans des fichiers BRIN, GIN et B-tree : elles ne prouvent pas les appels affirmés. Les deux autres questions n'ont produit aucun résultat final, dans aucune variante ; leurs attendus ne sont donc pas couverts dans les réponses finales.

Les deux réutilisations concernent le script `search("raw_parser")` dans la première séquence on, avec le même paramètre. Dans les trois séquences on, les scripts conservés lors de la première question codent en dur des termes comme `raw_parser` et `query_string` alors qu'ils déclarent un paramètre `query` : changer ce paramètre ne change pas leur comportement. Les exemples paramétrés produits lors d'explorations ensuite interrompues n'ont pas été enregistrés, car une exploration interrompue ne valide pas sa bibliothèque. Ces observations ne prouvent pas qu'un script de recherche soit inutile, mais elles ne montrent pas de généralisation ni de composition.

## Implémentation et limites

Le Code Mode accepte maintenant `script(id, params)` dans une expression pour appeler une expression mémorisée, sous les mêmes limites de sandbox et avec une profondeur maximale de 20. Les scripts candidats exécutés sans erreur et dont le résultat n'est pas tronqué peuvent être conservés après une réponse finale valide, même sans preuve attribuée ; ils ne sont pas pour autant considérés fiables. Les fonctions sont identifiées par leur identifiant et décrites dans le catalogue. Les dépendances entre fonctions ne sont pas suivies lors des purges, et la composition n'a été démontrée qu'en test local. La sandbox n'est pas une isolation au niveau système d'exploitation.

Les 16 tests d'exploration et les 9 tests de sandbox passent, notamment composition, limite de récursion et recherche au-delà des 500 fichiers de la liste. Ils n'établissent pas la qualité sémantique des réponses Mistral.

[Résultats bruts](results-postgres-70c4a57b.json) et [runner reproductible](postgres.mjs). Le runner utilise le trousseau ou `MISTRAL_API_KEY` ; les appels API sont potentiellement facturés. L'intérêt suivant à tester serait une validation des paramètres réellement utilisés et une stratégie de conclusion avant épuisement du budget, puis une nouvelle comparaison indépendante ; modifier le protocole en cours de série ne permettrait pas de réinterpréter cette série.
