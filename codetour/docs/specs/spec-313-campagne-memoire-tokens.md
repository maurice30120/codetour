# [Spec #313] Campagne bout en bout — la mémoire Knowledge de TokenEconomizer économise-t-elle des tokens sur CodeTour ?

> Issue : [maurice30120/codetour#313](https://github.com/maurice30120/codetour/issues/313), label
> `spec-313`. Remplace l'issue #299, dont les surfaces (outils MCP `knowledge_*`, flag
> `knowledgeEnabled`, consolidation de fin de Tour) ont été supprimées par la spec #304.

## Problem Statement

On veut savoir, mesures en main, si la mémoire — les Knowledge de TokenEconomizer (TE) — fait
réellement économiser des tokens quand un agent génère des Tours. Aujourd'hui la réponse ne peut
être qu'une impression : aucune campagne ne consigne par Tour ce qui a été injecté, ce qui a été
relu, ni ce qu'une Knowledge a évité.

La campagne d'origine (#299) ne peut plus être exécutée : elle mesurait la mémoire interne de
CodeTour, retirée par #304. Ses surfaces de mesure — `knowledge_list`, `knowledge_read`,
`knowledge_save`, le flag `knowledgeEnabled`, le catalogue dans les prompts, la consolidation de
fin de Tour — n'existent plus. La rejouer telle quelle ne mesurerait que des pannes.

Trois confusions rendent la question piégeuse, et la campagne doit les séparer :

1. **La mécanique est bornée et minuscule.** Une injection ajoute au plus `microskills_max_facts`
   = 4 faits et `microskills_max_tokens` = 150 tokens au démarrage d'une session ; une génération
   de Tour coûte des dizaines de milliers de tokens. Un gain ne peut donc pas venir de l'injection
   elle-même : il ne peut venir que du **travail d'exploration évité** (fichiers relus, recherches
   refaites).
2. **L'injection n'est jamais garantie.** Une Knowledge n'est injectable qu'après le cycle TE
   (proposition toutes les 3 sessions, au moins 2 sessions citantes, seuils de confirmation), avec
   une preuve encore valide et dans le budget de sélection. Une série de six sessions peut n'en
   injecter aucune. « Aucune injection » et « aucune économie » sont deux résultats différents, et
   seule la mesure de l'**admissibilité** les distingue.
3. **Une baisse de coût peut venir d'autre chose.** Les prompts n'ont ni le même périmètre ni la
   même complexité ; le modèle, le cache de prompt et l'état du dépôt varient aussi. Attribuer une
   baisse au moteur Knowledge sans preuve de réutilisation est une erreur d'interprétation.

Six sessions ne suffisent pas à conclure, et c'est ce qui motive la taille de la campagne : **douze
générations, en deux blocs de six** — un bloc sur le dépôt CodeTour, un bloc sur le dépôt
TokenEconomizer. L'état TE étant isolé par workspace, chaque bloc a **son propre catalogue** et sa
propre cadence : ce sont deux séries indépendantes de six sessions, pas une série de douze. Douze
mesures au lieu de six, deux catalogues au lieu d'un, et la possibilité d'observer au moins une
réutilisation dans l'un des deux blocs.

**La campagne a un second objectif, aussi important : comprendre les deux projets.** Les douze
Tours sont des Tours d'architecture et d'explication, progressifs, et leur **contenu est un
livrable** : douze fichiers `.tour` exportés, un parcours de lecture par dépôt, et une synthèse
d'architecture par dépôt rédigée à partir d'eux. Une campagne qui n'économiserait rien mais
laisserait deux dossiers de lecture exacts n'est pas un échec — et, inversement, un Tour faux obtenu
bon marché n'est pas un gain. Mesure et compréhension sont donc deux résultats à livrer, pas un
compromis entre les deux.

## Solution

Une **campagne unique de douze générations successives de Tours**, en deux blocs :

- **Bloc A — CodeTour** : six Tours sur le dépôt CodeTour (`codetour/`) ;
- **Bloc B — TokenEconomizer** : six Tours sur le dépôt TokenEconomizer (`TokenEconomizer/`).

