# Comparaison ponctuelle des tokens : mémoire activée ou désactivée

Question identique : « Dans config.ts, comment loadConfig charge-t-elle le fichier de configuration et que fait-elle quand le fichier manque ? Cite les lignes pertinentes et indique toute incertitude. » Même racine `packages/exploration-poc/src`, modèle `zai-glm-5-3-flash`, budgets et configuration, exécutions successives le 17 novembre 2026.

| Mode | RunId | Statut | Entrée | Sortie | Total | Réemplois |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Mémoire activée | `4ce6b7ad-a280-491f-8aa8-3bce6342de82` | complet | 62 440 | 2 389 | 64 829 | 0 |
| Mémoire désactivée | `2f2aab5f-747d-4c30-b49f-b167923ae95c` | complet | 29 195 | 1 664 | 30 859 | 0 |

Les compteurs sont disponibles pour les deux runs. Le mode mémoire a consommé 33 970 tokens de plus, soit environ 110 % de plus dans cette paire. Les deux réponses citent `config.ts:61-71` ; une lecture directe confirme que `loadConfig` lit `.tours/config.json` en UTF-8 et retourne `DEFAULT_CONFIG` si l'erreur est `ENOENT`. Les références prouvent l'existence des lignes ; cette vérification cible uniquement la question comparée et ne valide pas toutes les affirmations secondaires.

## Deuxième paire : fonction effectivement réutilisée

Question identique : « Dans cli.ts, comment la CLI lance-t-elle explore après le préflight ? Examine uniquement les lignes 90 à 112, puis donne immédiatement une réponse JSON avec références et incertitudes. » Même modèle, racine et budgets ; exécutions successives après suppression de l'instruction imposant une nouvelle fonction à chaque réponse.

| Mode | RunId | Statut | Entrée | Sortie | Total | Réemplois |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Mémoire activée | `b578dd37-5ed6-4fff-b3fd-169fd4ed2544` | complet | 11 066 | 3 390 | 14 456 | 1 |
| Mémoire désactivée | `8478abde-abf9-4c0d-805c-27b62918609f` | complet | 3 031 | 1 277 | 4 308 | 0 |

Les deux réponses citent le préflight conditionnel, l'appel à `explore` et l'émission du résultat ; ces affirmations ont été comparées directement à `cli.ts:98-112`. Le run avec mémoire a réellement exécuté `findSymbolOccurrences`, mais a consommé 10 148 tokens de plus, soit environ 236 % de plus que le run sans mémoire. Les compteurs sont disponibles. Ce résultat défavorable concerne une question courte avec les lignes déjà indiquées : une paire ne généralise pas à d'autres tâches, et les différences d'outils, d'instructions et de traitement restent confondues avec l'effet de la fonction. Le coût de création n'est pas inclus dans ces totaux ; l'inclure aggraverait ici le bilan avec mémoire. Résultats : `/private/tmp/codetour-cli-run13.json` et `/private/tmp/codetour-cli-memory-off.json`.

Dans le run avec mémoire, les deux appels `memory-synthesis` représentent 4 217 tokens d'entrée et 2 036 de sortie, soit 6 253 tokens sur les 14 456. Le harnais a ensuite été modifié pour ne plus lancer cette synthèse automatique lorsqu'une fonction mémorisée a fourni une ligne effectivement citée par la réponse et dont la preuve est valide ; une synthèse reste possible sans réemploi pertinent. Le test de régression a échoué avant correction puis réussi après, ainsi que les tests de synthèse existants.

Un test complémentaire vérifie aussi le cas inverse : si la fonction réutilisée trouve une ligne sans rapport avec les références de la réponse, elle ne supprime pas la phase de synthèse. Les quatre tests de synthèse et le contrôle TypeScript passent.

Vérification après les derniers changements : suite complète `npm test`, 238 tests réussis sur 238.

Dans ce run, `findSymbolOccurrences` a renvoyé entre autres `cli.ts:111`, qui apparaît dans la réponse finale ; il satisfait donc le nouveau critère. La suite complète du paquet après correction passe : 237 tests sur 237. La soustraction des 6 253 tokens observés illustre le poste supprimé dans ce cas historique ; elle ne prédit pas la consommation d'un nouveau run, dont les autres appels peuvent varier.

Un rejeu local déterministe des réponses modèle enregistrées du run `b578dd37-5ed6-4fff-b3fd-169fd4ed2544` a ensuite exécuté le harnais corrigé, avec une copie temporaire de la mémoire et les mêmes paramètres de recherche. Il termine avec un réemploi et trois réponses modèle rejouées, sans appel `memory-synthesis` ; la somme des compteurs historiques de ces réponses est 6 849 + 1 354 = 8 203 tokens, contre 14 456 pour le run initial. Aucun appel réseau n'a été réalisé par ce rejeu. C'est une preuve de suppression des deux appels dans cette trace fixe, pas une nouvelle mesure de consommation réelle ni une garantie sur le comportement futur du modèle. Script de diagnostic temporaire : `/private/tmp/codetour-replay-optimized.mjs` ; logs susceptibles de contenir du code source.

La tentative de remesure `788d757b-dbff-44af-b14f-5acea02f03c1` a échoué avec HTTP 503 ; ses compteurs sont incomplets. La relance `f3e8dfee-7ee1-4075-b616-68bf2405b280` est complète à 10 885 tokens d'entrée et 4 253 de sortie, mais sans réemploi de la fonction. Elle ne mesure donc pas le cas corrigé. Aucun gain réel de cette modification n'est revendiqué sur la base de ces runs.

Un essai ultérieur demandant explicitement le réemploi (`8fe415d1-951e-45ab-95b2-5bbe6b5ed617`) a exécuté `findSymbolOccurrences`, puis effectué des lectures répétées jusqu'à l'arrêt sur budget : 61 979 tokens d'entrée et 1 088 de sortie, résultat partiel. La réponse finale n'ayant pas été produite, la phase de synthèse n'a pas été atteinte ; cet essai ne mesure pas non plus l'optimisation après réemploi et n'est pas directement comparable aux questions précédentes, car sa formulation diffère.

L'analyse de cette trace montre six lectures finales entièrement composées de lignes déjà renvoyées. Un défaut du garde-fou a été reproduit : si la première alerte dépassait la limite de sortie, elle n'était jamais retentée pour cette séquence. La correction retente l'alerte sur une page ultérieure assez courte ; elle ne tronque pas une page pour faire place à l'avertissement et n'établit pas que tous les cas de lecture répétée seront évités. Les deux tests ciblés et TypeScript passent ; aucun gain réel n'a été mesuré après cette correction.

**Limites :** un seul essai par mode et question ne permet pas d'établir une moyenne ni un gain reproductible. Dans la première paire la fonction enregistrée n'a pas été appelée ; dans la seconde elle l'a été, mais les modes exposent aussi des outils et instructions différents. L'ordre n'est pas alterné. La création de `findSymbolOccurrences` a consommé 51 474 tokens d'entrée et 2 980 de sortie lors du run `f40ed0e1-e310-42f6-9f44-6fa143e06c49` ; aucun amortissement n'est observé dans la seconde paire. Les premiers résultats JSON et fichiers de progression sont dans `/private/tmp/codetour-benchmark-memory-{on,off}.json*`.
