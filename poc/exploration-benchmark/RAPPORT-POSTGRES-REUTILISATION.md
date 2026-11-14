# Réutilisation sur PostgreSQL

## Protocole

Le dépôt étudié est le checkout `postgres/postgres` au commit `70c4a57b64d39c526eb4c44a925eb92a6e56f3c5`, propre au début des essais. Trois questions portent sur le parsing, l'analyse/réécriture et le flux des requêtes SQL simples jusqu'à la planification. Deux répétitions et deux variantes, ordre alterné, donnent 12 explorations. Chaque séquence dispose de sa propre mémoire temporaire préremplie uniquement avec `list()`, `search(params.query)` et `read(...)`. Les deux variantes proposent la recherche mémorisée comme outil nommé ; la seconde retire les outils `search` et `code` du modèle tout en gardant `list`, `read` et les outils mémoire. Elle ne permet donc pas la génération libre de nouvelles compositions pendant l'exploration. Les consignes diffèrent également. Le modèle est `mistral-small-latest`, température 0 ; chaque exploration dispose de 12 appels modèle, 40 appels modèle/outils, 48 000 tokens et 90 secondes. Les extraits consultés sont transmis à l'API Mistral.

Les appels modèle peuvent dépasser légèrement la limite de tokens car leur consommation réelle n'est connue qu'au retour. Le rappel final n'est envoyé qu'au dernier appel modèle : il n'intervient pas si le budget de tokens est atteint avant. Les bibliothèques temporaires sont supprimées après l'expérience ; aucune mémoire personnelle n'est effacée.

## Résultats

| Variante | Explorations complètes | Partielles | Erreurs | Réutilisations exécutées | Tokens d'entrée observés | Tokens de sortie observés |
|---|---:|---:|---:|---:|---:|---:|
| Outils habituels et mémoire nommée | 0/6 | 5 | 1 | 0 | au moins 286 458 | au moins 2 738 |
| Recherche mémorisée seule pour rechercher | 0/6 | 6 | 0 | 22 | 298 039 | 1 230 |

Les cinq explorations partielles de la première variante et les six de la seconde ont atteint la limite de tokens. L'erreur est une réponse structurée invalide ; une partie de l'usage de l'appel ayant échoué peut manquer. Les tokens comprennent la préparation de la mémoire telle que présentée dans le prompt, les échecs et les rappels lorsqu'ils sont utilisés. La sélection du script par sondes locales prend respectivement 915 et 997 ms cumulées et n'est pas comprise dans la durée de l'exploration. Aucun prix facturé n'est disponible.

La variante à outils restreints exécute réellement la recherche mémorisée, mais certains termes sont demandés plusieurs fois, notamment `exec_simple_query`, et plusieurs requêtes contiennent des espaces alors que la recherche est littérale. Les scripts réutilisés sont les primitives préchargées, pas des fonctions apprises depuis une mémoire vide. Aucune exploration n'a abouti à une réponse finale ; les résultats partiels ne permettent donc pas d'évaluer les relations et ancres proposées pour un Tour, ni de calculer un coût par Tour correct. Cette expérience démontre une réutilisation sous contrainte sur ce dépôt ; elle ne démontre pas un gain de coût ou la production de fonctions générées de qualité.

Prochaine piste : réduire les sorties répétées et réserver de la place pour une conclusion avant la limite de tokens, en vérifiant si la couverture et la justesse des preuves sur PostgreSQL se maintiennent. Puis évaluer la réutilisation de fonctions réellement générées et validées, à partir de mémoires isolées, sur des questions distinctes.

[Résultats bruts](results-postgres-reuse.json) · [questions](postgres-tour-tasks.json) · [runner](tour-memory-experiment.mjs)

## Référence classique et budget élargi

À la demande de l'utilisateur, une référence utilise un agent classique avec `list`, `search` et `read`, sans Code Mode ni mémoire, sur les mêmes trois questions PostgreSQL, deux répétitions. Avec un plafond de 160 000 tokens, 20 appels modèle, 60 appels modèle/outils et 180 secondes, les six explorations atteignent la limite de tokens : les consommations observées vont de 160 981 à 172 070 tokens d'entrée. Le dépassement vient du fait que l'usage d'un appel n'est connu qu'après sa réponse. Aucun coût par réponse correcte ne peut être estimé dans cette série. [Données](results-postgres-classic-baseline.json).