Un seul hôte pour toute la campagne, un seul commit par bloc (figé), un seul modèle, une seule
configuration, catalogue conservé **dans chaque bloc**. Le bloc A se déroule intégralement avant le
bloc B. Aucun A/B, aucune seconde série supplémentaire, aucune réinitialisation, aucune injection
manuelle.

Chaque Tour produit trois mesures séparées, jamais fusionnées :

- **ce qui a été injecté** : identifiants, nombre de faits, tokens ajoutés au démarrage ;
- **ce que l'exploration a coûté** : lectures, recherches, fichiers distincts ouverts, et
  **relectures de fichiers déjà couverts par une Knowledge injectée** ;
- **ce que le Tour vaut** : couverture des composants, étapes correctement ancrées, exactitude
  factuelle, lisibilité, travail refait.

Et il produit un livrable de compréhension, décrit plus bas et noté aussi sévèrement que le coût :
un Tour d'architecture qui n'explique rien n'est pas un Tour réussi, même s'il coûte peu.

La conclusion porte sur l'usage réel — la réutilisation a-t-elle eu lieu, et a-t-elle évité du
travail — et non sur le coût brut. « Gain non démontré » reste un résultat recevable.

## Les douze prompts, dans cet ordre

Les prompts restent naturels : **ne jamais demander explicitement à l'agent de créer, d'enrichir
ou de composer une Knowledge**, ni d'utiliser la mémoire. C'est une décision qui doit venir du
mécanisme, et c'est précisément ce qu'on observe.

Chaque prompt est une demande d'**explication** pour un développeur qui découvre le dépôt : le Tour
attendu nomme les composants, montre où ils vivent dans le code, et décrit les flux entre eux. Le
dernier Tour de chaque bloc est une **synthèse** qui relie les composants déjà étudiés — c'est lui
qui sert de table des matières au dossier de lecture.

### Bloc A — dépôt CodeTour (`codetour/`)

**CT1 — Format d'un Tour**

> Crée un Project Tour qui explique simplement comment est structuré un fichier `.tour` dans CodeTour et ce que représente une étape.

**CT2 — Lecture d'un Tour**

> Crée un Project Tour qui explique comment CodeTour charge un Tour et affiche ses étapes dans VS Code.

**CT3 — Génération par MCP**

> Crée un Project Tour qui explique comment le serveur MCP de CodeTour reçoit, valide et sauvegarde un nouveau Tour.

**CT4 — Deux types de génération**

> Crée un Project Tour qui explique les points communs et les différences entre la création d'un Project Tour et celle d'un Changes Tour.

**CT5 — Parcours complet**

> Crée un Project Tour qui retrace le parcours d'un Tour, depuis sa génération par l'agent jusqu'à sa lecture, en reliant les composants déjà étudiés.

**CT6 — Architecture d'ensemble** *(prompt réécrit : CodeTour ne porte plus de moteur de mémoire)*

> Crée un Project Tour qui présente l'architecture globale de CodeTour et explique comment l'extension VS Code, le CLI et le serveur MCP coopèrent.

### Bloc B — dépôt TokenEconomizer (`TokenEconomizer/`)

**TE1 — Architecture du plugin**

> Crée un Project Tour qui explique comment un événement de session émis par l'agent atteint un mécanisme du plugin TokenEconomizer.

**TE2 — Micro-skills**

> Crée un Project Tour qui explique d'où viennent les faits que le plugin injecte et à quelles conditions ils le sont.

**TE3 — Élagage des outils**

> Crée un Project Tour qui explique comment une liste d'outils inutilisés est constituée, proposée puis appliquée aux réglages de l'agent.

**TE4 — Garde anti-boucle**

> Crée un Project Tour qui explique quand un tour est jugé bloqué et ce que le plugin ajoute alors au contexte de l'agent.

**TE5 — Knowledge et preuves**

> Crée un Project Tour qui explique comment une empreinte de fichier ou de symbole est calculée, enregistrée et vérifiée avant une injection.

