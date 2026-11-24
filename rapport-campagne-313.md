# Campagne Pi #313 — création et utilisation de Knowledge (24 novembre 2026)

## Réponses courtes

- **Des Knowledge sont-elles créées ?** Oui, dans le dépôt CodeTour : 4 faits après CT4. Non dans le dépôt TokenEconomizer : 0 fait après six sessions.
- **Sont-elles réutilisées ?** Elles ont été injectées (CT2 à CT6) mais je n'ai pas de preuve qu'une Knowledge ait évité un travail. Le modèle n'a pas relu `schema.json` dans 4 des 5 sessions injectées, mais leurs sujets ne le demandaient pas toujours. Il a relu `tourDiscovery.ts` en CT6 malgré le fait injecté qui le couvrait.
- **Les tokens diminuent-ils ?** Non dans le bloc CodeTour (hausse, sujets de plus en plus larges). Oui, en apparence, dans le bloc TokenEconomizer, où aucune Knowledge n'a été injectée : la baisse y vient donc d'autre chose. Gain dû à Knowledge : non démontré.

## Conditions

- Hôte Pi 1.6.0, modèle `mistral/deepseek-v4-1-flash-1017`, raisonnement `high`, lancement `./launch-local.sh pi --memory=knowledge` (Knowledge actif, micro-skills natifs désactivés). Une seule copie de TE chargée (dépôt local).
- Commits : CodeTour `7070372877aefb44872616dd09a1651e867a4051` (branche `spec-314-integration`, avec modifications locales non commitées préexistantes) ; TokenEconomizer `f8cbb579cf2d8602cb69c0ad22880615804e2cba`.
- Tours générés par `/codetour project <prompt de l'issue>`, une session neuve chacun, dans l'ordre. Aucune réinitialisation ni injection manuelle.
- État initial CodeTour : 147 sessions repliées, 0 Knowledge, cadence `now=10`, `last_propose=8` (comprend la calibration de cette campagne et ses sessions antérieures). État initial TokenEconomizer : 4 sessions repliées, aucun état Knowledge ; la calibration l'a porté à `now=1`.
- Pré-vol : `npm run check:fast`, `npm test` et la suite TE avaient été exécutés avec succès lors de la préparation précédente (rapport de reprise du même jour). Je ne les ai pas relancés ; seule la réinstallation `./install-local.sh --pi` a été refaite.
- Aucune correction du code ou de la configuration n'a été nécessaire. Aucune rupture des conditions de mesure.

## Chronologie par dépôt

### CodeTour

| Étape | Observation |
| --- | --- |
| Création | Repli de CT1 : fait `18de21` (« les `.tour` vivent dans `.tours/`, décrits par `codetour/schema.json` »). Repli de CT4 : trois faits de plus (`cb6258` serveur MCP, `56fe20` découverte `tourDiscovery.ts`, `ddf2d3` schémas zod `tourSchema.ts`). Coût d'optimisation TE : 73 415 (CT1), 89 290 (CT4). |
| Preuve | Empreinte sha256 d'un fichier : `schema.json`, `cli.ts` du serveur MCP, `tourDiscovery.ts`, `tourSchema.ts`. |
| Admissibilité | Il faut ACTIF, au moins 4 tâches exercées et un taux de tir d'au moins 40 %. `18de21` : admissible dès CT2. `56fe20` et `ddf2d3` : 3 observations avant CT5, donc **non admissibles pour CT5**, admissibles à partir de CT6. `cb6258` : 0 tir sur 5, **jamais admissible**. |
| Injection | CT1 : aucune (fait inexistant). CT2, CT3, CT4, CT5 : 1 fait (`18de21`). CT6 : 2 faits (`18de21`, `56fe20`). `ddf2d3` est admissible mais exclu par le budget (150 tokens, soit environ 600 caractères). |
| Réutilisation observée | Voir ci-dessous. Aucune preuve de travail évité. |

Lectures de fichiers couverts par un fait injecté (références dans les commandes de lecture et de shell) :

| Session | Faits injectés | `schema.json` | `tourDiscovery.ts` | `tourSchema.ts` |
| --- | --- | ---: | ---: | ---: |
| CT1 (référence) | 0 | 3 | 2 | 3 |
| CT2 | 1 | 0 | 1 | 1 |
| CT3 | 1 | 0 | 0 | 0 |
| CT4 | 1 | 1 | 0 | 0 |
| CT5 | 1 | 0 | 4 | 4 |
| CT6 | 2 | 0 | 3 | 0 |

`schema.json` n'a plus été relu en CT2, CT3, CT5 et CT6, après trois lectures en CT1, ce qui est compatible avec une réutilisation. Mais CT2 et CT3 portent sur d'autres sujets, et CT5 et CT6 ont lu des fichiers voisins par le shell. Rien n'établit que le fait a provoqué l'absence de lecture. `tourDiscovery.ts` a été relu en CT6 alors que son fait était injecté.

### TokenEconomizer

| Étape | Observation |
| --- | --- |
| Création | **Aucune.** Une proposition a été tentée au repli de TE4 : 160 514 tokens d'optimisation, 0 fait retenu. TE1 a aussi enregistré 6 743 tokens d'optimisation. |
| Preuve, admissibilité, injection, réutilisation | Sans objet : aucun fait. Aucune injection dans TE1 à TE6. |
| Raison de l'absence de fait | **Non établie.** Les sessions ont des observations enregistrées (2 à 9 sources par session) ; le proposeur n'a rien retenu. Une piste déjà notée dans le rapport partiel : les lectures partielles de Pi ne sont pas toutes admissibles comme preuve. À vérifier. |

## Les douze sessions

