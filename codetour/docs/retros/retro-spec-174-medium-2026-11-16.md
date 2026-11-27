# Rétrospective — CodeTour Medium et télémétrie Vibe, 16 novembre 2026

Préparée avec le skill `retro` de Matt Pocock et son guide `writing-for-agents`, à partir de la conversation courante, des diffs, des journaux de tests et des traces archivées. Les pistes ci-dessous restent à analyser ; cette sauvegarde n'implémente pas une refonte de l'environnement.

Le résultat utile est une recherche CodeTour vérifiée avec Medium 3.5 et plusieurs régressions reproduites puis corrigées. La campagne de 80 n'a pas démarré. Le diagnostic de dix runs est incomplet et invalide pour son comptage Vibe. Aucun apprentissage ni gain de tokens par Tour correct n'est démontré.

## Constats classés par gravité

| Priorité | Constat et preuve | Amélioration de l'environnement | État |
|---|---|---|---|
| P0 — mesure | Vibe Q1 : 111 462 tokens enregistrés contre 447 650 dans les exports fournisseur. Le connecteur acceptait un journal partiel après rotation ; le runner ignorait le complément. | Réconcilier exactement chaque session et chaque total ; refuser les appels manquants. Capturer durablement la télémétrie avant sa suppression, sans inventer de ventilation. | Régression ajoutée ; G2 strict et contrôle indépendant du runner corrigés. Capture native encore bloquante. |
| P0 — résultat | Ancien test10 : Q1/Q2/Q5 CodeTour « success » avec tableaux vides, zéro outil et zéro preuve. | Une sortie vide produit une récupération bornée, puis un résultat partiel ; valider séparément la pertinence et l'existence des citations. | Corrigé et testé ; aucune évaluation à l'aveugle achevée. |
| P1 — exécution | `--iterations` et `--calls` suivaient les arguments positionnels : le CLI conservait huit itérations, malgré les budgets déclarés. | Tester la frontière runner → vrai processus CLI, pas seulement la logique interne. | Test de transport ajouté ; options déplacées avant les arguments positionnels. |
| P1 — garde-fous | La CI existante `.github/workflows/test.yml` exécute les tests de l'extension ; elle ne branche pas explicitement les suites POC/sandbox/connecteur/runner/évaluateur. Le hook `.githooks/pre-commit` existe mais `core.hooksPath` n'était pas configuré sur ce clone. | Brancher les contrôles benchmark existants dans un job sans appels fournisseur, déclenché par les chemins concernés ; annoncer l'activation du hook à l'installation. | Proposition pour analyse ultérieure ; pas d'absence générale de CI revendiquée. |
| P1 — preuve préalable | Les gels historiques et le précontrôle superficiel pouvaient donner une impression de disponibilité alors que les sources exécutées avaient changé. | Un contrôle unique doit vérifier les artefacts scellés et la configuration exécutée avant de déclarer prêt. | Le runner refuse déjà les dérives ; écart à traiter côté précontrôle et navigation. |
| P1 — reprise | Des preuves et lanceurs n'existaient que sous `/tmp`, avec chemins macOS absolus ; plusieurs tentatives ont accumulé des états ambigus. | Point de reprise unique, inventaire SHA-256, dossiers portant un statut terminal, un lanceur relu limité au diagnostic demandé. | Archives versionnées et point de reprise ajoutés ; lanceur portable restant à préparer. |
| P2 — contexte agent | Les lectures directes annonçaient des lignes numérotées mais renvoyaient des textes avec seulement un numéro de départ. Des plages existantes citaient les mauvais faits. | Présenter un numéro absolu près de chaque ligne ; conserver arguments et sorties d'outils pour diagnostiquer les boucles. | Corrigé et testé. La causalité avec la qualité globale reste non mesurée. |
| P2 — apprentissage | Créations forcées à `[]`, réutilisations cherchées dans un champ absent ; les diagnostics réels ne montrent ensuite aucune création ni réutilisation. | Instrumenter persistance et replay réels ; distinguer exécution réussie, preuve utile et transfert. Tester les séquences R/T prévues une fois G2 résolu. | Instrumentation corrigée, tests ajoutés ; bénéfice encore non observé. |
| P2 — économie des outils | Un affichage de `raw_response` Vibe a produit environ 118 000 tokens potentiels de sortie avant troncature. Plusieurs essais fournisseur coûteux ont précédé un diagnostic assez précis. | Extraire des sous-champs bornés ; afficher en premier usage, erreurs, paramètres, citations et derniers appels. Tester les transports et le comptage hors ligne avant des runs réels. | Régressions ciblées et traces détaillées disponibles ; outil de synthèse dédié à envisager. |