**TE6 — Architecture d'ensemble**

> Crée un Project Tour qui présente l'architecture globale du plugin TokenEconomizer, explique comment ses mécanismes coopèrent, et où le coût de chaque session est calculé et enregistré.

## User Stories

1. En tant qu'expérimentateur, je veux **deux blocs de six Tours sur deux dépôts distincts**, afin d'obtenir douze mesures sans transformer la campagne en comparatif A/B.
2. En tant qu'expérimentateur, je veux que chaque bloc ait son propre catalogue et sa propre cadence, afin que le second bloc ne soit pas un mélange du premier — l'état TE est isolé par workspace.
3. En tant qu'expérimentateur, je veux le bloc A intégralement terminé avant le bloc B, afin qu'aucun entrelacement ne brouille l'ordre des sessions.
4. En tant qu'expérimentateur, je veux un seul hôte pour les douze Tours, afin que seule la mémoire puisse expliquer une différence.
5. En tant qu'expérimentateur, je veux le commit figé de chaque bloc, les versions d'hôte et de TE, le modèle et la configuration consignés avant le premier Tour, afin que la campagne soit reproductible.
6. En tant qu'expérimentateur, je veux l'état TE initial de chaque dépôt consigné (sessions déjà repliées, faits, Knowledge), afin d'interpréter la cadence et de ne pas confondre un catalogue pré-existant avec un apprentissage de la campagne.
7. En tant qu'expérimentateur, je veux qu'aucune Knowledge ne soit injectée ni forcée à la main, afin que la mesure porte sur le mécanisme réel.
8. En tant qu'expérimentateur, je veux chaque Tour dans une **session neuve**, afin que l'injection ait lieu — elle n'a lieu qu'aux sources `startup`, `new`, `clear` et `compact`, jamais dans une session reprise.
9. En tant qu'expérimentateur, je veux distinguer « Knowledge admissible » de « Knowledge injectée », afin de ne pas conclure à une panne quand seul le cycle TE n'a pas abouti.
10. En tant qu'expérimentateur, je veux le détail des Knowledge avant et après chaque Tour — atomiques, composées, révisions, statut de preuve, oubliées — afin de suivre le cycle de vie réel.
11. En tant qu'expérimentateur, je veux les tokens d'entrée, de sortie, le total et le cumul par Tour, afin de situer le coût.
12. En tant qu'expérimentateur, je veux aussi le coût des appels modèle de TE, afin qu'il soit compté dans le total et non caché.
13. En tant qu'expérimentateur, je veux le nombre de lectures et de recherches par Tour, ainsi que les fichiers distincts ouverts, afin de mesurer le travail d'exploration.
14. En tant qu'expérimentateur, je veux repérer les fichiers relus alors qu'une Knowledge injectée les couvrait, afin d'identifier un travail refait malgré la mémoire.
15. En tant qu'expérimentateur, je veux la durée de chaque Tour, afin de compléter le coût par le temps.
16. En tant qu'expérimentateur, je veux juger la qualité de chaque Tour — étapes ancrées, exactitude — afin qu'une baisse de coût obtenue avec un Tour faux ne soit jamais comptée comme un gain.
17. En tant qu'expérimentateur, je veux noter « non disponible » plutôt qu'estimer une métrique absente, afin que le rapport ne contienne aucun chiffre inventé.
18. En tant qu'expérimentateur, je veux que les Tours générés soient **commités** à la fin de chaque bloc, afin que le dossier de lecture soit durable et relisible, comme les Tours déjà présents dans le dépôt.
19. En tant qu'expérimentateur, je veux qu'un Tour écrit pendant un bloc ne soit pas commité avant la fin de ce bloc, afin que l'arbre analysé ne change pas au milieu de la série.
20. En tant qu'expérimentateur, je veux que chaque bloc soit commité dans le dépôt qu'il a analysé — bloc A dans CodeTour, bloc B dans TokenEconomizer — afin que les Tours vivent avec le projet qu'ils expliquent.
21. En tant qu'expérimentateur, je veux qu'aucun fichier de mesure brut (journaux, exports de session) n'entre dans git, afin que les dépôts ne portent que des Tours, pas des sorties de run.
22. En tant qu'expérimentateur, je veux qu'une Knowledge invalidée par une modification de fichier soit constatée une fois par bloc, en fin de bloc, afin de vérifier le contrat de preuve sans polluer les Tours précédents.
23. En tant qu'expérimentateur, je veux pouvoir comparer les deux blocs **à titre descriptif** — même hôte, même modèle, mécanisme identique, dépôts différents — sans en tirer une causalité.
24. En tant que mainteneur, je veux que la campagne utilise les surfaces existantes — `te status`, `te config show`, `te microskills`, le run-state CodeTour — sans nouvel outil, afin qu'elle reste rejouable à la main.
25. En tant que mainteneur, je veux une porte de pré-vol obligatoire par bloc (installation, suites automatisées, panne TE), afin qu'une série qui mesure une panne d'installation soit invalidée avant de produire un rapport.
26. En tant que mainteneur, je veux que la campagne puisse conclure « gain non démontré », afin qu'aucune conclusion ne soit forcée par le protocole.
27. En tant que mainteneur, je veux que tout écart de configuration soit déclaré avant le premier Tour et jamais modifié ensuite, afin qu'aucun état mixte ne rende la campagne inattribuable.
28. En tant que lecteur, je veux **lire les douze Tours produits**, afin de comprendre l'architecture de CodeTour et celle de TokenEconomizer sans les mesurer moi-même.
29. En tant que lecteur, je veux que chaque Tour soit conservé intact sous un nom stable, afin que le chemin réservé d'un Project Tour ne l'écrase pas.
30. En tant que lecteur, je veux un ordre de lecture par dépôt, du format d'un Tour jusqu'à la synthèse, afin que la progression des prompts devienne un parcours et pas une collection.
31. En tant que lecteur, je veux une synthèse d'architecture par dépôt, rédigée à partir des Tours et citant les fichiers, afin d'avoir un document court plutôt que douze fichiers à recoller.
32. En tant que lecteur, je veux que chaque affirmation d'un Tour soit ancrée dans le code qu'il cite, afin de pouvoir vérifier ce que je lis au lieu de le croire.
33. En tant que mainteneur, je veux que les Tours vivent là où CodeTour les écrit normalement, afin qu'aucun réglage ni chemin spécial ne soit inventé pour la campagne.
34. En tant que mainteneur, je veux que la campagne **n'exige aucune modification de CodeTour**, afin de mesurer le produit tel qu'il est et non une variante instrumentée.

