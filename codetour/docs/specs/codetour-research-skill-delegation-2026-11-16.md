# Spec — Skill de délégation de recherche CodeTour dans Copilot

> **Statut :** spécification validée oralement le 16 novembre 2026 ; implémentation et essais **non réalisés** par cette publication.  
> **Origine :** décisions de conception de la session CodeTour, synthétisées selon `to-spec`.  
> **Références :** #172 (mémoire procédurale), #183 (diagnostic création/réutilisation), #194 (sélection/consolidation), #174 (benchmark officiel séparé).

## Branche de départ de l'implémentation

- **Dépôt :** `maurice30120/codetour`.
- **Branche existante obligatoire :** `spec-174-integration`. Ne **pas** repartir de `main`, créer automatiquement une branche concurrente ni figer un ancien SHA.
- **HEAD observé lors de la rédaction :** `5e9b0ea681e68a6a6e8faa34e61d0aa92b3d7fb5`, repère historique **non figé**. L'implémenteur reprend **le HEAD distant le plus récent** de `origin/spec-174-integration`.
- Vérifier branche, statut et HEAD ; préserver les changements locaux non commités ; utiliser une mise à jour non destructive et signaler toute divergence.
- La version Markdown de cette spec est un instantané versionné ; **cette issue est la source de vérité**.

## Tâche préalable obligatoire — nettoyage documentaire (#204)