Source : journal de sessions TE. « Effectifs » est la métrique pondérée de TE, distincte du total brut. « Surcoût TE » compte les tokens d'optimisation du proposeur au repli de cette session ; le juge anti-boucle n'a pas été isolé pour ces sessions (non disponible). Lectures, shell et fichiers viennent des transcriptions Pi (les lectures par `cat` ou `sed` passent par le shell).

| Session | Entrée | Sortie | Cache | Effectifs | Surcoût TE | Durée | Étapes | Faits injectés | Lectures | Shell | Fichiers distincts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| CT1 | 34 804 | 17 682 | 977 408 | 238 637 | 73 415 | 190 s | 10 | 0 | 1 | 37 | 18 |
| CT2 | 58 512 | 27 458 | 772 736 | 300 534 | 0 | 151 s | 15 | 1 | 10 | 21 | 24 |
| CT3 | 32 608 | 23 810 | 1 319 936 | 307 462 | 0 | 191 s | 15 | 1 | 14 | 18 | 20 |
| CT4 | 43 523 | 18 155 | 1 153 152 | 267 768 | 89 290 | 151 s | 15 | 1 | 13 | 11 | 17 |
| CT5 | 57 394 | 33 812 | 1 212 544 | 381 520 | 0 | 181 s | 20 | 1 | 0 | 37 | 29 |
| CT6 | 70 708 | 34 861 | 1 571 456 | 437 020 | 0 | 181 s | 16 | 2 | 0 | 45 | 37 |
| TE1 | 88 157 | 34 476 | 2 033 408 | 498 354 | 6 743 | 211 s | 18 | 0 | 8 | 42 | 33 |
| TE2 | 64 381 | 22 933 | 2 762 240 | 478 203 | 0 | 211 s | 15 | 0 | 21 | 28 | 37 |
| TE3 | 56 132 | 23 027 | 1 443 840 | 338 678 | 0 | 161 s | 17 | 0 | 10 | 16 | 22 |
| TE4 | 58 831 | 31 672 | 1 443 840 | 393 247 | 160 514 | 212 s | 19 | 0 | 2 | 44 | 28 |
| TE5 | 52 562 | 20 006 | 700 672 | 242 665 | 0 | 141 s | 18 | 0 | 9 | 20 | 20 |
| TE6 | 59 779 | 21 395 | 1 162 624 | 304 411 | 0 | 171 s | 22 | 0 | 0 | 39 | 34 |

Les surcoûts de CT1, CT4, TE1 et TE4 correspondent aux sessions dont le repli a lancé une proposition (cadence toutes les 3 sessions).

## Évolution des tokens

- **CodeTour (avec faits injectés dès CT2) :** 239 k, 301 k, 307 k, 268 k, 382 k, 437 k. Hausse nette. Les sujets s'élargissent (CT5 et CT6 relient plusieurs composants).
- **TokenEconomizer (aucune injection) :** 498 k, 478 k, 339 k, 393 k, 243 k, 304 k. Baisse apparente alors qu'aucune Knowledge n'a agi.

Les deux tendances inverses, dont une sans mémoire en jeu, montrent que le sujet de chaque prompt et la variance du modèle pèsent plus que Knowledge. L'injection ajoute au plus 150 tokens. Les prompts diffèrent entre sessions et il n'y a pas de groupe sans mémoire : une baisse ne prouverait pas une économie due à Knowledge, et une hausse ne prouve pas l'inverse. **Gain non démontré.**

## Qualité des Tours

- Les douze Tours sont créés (10 à 22 étapes). Tous les fichiers ancrés existent et tous les motifs et lignes résolvent, par contrôle automatique. CT5 (20 étapes) et TE6 (22) dépassent la recommandation de 15.
- Justesse, lisibilité et couverture : jugées sur les titres et descriptions seulement ; pas de relecture complète des 200 étapes. Les synthèses d'architecture sont rédigées à partir de ces textes et le signalent.

## Test d'invalidation de preuve (bloc CodeTour)

`schema.json` modifié par un espace : le fait `18de21` disparaît de la liste des faits injectables (il reste `56fe20` et `ddf2d3`). Fichier restauré : `18de21` redevient injectable. La même vérification n'a pas été possible dans le bloc TokenEconomizer (aucun fait).

## Anomalies et limites

- **Journal d'injection :** le champ d'injection du journal TE reste vide pour Knowledge. L'injection s'est prouvée par la transcription Pi (bloc `<tokeneconomizer>`).
- **Calibration CodeTour :** `/codetour` sans argument a lancé une génération à vide, abandonnée. La session est comptée dans la cadence. Le modèle de calibration n'avait pas les outils MCP avant `/codetour`.
- **Anciens Tours CodeTour :** une observation faite en cours de campagne (anciens Tours visibles dans `.tours/`) n'a pas été confirmée ; l'arbre final ne contient que les six nouveaux Tours.
- **Journal du repli :** `fold.log` du dépôt CodeTour contient d'anciennes erreurs Python 3.14 (`_socket`, signature de code invalide). Ces entrées n'ont pas été attribuées aux sessions de la campagne.
- **Autres :** durée et nombre de recherches distinctes ne sont pas isolés. Le surcoût du juge anti-boucle n'a pas été relevé. Pas de mesure de contrefactuel. Un seul modèle, une seule exécution par Tour.
- Les journaux bruts (ledger TE, état Knowledge, transcriptions Pi) restent hors de Git, dans `~/.tokeneconomizer` et `~/.pi/agent/sessions`.

## Livrables

- Tours : `codetour/.tours/ct1-…ct6-*.tour` et `TokenEconomizer/.tours/te1-…te6-*.tour`.
- Parcours de lecture et synthèse d'architecture : `docs/campagne-313/` dans chaque dépôt.
- Ce rapport.
