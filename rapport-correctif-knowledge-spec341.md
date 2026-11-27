# Knowledge — correctif et nouvel essai du 27 novembre 2026

**Le proposeur réel crée désormais des Knowledge après des lectures seules :
4 candidates sourcées, 4 admises, 4 persistées en état `ACTIVE`.** Aucune commande
ni confirmation n’a été nécessaire dans les sessions observées. Le problème de
confusion avec les règles des micro-skills n’est plus reproduit sur cet essai.

Ce relevé complète le [premier rapport](rapport-creation-knowledge-spec341.md), qui
conserve les échecs antérieurs. L’autorisation ultérieure de corriger et retester
remplace la restriction initiale du protocole interdisant les modifications.
Les essais contrôlés vérifient les contrats du moteur ; ils sont distingués des
réponses du modèle réel. Ils ne mesurent pas sa qualité dans tous les cas limites.

## Version, changement et environnement

- CodeTour : `6e4e744d72d67f97d05c69c91b184da02213a01f`.
- TokenEconomizer : `a75d57409ae800872a6138f02b842eb6c46210a0`, branche
  `spec-341-integration`, arbre propre avant et après les essais.
- Correctif : `f3cca441ccd972d263b4dd39a1855ec137167223`, puis clarification
  `a75d57409ae800872a6138f02b842eb6c46210a0`. Ces commits étaient déjà présents
  à la reprise : aucun second correctif identique n’a été ajouté.
- Knowledge dispose d’un prompt autonome, d’un exemple JSON avec `sources` et de
  règles d’admission indépendantes des commandes et confirmations des Facts natives.
  L’appel combiné distingue les deux missions et conserve le budget partagé.
- Le test `test_read_only_knowledge_has_its_own_proposal_contract` exerce les hooks
  jusqu’à l’admission et à l’injection, en modes Knowledge seule et partagé, avec
  une lecture sans commande. Le proposeur y est simulé.
- Pi `1.6.1` ; modèle principal et proposeur `mistral/deepseek-v4-1-flash-1017`,
  profil `high`. Seule l’extension Pi du checkout est explicitement chargée.
  Les autres extensions, skills, modèles de prompt, fichiers de contexte et MCP
  sont désactivés dans les commandes de campagne.
- Nouveau profil privé et nouveau `TOKENECONOMIZER_HOME`, distincts des données
  personnelles. Dépôt natif `maurice30120/codetour`, hôte `pi`.
- Knowledge activée ; micro-skills, toolprune, loopguard et import d’historique
  désactivés. Cadence native : 3 ; fenêtre : 8 séquences ; plafond : 16 000
  caractères par séquence. Aucun changement des réglages versionnés.
- Les appels externes à `mistral` et les copies privées d’authentification étaient
  autorisés. Les copies `auth.json` et `models.json` ont été retirées après la fin
  des appels et des replis. Aucun ticket ni publication distante n’a été modifié.

## Essai réel, mêmes demandes de lecture seule

Les trois prompts sont identiques aux C1–C3 du premier essai ; les arguments exacts
figurent dans les `command.json`. Le stock initial est vide. Chaque session réelle
est repliée par l’extension native, sans proposition simulée.

| Essai | Activité réelle | Résultat |
| --- | --- | --- |
| C1 | Lecture complète de `codetour/src/store/tourSchema.ts` | Une observation retenue ; pas de proposition, conformément à la cadence. |
| C2 | Lectures complètes de `storage.ts` et `tourSchema.ts` | Un appel au proposeur ; 4 candidates avec `sources`, toutes stockées immédiatement à ce repli (`promoted_at=2`, aucune confirmation). |
| C3 | Message sans outil ni fait technique | Zéro lecture, une séquence vide, aucun nouvel appel ni nouvelle entrée. La fenêtre contient toujours les observations antérieures. |

État final : `now=3`, `last_propose=2`. Trois sessions repliées, trois séquences,
trois lectures ; le catalogue dédupliqué contient deux entrées et deux commentaires.
Les séquences consomment respectivement 8 589, 9 337 et 0 caractères : aucun
dépassement ni exclusion dans ces trois sessions. Chaque candidate réelle cite une
seule observation suffisante ; aucune n’a demandé deux sources ou deux sessions.
L’essai réel C2 ne démontre donc pas une synthèse multisource générée par le modèle.

## Les quatre Knowledge persistées

