# Essais du POC d'exploration avec Mistral

## Résultat

Sur les essais effectués, **l'intérêt de la mémoire de scripts n'est pas démontré** : aucune des six explorations avec mémoire de la série principale n'a réutilisé de script. L'instruction supplémentaire a bien été transmise au modèle, mais celui-ci n'a appelé `code` dans aucune exploration avec mémoire. Dans ces conditions, comparer les métriques ne mesure pas un gain de réutilisation. Le petit échantillon ne permet pas non plus de conclure à une différence générale de qualité entre les variantes.

Trois des six explorations avec mémoire et une des six sans mémoire ont produit un résultat complet. Les autres se sont arrêtées sur la limite de huit appels au modèle. Le coût facturé n'est pas fourni par l'adaptateur : il ne peut donc pas être calculé ici, ni ramené au nombre de réponses correctes.

## Protocole

- Modèle : `mistral-small-latest`, température 0 ; sa version effective n'est pas enregistrée par l'API dans ces résultats. Date : 14 novembre 2026.
- Données transmises : uniquement le petit dépôt synthétique `workspace/` et les objectifs publics de `tasks.json`. Les attendus restent hors du dépôt transmis.
- Code Mode activé dans les deux variantes ; mémoire désactivée ou activée. Un workspace et une bibliothèque vides sont créés pour chaque couple tâche/variante ; les deux demandes successives de ce couple partagent leur bibliothèque. L'ordre on/off alterne selon la tâche.
- Trois tâches distinctes : calcul de `totalPrice`, dépendances de `Catalog`, flux de `postOrder`. Deux demandes identiques par tâche et variante : **12 explorations**, soit six par variante. Les trois tâches ne sont pas trois répétitions indépendantes d'une même tâche.
- Budget identique : huit appels au modèle au maximum, 32 appels modèle/outils, 32 000 tokens et 60 secondes par exploration. Les métriques comprennent la première demande, qui peut constituer la mémoire, et la seconde, qui pourrait la réutiliser.
- Modification atomique avant cette série : dans l'instruction propre à la mémoire, un exemple `search(params.query)` incite à appeler `code` avec `remember=true`. Cela modifie le prompt de la variante activée : on mesure le dispositif complet, prompt inclus. Cette incitation n'a pas suffi à produire une réutilisation.
- Commande reproductible : `node poc/exploration-benchmark/experiment-memory.mjs <nouveau-fichier.json>`. Elle utilise `MISTRAL_API_KEY` ou lit l'entrée autorisée du trousseau macOS. Elle effectue des appels API potentiellement facturés ; la clé n'est pas enregistrée dans le résultat.

## Série principale : chaque exploration

Les tokens proviennent des usages renvoyés par l'API ; la durée est celle de l'exploration, en millisecondes. « Partiel » signifie qu'aucun résultat structuré final n'a été produit avant le budget d'itérations, et non qu'une réponse incomplète a été validée.

| Tâche | Mémoire | Demande | État | Tokens entrée / sortie | Appels modèle / outils | Durée ms | Réutilisations |
|---|---|---:|---|---:|---:|---:|---:|
| function | off | 1 | partiel | 6 737 / 146 | 8 / 8 | 4 018 | 0 |
| function | off | 2 | complet | 5 536 / 532 | 7 / 6 | 6 028 | 0 |
| function | on | 1 | complet | 4 764 / 284 | 5 / 4 | 3 931 | 0 |
| function | on | 2 | complet | 4 764 / 239 | 5 / 4 | 2 957 | 0 |
| class | off | 1 | partiel | 6 109 / 151 | 8 / 8 | 3 831 | 0 |
| class | off | 2 | partiel | 6 194 / 150 | 8 / 8 | 4 493 | 0 |
| class | on | 1 | partiel | 8 559 / 90 | 8 / 8 | 3 755 | 0 |
| class | on | 2 | partiel | 8 527 / 108 | 8 / 8 | 5 425 | 0 |
| flow | off | 1 | partiel | 6 809 / 575 | 8 / 8 | 7 299 | 0 |
| flow | off | 2 | partiel | 6 324 / 130 | 8 / 8 | 4 096 | 0 |
| flow | on | 1 | complet | 8 272 / 405 | 8 / 7 | 4 979 | 0 |
| flow | on | 2 | partiel | 8 525 / 132 | 8 / 8 | 4 619 | 0 |

Total off : 37 709 tokens d'entrée, 1 684 de sortie, 47 appels modèle, 46 appels outils et 29 765 ms cumulées. Total on : 43 411 tokens d'entrée, 1 258 de sortie, 42 appels modèle, 39 appels outils et 25 666 ms cumulées. Ces totaux additionnent des tâches différentes et incluent les échecs ; ils décrivent cette série seulement. La mémoire n'ayant pas été réutilisée, les écarts ne peuvent pas lui être attribués.

## Revue des réponses

La validation automatique vérifie l'existence des lignes citées, mais pas le sens. La revue des quatre résultats complets donne :