Une seconde comparaison applique aux deux variantes le même plafond élargi et une demande de conclusion quand l'usage connu atteint 60 % du plafond, ou au dernier appel modèle. Elle ne force pas le modèle à cesser ses outils et ne garantit pas une réponse correcte. La variante mémoire utilise l'outil de recherche mémorisé sous la contrainte décrite plus haut ; elle renvoie au maximum huit résultats de recherche, signale que la recherche est bornée et si la sortie est tronquée, raccourcit les lignes de résultat et remplace une sortie identique répétée par une référence au résultat antérieur. Chaque appel est toutefois réexécuté pour éviter de masquer un changement du dépôt. `list` et `read` restent disponibles. Les instructions et outils diffèrent entre variantes : ce n'est pas une mesure isolée de l'effet d'une seule fonction.

| Variante | Réponses structurées | Erreurs | Réutilisations exécutées sur réponses structurées | Tokens d'entrée observés | Tokens de sortie observés | Réponses citant toutes les lignes minimales |
|---|---:|---:|---:|---:|---:|---:|
| Classique | 4/6 | 2 | 0 | au moins 670 403 | au moins 7 023 | 1/6 |
| Mémoire et sortie compacte | 4/6 | 2 | 20 | au moins 678 797 | au moins 6 451 | 0/6 |

Les totaux incluent l'usage observé avant les erreurs ; des tokens peuvent manquer lorsqu'une réponse ne peut pas être analysée. Deux sorties répétées ont été remplacées dans les explorations structurées de la variante mémoire. Les sondes de sélection coûtent aussi du temps local hors durée d'exploration. L'unique réponse classique couvrant les citations minimales concerne le parsing et utilise 112 998 tokens d'entrée et 1 027 de sortie ; elle cite l'appel de `raw_parser` ligne 626 et celui de `pg_parse_query` ligne 1083. Une seule observation ne donne ni distribution fiable, ni budget général. La variante mémoire ne fait pas mieux dans cet essai : notamment, une réponse de parsing inverse la direction de la relation et n'étaye pas l'appel de la ligne 1083.

Le [filtre de citations PostgreSQL](screen-postgres.mjs) vérifie seulement la présence de lignes attendues dans les preuves structurées, pas le sens d'une relation ni l'absence d'erreurs ailleurs. Il ne mesure donc pas des Tours valides et ne remplace pas la revue des réponses. La restriction à huit résultats peut cacher une preuve et appelle une stratégie de recherche plus ciblée ; ce n'est pas une optimisation validée. [Données de comparaison](results-postgres-baseline-compact.json).

## Autosélection légère en conditions réelles (génération de Tour)

Nouveau checkout sparse (`src/backend`, `src/include`) du commit `70c4a57b`, mêmes trois tâches de préparation de Project Tour (`pg-parse`, `pg-analyze`, `pg-flow`), plafond 160 000 tokens / 20 itérations / 60 appels / 180 s, conclusion demandée à 60 % du plafond, deux répétitions, ordre alterné, `mistral-small-latest` température 0. Deux variantes appariées : le témoin `primitives_scoped_named_exclusive_contract_final` et la variante légèrement optimisée `primitives_scoped_named_exclusive_autoselect_contract_final`, où le harnais recommande dès le premier message un terme concret issu de l'objectif, choisi localement par comptage d'identifiants entiers (`autoselect.mjs`) : symboles de code d'abord (underscore, camelCase, acronyme), puis les mots capitalisés, puis la prose ; à égalité, le terme le moins fréquent est le plus ciblé. Termes retenus : `query_string` pour `pg-parse`, `exec_simple_query` pour `pg-analyze` et `pg-flow`.

| Variante | Réponses complètes | Réutilisations | Tokens entrée | Appels outils | Citations présentes (filtre) |
|---|---:|---:|---:|---:|---:|
| Témoin scoped exclusif | 5/6 | 32 | 550 201 | 81 | 1/6 |
| Scoped exclusif + autosélection | 6/6 | 21 | 500 389 | 78 | 5/6 |

