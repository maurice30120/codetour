# Création de Knowledge — essais Pi du 27 novembre 2026

**Mise à jour après correctif : le [nouvel essai](rapport-correctif-knowledge-spec341.md)
a créé et persisté quatre Knowledge après des lectures seules.** Le présent rapport
conserve les résultats et le diagnostic de la campagne antérieure au correctif.

Le réseau fonctionne après relance avec l’accès autorisé au fournisseur `mistral`.
La campagne réelle a exécuté cinq sessions, sept lectures et deux appels au proposeur,
mais **aucune Knowledge n’a été persistée**. Le premier appel propose une liste vide ;
le second produit trois faits sans `sources`, incompatibles avec l’admission Knowledge.

Une lecture suffisante constitue une preuve admissible dès le cycle courant. Les
preuves par commandes propres aux micro-skills ne sont pas un prérequis Knowledge.
Les deux sessions supplémentaires avec tests sont des sondes de diagnostic, pas un
nouveau protocole d’admission ni un contournement de cette exigence.

## Version et isolation

- Branche des deux dépôts : `spec-341-integration`.
- CodeTour : `6e4e744d72d67f97d05c69c91b184da02213a01f`.
- TokenEconomizer : `ac1a5f536ddfd1634a0bc57cdc725543bc0dccab`, avec modifications
  locales préexistantes. Le parent référence encore `049e39f29d7ce932cfb535dcef32fd5834f7dcb2`.
  À la clôture du relevé, HEAD TokenEconomizer est passé à
  `4ef7a33d820a347f46c487891ba8a6d9dad339d3` ; le harnais de mesure et son test
  présentent alors des modifications locales. Ces évolutions concurrentes n’ont
  pas été réalisées par cette campagne et sont conservées.
- Pi installé : 1.6.1 ; modèle principal et proposeur :
  `mistral/deepseek-v4-1-flash-1017`, effort du profil `high`.
- Profil Pi et `TOKENECONOMIZER_HOME` séparés du profil et du stock personnels.
  Identité native constatée : dépôt `maurice30120/codetour`, hôte `pi`, répertoire
  `repos/codetour-10c5c88374/pi`. L’isolation repose sur la racine de stockage, pas
  sur un changement artificiel d’identité du dépôt.
- Extension explicitement chargée :
  `TokenEconomizer/plugin/pi/tokeneconomizer.ts` du checkout ; découverte des autres
  extensions, skills, fichiers de contexte et serveurs MCP désactivée.
- Knowledge activée ; micro-skills, toolprune, loopguard et import d’historique
  désactivés. Cadence native conservée : 3 ; fenêtre : 8 ; plafond : 16 000.
  Les arguments exacts, variables effectives et empreintes sont conservés avec les preuves.
- Aucun code, test versionné, sélecteur ou défaut n’a été modifié par cette campagne.
  `digest.py` a changé sur disque entre les instantanés de début et de fin : les SHA
  seuls ne désignent donc pas précisément tout le code exécuté. Cette campagne ne
  certifie pas une version finale figée.

Les appels externes et la copie temporaire privée de l’authentification Pi ont été
explicitement autorisés. Les copies d’authentification et de configuration des modèles
ont été retirées du profil de campagne après terminaison des appels et replis.

## Essais réels

Les prompts et commandes exacts figurent dans chaque `command.json` des preuves.
Le repli utilise l’extension et le moteur natifs ; aucune proposition n’est simulée.

