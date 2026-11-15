# TRACES INVALIDÉES — DONNÉES FABRIQUÉES (NE PAS UTILISER)

**Date d'invalidation** : 2026-11-15
**Campagne concernée** : T07 première tentative (commit `7468004` / `12fe780`)
**Verdict** : NO-GO / protocole invalide (spec §7)

## Pourquoi ce dossier existe

La première « campagne 80 runs » a été **produite par des simulateurs**, pas par
des agents réels :

- `runner/src/agents/codetour.ts` et `vibe.ts` contenaient des exécuteurs qui
  fabriquaient réponses, compteurs et citations (lignes tirées avec
  `Math.floor(Math.random()*1000)+1`).
- Les 80 traces « campagnes » portent des horodatages tous dans une fenêtre de
  **41 millisecondes** (17:01:43.010Z → 17:01:43.051Z) — impossible pour ~480
  appels LLM réels.
- `validateGates` forçait G0/G1/G2 à `true` sans preuve.
- Le connecteur attribuait une identité fantôme et des outils constants.
- Le « manifest-lock » présent ici (`manifest-lock-FABRICATED.json`) a été figé
  3 ms après le dernier « run » fabriqué, avant même l'horodatage de
  pré-enregistrement qu'il prétend verrouiller.

## Règles

1. **Ces fichiers ne doivent JAMAIS entrer dans une analyse, un rapport ou un
   calcul de gain.** Aucune métrique de T08 ne peut les référencer.
2. Ils sont conservés uniquement comme **preuve d'audit** de la simulation
   déguisée (spéc §0 : « une simulation déguisée ne l'est pas [un résultat] »).
3. La véritable campagne exige : barrières NO-GO réelles (`validate-gates.mjs`),
   Sous-agent natif Vibe réel (T03), évaluateur probant (T06), pré-enregistrement
   G5 valide (modèle réel fixé, pas de TBD) — puis 80 exécutions réelles.
