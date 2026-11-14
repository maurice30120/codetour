# Boîte à outils préremplie : essai exploratoire

Deux répétitions de trois questions sur le dépôt synthétique ont comparé trois variantes : sans mémoire, une fonction de recherche littérale, et une boîte de trois fonctions préchargées. Chaque exploration démarre avec une mémoire isolée. Modèle `mistral-small-latest`, température 0 ; budget identique de 8 appels modèle, 32 appels modèle/outils, 32 000 tokens et 60 secondes. L'ordre des variantes est inversé à la seconde répétition.

Les fonctions candidates sont : recherche littérale paramétrée ; recherche accompagnée de contexte autour des résultats ; recherche de plusieurs symboles. Elles ont été exécutées dans la sandbox avec des paramètres d'exemple et ont renvoyé des références de fichiers. Ce contrôle ne démontre pas leur utilité générale. Les données et codes exacts figurent dans les résultats bruts.

| Variante | Explorations | Complètes | Réutilisations mémoire | Tokens entrée | Tokens sortie |
|---|---:|---:|---:|---:|---:|
| Sans mémoire | 6 | 2 | 0 | 38 433 | 1 705 |
| Recherche seule | 6 | 2 | 0 | 54 084 | 1 624 |
| Trois fonctions | 6 | 2 | 0 | 65 575 | 1 740 |

Les six réponses complètes concernent `totalPrice` et citent la ligne du calcul ; toutes les réponses sur `Catalog` et `postOrder` sont partielles. Une réponse complète sans mémoire affirme une relation entre `Catalog.find` et `totalPrice` qui n'est pas étayée par la ligne citée. Une réponse complète ne garantit donc pas l'exactitude de toutes les relations.

Le modèle n'a exécuté aucune fonction préchargée : il a souvent généré un nouvel appel `code` de recherche malgré les consignes de réutilisation. Les différences de tokens sont descriptives : les prompts diffèrent selon la variante et l'échantillon est petit. Le coût facturé n'est pas disponible. Cette série ne permet pas de départager les formes de fonctions ni de démontrer un bénéfice de la boîte à outils ; elle montre un obstacle préalable de sélection. Les fonctions n'ont pas été évaluées sur PostgreSQL ici.

Prochaine expérience : rendre explicitement disponibles les fonctions comme outils sélectionnables, ou injecter un résultat pré-calculé, et comparer à budget et consignes contrôlés. Vérifier séparément les résultats, les relations et l'effet sur les grandes bases de code avant de généraliser.

Reproduction : `node poc/exploration-benchmark/toolbox-experiment.mjs NOUVEAU-FICHIER.json` ; `TOOLBOX_REPETITIONS` règle le nombre de répétitions. Le script utilise `MISTRAL_API_KEY` ou le trousseau et effectue des appels API potentiellement facturés. Les résultats sont écrits après chaque exploration.

[Résultats bruts](results-toolbox-2026-11-14.json) · [Script de l'expérience](toolbox-experiment.mjs)