| Essai | Demande et activité constatée | Résultat |
| --- | --- | --- |
| C1 | Lecture complète de `codetour/src/store/tourSchema.ts`, sans commande | Lecture retenue ; premier repli sans appel de proposition, conformément à la cadence. Création réelle non concluante. |
| C2 | Lectures complètes de `storage.ts` et `tourSchema.ts` | Premier appel natif : `{"extractors": [], "facts": []}` ; aucune candidate ni admission. Création réelle non concluante. |
| C3 | Message sans outil ni fait technique | Aucune lecture ; message retenu comme séquence ; aucun appel de proposition à ce repli. Ne prouve pas isolément la réponse du proposeur sur une fenêtre entièrement vide. |
| E1 | Lecture complète de `packages/workspace-identity/index.js`, puis test existant | Suite Node exécutée : 2 tests réussis ; pas d’appel de proposition à ce repli. |
| E2 | Lectures complètes de `index.js`, `test/identity.test.js` et, à l’initiative de Pi, `package.json` ; même test | 2 tests réussis ; second appel : 3 faits sans `sources`, zéro Knowledge persistée. |

Les chemins E1/E2 sont sous `codetour/`. La lecture additionnelle de `package.json`
est un écart aux lectures prévues, conservé dans les traces et le digest.

Les deux appels natifs ont eu lieu aux replis 2 et 5 ; état final `now=5`,
`last_propose=5`. Les cinq sessions sont marquées repliées dans le stock natif.

## Propositions, admission et interprétation

Le premier appel possède bien des observations de code dans son prompt. Il renvoie
une liste vide. Le raisonnement enregistré explique ce choix par l’absence de
commandes et de deux confirmations, malgré l’annexe Knowledge. Une réponse vide
reste acceptable en soi ; c’est l’application des contraintes micro-skills aux
Knowledge dans ce raisonnement qui révèle la confusion de consignes.

Le second appel suit à nouveau le format micro-skills et propose :

| Identifiant proposé | Sujet | Rejeu local de l’admission existante |
| --- | --- | --- |
| `node-test-runner` | Invocation de la suite via `rtk node --test` | `invalid-source-or-content` |
| `workspace-identity-package` | Package CommonJS et script de test | `invalid-source-or-content` |
| `no-install-build-before-test` | Absence d’installation ou compilation avant le test | `invalid-source-or-content` |

Chaque proposition possède `id`, `claim`, `injection`, `detector` et `cite`, mais
aucune ne possède `sources`. Les textes complets sont dans `raw-proposal.json`.
Le rejeu appelle uniquement `_admit` sur les candidates réelles, sans sauvegarde ni
nouvel appel modèle. Ses motifs explicitent le contrat ; ils ne sont pas présentés
comme une journalisation des décisions originales, que le ledger n’expose pas ici.
Le stock natif final confirme indépendamment l’absence de toute entrée persistée.

Il n’existe donc aucun contrat persisté à évaluer. Les propositions brutes présentent
en outre des problèmes de portée : `node-test-runner` généralise une suite particulière
aux tests du dépôt ; l’absence d’installation observée ne prouve pas qu’aucune
préparation préalable ne soit nécessaire. Les sources du package CommonJS sont
observables, mais le contrat de preuve exigé n’a pas été produit.

Le résultat localise une difficulté du proposeur et du prompt partagé ; il ne prouve
pas un besoin de commandes pour l’admission. Le test existant
`test_one_complete_read_admits_and_injects_a_knowledge_in_the_same_cycle` vérifie
précisément qu’une candidate contrôlée, sourcée par une seule lecture, est admise
immédiatement. Cela ne mesure pas la qualité du proposeur réel.

## Mesures

| Mesure | Valeur observée |
| --- | ---: |
| Sessions / séquences / lectures | 5 / 5 / 7 |
| Entrées du catalogue final / commentaires | 5 / 4 |
| Appels réels au proposeur | 2 |
| Candidates brutes / avec `sources` | 3 / 0 |
| Knowledge persistées | 0 |
| Motifs de rejet reproduits localement | 3 × `invalid-source-or-content` |
| Volumes des prompts réellement transmis | 22 890 et 41 363 caractères |
| Durées des appels de proposition | 1,993 et 10,526 secondes |
| Tokens proposeur : entrée / sortie / cache lu / cache écrit | 19 763 / 2 973 / 0 / 0 |
| Tokens sessions principales : entrée / sortie / cache lu / cache écrit | 7 117 / 7 237 / 12 416 / 0 |

