# Campagne Knowledge #313 — rapport partiel du 24 novembre 2026

Campagne mise en pause à la demande de l’utilisateur après cinq sessions de génération CodeTour. Les Tours produits et ceux préexistants ont ensuite été supprimés des répertoires de projet à sa demande. Les sept sessions restantes et le bloc TokenEconomizer n’ont pas été exécutés. Les résultats ci-dessous ne constituent pas une campagne complète.

## Conclusion provisoire

Aucune Knowledge n’était présente dans le catalogue à la fin des cinq sessions et aucune injection n’a été enregistrée pour celles-ci. Une économie de tokens due à Knowledge n’est donc pas démontrée. Le coût augmente sur cette courte série, mais les demandes et le travail effectué diffèrent : cela ne prouve pas que Knowledge augmente ou diminue les coûts.

TE a réalisé une tentative de proposition lors du repli de CT3 : 52 002 tokens d’optimisation ont été enregistrés pour cette session, sans création de Knowledge conservée. Le catalogue final affiche `now=7`, `last_propose=5`, zéro fait et 85 501 tokens d’optimisation cumulés, dont 33 499 provenant d’une ancienne session repliée pendant la campagne. Ce cumul ne doit pas être attribué entièrement aux Tours de la campagne.

Une piste explicative, à vérifier : les observations sauvegardées pour les sessions ne contiennent aucune source complète admissible. Pi effectue notamment des lectures partielles avec `offset` et `limit`, tandis que l’adaptateur TE rejette ces lectures comme preuves ; les lectures par commande shell ne sont pas traitées comme des lectures Pi complètes. Cela explique potentiellement l’absence de propositions prouvables, sans identifier à lui seul la cause exacte de l’absence de faits retenus.

## Mesures par session

Hôte Pi 1.6.0 ; modèle `mistral/deepseek-v4-1-flash-1017`, raisonnement `high` ; `TE_KNOWLEDGE=on`, `TE_MICROSKILLS=off`. Les chiffres proviennent du journal de sessions TE. Les tokens effectifs sont une métrique pondérée calculée par TE, distincte du total brut et non directement comparable à une facture. Les lectures en cache sont comptées séparément. Le surcoût Knowledge est rapporté séparément ; le juge anti-boucle a aussi enregistré 3 964 tokens pour CT3 et 3 809 pour CT5.

| Tour | Entrée | Sortie | Lecture cache | Tokens effectifs TE | Surcoût Knowledge | Injection |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| CT1 | 40 058 | 13 990 | 842 240 | 208 222 | 0 | aucune |
| CT2 | 33 995 | 23 775 | 787 840 | 255 429 | 0 | aucune |
| CT3 | 45 201 | 28 200 | 1 001 472 | 314 548,2 | 52 002 | aucune |
| CT4 | 46 808 | 18 813 | 1 702 912 | 329 977,2 | 0 | aucune |
| CT5 | 89 370 | 55 501 | 3 989 632 | 821 339,2 | 0 | aucune |

CT1–CT5 ont généré respectivement 9, 20, 22, 12 et 16 étapes ; CT2, CT3 et CT5 dépassent la recommandation de 15 étapes. Les fichiers et les ancrages des quatre premiers ont passé un contrôle automatique de présence et de résolution ; une vérification complète de la justesse et la relecture de CT5 restent à faire. Les Tours ayant ensuite été supprimés à la demande de l’utilisateur, cette vérification ne peut être reprise qu’à partir de la sauvegarde temporaire.

## Préparation et limites

- Le plugin Pi local a été réinstallé, et l’entrée TE distante chargée en double a été retirée. La configuration de lancement a bien activé Knowledge tout en désactivant les micro-skills natifs.
- CodeTour `npm run check:fast` et `npm test` réussis ; suite TE réussie avec le venv. Un substitut temporaire à `timeout`, absent sur macOS, a été nécessaire aux tests Copilot ; un lien local manquant dans `node_modules` a été rétabli. Les sources suivies n’ont pas été modifiées pour ces corrections.
- Une calibration Pi a été effectuée et compte dans la cadence. Une ancienne session Pi du même dépôt a été repliée pendant CT1 : elle a influencé le catalogue et la cadence. Les coûts par Tour ci-dessus sont isolés par identifiant de session.
- Le mode Pi non interactif échouait à la génération avec une erreur de contexte périmé ; la génération interactive a fonctionné. Une génération en dossier temporaire a aussi réussi avec TE volontairement indisponible.
- Le catalogue du dépôt TokenEconomizer, son bloc de six Tours, l’invalidation/restauration des preuves, la revue complète de chaque Tour et une mesure causale des économies restent non réalisés. Aucun gain n’est démontré.
- Les 14 Tours supprimés des répertoires de projet ont été copiés avant suppression dans `/private/tmp/codetour-tours-avant-suppression-20261124.zip` ; cet emplacement temporaire peut être purgé par le système. Les jeux de test de `.scratch` ont été conservés.
