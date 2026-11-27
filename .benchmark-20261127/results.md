# Benchmark CodeTour × TokenEconomizer — 2026-11-27 — Résultats finaux

Protocole : 4 groupes (knowledge × microskills), 3 cycles, 12 runs de création + 12 évaluations à l'aveugle.
Modèle : `mistral/deepseek-v4-1-flash-1017:high`. Code : commit `c248a4ab`. Seed : `20261127`.

## Groupes

| Groupe | Knowledge | Microskills |
|---|---|---|
| A | off | off |
| B | off | on |
| C | on (injection `both`) | off |
| D | on (injection `both`) | on |

## Runs de création — 12/12 succès, 0 avertissement

| Run | Groupe | Cycle | Durée | Étapes | Coût |
|---|---|---|---|---|---|
| D-01 | D | 1 | 65 s | 11 | 0,029 $ |
| B-01 | B | 1 | 162 s | 13 | 0,056 $ |
| C-01 | C | 1 | 104 s | 10 | 0,043 $ |
| A-01 | A | 1 | 152 s | 14 | 0,060 $ |
| B-02 | B | 2 | 85 s | 13 | 0,031 $ |
| A-02 | A | 2 | 206 s | 12 | 0,046 $ |
| D-02 | D | 2 | 171 s | 12 | 0,036 $ |
| C-02 | C | 2 | 368 s | 13 | 0,035 $ |
| A-03 | A | 3 | 259 s | 15 | 0,058 $ |
| C-03 | C | 3 | 163 s | 11 | 0,027 $ |
| D-03 | D | 3 | 212 s | 14 | 0,033 $ |
| B-03 | B | 3 | 90 s | 13 | 0,041 $ |

## Évaluation à l'aveugle (3 critères /10, note globale = moyenne)

| Run | Groupe | Exactitude | Exhaustivité | Abs. erreurs | Globale |
|---|---|---|---|---|---|
| D-01 | D | 9 | 7 | 9 | **8,3** |
| B-01 | B | 8 | 8 | 8 | 8,0 |
| C-01 | C | 8 | 7 | 8 | 7,7 |
| A-01 | A | 9 | 7 | 7 | 7,7 |
| B-02 | B | 7 | 7 | 7 | 7,0 |
| A-02 | A | 8 | 7 | 7 | 7,3 |
| D-02 | D | 9 | 8 | 9 | **8,7** |
| C-02 | C | 8 | 7 | 8 | 7,7 |
| A-03 | A | 7 | 7 | 6 | 6,7 |
| C-03 | C | 9 | 7 | 9 | **8,3** |
| D-03 | D | 8 | 9 | 8 | **8,3** |
| B-03 | B | 8 | 7 | 7 | 7,3 |

## Moyennes par groupe

| Groupe | Note globale | Exactitude | Exhaustivité | Abs. erreurs | Durée moy. | Coût moy. |
|---|---|---|---|---|---|---|
| D (on/on) | **8,43** | 8,67 | 8,00 | 8,67 | 150 s | **0,033 $** |
| C (on/off) | 7,90 | 8,33 | 7,00 | 8,33 | 212 s | 0,035 $ |
| B (off/on) | 7,43 | 7,67 | 7,33 | 7,33 | 112 s | 0,043 $ |
| A (off/off) | 7,23 | 8,00 | 7,00 | 6,67 | 206 s | 0,055 $ |

## Observations

- **D (knowledge + microskills) domine** : meilleure qualité (8,43) **et** le coût le plus bas (0,033 $). Les deux mécanismes se renforcent sans se gêner.
- **A (tout off)** est à la fois le plus cher (0,055 $) et le moins bien noté (7,23) : sans guidage, l'agent tourne plus longtemps pour un résultat moins bon.
- **Knowledge seul (C)** améliore fortement l'absence d'erreurs (8,33 vs 6,67 pour A) — cohérent avec l'injection de faits vérifiés.
- **Microskills seuls (B)** : le moins cher des groupes sans knowledge (0,043 $), qualité intermédiaire (7,43).
- Aucun échec, aucun avertissement CLI sur les 12 tours créés.

Coût total : 0,50 $ (création) + 0,40 $ (évaluation) = 0,90 $.
Sous-variantes du point d'injection (startup / tools / both) : voir `.benchmark-20261127-injection/` (benchmark dédié, 9 runs + 9 évals).