Les durées incluent le lancement CLI. Les usages sont ceux rapportés par Pi.
Le coût remonté par Pi pour les deux propositions totalise 0,0094965 USD ; la facture
du fournisseur n’est pas vérifiée. Ces deux appels sont comptés une seule fois.
Les compteurs `optimizer_tokens` du ledger sont des tokens effectifs pondérés et
ne se substituent pas aux usages entrée/sortie/cache ci-dessus.

Les tailles finales des cinq séquences sont respectivement 6 989, 10 395, 118,
8 217 et 9 612 caractères selon le compteur du digest. Les cas limites de plafond,
les exclusions et les traitements de versions ne sont pas mesurés par ces cinq
sessions ; ils restent du ressort des tests contrôlés et d’une campagne dédiée.

## Vérifications contrôlées et couverture restante

Commande exécutée depuis `TokenEconomizer/` :

```sh
rtk ../.tokeneconomizer-venv/bin/python -m pytest \
  tests/test_knowledge_workflow.py tests/test_knowledge_pi.py \
  tests/test_knowledge_observation.py tests/test_knowledge_proof.py \
  tests/test_knowledge_digest_measure.py -p no:cacheprovider \
  --junitxml=/tmp/spec341-creation-retest.xml
```

Résultat : **109 réussis**, aucun échec ni test ignoré. Ces tests couvrent notamment
l’admission atomique et multisource, les preuves partielles et périmées, les séquences,
la fenêtre temporelle et la reprise, la déduplication, les versions, les commentaires,
le plafond et une partie de la coexistence avec les micro-skills. Ils utilisent des
propositions contrôlées et ne remplacent pas les essais réels C1–C12 du protocole.

Les cas réels C4–C12 ne sont pas exécutés dans cette campagne. La couverture complète
des modes C12, la qualité de Knowledge effectivement créées, leurs doublons et
contradictions restent non vérifiés. Aucun résultat n’est extrapolé à la livraison,
aux économies de réutilisation, à la campagne comparative #335 ou à la clôture #336.

## Pièces justificatives et incident initial

Répertoire des essais réseau fonctionnels :

`/var/folders/yd/6910m5zs4v7d7308h_8ypmy80000gp/T/spec341-creation-20261127-3p3y7bcb/`

- `analysis.json` : mesures, usages, candidates et motifs du rejeu d’admission.
- `checkout-before.json` : SHA, états Git et empreintes ; `analysis.json` garde
  également les empreintes finales et la liste des changements observés.
  `checkout-final-git.json` conserve les SHA et l’état Git au terme du relevé.
- `C1/`, `C2/`, `C3/`, `E1/`, `E2/` : arguments exacts, traces Pi natives et sorties.
- `sidecall-*/` : arguments, `prompt.txt`, `raw-proposal.json`, réponse JSONL,
  résultat et durée du processus.
- `store/` : sessions natives, état Knowledge final, digest et ledger.
- `/tmp/spec341-creation-retest.xml` : résultat des tests contrôlés.

L’incident initial est conservé séparément dans
`/var/folders/yd/6910m5zs4v7d7308h_8ypmy80000gp/T/spec341-creation-20261127-3zxu0ul0/`.
Deux sessions sans lecture et un appel au proposeur y échouent avec `fetch failed`,
malgré une sortie processus à 0. Leurs usages nuls ne constituent pas une mesure
de facturation ; ces essais sont exclus des totaux fonctionnels ci-dessus.

La relance disposant de l’accès réseau réussit sans correction de code. La cause
réseau est ainsi étayée par le changement d’environnement d’exécution ; une panne
DNS ou TLS précise n’a pas été isolée. Aucun ticket n’a été créé ou modifié.