- **Première tâche à exécuter avant toute implémentation de cette spec :** [#204 — Nettoyer les documents obsolètes du dépôt](https://github.com/maurice30120/codetour/issues/204).
- Nettoyage par familles : brouillons, rapports de tests/benchmarks désuets, copies de specs/tickets déjà sur GitHub, documentation obsolète.
- **Protections absolues :** documents antérieurs au POC du harnais de recherche/mémoire procédurale (14 novembre 2026, ancienneté à vérifier dans Git), README, ADR et fichiers nécessaires aux outils. En cas de doute, conserver.
- Aucun nettoyage ne doit effacer des exigences actives ou des preuves indispensables ; vérifier les références avant suppression.

## Problem Statement

La génération de Project Tours se fait aujourd'hui par l'agent appelant (par exemple Copilot), qui explore directement le dépôt puis appelle le serveur MCP CodeTour pour valider et enregistrer le Tour. En parallèle, le POC d'exploration CodeTour utilise un LLM, des procédures TypeScript réutilisables, une sandbox et une mémoire persistante ; il n'est pas intégré au parcours de génération réel.

Même si des fonctions sont créées ou réutilisées dans le POC, Copilot peut continuer d'effectuer l'essentiel des recherches avec ses propres outils. Le Tour résultant peut être correct, mais les recherches ne capitalisent pas sur le travail des Tours précédents. À l'inverse, demander à Copilot de manipuler directement les primitives, `memory_run` ou `function_try` l'obligerait à comprendre le protocole interne et dupliquerait ses responsabilités.

Le besoin utilisateur est de **conserver la même mémoire de recherche entre Tours et agents**, sans imposer à Copilot, Codex ou un autre agent le même raisonnement. L'agent appelant doit rester maître de la décomposition et de la construction du Tour ; le harnais doit optimiser la résolution des questions qui lui sont confiées.

## Solution

Introduire un **Agent Skill `codetour-research`**, invoqué **explicitement** dans Copilot pour ce premier POC. Le skill enseigne une méthode simple : comprendre la demande de Tour, la découper en **questions fonctionnelles atomiques et indépendantes**, déléguer l'exploration de chacune au **harnais CodeTour existant**, puis synthétiser les réponses sourcées et appeler le **MCP de génération existant** pour valider et produire un vrai fichier `.tour`.

Copilot n'a pas à connaître les mécanismes de mémoire. Le harnais conserve son propre LLM, son choix de fonctions existantes ou nouvelles, les validations, la consolidation et le catalogue persistant. Le skill peut orienter la façon de formuler les questions mais **ne réimplémente ni les primitives ni la logique mémoire**.

Le test porte sur **une invocation explicite du skill** et **deux Tours successifs** partageant une mémoire, avec une revue dans VS Code. Il **n'inclut pas** de test d'activation spontanée/automatique du skill, explicitement retiré du périmètre après la discussion.

Le résultat recherché est une **délégation effective et une capitalisation vérifiable**, non simplement un Tour visuellement réussi.

## User Stories

1. En tant qu'utilisateur de CodeTour, je veux invoquer explicitement le skill dans Copilot, depuis n'importe quel projet ouvert sur ma machine, afin d'essayer le parcours sans modifier le comportement général de Copilot.
2. En tant qu'auteur de Tour, je veux que Copilot conserve la compréhension de mon objectif global, afin que le Tour réponde réellement à ma demande.
3. En tant qu'auteur de Tour, je veux que Copilot découpe la recherche en questions fonctionnelles autonomes, afin que chaque délégation ait un périmètre compréhensible.
4. En tant qu'auteur de Tour, je veux éviter les questions artificiellement minuscules ou interdépendantes, afin de ne pas multiplier les appels inutiles.
5. En tant qu'utilisateur, je veux que l'agent confie prioritairement les recherches de code au harnais, afin d'exploiter la mémoire accumulée.
6. En tant qu'auteur de Tour, je veux pouvoir vérifier directement un extrait précis lorsque nécessaire, afin de ne pas transformer le skill en interdiction de lecture.
7. En tant qu'utilisateur, je veux que la consultation, la création et la réutilisation des fonctions restent invisibles à l'agent appelant, afin de ne pas coupler le skill au protocole interne de mémoire.
8. En tant qu'agent appelant, je veux recevoir pour chaque question une réponse structurée, un statut, des références et des incertitudes, afin de pouvoir raisonner sans inventer de preuves.
9. En tant qu'agent appelant, je veux distinguer les réponses complètes, partielles et échouées, afin de ne pas considérer une exploration interrompue comme exhaustive.
10. En tant qu'agent appelant, je veux pouvoir reformuler une question ou demander un complément justifié, afin de résoudre les lacunes sans recommencer toute la recherche.
11. En tant qu'utilisateur, je veux que les réponses déjà suffisantes ne soient pas recherchées une seconde fois, afin de réduire la redondance.
12. En tant qu'utilisateur, je veux que plusieurs recherches successives utilisent une mémoire persistante commune au même dépôt, afin de capitaliser au fil des Tours.
13. En tant qu'utilisateur, je veux qu'une fonction créée pendant un Tour A puisse être exécutée pendant un Tour B distinct, afin de constater une réutilisation réelle.
14. En tant qu'utilisateur, je veux que l'identité de la fonction, son exécution et sa validation soient traçables, afin de distinguer l'apprentissage d'une simple tentative.
15. En tant qu'auteur de Tour, je veux que Copilot synthétise les relations globales à partir des réponses atomiques, afin de produire un Tour cohérent plutôt qu'une juxtaposition de réponses.
16. En tant qu'auteur de Tour, je veux utiliser les outils MCP CodeTour existants pour valider le résultat, afin de conserver les garanties actuelles des ancres, des diagrammes et de la persistance.
17. En tant qu'utilisateur, je veux ouvrir et parcourir un vrai fichier `.tour` dans VS Code, afin de juger le résultat dans le produit.
18. En tant qu'analyste, je veux rattacher chaque question déléguée à son run, aux fonctions utilisées et au Tour, afin de diagnostiquer le parcours complet.
19. En tant qu'analyste, je veux distinguer les lectures directes de Copilot des appels de recherche délégués, afin de détecter le contournement du harnais.
20. En tant qu'analyste, je veux conserver les traces de refus, de sélection, de réutilisation et leurs raisons lorsqu'elles existent, afin d'évaluer la valeur réelle de la mémoire sans inventer de motifs manquants.
21. En tant qu'analyste, je veux voir les tokens, la durée et les limites de télémétrie réellement observées, afin de discuter du coût sans annoncer de gains non démontrés.
22. En tant qu'utilisateur, je veux qu'une génération sans délégation effective soit marquée comme un échec d'intégration même si le Tour est joli, afin de tester la bonne hypothèse.
23. En tant qu'implémenteur, je veux utiliser les interfaces existantes du harnais et du MCP, afin de réduire la surface de modification et les risques de régression.
24. En tant qu'implémenteur, je veux une erreur explicite si le skill ne peut pas lancer le harnais ou si l'accès à l'outil terminal est refusé, afin d'éviter toute simulation de réussite.
25. En tant qu'utilisateur, je veux que la mémoire et les traces ne divulguent pas de clés API, afin de préserver les secrets du poste.

## Implementation Decisions

### Responsabilités

- **Agent appelant :** compréhension du Tour, décomposition des besoins, formulation des questions, orchestration des demandes, synthèse et rédaction finale.
- **Skill :** instructions de formulation et de délégation des questions au harnais ; protocole d'exploitation des résultats ; aucune gestion directe des fonctions mémorisées.
- **Harnais existant :** exploration d'une question, LLM de recherche, primitives, mémoire, `function_try`, sandbox, validation, consolidation, télémétrie. Il peut encore redécomposer la question à l'intérieur : **ce chevauchement est accepté et observé pendant le POC**, pas refactorisé d'emblée.
- **MCP existant :** les outils `create_project_tour` / `create_changes_tour` restent responsables de la validation et de la persistance du fichier Tour. Aucune génération cachée dans le harnais.

### Stockage de la mémoire procédurale dans le dépôt

- **Chemin canonique obligatoire :** `<racine-du-dépôt-cible>/.codetour/.memory/`. Le nom du sous-dossier est exactement **`.memory`**, avec un point initial, à l'intérieur de **`.codetour`**.
- **Contenu :** toutes les **fonctions mémorisées et persistées** par le harnais ainsi que le catalogue et les métadonnées nécessaires à leur redécouverte/exécution doivent résider sous ce chemin. Les fonctions mémorisées sont conservées comme **sources TypeScript lisibles (`.ts`)**, et non uniquement comme JavaScript compilé ou blobs opaques. Le format du catalogue et des métadonnées reste celui du harnais, sauf adaptation indispensable à la localisation et à la documentation.
- **Métadonnées obligatoires par fonction :** chaque procédure TypeScript persistée possède une **fiche de métadonnées identifiée et structurée dans le catalogue existant** (identifiant, nom, question canonique, description/périmètre, paramètres typés, contrat de sortie, limites/incertitudes, version/révision, statut ou traces de validation et exemple lorsque disponible), selon les champs déjà définis en #172. Cette fiche est la **source unique** de la documentation : ne pas régénérer une description concurrente ni introduire un second catalogue.
- **Documentation visible dans le `.ts` :** lors de la persistance de chaque fonction, reprendre **fidèlement** les champs descriptifs de sa fiche de catalogue dans un bloc JSDoc associé à la fonction dans `.codetour/.memory/functions/*.ts`, avec un nom clair en `camelCase`. La fiche du catalogue et ce commentaire du fichier doivent rester **synchronisés** lors d'une création, modification ou remplacement. La source TypeScript validée reste consultable ; le JavaScript compilé n'est pas le document de référence.
- **Organisation :** fichiers `.ts` individuels pour les fonctions persistées, idéalement dans `.codetour/.memory/functions/` conformément à la structure déjà envisagée dans #172, avec catalogue voisin dans `.codetour/.memory/`. Ne pas imposer de refonte du mécanisme de stockage, ni de format JSDoc propriétaire.
- **Portée :** mémoire propre au dépôt analysé, résolue depuis sa racine et non depuis le répertoire de lancement de Copilot. Les questions du Tour A et du Tour B doivent lire et écrire le **même** catalogue à ce chemin ; ne pas vider la mémoire entre les deux Tours.
- **Source unique :** aucune seconde mémoire parallèle en `.codetour/memory/`, dans un dossier temporaire ou dans un répertoire externe ne doit servir silencieusement de catalogue pour ce parcours. La nouvelle règle remplace explicitement l'exemple de chemin `.codetour/memory/` indiqué dans la spec historique #172 ; adapter le paramétrage ou traiter une éventuelle migration de manière explicite et non destructive.
- **Intégration minimale :** privilégier le paramètre de répertoire mémoire du CLI existant. Si le harnais ne sait pas utiliser ce chemin, documenter le blocage et limiter toute adaptation au raccordement/configuration du stockage, sans refondre le moteur de recherche, la consolidation ni le MCP. Ne jamais annoncer une persistance réussie en cas d'écriture ailleurs.
- **Contrôle :** le test A doit vérifier la présence réelle des fonctions validées et du catalogue sous `.codetour/.memory/`. Le test B doit démontrer la relecture et l'exécution d'une même fonction depuis ce répertoire après une nouvelle invocation ; les traces doivent renseigner le chemin effectivement utilisé. Ne pas présumer de la politique de versionnement Git de ce dossier : à décider séparément.

### Activation exclusivement manuelle du skill dans GitHub Copilot

- **Exigence fonctionnelle :** le skill `codetour-research` est disponible **uniquement à l'invocation explicite de l'utilisateur** dans Copilot Chat. Une demande ordinaire de génération de Tour ne doit pas le charger automatiquement ; le parcours standard Copilot + MCP doit rester utilisable sans ce skill et sans mémoire procédurale déléguée.
- **Configuration obligatoire dans le frontmatter YAML de `SKILL.md`** (et non une simple phrase dans la description ou le corps du skill) :

```yaml
---
name: codetour-research
description: Recherche de code déléguée au harnais CodeTour avec mémoire procédurale pour générer un Tour.
user-invocable: true
disable-model-invocation: true
---
```

- **Invocation attendue dans VS Code Copilot Chat :** l'utilisateur saisit `/codetour-research` (ou le sélectionne dans le menu `/`) puis ajoute sa demande de Tour. Les propriétés sont documentées dans [VS Code — Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills). `user-invocable: true` rend la commande visible et `disable-model-invocation: true` empêche le chargement spontané par le modèle.
- **Contrôle avant test :** sur la version cible de VS Code / Copilot, vérifier dans une nouvelle session que le skill apparaît sous `/` et qu'une invocation explicite charge ses instructions. Ne pas considérer la présence dans le menu comme une preuve de bon fonctionnement ; consigner la version et tout comportement divergent. **Ne pas réintroduire un scénario d'activation spontanée automatique** dans cette campagne.

### Installation utilisateur et exécution multi-projets

- **Exigence impérative :** sur une machine où CodeTour est installé, l'utilisateur doit pouvoir ouvrir **n'importe quel projet local dans VS Code** et lancer `/codetour-research` sans cloner le dépôt source de CodeTour dans ce projet, sans y copier le harnais, sans exécuter `npm install` pour le harnais dans chaque projet et sans configuration manuelle projet par projet.
- **Skill disponible globalement :** pour Copilot, le skill personnel peut être installé dans `~/.copilot/skills/codetour-research/SKILL.md` ; une distribution par l'extension CodeTour via `contributes.chatSkills` est également envisageable pour garantir une disponibilité après installation de l'extension. Choisir **un mode canonique de distribution** et vérifier sa découverte dans plusieurs workspaces. Le skill reste à invocation uniquement manuelle.
- **Harnais partagé, hors des projets analysés :** le CLI/runtime de recherche CodeTour doit être installé **une seule fois** via le mécanisme de distribution retenu (par exemple embarqué/accessible depuis l'extension, ou exécutable installé au niveau utilisateur). Le skill doit pouvoir le trouver par un chemin stable/configurable, **sans dépendre de son propre répertoire de développement**. Ne pas supposer que le CLI expérimental actuel est déjà distribuable de cette façon : le vérifier à l'implémentation et documenter les dépendances/installations nécessaires.
- **Séparation stricte des emplacements :** dans chaque projet, seule la donnée liée au projet, dont `<racine-du-projet>/.codetour/.memory/`, est créée ou lue. Ni le code du harnais ni le skill personnel ne sont copiés sous `.codetour/`.
- **Ciblage du workspace :** le lanceur transmet explicitement le chemin absolu du projet ouvert comme workspace cible et résout la mémoire depuis **cette racine**, indépendamment du répertoire courant du processus ou de l'endroit où est installé le harnais. Pour un workspace multi-racines, sélectionner explicitement la racine cible ; si elle est ambiguë, demander une sélection ou échouer clairement plutôt que d'écrire dans le mauvais projet. N'accepter aucun accès hors du workspace ciblé sauf ressources de runtime nécessaires et autorisées.
- **Absence de dépendance au dépôt source CodeTour :** un projet sans sous-dossier CodeTour préexistant doit fonctionner après initialisation sûre de `.codetour/.memory/`, sans présupposer la présence du monorepo de développement.
- **Préflight et erreurs :** vérifier que l'exécutable du harnais et ses dépendances sont réellement disponibles depuis un projet tiers, que le skill peut le lancer, et que la mémoire choisie est accessible en écriture ; sinon afficher une erreur exploitable, jamais une simulation de réussite.

### Parcours utilisateur et interfaces

- Une **invocation explicite** de `codetour-research` sous Copilot démarre un parcours réel de génération de **Project Tour**. Une compatibilité conceptuelle avec Changes Tour peut être mentionnée, mais le scénario obligatoire initial porte sur Project Tour.
- Copilot produit un plan bref de questions atomiques utiles ; ne pas imposer un nombre arbitraire de questions ni une question par fichier.
- Pour chaque question nécessitant une investigation, le skill demande un appel au **CLI existant du harnais en Code Mode avec mémoire activée**, utilisant le dépôt cible, la question et le même répertoire de mémoire persistant. Les appels sont **séquentiels** : le catalogue expérimental ne garantit pas des écritures concurrentes.
- Un **adaptateur de lancement minimal**, uniquement si utile pour l'ergonomie du skill, peut fournir des arguments sûrs, une sortie JSON exploitable et des journaux bruts. Il ne contient aucune logique de recherche ou de sélection et n'ajoute pas de deuxième LLM.
- Les sorties acceptées comprennent : statut, résultats structurés, preuves, incertitudes, identité du run et métriques. Une sortie partielle/échouée ne peut être silencieusement promue en preuve complète.
- Les lectures directes de Copilot sont permises pour des vérifications ponctuelles ; leur présence doit être visible. Une recherche de fond principalement exécutée hors harnais **fait échouer le critère de délégation**.
- Copilot assemble les réponses en conservant les relations et incertitudes, puis utilise le MCP existant (la validation précède l’écriture) ; il ne prétend pas qu'un Tour existe avant confirmation de l'écriture.
- **Mémoire :** catalogue persistant situé exclusivement sous `<racine-du-dépôt-cible>/.codetour/.memory/`, commun aux recherches et aux deux Tours du même checkout ; vide au démarrage de l'expérience de création ; jamais réinitialisé entre Tour A et B. Isoler des essais ultérieurs pour ne pas confondre ancienne mémoire et apprentissage du test.
- **Langue :** instructions internes et contrats conformes aux conventions du dépôt ; le Tour et ses descriptions restent dans la langue demandée par l'utilisateur.
- **Sécurité :** workspace confiné, pas de secrets dans les traces ni dans le dépôt, échec explicite si la clé modèle, les dépendances ou les autorisations de lancement sont absentes.

### Observabilité et limites

- Réutiliser les `callTrace`, rapports de consolidation et métriques du harnais ; ne pas reconstruire la télémétrie interne.
- Prévoir une corrélation légère `tour_id` → `question_id` → `run_id` → fonctions créées/réutilisées, via un manifeste de test si nécessaire. Ne pas modifier le modèle de mémoire uniquement pour la télémétrie du skill.
- Les appels directs de Copilot **ne sont pas visibles au harnais**. Leur quantification dépend de l'historique des outils de l'agent et peut demander une revue manuelle. **Si ces traces sont indisponibles : résultat « non mesurable », pas « 0 recherche directe ».**
- Un rejet de consolidation par le LLM ne doit pas être présenté comme une erreur de validation déterministe ; rapporter le motif réellement observé ou son absence.
- Une citation structurellement valide prouve l'existence d'une ligne, **pas** la justesse sémantique de l'explication.
- Le coût du POC comprend les appels du **LLM du harnais et ceux de Copilot**, si observables ; lorsqu'une source de compteurs manque, aucune somme totale ni économie non fondée.

### Séquencement et contraintes

- Commencer par un contrôle des dépendances et du CLI ; les échecs CI connus, notamment la dépendance QuickJS manquante dans certains runners, doivent être signalés et corrigés séparément si bloquants, sans confondre ce défaut d'environnement avec un échec du mécanisme mémoire.
- **Ne pas modifier la logique du harnais ni le MCP pour ce premier POC** ; si le CLI actuel se révèle insuffisant, limiter le changement à un adaptateur externe minimal (ou, uniquement si indispensable pour respecter `.codetour/.memory/`, à un raccordement de configuration du chemin mémoire), et documenter explicitement la déviation.
- Ne pas rendre obligatoires les tests d'activation automatique ou la restriction des outils natifs de Copilot. Réaliser la comparaison pratique du **même Tour sans et avec invocation manuelle du skill** décrite dans les Testing Decisions, sans la confondre avec un benchmark A/B officiel.
- Garder les décisions de tuning du skill séparées des critères de succès ; enregistrer la version du skill utilisé.

## Testing Decisions

### Seam principal retenu

Tester **le parcours utilisateur existant au plus haut niveau** : invocation explicite du skill dans Copilot → appels effectifs au CLI CodeTour → génération et validation par le MCP existant → ouverture du vrai Tour VS Code. Réutiliser les tests d'intégration MCP et les tests multi-Tours du POC comme références, **mais ne pas les substituer à l'essai réel**.

### Préflight

- Confirmer la branche et la révision du checkout cible, la version du skill, le modèle effectif, les dépendances du harnais (dont QuickJS), la disponibilité de l'outil terminal et du MCP.
- Vérifier qu'un appel réel du harnais retourne un JSON décodable ; ne pas écrire de Tour en cas d'échec du préflight.
- Établir une mémoire vide pour le Tour A sous `.codetour/.memory/` à la racine du dépôt cible, et des fichiers de trace séparés. Vérifier le chemin réellement utilisé par les deux exécutions, sans dépendre du répertoire courant.

### Comparaison contrôlée du même Tour, sans et avec le skill

- **But utilisateur :** permettre de demander **le même Project Tour**, sur **le même dépôt et la même révision**, en deux sessions Copilot distinctes :
  - **Sans skill** : invocation standard de Copilot + MCP CodeTour, sans charger `codetour-research` ni appeler volontairement le harnais mémoire.
  - **Avec skill** : invocation manuelle `/codetour-research` ; recherche déléguée au harnais utilisant `.codetour/.memory/`, puis validation/génération avec le même MCP.
- Employer le **même prompt métier**, le même périmètre, le même modèle Copilot si contrôlable et des fichiers de sortie séparés pour ne pas écraser le premier Tour. Consigner les différences de configuration et la révision du skill. La mémoire doit être **isolée ou explicitement initialisée** pour éviter toute contamination par des essais précédents.
- Comparer **qualité des étapes, preuves et ancres, appels réels, latence et tokens effectivement disponibles**. Marquer les mesures indisponibles comme telles. **Ne pas attribuer automatiquement les écarts à la mémoire seule** : le skill change aussi l'orchestration et délègue à un harnais distinct.
- Cette comparaison pratique **complète** les tests A et B de création/réutilisation entre deux Tours distincts, **sans remplacer le test B** et sans devenir le benchmark officiel #174 ni un engagement de gain de tokens.

### Test A — Tour réel avec skill explicitement invoqué

- Demander à Copilot un Project Tour concret sur un dépôt réel et figé à une révision.
- Vérifier dans les traces de Copilot **quelles questions sont formulées** et **quels appels au harnais ont réellement eu lieu**.
- Examiner les recherches directes effectuées par Copilot, les lacunes de preuves et l'éventuelle redondance.
- Exiger un appel réussi du MCP de génération, un fichier Tour valide, des ancres contrôlables et une revue manuelle des liens et explications dans VS Code.
- **Échec d'intégration si l'essentiel des recherches est réalisé directement par Copilot** sans délégation, même si le Tour est correct.

### Test B — Réutilisation avec le même catalogue

- Générer un second Project Tour **distinct**, avec des questions partiellement communes mais un objectif différent, sans vider la mémoire.
- Identifier une procédure **nouvellement créée, exécutée, validée et persistée** pendant le Tour A.
- Vérifier un appel effectif à **la même fonction via `memory_run` pendant le Tour B**, avec des paramètres réels, un résultat exploitable et des références vérifiables.
- Ne pas compter les primitives préchargées, la simple présence au catalogue, un `function_try` ou une réutilisation non exécutée comme preuve d'apprentissage.
- Documenter honnêtement si aucune création/réutilisation nouvelle n'est observée ; la réussite de génération et la réussite de mémoire sont deux verdicts distincts.

### Rapport de test

Fournir les SHA et versions, l'identité des deux Tours, questions, appels effectivement effectués, fichiers `.tour`, statuts de preuve, créations/consolidations/réutilisations, recherches directes observées, tokens connus/inconnus, anomalies, limites et verdicts séparés **délégation / apprentissage / qualité**. Ne pas déclarer de gain financier sur ce seul essai.

## Out of Scope

- Test où l'utilisateur demande un Tour sans invoquer explicitement le skill ; **activation automatique retirée explicitement de cette campagne**.
- Nouveau MCP ou nouveau protocole RPC ; refonte des outils MCP existants.
- Transformation du harnais en simple moteur de primitives ; ajout d'un mode guidé ; déplacement du LLM de recherche dans Copilot.
- Refonte de la consolidation, déduplication sémantique, purge, remplacement et partage de mémoire multi-machine.
- Suppression ou interdiction des outils natifs de Copilot ; prétendre que le skill impose une délégation à 100 %.
- Campagne comparative Vibe / benchmark officiel #174, preuve de rentabilité ou économies de tokens déclarées sur un seul test. La comparaison ciblée du même Tour avec/sans skill reste, elle, dans le périmètre.
- Génération automatique du skill depuis des prompts, modification non demandée de l'extension ou exécution du POC au moment de publier cette spec.

## Further Notes

- **Décision finale :** un **skill souple** incite l'agent à poser de bonnes questions atomiques et à déléguer ses recherches ; **l'agent appelant garde son raisonnement**, **le harnais garde la mémoire et son intelligence d'exécution**, **le MCP garde la validation du Tour**.
- **Critère fondamental :** « Tour réussi » ne signifie pas « capitalisation réussie ». Une délégation principalement contournée échoue ; une mémoire préremplie ne prouve pas un apprentissage neuf.
- **Pas de faux positif** : la réutilisation observée oralement lors de tests locaux ne remplace pas les traces vérifiées de la nouvelle campagne ; les résultats des anciens diagnostics ne sont pas réécrits rétroactivement.
- **Tests qui survivent au changement de contexte :** le seam est défini au niveau de l'invocation du skill et des interfaces existantes ; ne pas créer un nouvel orchestrateur uniquement pour faciliter les tests.
- **Cette publication est une spécification ;** elle ne constitue ni une implémentation, ni un Tour généré, ni une mesure de benchmark.
