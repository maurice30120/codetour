# Campagne Knowledge pertinente — Pi, dépôt CodeTour

**Relevé du 24 novembre 2026.** Statut : historique et dépassé. Ce document décrit
TokenEconomizer dans l'état de la branche `knowledge-relevance-integration` à `42cebaa` ; la pointe
est depuis passée par `fe8041a`, `3c13f43` puis `82bc87e`, qui changent le budget du bloc injecté et
son crédit d'injection. Les chiffres ci-dessous ne décrivent donc pas le comportement actuel, et une
campagne distincte (25 novembre) reprend la mesure.

## Cadre

- Hôte : Pi seul (Claude Code et Copilot CLI non testés).
- Modèle : `mistral/deepseek-v4-1-flash-1017`.
- Environnement : venv local, important bien `TokenEconomizer/tokeneconomizer`.
- Protocole : questions en lecture seule, 4 tâches × (avec / sans Knowledge) × 2 répétitions,
  soit 16 sessions fraîches.
- Dépôt resté propre pendant la mesure (aucun fichier modifié). Le relevé d'origine mentionne
  « 12 anciens Tours archivés hors dépôt » ; ce point n'a pas été revérifié depuis.
- Données brutes : `~/.copilot/session-state/…/files/k2/` (hors Git).

## Mesures

Tokens effectifs, puis nombre d'appels d'outils. Le coût du proposeur est hors tokens effectifs.

| Tâche | Fichier couvert nommé ? | Avec Knowledge (r1 / r2) | Sans Knowledge (r1 / r2) | Injections |
| --- | --- | --- | --- | --- |
| T1 `tourSchema.ts` | oui | 11 977 / 4 684 ; 1 / 1 appel | 4 914 / 5 629 ; 1 / 2 appels | `ddf2d3`, `trigger=prompt`, r1 et r2 |
| T2 découverte `.tour` | non | 31 598 / 10 784 ; 13 / 5 appels | 16 632 / 16 387 ; 6 / 7 appels | r2 seulement : `56fe20`, `trigger=read`, `read_before=false` |
| T3 `cli.ts` (MCP) | oui | 13 655 / 21 033 ; 5 / 9 appels | 16 948 / 12 547 ; 7 / 3 appels | aucune |
| T4 stockage / format | non | 13 987 / 9 568 ; 6 / 4 appels | 11 230 / 18 285 ; 4 / 7 appels | aucune |
| **Total** | | **117 286** | **102 572** | |

Proposeur (modèle séparé) : 111 328 tokens après T1 r1, 78 011 après T4 r1, 73 252 après T3 r2,
soit **262 591 tokens**, pour **0 fait retenu**. Le coût d'injection n'est pas isolé (blocs courts,
≈ 150 tokens au plus par budget).

## Verdicts

- **(a) Arrivée — prouvée.** T1 r1 et r2 : événement `kind:"knowledge"` portant `ddf2d3`,
  `signal=codetour/src/store/tourSchema.ts`, `trigger=prompt`, `read_before=false` ; le bloc
  « Knowledge from earlier sessions » est présent dans la transcription avant le premier appel
  d'outil. T2 r2 : `56fe20`, `trigger=read`, après lecture de `tourDiscovery.ts`.
- **(b) Utilisation — non prouvée.** En T1, le modèle relit `tourSchema.ts` malgré l'injection (même
  lecture que sans Knowledge) ; en T2 r2, il relit `provider.ts` après injection. Aucune citation
  explicite de la Knowledge n'a été relevée, le raisonnement n'ayant pas été analysé
  systématiquement.
- **(c) Lecture ou tokens évités — non prouvé.** Aucune lecture du fichier couvert n'est évitée. Le
  total avec Knowledge (117 286) dépasse celui sans Knowledge (102 572), avant même les 262 591
  tokens de propositions. Les écarts par paire sont dominés par le bruit : T1 r1 à 11 977 contre
  4 684 en r2 pour la même configuration.

## Anomalies et points non vérifiés

- T3 nomme `cli.ts` sans injection : `cb62589a` n'a jamais atteint le seuil de tir (0/5 hérité de la
  campagne précédente) ; non vérifié ligne à ligne. T4 : la Knowledge de `schema.json` (`18de21`)
  n'a pas été déclenchée, ni le prompt ni la lecture ne la visant.
- T1 r1 : cache lu 6 912 contre 13 824 ailleurs. À la répétition r2, le cache est normal avec
  injection (13 824) : probablement un démarrage à froid, pas une rupture de cache. Non prouvé.
- Deux nouveaux faits MCP (`737fe0`, `adfc64`) sont apparus pendant la campagne : l'état de la
  Knowledge a donc changé entre les séries.
- Le champ `injection` du ledger reste vide ; la preuve vient des événements `knowledge` et de la
  transcription.
- `fold.log` n'a pas été analysé pour des erreurs Python 3.14 datées pendant la campagne.
- Calibration CodeTour évitée (prompts simples, sans `/codetour`).

## Pour trancher

Davantage de répétitions (≥ 5 par cellule), des tâches où le fichier couvert est à la fois nécessaire
et nommé, une mesure du préfixe de cache autour d'une injection, et un passage sur Copilot CLI et
Claude Code.