Les quatre champs métier complets `id`, `claim`, `injection`, `detector` sont dans
`sidecall-*/raw-proposal.json`. `analysis.json` conserve aussi les contrats réellement
persistés, leurs identifiants internes, révisions, preuves et provenances.
Les détecteurs des quatre candidates sont `{"scope":"(?!)","confirm":"(?!)"}` :
ils ne correspondent à aucune commande, ce qui n’empêche pas l’admission.

| Identifiant proposé | Contenu, traduit et résumé | Évaluation sur le code observé |
| --- | --- | --- |
| `tour-id-injected-after-validation` | `loadTour` valide le fichier puis lui affecte l’identifiant fourni par l’appelant, remplaçant un éventuel `id` présent dans le fichier. | Mécanisme durable et étayé par `loadTour`, `parseTourFile` et les schémas du fichier lu. La phrase « never itself validated » doit se comprendre dans ce chargeur, sans généralisation aux appelants. |
| `loose-objects-preserve-unknown-fields` | Les objets tour et étape utilisent `z.looseObject` ; les propriétés inconnues y sont conservées. Les objets imbriqués sélection/position utilisent `z.object`. | Distinction cohérente avec les déclarations observées et le commentaire de format. Le comportement des primitives Zod est une interprétation de leur API, pas un résultat d’exécution mesuré dans cette session. |
| `step-description-default-vs-tour-optional` | Une description d’étape absente devient `""` ; une description du tour absente reste `undefined`. | Différence de contrat explicite : `.default("")` contre `.optional()`. Portée limitée au résultat du parseur. |
| `progress-keyed-by-tour-id` | La progression est une liste d’étapes visitées par `tour.id`, stockée sous `codetour:progress`. L’ajout d’une étape est idempotent et la complétude globale compare des longueurs. | Juste sur le fichier observé ; mécanisme cohérent réunissant mise à jour, lecture et remise à zéro du même stockage. La comparaison de longueurs ne prouve pas à elle seule que chaque indice d’étape est valide. |

Ces quatre textes traitent de mécanismes distincts ; aucun doublon ou conflit entre
eux n’a été relevé. Le stock initial étant vide, cet essai ne teste pas la résolution
sémantique de contradictions avec un historique existant. Chaque contrat vérifie
actuellement sa preuve locale et reste `ACTIVE`, avec zéro confirmation.

Deux preuves sont symboliques (`loadTour`, `initializeStorage`) et deux sont des
preuves de fichier par repli du parseur (`symbol-unresolvable` pour `TourFileSchema`
et `CodeTourStepSchema`). **Limite observée : une preuve symbolique est plus étroite
que certaines explications proposées.** La première candidate parle aussi des
schémas appelés ; la quatrième dépend notamment de `getProgress` et d’une constante
extérieurs au symbole cité. La vérité actuelle des textes est vérifiable sur les
fichiers lus, mais les empreintes de ces seuls symboles ne garantissent pas leur
invalidation lors de toute modification de leurs dépendances. Ce correctif du
prompt ne change pas le calcul des preuves et ne résout pas cette limite.

## Couverture contrôlée des douze cas

Les tests cités ci-dessous existent dans le checkout final et sont exécutés par la
suite complète. Aucun de ces résultats contrôlés n’est présenté comme une réponse
du modèle réel. Les sondes supplémentaires restent hors des dépôts versionnés.

