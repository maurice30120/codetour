# Rétro du run « recherche uniquement mémoire » (PostgreSQL, 2026-11-14)

## Contexte du run

Dernière manche de l'exploration code mode + mémoire : trois variantes appariées sur le checkout PostgreSQL réel (`70c4a57b`, sparse `src/backend` + `src/include`, 2204 fichiers), tâches de préparation de Project Tour (`pg-parse`, `pg-analyze`, `pg-flow`), plafond 160 000 tokens / 20 itérations / 60 appels / 180 s, conclusion demandée à 60 % du plafond, `mistral-small-latest` température 0, 2 répétitions, ordre alterné. 18 explorations (`results-postgres-memoryonly.json`) puis une relance mémoire seule de 6 explorations (`results-postgres-memoryonly-v2.json`).

Variantes :

1. `primitives_scoped_named_exclusive_contract_final` — témoin, outil nommé `memory_search`, `search`/`code` retirés.
2. `primitives_scoped_named_exclusive_autoselect_contract_final` — + autosélection (terme symbole + `pathPrefix` dominant recommandés localement).
3. `primitives_scoped_memoryonly_autoselect_contract_final` — **recherche 100 % mémoire** : `search` et `code` supprimés de l'API, catalogue dans le prompt, recommandation concrète `memory_run(id, {query, pathPrefix})`.

## Résultats

| Variante | Complètes | Réutilisations | Tokens entrée | Appels outils | Citations présentes (filtre) |
|---|---:|---:|---:|---:|---:|
| Témoin nommé exclusif | 4/6 | 29 | 443 853 | 67 | 0/6 |
| Nommé exclusif + autosélection | 6/6 | 13 | 355 139 | 87 | 1/6 |
| Mémoire seule + autosélection (série 1) | 4/6 | 10 | 232 020 | 40 | 2/6 |
| Mémoire seule + autosélection (relance, garde assouplie) | **6/6** | 15 | 472 224 (moy. 78 704) | 67 | **4/6** |

Par tâche (relance) : `pg-parse` 28 625 tokens moyens, `pg-flow` 80 505, `pg-analyze` 126 983. Préfixe recommandé et utilisé : `src/backend/tcop/`.

## Ce qui a marché

- **Mémoire seule = config la plus simple et la plus sobre** : pas d'outil nommé nécessaire, le catalogue + une recommandation `id`/`params` concrète suffisent ; le modèle réutilise `memory_run` spontanément (10–15 réutilisations / 6 runs).
- **Autosélection locale (zéro token modèle)** : extraction des identifiants de l'objectif, comptage d'identifiants entiers, score symbole > mot capitalisé > prose, terme le moins fréquent = le plus ciblé ; `pathPrefix` = répertoire dominant (≥ 50 % des occurrences, ≥ 3). Termes retenus : `query_string`, `exec_simple_query`.
- La relance avec garde assouplie a produit 6/6 sans erreur et la meilleure couverture de citations (4/6).

## Incidents et ratés du run

- **Classement v1 par sous-chaînes** : recommandait des mots de prose (`code`, `parsing`) à cause des super-identifiants (`debug_query_string`, `PostgreSQL`) dans la première page de résultats → corrigé par comptage d'identifiants entiers + score symbole (couvert par tests).
- **Garde trop stricte** : un appel `search` halluciné en mode mémoire seule annulait toute l'exploration (`Model called a tool unavailable`) → assoupli pour `memoryonly` (l'appel dégrade en erreur outil, le modèle corrige).
- **Variance forte entre séries** (232k vs 472k tokens pour la même variante) : n=2 répétitions, conclusion à 60 % du plafond — les totaux de tokens sont à prendre comme des ordres de grandeur.
- **Processus orpheliné** une fois (run v3 interrompue à 7/12 lignes) → relancée en v4 ; la perte est documentée, pas cachée.
- `pg-parse` manque la ligne 1083 dans toutes les variantes (le modèle cite 626 `raw_parser`, qui est la bonne réponse à la question posée) — le filtre de citations exige les deux.
- Côté outillage : un `sleep 90` dans un appel bash dépassait le timeout de 30 s et a tué la commande ; le run long doit passer par `tools.process.start` + polling.

## Leçons

1. Pour optimiser la réutilisation/budget : **retirer la voie libre** (`search`/`code`) plutôt qu'ajouter des outils nommés — avec `code` disponible, les outils nommés sont ignorés et les tokens triplent.
2. Une recommandation concrète (script + terme + préfixe), calculée localement, bat une consigne générique : moins d'appels exploratoires, donc moins de tokens d'entrée (chaque sortie d'outil est renvoyée à chaque appel modèle).
3. Le catalogue seul dans le prompt suffit ; l'outil nommé `memory_search` n'apporte rien de plus en mémoire seule.
4. Toujours garder les résultats bruts + les séries partielles ; la variance impose de ne conclure que sur les tendances robustes (complétude, citations, appels), pas sur un total de tokens isolé.

## Prochaines étapes

- Séquence longue (`run-memory.mjs`, 17 demandes, retour du sujet après 14) avec la variante mémoire seule.
- 3+ répétitions pour réduire la variance ; revue manuelle des relations (le filtre ne teste que la présence de lignes).
- Câblage éventuel dans le générateur de Tour (ADR à rédiger avant toute intégration).

Données : [results-postgres-memoryonly.json](results-postgres-memoryonly.json) · [results-postgres-memoryonly-v2.json](results-postgres-memoryonly-v2.json) · bilan détaillé dans [RAPPORT-POSTGRES-REUTILISATION.md](RAPPORT-POSTGRES-REUTILISATION.md).
