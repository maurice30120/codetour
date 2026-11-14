# Évaluation du micro-harnais

Ce jeu de données ne constitue pas une mesure du modèle. `workspace/` est le seul répertoire à donner à l'explorateur ; `expected.json` reste hors de ce répertoire et n'est jamais transmis au modèle. Les trois questions publiques figurent dans `tasks.json`. Les attendus désignent des zones utiles, pas une réponse exhaustive : examiner aussi manuellement la pertinence et les relations affirmées.

## Comparaison Code Mode

Pour chaque question, exécuter séparément sans puis avec Code Mode, sur la même copie du workspace, avec les mêmes modèle, version, objectif et budgets. Répéter au moins trois fois et alterner l'ordre des variantes. Conserver le JSON brut, les paramètres et les erreurs de chaque run. Mesurer tokens d'entrée et de sortie, appels, durée, volume renvoyé et coût total ; noter « indisponible » pour toute donnée absente. Ne pas déduire le coût facturé à partir du nombre d'appels.

Avec Node 24 et les dépendances de `packages/exploration-poc` installées, définir `MISTRAL_API_KEY` et éventuellement `MISTRAL_MODEL`, puis lancer :

```sh
node poc/exploration-benchmark/run.mjs --adapter "$(command -v node)" --arg poc/exploration-benchmark/mistral-adapter.mjs --output /tmp/comparaison-codetour --repetitions 3
```

Le dossier de sortie ne doit pas déjà exister. Ajouter `--budget budget.json` pour appliquer le même objet de budget aux variantes, ou `--timeout-ms 120000` pour changer la limite externe. Les valeurs par défaut explicites sont 8 itérations, 32 appels, 32 000 tokens et 60 secondes. Les coûts d'API sont à la charge de l'utilisateur. Chaque run reçoit une copie fraîche du workspace ; le fichier d'attendus n'y est pas inclus. Les JSON bruts et métadonnées sont conservés par run ; `summary.json` donne par tâche et globalement médiane, minimum, maximum, nombre de mesures absentes et empreintes SHA-256 des fixtures. Les totaux de tokens incomplets sont marqués indisponibles. Les zones indiquées « covered » ont simplement une intersection avec une référence : cela ne prouve ni leur couverture complète ni la justesse ou pertinence de l'affirmation. Les relations et la pertinence exigent une revue manuelle avant toute conclusion. Les métriques groupées entre tâches différentes sont descriptives seulement ; privilégier les comparaisons par tâche. Le stderr des processus n'est pas conservé pour éviter la divulgation de secrets ; le statut, le code de sortie et le signal sont conservés. Une sortie partielle est identifiable dans les métadonnées.

Le runner accepte aussi un adaptateur externe : il reçoit le mode (`baseline` ou `code-mode`) en dernier argument et dans `EXPLORATION_MODE`, un JSON `{root, objective, mode, budget}` sur stdin et doit écrire un seul JSON résultat sur stdout. Le résultat peut exposer `evidence` directement ou les tableaux `entryPoints`, `components`, `relations` du harnais. Les valeurs de métriques absentes restent `null`. Test du protocole avec un faux adaptateur sans appel réseau : `node --test poc/exploration-benchmark/test/run.test.mjs`.

## Comparaison de la mémoire

Après le bilan Code Mode, comparer sans mémoire et avec mémoire avec des séquences identiques. Pour chaque répétition et chaque variante, partir d'une bibliothèque vide dans un répertoire temporaire distinct ; le coût de constitution et de consultation du catalogue fait partie du coût total. Essayer au moins ces deux ordres :

- `function, class, flow`, puis répéter `class, flow` six fois et finir par `function` : le sujet revient après douze autres runs.
- `flow, class, function`, puis répéter `flow, class` six fois et finir par `function`.

Relever réutilisations, tentatives, purges et interruptions. Tester séparément une modification de `workspace/src/math.js` dans une copie temporaire qui invalide une hypothèse du script mémorisé ; vérifier que le script est réexécuté, que les anciennes preuves ne sont pas recyclées et que l'exploration peut continuer. Ne pas conserver de copie des scripts purgés.

Le protocole automatisé on/off s'exécute avec la même clé et le même adaptateur :

```sh
node poc/exploration-benchmark/run-memory.mjs --adapter "$(command -v node)" --arg poc/exploration-benchmark/mistral-adapter.mjs --output /tmp/comparaison-memoire --repetitions 2
```

Attention : cette commande effectue **136 explorations** par défaut (deux répétitions, deux ordres, deux variantes, 17 demandes), potentiellement facturées. Chaque séquence démarre avec un dossier de mémoire vide et conserve le même chemin de workspace pendant ses demandes ; les variantes et séquences sont isolées. Les deux variantes suivent un ordre identique, et la fonction revient après 14 autres demandes. Les échecs et résultats partiels sont conservés. Une dernière demande distincte suit une modification de la ligne de calcul : elle permet de vérifier les preuves recalculées mais ne garantit pas qu'un script appris casse ; inspecter le script effectivement appris et construire si nécessaire une modification qui l'invalide. Cette demande modifiée est exclue de la synthèse principale et conservée dans les résultats bruts. Les bibliothèques temporaires sont supprimées après le benchmark ; aucun script purgé n'est archivé.

La synthèse indique les appels, tokens, durée, coût, volume, réutilisations et purges lorsqu'ils sont disponibles ; les totaux sont `null` si une mesure manque. Les coûts de constitution et de consultation sont inclus dans les métriques du harnais. Les zones simplement intersectées ne sont pas des preuves de pertinence : revoir les références et relations, compter les preuves correctes et pertinentes, incorrectes et attendus manquants, puis calculer le coût total de chaque séquence divisé par son nombre de demandes correctes si les coûts sont disponibles. La conclusion reste non concluante avant cette revue. Pour tester le runner sans réseau : `node --test poc/exploration-benchmark/test/run-memory.test.mjs`.

## Évaluation

Adapter chaque résultat au format suivant et l'enregistrer à l'extérieur du workspace :

```json
{"taskId":"function","evidence":[{"file":"src/math.js","startLine":1,"endLine":2}]}
```

Exécuter `node poc/exploration-benchmark/evaluate.mjs chemin/vers/resultat.json`. L'évaluateur vérifie que les références restent dans le workspace, pointent vers un fichier régulier et des lignes existantes, et calcule les zones attendues couvertes. Une référence valide n'est pas nécessairement pertinente ; une relation correcte n'est pas prouvée automatiquement. Évaluer manuellement la pertinence, les affirmations et les relations, ainsi que les éléments manquants. Pour le test après modification, utiliser `--workspace chemin/vers/copie` et adapter les attendus à la modification avant l'évaluation.

Pour chaque variante, rapporter par tâche et répétition les preuves pertinentes correctes, incorrectes et attendus manquants ; ajouter les médianes et la dispersion des métriques. Calculer le coût total de tous les runs divisé par le nombre d'explorations jugées correctes, sans masquer les échecs. Conclure favorable uniquement si la mémoire réduit ce coût sans dégrader la qualité ; sinon défavorable ou non concluant selon les données. Une absence de clé API ou de métrique donne un résultat non mesuré, jamais un gain supposé.