## Implementation Decisions

- **Surfaces de mesure, aucun nouvel outillage.** TE expose déjà tout : `te config show` (état du
  flag `knowledge`, seuils), `te status` (sessions repliées, tokens effectifs, surcoût du plugin,
  compteurs de mécanismes), `te microskills` (par Knowledge : identifiant, révision, état du cycle,
  `proof=valid|invalid`, source et session, oubliées), `te repos` (identité de workspace, hôtes,
  sessions). Côté CodeTour, le run-state porte un objet `metrics` (ADR 0042).
- **Deux catalogues, pas un.** L'état TE est isolé par workspace (chemin du dépôt). Le bloc A
  alimente le catalogue CodeTour, le bloc B celui de TokenEconomizer : aucun fait ne traverse, et
  la cadence `microskills_propose_every` = 3 se compte **par dépôt**. Chaque bloc constitue donc
  une fenêtre complète de six sessions, avec deux occasions de proposition au lieu d'une seule
  série de douze.
- **Le bloc B n'est pas un doublon du bloc A.** Les prompts TE portent sur le code du plugin, pas
  sur celui de l'extension : vocabulaire, fichiers et points d'entrée différents, donc aucune
  Knowledge du bloc A ne peut servir au bloc B — c'est le comportement attendu d'un état isolé, et
  le rapport doit le dire plutôt que de le lire comme un échec.
