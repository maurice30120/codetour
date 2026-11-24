# Reprise de la campagne Knowledge #313 — 24 novembre 2026

La campagne a été préparée à nouveau, mais aucun des douze Tours n'a été lancé : la porte de pré-vol impose un test de génération avec TokenEconomizer indisponible, et le nouveau test n'a pas abouti. Aucun résultat de cette préparation ne permet de conclure sur les économies de tokens de la version #314.

## Configuration et état initial

- CodeTour : branche `spec-314-integration`, HEAD `7070372877aefb44872616dd09a1651e867a4051`, avec les suppressions de neuf anciens Tours suivis et une correction locale du test de lecture. Ces modifications ne sont pas commitées ; le SHA ne décrit donc pas à lui seul l'arbre testé.
- TokenEconomizer : branche `spec-314-integration`, HEAD `f8cbb579cf2d8602cb69c0ad22880615804e2cba`, arbre propre au contrôle initial.
- Plugin local Pi réinstallé. Une entrée Pi périmée pointant vers le worktree inexistant `wt-314-te` a été retirée ; une seule entrée TokenEconomizer locale subsiste.
- `TE_KNOWLEDGE=on`, `TE_MICROSKILLS=off` vérifiés par `te config show`. La calibration Pi a répondu et affiché ses tokens ; le modèle utilisé était `mistral/deepseek-v4-1-flash-1017`, raisonnement `high`.
- Catalogue CodeTour conservé : au contrôle, 146 sessions repliées dans `te status`, aucune Knowledge dans `facts`. L'état Knowledge relevé après calibration contient `now=8`, `last_propose=8`, `opt_tokens=144364` ; ces compteurs comprennent des sessions antérieures et ne sont pas le coût de la nouvelle campagne. Le repli d'une ancienne session a modifié la cadence depuis le rapport précédent.
- Les anciens Tours de projet ont bien été supprimés. Les fichiers de test temporaires sous `.scratch` ne sont pas des Tours de projet.

## Pré-vol

- `npm run check:fast` : 58 tests réussis.
- Suite TokenEconomizer `tests experiments/tests` avec le venv : réussite, avec le substitut temporaire à `timeout` déjà utilisé sur macOS.
- `npm test` CodeTour : réussite après correction d'un test qui dépendait d'un ancien Tour supprimé. Le test utilise désormais un exemple intégré et continue de vérifier le rendu et les ancrages réels. La première relance de la correction a aussi révélé l'absence d'une légende Mermaid dans l'exemple ; elle a été ajoutée et le test ciblé, puis la suite complète, sont passés.
- Test TE en panne : non validé pour cette reprise. Deux essais dans `/private/tmp/te313-te-hs`, avec `TE_PYTHON=/bin/false`, ont utilisé les modèles disponibles `mistral/zai-glm-5-3` et `mistral/zai-glm-5-2`. Les appels MCP `create_project_tour` ont été refusés parce que `steps` et `dryRun` arrivaient avec des types incorrects. Les essais ont été interrompus sans nouvelle génération validée. Un test semblable avait réussi lors de la campagne précédente avec `mistral/deepseek-v4-1-flash-1017`, mais ce résultat antérieur ne remplace pas le nouveau pré-vol.
- Après la calibration, `pi --list-models deepseek-v4-1-flash`, y compris via le lanceur de campagne, n'a trouvé aucun modèle correspondant. La calibration montre que ce modèle était accessible au début de la préparation ; la raison de son indisponibilité ultérieure n'est pas établie.
- Un essai complémentaire avec `mistral/devstral-small-2507`, pourtant listé par Pi, a reçu de l'API Mistral une erreur 400 `invalid_model` ; aucune génération n'a commencé avec ce modèle.

## À reprendre

Rétablir un modèle Pi capable d'appeler correctement les outils MCP, rejouer le test de panne jusqu'à création effective d'un Tour temporaire, vérifier la disponibilité et fixer un modèle unique pour les deux blocs, puis lancer CT1 à CT6 et TE1 à TE6 dans l'ordre prévu. Relever le catalogue avant le premier Tour et après chaque session. Les résultats des tentatives de préparation ne doivent pas être confondus avec les douze mesures de campagne.