| Cas du protocole | Preuve inspectée et exécutée | Statut et limite |
| --- | --- | --- |
| C1 — atomique | Test `test_read_only_knowledge_has_its_own_proposal_contract` ; quatre contrats réels `ACTIVE` sans commande ni confirmation. | Réussi ; l’appel reste soumis à la cadence native. |
| C2 — multisource | Tests `test_a_knowledge_about_several_files_holds_while_all_of_them_do`, `test_two_observed_symbols_in_distinct_files_are_admitted`. Sonde sur les observations Pi réelles : une candidate reliant identité et progression, deux preuves de fichier, sauvegarde puis rechargement en `ACTIVE`. | Réussi en contrôlé ; candidate de la sonde rédigée localement, pas générée par le modèle. |
| C3 — absence de fait | Session réelle C3 ; tests des séquences sans lecture et du contexte Knowledge indisponible ; réponse vide simulée dans le harnais. | Réussi sur conservation de la séquence et absence d’invention moteur ; réponse du modèle sur une fenêtre entièrement vide non mesurée. |
| C4 — lecture partielle | Tests Pi `test_a_partial_read_proves_the_symbol_it_crossed`, `test_a_pi_partial_read_reaches_the_fold_creates_and_invalidates_knowledge` ; tests workflow d’admission du symbole et refus hors portée. | Réussi en contrôlé, avec captures ; aucune prétention de lecture des lignes absentes. |
| C5 — références refusées | Tests `test_a_reference_must_resolve_to_one_retained_observation`, `test_partial_knowledge_refuses_anything_but_an_observed_symbol`, preuves périmées/ambiguës ; sonde `missing/0.0` → `out-of-digest`. | Réussi en contrôlé ; pas d’entrée sur référence refusée. |
| C6 — séquences | Tests `test_two_requests_in_one_session_are_two_sequences_with_their_own_reads`, `test_a_request_that_read_nothing_still_takes_its_slot`, `test_pi_injected_and_system_messages_open_no_work_sequence`. | Réussi en contrôlé ; trois vraies demandes donnent aussi trois séquences dans l’essai réel. |
| C7 — fenêtre/reprise | Tests `test_a_session_folded_late_lands_at_its_own_time_position`, `test_a_request_appended_after_a_session_is_folded_stays_out`, sauvegarde/rechargement identiques. | Réussi en contrôlé : huit demandes les plus récentes par heure d’émission ; ajouts après repli exclus. |
| C8 — déduplication | Tests Pi des fragments disjoints, chevauchants, répétitions et lecture complète ; test des compteurs lectures/séquences/sessions. | Réussi en contrôlé ; dans le réel, trois lectures donnent deux entrées de catalogue. |
| C9 — versions | Tests `test_two_versions_are_two_entries_even_when_the_symbol_is_unchanged` et `test_partial_reads_of_two_versions_of_a_file_do_not_merge`. | Réussi en contrôlé ; aucune fusion sur la seule empreinte d’un symbole. |
| C10 — commentaires | Tests de rattachement, ordre d’un constat et de sa correction, instructions non fiables, commentaire seul refusé et commentaire jamais preuve. | Réussi sur ces contrats contrôlés ; résistance générale du modèle aux instructions malveillantes non certifiée. |
| C11 — plafond | Tests d’arrêt au premier dépassement, première unité trop grande, budgets distincts et coût des commentaires. Sonde : code + chemin + ref = 16 000 retenus ; 16 001 → aucune unité retenue. | Réussi en contrôlé ; unités complètes, aucun remplissage avec la petite unité après dépassement. Le message utilisateur borné reste hors plafond, conformément au moteur final. |
| C12 — coexistence | Tests workflow du budget partagé et repli natif sur erreur Knowledge. Rejeu des mêmes trois traces Pi dans six stocks : Knowledge seule, native seule, partagé, `envfacts` seul, tout désactivé, appels suspendus. | Réussi en contrôlé : un appel dans chacun des trois modes LLM, zéro dans les trois autres. Coût simulé de 13 tokens effectifs compté une seule fois, y compris en partagé. |

La sonde multisource confirme aussi `duplicate` pour une seconde proposition de la
même affirmation. Le harnais existant mesure sur les traces enregistrées l’admission,
la déduplication, le refus après changement de preuve et le retrait après une
contradiction contrôlée. Les sorties `controlled-probes.json` et `comparison.json`+détaillent les résultats et les différences de mesure avec le mécanisme précédent.

## Mesures réelles et comparaison hors modèle

| Mesure réelle du nouvel essai | Valeur |
| --- | ---: |
| Sessions / séquences / lectures | 3 / 3 / 3 |
| Appels réels au proposeur | 1 |
| Candidates / admissions / entrées persistées | 4 / 4 / 4 |
| Refus / doublons dans cet appel réel | 0 / 0 |
| Taille du prompt transmis | 19 455 caractères |
| Durée du processus proposeur | 7,419 secondes |
| Tokens proposeur : entrée / sortie / cache lu / écrit | 6 291 / 2 024 / 0 / 0 |
| Tokens sessions principales : entrée / sortie / cache lu / écrit | 4 590 / 3 964 / 2 560 / 0 |
| Coût proposeur rapporté par Pi | 0,0043161 USD |

La facture fournisseur n’est pas vérifiée. Les tokens effectifs du ledger
(`18 435`) sont pondérés et distincts des usages ci-dessus. L’appel n’est compté
qu’une fois ; les événements Pi dupliquant le dernier message ne sont pas sommés.