- **La source des tokens dépend de l'hôte.** TE replie le coût de session sur Pi
  (`pi_session_usage`) comme sur Copilot. Le run-state CodeTour, lui, dérive de
  `~/.copilot/session-state/<id>/events.jsonl` : **seul Copilot** fournit les fenêtres
  génération/consolidation, et un flux sans `session.usage_record` produit `observed:false` avec
  motif, à consigner tel quel. Sur Pi, les tokens viennent de TE seul.
- **Un seul hôte pour les deux blocs.** Pi ou Copilot, choisi avant le bloc A et conservé ensuite.
  Ce sont les deux hôtes dont l'adaptateur de preuve est vérifié (lecture complète et fiable). Les
  autres hôtes ne produisent aucune preuve, donc aucune Knowledge : une campagne qui y serait
  lancée mesurerait zéro candidat, pas une absence de gain.
- **Mode d'exécution.** `./launch-local.sh <hôte> --memory=knowledge`, c'est-à-dire
  `TE_KNOWLEDGE=on` et `TE_MICROSKILLS=off`. Le budget d'injection (4 faits, 150 tokens) est alors
  entièrement disponible pour Knowledge : il est calculé en soustrayant le bloc micro-skills, vide
  dans ce mode. Consigner la valeur effective du flag à chaque Tour.
  En mode `config` (défaut), le flag `knowledge` vaut `false` et **aucune** Knowledge n'est
  injectée : lancer ainsi invalide la mesure.
- **Sessions neuves obligatoires.** L'injection Knowledge a lieu au démarrage
  (`startup`/`new`/`clear`/`compact`) ; une session reprise ne la rejoue pas. Reprendre une session
  entre deux Tours invalide la mesure du Tour concerné.
- **État initial consigné, pas réinitialisé.** Les deux dépôts ont déjà un historique de sessions
  (relevé du 2026-11-24 : 138 sessions repliées sur le workspace `codetour`). Le rapport enregistre
  pour chaque bloc, avant son premier Tour : sessions repliées, faits injectés, Knowledge présentes
  et leur statut de preuve. On n'efface rien — effacer changerait le mécanisme observé — mais la
  position dans la cadence doit être connue pour interpréter quand une proposition peut survenir.
- **Une seule configuration, déclarée avant le bloc A.** Défauts recommandés
  (`microskills_propose_every` = 3, `MIN_CITE` = 2). Accepter par avance que la première injection
  puisse n'apparaître qu'au quatrième Tour d'un bloc, ou jamais. Une variante (`propose_every` = 1)
  n'est permise que si elle est déclarée avant le bloc A, consignée, puis conservée pour les douze
  Tours. Aucun changement en cours de campagne, aucun bloc comparatif.
- **Session de calibration par bloc.** Une session unique sans génération de Tour, au début de
  chaque bloc, valide la chaîne de mesure (injection, fichiers de session, remontée des tokens).
  Elle ne compte pas dans les six Tours mais **compte dans la cadence TE** : la consigner.
- **Preuves bornées par l'hôte.** Une preuve exige une lecture complète et fiable ; sous Copilot,
  les fichiers d'au moins 20 KiB et les sessions sans télémétrie adéquate sont rejetés par
  prudence. Consigner les replis (`file` au lieu de `symbol`, ou absence de preuve) et leur motif.
  Les deux dépôts contiennent de gros fichiers : le taux de repli est une donnée de la campagne.
- **Aucune modification de CodeTour.** La campagne se déroule sur le produit tel qu'il est : pas de
  flag, pas de mode de débogage, pas de chemin forcé, pas de réglage `codetour.*` modifié, pas
  d'export imposé. Les Tours sont écrits là où CodeTour les écrit (`<dépôt>/.tours/`), lus par le
  lecteur normal. Si une donnée manque, elle est notée « non disponible » : on ne comble pas un
  trou de mesure en instrumentant le produit.