## Décisions et résultats réels

Medium 3.5 est retenu explicitement par Damien pour CodeTour. La recherche isolée vérifiée sur `pg_config --version` retrouve la correspondance `--version`/`VERSION`, la construction de la valeur et l'affichage par `show_item`. Elle prend 49 secondes et 294 084 tokens ; 5 faits et 12 références sont vérifiés manuellement. Cette sélection ne prouve pas un avantage causal du modèle ou de la mémoire.

Le test dix runs Medium ne livre que deux résultats : CodeTour Q1 complet (160 427 tokens, 41 s, aucune création/réutilisation), puis Vibe Q1 complet côté agent mais invalide pour comptage. Le run suivant Vibe Q2 est interrompu ; son coût complet n'est pas disponible. Les totaux partiels ne servent à aucun ratio comparatif.

Le prototype temporaire de rétention ne modifie pas le paquet Vibe installé. Son premier lancement ne trouve pas l'app-server voisin du wrapper ; le second, après ajout de ce wrapper, expire sans export. Cela n'établit ni que la capture fonctionne ni que la rétention cause le délai. L'exécution reprendrait seulement après une sentinelle donnant une preuve complète.

## Changements conservés

- Configuration locale ignorée pour la clé, exemple sans secret et Medium par défaut du benchmark.
- Refus des résultats vides sans preuve, corrections de citations dans les budgets, limite de récursion cohérente avec le budget demandé.
- Métadonnées modèle conservées dans les échecs ; lectures numérotées ; arguments et retours d'outils dans les traces.
- Mémoire partielle : échecs observés persistés, candidats non consolidés ; compteurs de création/replay issus de faits réels.
- G2 strict sur journaux partiels et double contrôle de réconciliation du runner.

## Contrôles réellement exécutés

G0 : 156 tests POC/sandbox ; G4 : 15 tests évaluateur ; connecteur : 34 tests hors ligne ; runner : 29 tests ; infrastructure benchmark : 26 tests. Les logs sont dans les [archives](../../poc/benchmark/diagnostics/2026-11-16/README.md). Le typecheck du benchmark et `git diff --check` ont passé. Une sentinelle réelle expirée n'est pas un test réussi. Les sources et chemins du nouveau poste imposeront de nouvelles preuves G0/G4 et un nouveau gel.

## Questions à analyser plus tard

1. Comment conserver toute la télémétrie native avec un mécanisme supporté par Vibe, sans modifier ses instructions ou inférer des compteurs ?
2. Pourquoi la sentinelle instrumentée a-t-elle expiré : transport, serveur, rétention, attente du sous-agent ou latence du modèle ?
3. Les questions et séquences prévues offrent-elles des opportunités fonctionnelles de mémoire, au-delà d'appels directs aux primitives ? Mesurer d'abord l'usage réel et sa pertinence.
4. Quel résultat observable constitue un Tour correct, indépendamment du statut technique ? Conserver le contrôle à l'aveugle T06.
5. Comment rendre les précontrôles, les identités de modèle routées et les commandes de reprise explicites avant toute dépense fournisseur ?

Le [point de reprise](../specs/spec-174-tickets/REPRISE-2026-11-16.md) porte les étapes opérationnelles. Cette rétrospective porte les raisons et les sujets d'analyse ; les anciennes conclusions de gain ne deviennent pas valides par cette sauvegarde.