Par tâche (tokens d'entrée) : `pg-parse` 235 002 → 61 584 (−74 %), `pg-analyze` 208 824 → 218 740 (équivalent), `pg-flow` 106 375 → 220 065 (dégradé sur cette série, contradictoire avec la série partielle v3 où les deux variantes étaient à ~110 000). La revue manuelle d'une réponse `pg-parse` autosélectionnée montre la relation attendue `query_string -> raw_parser` ancrée à `src/backend/tcop/postgres.c:626` pour 30 792 tokens d'entrée. Une première version du classement (occurrences de sous-chaînes) recommandait des mots de prose (`code`, `parsing`) : 132 000 tokens sur les trois tâches avec 3 erreurs de schéma, ce qui a motivé le comptage par identifiants entiers et le score symbole/prose.

Conclusion : en conditions réelles, la variante lightly optimisée (recherche nommée exclusive à portée `pathPrefix` + recommandation d'un seul terme ciblé) est compétitive sur le budget global (−9 % de tokens d'entrée) et nettement meilleure sur la couverture de citations (5/6 contre 1/6), avec moins d'erreurs ; le gain vient surtout de la convergence rapide sur `pg-parse`, pas d'un plus grand nombre de réutilisations (21 contre 32, la recommandation réduit le nombre d'appels donc d'occasions de réutiliser). Échantillon de deux répétitions : la dispersion sur `pg-flow` interdit une conclusion ferme sur le gain de tokens ; la qualité des ancres reste à revue manuelle complète. [Données v4](results-postgres-autoselect-v4.json) · [série v1, classement par sous-chaînes](results-postgres-autoselect.json) · [série v3 partielle](results-postgres-autoselect-v3.json) · [sélecteur](autoselect.mjs).

## Recherche uniquement mémoire (`memory_run` + catalogue) et préfixe recommandé

Deux optimisations simples ajoutées : l'autosélection recommande aussi un `pathPrefix` (répertoire dominant du terme au comptage local, retenu s'il couvre au moins la moitié des occurrences et au moins 3 d'entre elles — `src/backend/tcop/` retenu ici), et un nouveau mode `primitives_scoped_memoryonly_autoselect_contract_final` retire carrément les outils `search` et `code` : la recherche n'existe plus que via `memory_run` avec le catalogue affiché dans le prompt, et la recommandation donne l'identifiant et les paramètres concrets (`memory_run` avec `{"query":"exec_simple_query","pathPrefix":"src/backend/tcop/"}`). Trois variantes appariées sur le même checkout (18 explorations, deux répétitions) :

| Variante | Réponses complètes | Réutilisations | Tokens entrée | Appels outils | Citations présentes |
|---|---:|---:|---:|---:|---:|
| Témoin scoped nommé exclusif | 4/6 | 29 | 443 853 | 67 | 0/6 |
| Nommé exclusif + autosélection (avec préfixe) | 6/6 | 13 | 355 139 | 87 | 1/6 |
| **Mémoire seule + autosélection (avec préfixe)** | 4/6* | 10 | 232 020 | 40 | 2/6 |

\* deux erreurs de la première série mémoire seule venaient d'une garde du harnais qui annulait l'exploration quand le modèle émettait malgré tout un appel `search` ; assouplie (l'appel dégrade en erreur outil et le modèle corrige). Relancée seule, la variante mémoire seule produit 6/6 réponses complètes, 0 erreur, 15 réutilisations, 472 224 tokens d'entrée (moyenne 78 704, `pg-parse` à 28 625) et 4/6 citations présentes (`pg-analyze` et `pg-flow` couvertes dans les deux répétitions). La dispersion entre séries (232k puis 472k) reflète la variance du modèle à deux répétitions, pas un effet du mode.

La recherche 100 % mémoire est donc la configuration la plus simple qui fonctionne : pas d'outil nommé nécessaire, le catalogue + une recommandation `id`/`params` concrète suffisent, le modèle réutilise `memory_run` spontanément, et le retrait de `search`/`code` évite les réécritures libres qui coûtaient le plus cher. [Données 3 variantes](results-postgres-memoryonly.json) · [mémoire seule relancée](results-postgres-memoryonly-v2.json).