- **Versionnement des Tours.** Les fichiers `.tour` sont des artefacts du produit et se versionnent :
  le dépôt CodeTour en contient déjà sept dans `.tours/`, et seuls `.tours/.log/` et
  `.tours/config.json` sont ignorés. Chaque bloc commité à sa fin, **dans le dépôt qu'il a analysé** :
  bloc A dans `codetour/.tours/`, bloc B dans `TokenEconomizer/.tours/` (le dépôt TokenEconomizer
  n'en contient aucun aujourd'hui ; le dossier est créé par le premier Tour du bloc).
  Ordre des commits, selon `AGENTS.md` du workspace : TokenEconomizer d'abord (poussé sur
  `maurice30120/TokenEconomizer`, jamais ailleurs), puis le parent qui enregistre le pointeur de
  sous-module avec les Tours du bloc A. Ce qui reste hors de git : les journaux, exports de session
  et tableaux de mesure bruts — la règle « pas de sorties de run dans le dépôt » s'applique à eux,
  pas aux Tours. Si le lecteur écrit des journaux locaux dans `.tours/.log/`, cette ligne rejoint
  le `.gitignore` de TokenEconomizer avant le bloc B, comme elle existe déjà dans CodeTour.
- **Anti-pollution, sans quarantaine.** Le commit analysé est figé par bloc (SHA consigné) : les
  Tours commités **après** le bloc sont hors du jeu analysé, donc ils ne peuvent pas servir de
  source aux Tours de ce bloc. Pendant un bloc, on ne commit rien, afin que l'arbre ne change pas
  en cours de série. Les Tours déjà présents dans `.tours/` au départ sont listés dans l'état
  initial : ce sont des sources réelles du dépôt, pas une pollution.
- **Fidélité des métriques.** Une métrique inaccessible est écrite « non disponible » avec sa
  raison. Aucune extrapolation, aucune moyenne inventée, aucun arrondi présenté comme mesure.

## Livrables de compréhension

La campagne produit quatre artefacts, en plus du rapport de mesures :

1. **Douze Tours versionnés**, un par prompt, rangés par bloc et numérotés (`CT1`…`CT6`, `TE1`…`TE6`) :
   bloc A dans `codetour/.tours/`, bloc B dans `TokenEconomizer/.tours/`. Le nom de fichier est
   stable dès la génération, parce que le chemin réservé d'un Project Tour peut être réécrit au Tour
   suivant.
2. **Un parcours de lecture par bloc** (`PARCOURS.md`) : l'ordre des Tours, la question à laquelle
   chacun répond, et le composant qu'il fait découvrir.
3. **Une synthèse d'architecture par bloc** (`ARCHITECTURE-CODETOUR.md`,
   `ARCHITECTURE-TOKENECONOMIZER.md`) : quelques pages, rédigées **à partir des Tours**, avec les
   fichiers et lignes cités. Elle ne remplace pas les Tours : elle dit comment les lire.
4. **Une grille de qualité par Tour**, notée sur quatre axes, chacun vérifiable :

| Axe | Ce qui est noté | Vérification |
| --- | --- | --- |
| Couverture | les composants que le prompt demandait sont présents | relecture du prompt, un par un |
| Ancrage | chaque étape pointe un fichier et une ligne réels | ouverture de chaque ancre |
| Justesse | aucune affirmation que le code cité ne soutient | lecture du code de l'étape |
| Lisibilité | titres, ordre, un diagramme quand un flux est décrit | lecture seule du Tour |

Une note `KO` sur **Justesse** invalide le Tour comme livrable, quel que soit son coût. Une note
`KO` sur **Ancrage** ou **Couverture** le déclare incomplet et le rapport doit le dire.

Les artefacts bruts de mesure — journaux de session, tableaux, exports — ne sont **pas versionnés**.
La synthèse et le parcours sont rédigés en dehors des sources figées : un document sur le dépôt,
écrit dans le dépôt, serait la première chose que le Tour suivant lirait.

## Mesures consignées par Tour

Un tableau de **douze lignes** (CT1–CT6, TE1–TE6), avec un sous-total par bloc et un cumul général :