- `function`, off demande 2 et on demandes 1 et 2 : les trois citent `src/math.js` lignes 1 à 3, où le calcul est `price * quantity`. Ils citent aussi du contexte supplémentaire ; les relations rapportées correspondent aux appels visibles. L'attendu principal est présent.
- `flow`, on demande 1 : les trois zones attendues sont citées (`api.js`, `order.js`, `math.js`) et les deux relations déclarées correspondent aux appels `postOrder → createOrder → totalPrice`.
- Les huit autres demandes ne produisent aucune preuve finale : les attendus sont donc manquants pour l'évaluation, même si certains fichiers ont pu être consultés avant l'interruption. Les deux demandes `class` de chaque variante sont dans ce cas.

Les résultats complets contiennent des références plus larges que strictement nécessaire. Cette revue vérifie les éléments demandés et les relations explicites, pas une exhaustivité générale sur un vrai dépôt. Aucun résultat final de cette série ne contient de relation identifiée comme fausse lors de cette revue.

## Essai préalable et limites

Un essai préalable de quatre demandes sur `totalPrice`, avant le changement d'instruction, a donné quatre résultats complets et zéro réutilisation. Tokens d'entrée : off 5 592 et 3 422 ; on 4 732 et 4 732. Tokens de sortie : off 781 et 275 ; on 275 et 298. Une réponse off formulait une relation insuffisamment étayée. Les résultats sont conservés séparément ; les objectifs diffèrent légèrement de ceux de la série principale et les deux séries ne constituent pas un protocole homogène.

Les essais ne couvrent ni la persistance après de nombreuses demandes, ni une invalidation après changement de code en conditions réelles Mistral : aucun script n'a été appris à invalider. Les tests automatisés du prototype couvrent séparément l'enregistrement, la réexécution sur contenu modifié et les purges, avec un faux modèle ; ils ne démontrent pas que Mistral choisira ces outils. Les limites d'isolation de la sandbox figurent dans son README. Aucun prix ni coût par réponse correcte ne peut être déduit de ces résultats.

Prochaine expérience utile : obtenir d'abord, avec une consigne ou une tâche adaptée, un script réellement enregistré puis réutilisé ; comparer ensuite plusieurs séquences appariées, y compris le coût de création, et vérifier les preuves après modification du code. Ne pas interpréter cette série comme une validation du gain de la mémoire.

## Données et vérifications

- [Résultats bruts de la série principale](results-mistral-memory-2026-11-14.json), y compris les appels d'outils et les résultats structurés ; [résultats du smoke test](results-mistral-smoke-2026-11-14.json).
- [Scénario reproductible](experiment-memory.mjs), [tâches](tasks.json), [attendus](expected.json) et [description générale du benchmark](README.md).
- Après le changement : 14 tests du prototype, 7 tests de la sandbox et 2 tests des runners réussis. Ces tests ne remplacent pas les mesures Mistral.

## Diagnostic complémentaire de la non-réutilisation

Un essai dirigé supplémentaire a demandé explicitement au modèle de créer un script paramétré avec `remember=true`, puis une seconde exploration lui a demandé de réutiliser le script. La limite a été portée à 12 appels modèle pour cet essai ; ce n'est donc pas un run comparable à la série principale. Le premier a appelé `memory_list`, `code`, puis `read`, et a produit une réponse complète. La bibliothèque était pourtant vide ; le second a consulté cette bibliothèque vide et utilisé `search` et `read`.

Le script effectivement généré était `search("totalPrice")`, avec `params: {"query":"totalPrice"}`. Il s'exécute et retrouve les occurrences, mais **ignore son paramètre** : le relancer avec une autre valeur chercherait encore `totalPrice`. Il ne regroupe pas non plus la recherche et la lecture du corps : un appel `read` supplémentaire a été nécessaire. Sa qualité comme script réutilisable est donc faible. Un seul script dirigé ne permet pas de généraliser à tous les scripts que le modèle peut produire. Dans la série principale, l'unique appel `code` était en mode mémoire off ; le runner n'a conservé que son nom, pas son contenu, qui ne peut donc pas être évalué rétrospectivement.

La trace révèle un deuxième obstacle distinct : la recherche retourne notamment `src/math.js` ligne 1, tandis que la preuve finale cite les lignes 1 à 3 après lecture. Le critère de conservation exige que la preuve finale soit entièrement incluse dans une plage retournée par le script ; la ligne 1 seule ne contient pas les lignes 1 à 3. Le candidat n'a donc pas été conservé. Ce critère prouve une correspondance stricte de plage, pas l'utilité d'une recherche suivie d'une lecture. L'échec constaté dépend ici du critère d'enregistrement, pas seulement du choix d'outil du modèle.

Les tâches simples et le prompt qui laisse les outils `search` et `read` disponibles sont des explications plausibles du choix de ces outils, mais la trace ne révèle pas le raisonnement interne du modèle. L'invocation de `memory_list` consomme aussi un appel sur le budget de huit ; les six runs avec mémoire ont ensuite eu au plus sept appels modèle disponibles, et trois ont été interrompus à cette limite. Cela n'établit pas que cet appel a causé à lui seul les interruptions.

La [trace complète du diagnostic dirigé](results-mistral-script-diagnostic-2026-11-14.json) et son [scénario reproductible](diagnostic-scripts.mjs) sont conservés. Toute nouvelle mesure devrait distinguer la génération d'un script réellement paramétré, son admission en mémoire, puis sa sélection et sa réexécution ; ces quatre étapes ne sont pas prouvées par une simple valeur de `memoryReuses`.