Le harnais existant `scripts/knowledge_digest_measure.py` a rejoué **les mêmes
trois traces** sans modèle sur le checkout final et sur
`f1a6c1890b640b0dc89995308754ad11268816fb`, extrait hors du dépôt.
Les commandes et SHA figurent dans les preuves. Les prompts mesurés sur les trois
replis totalisent 51 421 caractères pour le digest contre 30 293 pour l’ancienne
vue ; ce sont des volumes construits, y compris aux replis où la cadence interdit
l’appel, et non des consommations facturées. L’ancienne vue tronque sept occurrences
d’extraits à 2 000 caractères au fil des replis ; le digest n’a aucun dépassement
sur ces traces. Les fenêtres et mandats étant différents, aucune conclusion
d’économie ou de supériorité de qualité n’est tirée de ces tailles.

Les sondes d’admission du harnais sont contrôlées : côté digest, trois admissions
de l’observation choisie ; côté ancien mécanisme, une admission et deux refus
`ambiguous-source`. La contradiction est mesurée trois fois côté digest : trois
faits retirés, aucun encore rendu. Elle n’est pas mesurée côté ancien mécanisme,
qui ne fournit pas le digest requis par cette sonde, et n’est pas comptée comme zéro.

## Vérifications, revue et limites

- Tests ciblés : **98 réussis**, aucun ignoré ou échoué.
- Suite complète `python -m pytest tests experiments/tests` : **1 978 réussis,
  43 ignorés, 5 échecs**, tous dans `experiments/tests/test_model_spelling.py`.
  Les mêmes cinq échecs sont reproduits avec ce fichier et son script extraits du
  commit antérieur `cd4de57ebc242c2e1f5a05566e26055e49ccf1e2` : le binaire système
  `timeout` est absent, donc les faux CLI Copilot ne sont jamais exécutés.
  La suite globale ne peut pas être déclarée verte dans cet environnement.
- La compilation des trois modules Python modifiés réussit. Aucun vérificateur
  de types Python n’est configuré dans ce projet ; ce contrôle de syntaxe ne se
  substitue pas à une analyse de types.
- Revue Standards : **0 constat** sur `cd4de57...a75d574`.
- Revue Spec : **0 constat** sur le même diff, notamment sur l’indépendance des
  règles Knowledge et la préservation de l’appel partagé.

Les douze cas ont désormais des preuves d’exécution identifiées, réelles ou
contrôlées comme indiqué. Le résultat établit la création native de Knowledge à
partir de lectures seules sur cet essai. Il ne certifie pas la qualité du proposeur
pour toute entrée, la couverture transitive des preuves symboliques, la livraison,
les économies de réutilisation, la campagne comparative #335 ou la clôture #336.

## Pièces justificatives

Répertoire du nouvel essai :

`/var/folders/yd/6910m5zs4v7d7308h_8ypmy80000gp/T/spec341-fix-20261127-6skgxujl/`

- `checkout.json` : SHA, états Git, version Pi et empreintes des fichiers concernés.
- `manifest.json`, `environment.json`, `C1/`, `C2/`, `C3/` : paramètres, commandes,
  durées, traces Pi et erreurs modèle (aucune).
- `sidecall-*/` : arguments, prompt exact, réponse brute, usages et durée.
- `store/` : stock natif, sessions repliées, digest, contrats et ledger.
- `analysis.json` : mesures et vérification courante des quatre preuves.
- `controlled-probes.json`, `controlled-multisource/`, `modes/` : sondes d’admission,
  de plafond et de coexistence. Les coûts de ces sondes sont simulés.
- `comparison.json`, `measure-command.json`, `measure-output.txt` : rejeu comparatif
  existant, sans appel modèle.
- `spec341-fix-targeted.xml`, `spec341-fix-full.xml`, `before-fix-copilot.xml` et
  `before-fix-copilot.txt` : résultats contrôlés, y compris les échecs antérieurs.
- `coverage-audit.json` : correspondance des douze cas avec les tests réellement
  exécutés et réussis dans le XML de la suite complète.

Les scripts de campagne sont dans `/tmp/spec341_fix_run.py`,
`/tmp/spec341_fix_probes.py` et `/tmp/spec341_fix_collect.py`. Les traces et copies
temporaires ne sont pas publiées ; leur persistance dépend de celle du répertoire
temporaire local.
