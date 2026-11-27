# Benchmark injection knowledge — 2026-11-27 — Résultats finaux

Même protocole que `.benchmark-20261127/` (3 cycles, évaluation à l'aveugle, seed `20261127`),
sur les 3 sous-variantes du groupe C (knowledge `on`, microskills `off`) : seul
`knowledge_injection` change. Modèle : `mistral/deepseek-v4-1-flash-1017:high`.

## Verdict

**`knowledge_injection=tools` est le meilleur point d'injection** : meilleure qualité
(8,47), meilleure exactitude (9,0), meilleure absence d'erreurs (8,67), **et** le moins
cher (0,039 $/run, 807 k tokens). `both` coûte plus (0,050 $, 1 081 k tokens, +22 s) sans
aucun gain de qualité. `startup` est à qualité égale de `both` mais moins cher.

## Moyennes par variante (3 cycles)

| Variante | Note globale | Exactitude | Exhaustivité | Abs. erreurs | Durée moy. | Coût moy. | Étapes | Tokens |
|---|---|---|---|---|---|---|---|---|
| **tools** | **8,47** | **9,00** | 7,67 | **8,67** | 110 s | **0,0388 $** | 11,7 | **806 977** |
| startup | 7,67 | 8,33 | 7,00 | 7,67 | 106 s | 0,0418 $ | 13,0 | 876 043 |
| both | 7,67 | 8,00 | 7,67 | 7,33 | 128 s | 0,0495 $ | 12,0 | 1 081 266 |

## Détail par run (9/9 succès, 0 avertissement CLI)

| Run | Note | Exact. | Exhaust. | Abs. err. | Durée | Coût | Étapes |
|---|---|---|---|---|---|---|---|
| C-tools-01 | 8,7 | 9 | 8 | 9 | 94 s | 0,035 $ | 12 |
| C-tools-02 | 8,7 | 9 | 8 | 9 | 133 s | 0,042 $ | 10 |
| C-tools-03 | 8,0 | 9 | 7 | 8 | 103 s | 0,039 $ | 13 |
| C-startup-01 | 8,0 | 8 | 8 | 8 | 126 s | 0,045 $ | 13 |
| C-startup-02 | 7,7 | 8 | 7 | 8 | 108 s | 0,047 $ | 12 |
| C-startup-03 | 7,3 | 9 | 6 | 7 | 84 s | 0,034 $ | 14 |
| C-both-01 | 7,7 | 8 | 7 | 8 | 117 s | 0,048 $ | 11 |
| C-both-02 | 7,3 | 8 | 8 | 6 | 149 s | 0,052 $ | 13 |
| C-both-03 | 8,0 | 8 | 8 | 8 | 119 s | 0,048 $ | 13 |

## Vérification de l'injection (transcripts des sessions Pi)

La métrique `injection_probe` est inutilisable sur ce run (voir Incidents) ; la livraison
réelle a été vérifiée dans les sessions (`~/.pi/agent/sessions/…`) :

| Variante | Livraison observée |
|---|---|
| startup | 1 bloc knowledge livré au démarrage (~+2 s, avant tout appel d'outil) — 3/3 |
| tools | 2 blocs livrés après des appels d'outils nommant un fichier couvert — 3/3 |
| both | 1-2 blocs (startup + outils) — 3/3 après re-run du run contaminé |

## Incidents corrigés

1. **C-both-01 (run-01) contaminé** : un fold résiduel du benchmark principal tenait le
   verrou d'état TE pendant toute sa session → 0 knowledge livré. **Re-créé et re-évalué**
   (le tour re-créé a bien reçu 2 blocs knowledge).
2. **3 évals sans score** (slot-04, slot-08, slot-09 : l'évaluateur n'a pas renvoyé de JSON
   exploitable). **Re-joués** — tous scorés.
3. **`injection_probe` à 0 byte sur les 9 runs** : au 1er probe, verrou fold résiduel
   (`fold.Busy`) ; ensuite, les worktrees du benchmark principal supprimés → résolution du
   repo vers des chemins morts (`FileNotFoundError` dans `~/.tokeneconomizer/errors.log`)
   → sortie du hook SessionStart jetée. N'affecte que la mesure synthétique du probe, pas
   la livraison réelle en session (vérifiée ci-dessus).

## Comparaison avec le benchmark principal

Le groupe C du benchmark principal (injection `both`) : 7,90 — cohérent avec le 7,67 de
C-both ici (mêmes conditions, à la variabilité de session près). L'écart tools (+0,8 point
sur la note globale, +0,7 sur l'exactitude et l'absence d'erreurs) est au-dessus de la
dispersion intra-variante (~±0,5), donc significatif en première lecture : injecter le
knowledge **au moment où l'agent touche le fichier concerné** est plus efficace que de
l'injecter en bloc au démarrage, et moins coûteux que de faire les deux.

Coût total du benchmark : ~0,45 $ (création) + ~0,40 $ (évaluation), re-runs compris.