| Colonne | Source |
| --- | --- |
| tokens entrée / sortie / total, cumul | `te status`, run-state `metrics` (Copilot) |
| coût des appels modèle de TE | `te status` (surcoût du plugin), run-state |
| durée | horodatage de session |
| lectures, recherches, fichiers distincts | journal de session de l'hôte |
| fichiers relus couverts par une Knowledge injectée | rapprochement journal ↔ `te microskills` |
| Knowledge avant / après (atomiques, composées, révisions) | `te microskills` |
| Knowledge admissibles / injectées (identifiants) | `te microskills`, notification d'injection |
| Knowledge refusées ou invalidées + motif | `te microskills` (`proof=invalid`, repli) |
| `append` / `replace` effectués | `te microskills` (révisions) |
| couverture / ancrage / justesse / lisibilité | grille de qualité, quatre axes |

## Testing Decisions

- **La campagne est le test.** Ses critères sont observables : douze Tours, six par bloc, dans
  l'ordre, un seul hôte, un catalogue par bloc conservé, mesures présentes par Tour.
- **Porte de pré-vol obligatoire, au début de chaque bloc.** Installation locale,
  `npm run check:fast`, `npm test` sur CodeTour, suite pytest de TE **avec l'interpréteur du venv**
  (le Python système échoue en faux négatif faute de `tree_sitter_language_pack`), `te status` sain
  sur le dépôt du bloc, et le test de panne : lancer une session avec TE cassé et vérifier qu'une
  génération de Tour aboutit quand même. Un bloc commencé sans cette porte est déclaré invalide.
- **Contrôle de la chaîne de mesure** par la session de calibration de chaque bloc : sans injection
  ni tokens visibles, le bloc ne peut pas mesurer la mémoire.
- **Évaluation du livrable, à chaque Tour.** Les quatre axes de la grille sont notés juste après la
  génération, avant le Tour suivant : un Tour `KO` de justesse est rejoué une fois et le rejeu est
  consigné, afin que le dossier de lecture ne contienne aucune explication fausse.
- **Vérification du contrat de preuve, une fois par bloc, en fin de bloc** : modifier un fichier
  attesté hors session, relancer une session de contrôle, constater que la Knowledge concernée est
  exclue et que la session démarre normalement, puis restaurer les octets exacts et constater son
  retour, sans contourner le cycle TE.
- **Analyse finale** : tableau des douze Tours ; chronologie des Knowledge et de leurs
  réutilisations, bloc par bloc ; Tour auquel une synthèse transversale apparaît (s'il y en a une) ;
  coût apparent de la réutilisation — tokens injectés plus coût de création et de maintenance —
  rapporté au travail évité, en borne basse et seulement si la réutilisation est mesurable. Sinon :
  « gain non démontré ».
- **Comparaison inter-blocs purement descriptive.** Même hôte, même modèle, même mécanisme, dépôts
  et prompts différents : un écart entre les blocs ne prouve rien et ne doit pas être présenté comme
  une mesure d'effet.
- **Aucune attribution automatique** : une baisse de coût n'est attribuée à Knowledge que si la
  réutilisation est constatée (une Knowledge injectée couvrant un fichier qui n'a pas été relu) ;
  les douze prompts de périmètres différents sont rappelés comme limite dans le rapport.

## Critères d'acceptation

- [ ] Porte de pré-vol passée et consignée pour les deux blocs.
- [ ] Exactement douze Tours générés : CT1–CT6 sur `codetour/`, puis TE1–TE6 sur `TokenEconomizer/`,
      avec les douze prompts ci-dessus, dans l'ordre.
- [ ] Un seul hôte pour toute la campagne ; commit figé par bloc ; même modèle ; même configuration.
- [ ] Un catalogue par bloc, conservé à l'intérieur du bloc ; aucune injection manuelle ; aucun
      forçage de `create`, `append` ou `replace` ; état initial consigné avant chaque bloc.
- [ ] Douze sessions neuves, aucune reprise entre deux Tours.
- [ ] Tableau de douze lignes complet, sous-totaux par bloc, cumul général ; « non disponible »
      partout où la donnée manque.
- [ ] Chronologie du catalogue et statut de preuve de chaque Knowledge à chaque Tour, bloc par bloc.
- [ ] Qualité de chaque Tour notée sur les quatre axes (couverture, ancrage, justesse, lisibilité),
      un `KO` de justesse invalidant le Tour comme livrable.
- [ ] Douze Tours commités à la fin de leur bloc, chacun dans son dépôt (`codetour/.tours/`,
      `TokenEconomizer/.tours/`), aucun écrasé par le Tour suivant.
- [ ] Ordre des commits respecté : TokenEconomizer avant le parent qui porte les Tours du bloc A.
- [ ] **Aucune modification de CodeTour** : aucun fichier produit hors des douze `.tour`, aucun
      réglage `codetour.*` changé, aucun chemin forcé, aucun mode de débogage.
- [ ] Aucun journal, export de session ni tableau de mesure commité.
- [ ] Un `PARCOURS.md` et une synthèse d'architecture par bloc, rédigés hors des sources figées.
- [ ] Test de fin de bloc sur une preuve invalidée puis restaurée, deux fois (un par bloc).
- [ ] Conclusion critique : réutilisation observée ou non, gain démontré ou non, absence de
      transfert entre blocs expliquée, limites de l'expérience explicitement citées.
- [ ] Conclusion sur le livrable : ce que les douze Tours permettent de comprendre des deux projets,
      et ce qu'ils laissent de côté.

## Out of Scope

- Seconde campagne, comparatif mémoire activée / désactivée, ou toute forme d'A/B automatique.
- Troisième bloc, autre dépôt, ou prompts supplémentaires au-delà des douze.
- Knowledge multiniveaux, composition récursive, refonte du contrat de preuve.
- Nouvel outil de mesure, nouveau harness, nouvelle interface MCP ou CLI.
- Modification des seuils, de la cadence ou des règles de validation de TE pendant la campagne.
- Réintroduction de la mémoire dans CodeTour, import des anciennes connaissances CodeTour.
- Publication upstream des changements TE ; lien de dépendance avec d'autres issues.

## Further Notes

- **#299 est remplacée, pas complétée** : à fermer avec un renvoi vers cette spec, parce que ses
  surfaces ont disparu avec #304. Le label `ready-to-grill` qu'elle porte ne fait pas partie des
  cinq labels de `docs/agents/triage-labels.md`, à traiter séparément.
- Le prompt CT6 est le seul réécrit du bloc A : l'original demandait comment « le moteur Knowledge »
  coopère avec l'extension, le CLI et le MCP — un composant qui n'existe plus.
- Le bloc B est la partie la plus informative pour la question posée : ses prompts portent sur le
  code qui **implémente** la mémoire, donc les fichiers attestés y sont plus souvent lus en entier
  et les preuves plus souvent valides. Un bloc B sans Knowledge dirait quelque chose du mécanisme,
  pas seulement du dépôt.
- Les douze Tours sont versionnés à la fin de leur bloc, chacun dans le dépôt qu'il explique :
  `codetour/.tours/` en porte déjà sept, `TokenEconomizer/.tours/` est créé par le bloc B. Les
  journaux, exports et tableaux de mesure bruts ne sont pas versionnés.
- La campagne ne demande aucune évolution de CodeTour : elle se joue sur le produit tel qu'il est,
  avec ses chemins par défaut (`<dépôt>/.tours/`). Toute instrumentation ajoutée fausserait la
  question posée.
- Le dossier de lecture est le second livrable, pas un effet de bord : les prompts sont ordonnés
  comme un parcours (format → cycle de vie → intégration → flux → synthèse) et le dernier Tour de
  chaque bloc est une table des matières. Si un Tour est jugé faux, il est rejoué une fois et le
  rejeu est consigné : le livrable ne peut pas contenir un Tour `KO` de justesse.
- Limite assumée : douze sessions sur deux dépôts ne démontrent pas une économie généralisable.
  Cette campagne démontre si la réutilisation a lieu et si elle évite du travail ; une campagne de
  mesure de coût à plus grande échelle relèverait d'une autre spec.
