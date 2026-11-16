<!-- Source of truth: GitHub issue #183, 2026-11-16. Keep issue and this versioned snapshot aligned when changing the scope. -->

# Spécification consolidée — diagnostic de mémoire procédurale CodeTour
> **Source :** session « Grill Me » du 16 novembre 2026, synthétisée selon le skill `to-spec` de Matt Pocock. **Statut :** spécification à implémenter, **aucun run exécuté par cette mise à jour**.
>
> **Parent fonctionnel :** #172 — mémoire procédurale. **Protocole benchmark séparé :** #174. **Tickets de réalisation existants :** #175 (prompt), #176 (mémoire et `function_try`), #179 (télémétrie), #181 (campagne future). Cette issue **#183 est la source de vérité prioritaire pour la phase diagnostique** en cas de contradiction avec d'anciennes consignes de ces tickets.

## Problem Statement
Dans le dernier diagnostic réel sur PostgreSQL, CodeTour a répondu en explorant le dépôt, mais **aucune fonction mémoire n'a été créée, essayée ni réutilisée**. Le prompt exige une décomposition « mentale », non observable. Nous ne savons pas si l'agent a identifié des sous-questions fonctionnelles réutilisables ni pourquoi il n'a pas appelé `memory_list` ou `function_try`. Les diagnostics précédents ne démontrent **aucun apprentissage ni aucune économie de tokens**. Les journaux du comparateur Vibe présentaient en outre une consommation incomplète ; ceci reste une contrainte du benchmark futur, distincte du diagnostic présent.

Le blocage immédiat n'est **ni** le remplacement des fonctions, **ni** la déduplication sémantique, **ni** la preuve de rentabilité. Il faut d'abord provoquer et observer la **création réelle de procédures autonomes, valides, puis leur réutilisation dans un autre Tour**. Éviter de construire un moteur complexe avant cette preuve de faisabilité.

## Solution
Réaliser **une seule phase diagnostique exploratoire** du POC CodeTour (aucune phase « ancien prompt », aucun benchmark A/B obligatoire pour commencer). Au début de chaque Tour, le modèle produit un **petit plan structuré** en questions fonctionnelles indépendantes, **en anglais**, qui peut être révisé en cours d'exploration avec une raison enregistrée. L'agent explore brièvement, consulte `memory_list`, réutilise `memory_run` quand c'est pertinent, et est **fortement incité** à construire avec `function_try` une procédure TypeScript manquante quand elle représente une capacité durable, paramétrée et réutilisable. **Pas d'obligation artificielle de créer une fonction pour chaque question** ni de quota obligatoire de `function_try`.

`function_try` vérifie l'exécution et **toutes les citations obligatoires** sans LLM, retourne des erreurs suffisamment précises pour permettre une boucle **essayer → diagnostiquer → réparer → réessayer**, et laisse l'agent abandonner un candidat irrécupérable sans abandonner le Tour. La mémoire **n'est pas modifiée pendant le Tour**. À la fin, le LLM propose les fonctions qui l'ont réellement aidé ; un **validateur déterministe** les réexécute et autorise uniquement les versions valides et documentées. La consolidation est **volontairement minimaliste** : pas d'analyse intelligente de doublons ni de remplacement dans cette phase, mais jamais d'écrasement accidentel.

Les diagnostics utilisent un **budget généreux avec garde-fous de sécurité**. Les tokens sont comptés, **pas optimisés** à cette étape. **GLM 5.3 Flash** est le modèle candidat sous réserve de disponibilité vérifiée dans le harness. Si un essai Vibe est effectué en parallèle, demander le même modèle des deux côtés **sans ajouter maintenant une porte bloquante de preuve de parité**. La comparaison scientifique officielle avec le vrai sous-agent Vibe natif reste **différée**, et conserve ses exigences strictes de modèle effectif identique, télémétrie complète, provenance et portes G0–G5 (#174).

## User Stories
1. **En tant qu'auteur de Tour**, je veux que l'agent découpe explicitement le besoin en questions fonctionnelles indépendantes, afin d'observer ce qu'il se prépare à résoudre.
2. En tant qu'auteur de Tour, je veux que le plan soit bref et structuré, pour limiter son coût en tokens et éviter une dissertation.
3. En tant qu'auteur de Tour, je veux que le plan puisse évoluer après lecture du code, pour ne pas rester bloqué sur une mauvaise hypothèse initiale.
4. En tant qu'analyste du diagnostic, je veux voir **quelle question** a été ajoutée, révisée, divisée ou abandonnée et **pourquoi**, pour comprendre les adaptations.
5. En tant qu'analyste du diagnostic, je veux distinguer intentions déclarées et outils réellement appelés, pour ne pas inventer les décisions internes du LLM.
6. En tant qu'auteur de Tour, je veux consulter les capacités du catalogue avant création, pour favoriser la réutilisation immédiate.
7. En tant qu'auteur de Tour, je veux essayer une nouvelle fonction après une courte exploration utile, pour encapsuler une capacité réellement comprise.
8. En tant qu'auteur de Tour, je veux être fortement incité à créer des **fonctions paramétrées, indépendantes et durables**, pour démarrer l'apprentissage de la mémoire.
9. En tant qu'auteur de Tour, je veux pouvoir employer une primitive directement lorsqu'elle suffit, pour ne pas fabriquer de wrappers inutiles.
10. En tant qu'auteur de Tour, je veux utiliser une nouvelle fonction pendant le Tour courant avant persistance, afin de tester son utilité réelle.
11. En tant qu'auteur de Tour, je veux recevoir de `function_try` les erreurs TypeScript, sandbox, contrat et citations de manière précise et bornée, afin de réparer mon code.
12. En tant qu'auteur de Tour, je veux voir les références valides et les références fautives séparément, afin de ne corriger que ce qui est nécessaire.
13. En tant qu'auteur de Tour, je veux pouvoir abandonner une fonction après des échecs répétés et poursuivre l'exploration avec les primitives, afin de ne pas bloquer le Tour entier.
14. En tant qu'analyste, je veux conserver les essais abandonnés et leurs diagnostics dans les **logs uniquement**, afin d'étudier les échecs sans contaminer la mémoire.
15. En tant que mainteneur de CodeTour, je veux vérifier sans LLM que chaque fichier cité existe à la révision pertinente, que chaque plage de lignes existe et est cohérente, et qu'un extrait textuel exact correspond s'il est fourni, pour rejeter les références inventées.
16. En tant que mainteneur de CodeTour, je veux refaire les contrôles sur la **version exacte** soumise à la consolidation, pour empêcher l'enregistrement d'une variante non testée.
17. En tant qu'auteur de Tour, je veux proposer seulement les fonctions qui m'ont aidé réellement, afin de garder un catalogue utile.
18. En tant qu'utilisateur du catalogue, je veux une description **obligatoire en anglais de 1 à 2 phrases** pour chaque fonction, afin de reconnaître sa capacité au Tour suivant sans lire le code.
19. En tant que mainteneur, je veux que la validation de la description et de l'exécution soit déterministe, pour éviter tout LLM juge supplémentaire.
20. En tant que mainteneur, je veux que les fonctions invalides ou abandonnées soient **impossibles à mémoriser**, pour préserver l'intégrité du catalogue.
21. En tant que mainteneur, je veux une consolidation simple sans remplacement ni déduplication intelligente, afin de réduire le périmètre et laisser les éventuels doublons visibles au diagnostic.
22. En tant qu'auteur de Tour, je veux que les **prompts internes, descriptions d'outils et plans instrumentés soient en anglais**, pour garantir une convention cohérente.
23. En tant que lecteur francophone, je veux que le Tour et ses explications restent en français lorsque je le demande, même si les instructions internes sont en anglais.
24. En tant qu'analyste, je veux retrouver dans les logs plan, révisions, recherches mémoire, essais, réparations, appels et réconciliation finale, pour expliquer avec preuves pourquoi rien n'a éventuellement été mémorisé.
25. En tant qu'analyste, je veux voir la consommation réelle de tokens et la cause exacte d'un arrêt, sans faire d'économies de tokens un critère de succès immédiat.
26. En tant que développeur, je veux tester sur **deux Tours successifs avec une mémoire persistante commune**, pour démontrer qu'au moins une fonction valide est créée puis réutilisée.
27. En tant que responsable du benchmark futur, je veux préserver les exigences strictes du protocole Vibe officiel sans les imposer au diagnostic exploratoire, pour ne pas confondre faisabilité et preuve de rentabilité.

## Implementation Decisions
### Portée et séquencement
- **Une seule étape maintenant : diagnostic exploratoire CodeTour.** Ne pas exécuter d'abord l'ancien prompt (déjà observé sans création), ne pas imposer une deuxième phase ni lancer la campagne officielle de 80 runs.
- **Cible primaire : fonctions réellement créées, validées, consolidées et réutilisées**, non un nombre de tentatives ni un pourcentage d'économie. Les échecs sont des résultats diagnostiques, jamais maquillés en réussite.
- **Budget** : ample pour exploration, essais et réparation ; conserver des maxima techniques configurables sur temps, tokens et appels comme **sécurité**, les journaliser et ne pas les rendre invisibles. Toutes les consommations réelles restent comptées.
- **Modèle** : configurer GLM 5.3 Flash si le fournisseur et le harness exposent réellement ce modèle ; relever le nom effectivement employé ou indiquer l'indisponibilité. Ne pas revendiquer un run ou un modèle non vérifié.
- **Vibe** : si utilisé en diagnostic, configurer dans la mesure du possible le même modèle ; pas de nouveau contrôle bloquant de parité **pour cette phase**. Pour le **benchmark officiel seulement**, modèle effectif commun et vérifiable, vrai sous-agent natif, compteurs complets et G0–G5 restent non négociables conformément à #174. Aucune conclusion causale sur les tokens avant ce protocole.

### Découpage et choix des fonctions
- Conserver **une source de vérité unique** pour le prompt et son empreinte ; migrer en anglais toutes les instructions d'agents du périmètre, y compris le prompt de décomposition. Ne pas traduire les réponses et les Tours demandés en français : respecter l'ADR de langue déjà existante.
- Le premier échange d'exploration doit exposer un **plan synthétique structuré en anglais** (questions canoniques, identifiants stables et capacité potentiellement réutilisable) **dans la génération LLM habituelle**, sans appel LLM supplémentaire dédié. Il ne s'agit pas d'une chaîne de pensée.
- Les mises à jour du plan peuvent ajouter, scinder, fusionner, réordonner ou abandonner une question avec raison concise ; garder l'historique et les identifiants cohérents, ne pas réécrire les événements passés.
- Pour chaque sous-question, rechercher la capacité existante (`memory_list`) ; la réutiliser avec `memory_run` et vérifier ses résultats quand elle convient. Après une **courte exploration initiale**, encourager fortement `function_try` lorsqu'une capacité manquante demande une combinaison d'opérations réutilisable. Une primitive seule peut suffire : **aucune fonction forcée**.
- Les fonctions TypeScript mémorisables répondent chacune à **une seule question fonctionnelle autonome et paramétrable**, utilisent uniquement les dix primitives permanentes, n'appellent jamais d'autres fonctions mémorisées, renvoient des résultats **compacts, bornés, structurés et sourcés**. Ne pas mémoriser de réponse pré-calculée.
- Une fonction temporaire peut être réutilisée **pendant le Tour courant** ; seul le protocole de consolidation peut ensuite écrire dans le catalogue.

### Validation de `function_try` et boucle de réparation
- Réutiliser le contrat d'exécution TypeScript strict/QuickJS/whitelist existant et son flux d'erreurs ; ne pas créer un second moteur ni un second LLM juge.
- Ajouter une validation **déterministe et exhaustive des références émises** : chemin confiné au workspace, fichier présent à la révision attendue, entier positif, `startLine <= endLine`, fin dans les lignes réelles, et égalité du texte si un extrait exact est donné. Les références obligatoires manquantes sont un échec. Une sortie tronquée ne peut pas être déclarée exhaustive ni « prouvée » sans le signaler.
- Les résultats partiellement valides sont conservés dans le diagnostic ; si 1 référence sur 10 échoue, le statut de l'essai est **validation_failed** et le détail désigne la seule référence fautive. Ne jamais traiter l'essai comme validé.
- Le modèle reçoit un retour **court, structuré et actionnable** (erreur + chemin/ligne/type), peut corriger la fonction et rappeler `function_try`. Toutes les variantes, leurs paramètres et résultats observables sont tracés.
- Pas de quota fixe arbitraire de réparations ; autoriser l'abandon justifié si le modèle tourne en rond ou n'a plus de correction plausible. Le Tour continue si possible, la fonction abandonnée reste **logs seulement**. Garde-fous de sécurité globaux inchangés.
- **Limite épistémique** : citation existante ≠ preuve pertinente de la relation métier. Le validateur garantit l'intégrité structurale, pas l'exactitude sémantique complète ; ne pas prétendre le contraire.

### Consolidation finale minimaliste et catalogue
- **Le LLM propose** seulement les fonctions qui ont réellement servi au Tour, en expliquant brièvement leur utilité. La proposition **n'écrit rien**. **Le validateur en code tranche les critères vérifiables** sans second modèle.
- N'accepter qu'après Tour validé, preuve d'exécution du candidat exact, validation syntaxique/sandbox/contrat, **rejeu exact** et vérification exhaustive des citations à la consolidation. Si échec : refuser et journaliser, sans écrire.
- **Description obligatoire en anglais, 1–2 phrases**, avec une structure harmonisée décrivant la question résolue, le périmètre, le type de résultat et, si important, la limite principale ; vérifier automatiquement non-vide, langue selon règle praticable et longueur. Ne pas faire passer un détecteur de langue heuristique pour une preuve infaillible.
- Catalogue consultable sans exposer le code source : identifiant stable unique, nom canonique, question, description, paramètres typés, forme de sortie, limites, revision si applicable. Réutilisation dans un Tour ultérieur via `memory_list` + `memory_run`.
- **Reporter** la déduplication sémantique, la comparaison intelligente, le choix remplacer/garder et la gestion élaborée de variantes. Pour ce diagnostic, **append-only** et contrôle simple de collision d'identifiant ; ne jamais écraser une entrée validée. D'éventuels doublons non identiques sont acceptables et visibles dans le rapport.
- **Une fonction cassée, non exécutée ou abandonnée n'entre jamais dans la mémoire.**

### Instrumentation et résultats
- Utiliser le seam existant du **harness d'exploration POC**, qui pilote déjà les appels modèles/outils et la mémoire. Pas de nouveau service ni de pipeline parallèle.
- Traçage structuré par run : `decomposition_plan`, `plan_revised`, `decomposition_decision`, `tool_invocation/tool_result`, `function_try_attempt` (erreurs/réparations/abandons), `reconciliation` et `run_end`. Lier `run_id`, `question_id`, `call_id` et identifiant de candidat. Les appels réels sont enregistrés par le harness, **pas déduits d'un texte du LLM**.
- Une réconciliation non atteinte (`budget_exceeded`, `aborted`, `failed`) est différente d'une réconciliation atteinte **sans candidat**, d'un candidat rejeté et d'un candidat accepté. Les statuts manquants/inconnus restent visibles.
- Plans, messages internes, descriptions de fonction et motifs de décision en **anglais** ; texte final du **Tour dans la langue de l'utilisateur**. Ne pas exposer les plans internes dans le Tour.
- Conserver comptages de tokens d'entrée/sortie/cache et journal des tentatives, mais **aucune revendication d'économie ou de rentabilité** sur ce diagnostic.
- Le rapport de diagnostic doit répondre, sur des traces réelles : « l'agent a-t-il décomposé ? révisé ? consulté la mémoire ? essayé ? réparé ? abandonné ? réussi ? atteint la consolidation ? pourquoi a-t-il mémorisé ou non ? une fonction a-t-elle été réutilisée ensuite ? ».

### Sous-tâches logiques, dans cet ordre de dépendances
- [ ] **S1 — Prompt & langue (T01/#175)** : prompt unique en anglais, plan initial bref, révisions traçables, forte incitation à créer après exploration, réponses utilisateur dans sa langue ; version et empreinte.
- [ ] **S2 — Validation & réparation (T02/#176)** : contrôles déterministes de toutes les citations à `function_try`, erreurs bornées et réparables, conservation des résultats de diagnostic, abandon propre.
- [ ] **S3 — Consolidation simplifiée (T02/#176)** : sélection par LLM de candidats réellement utiles, revalidation exacte, description anglaise obligatoire et courte, persistance append-only, aucune déduplication intelligente/remplacement dans cette phase.
- [ ] **S4 — Logs & budgets (T05/#179)** : plan/décisions/actions/réconciliation reliés, anglais interne, comptes réels et budgets de sécurité configurables ; ne pas ajouter de vérification de parité Vibe bloquante au diagnostic.
- [ ] **S5 — Test de bout en bout (POC)** : Tour A mémoire vide, fonction créée et persistée ; Tour B même catalogue, `memory_list` puis `memory_run` prouvés ; traces et références vérifiables ; rapport d'échec explicite si cela ne fonctionne pas.

## Testing Decisions
- **Seam principal (le plus haut possible) :** tester `explore` / le **harness d'exploration** avec un modèle piloté de manière déterministe, workspace temporaire et mémoire persistante entre deux Tours. Observer **comportements et artefacts**, pas les formulations internes exactes ni des détails d'implémentation.
- Reprendre les tests existants des appels `function_try`, du contrôle d'évidence du Tour, de la consolidation et de la réutilisation ; préférer renforcer ces scénarios à multiplier les couches de mocks. Tester le validateur de citations comme petit composant pur si nécessaire, **sans créer de nouveau seam transversal**.
- **T1 — Plan** : questions autonomes, structuration anglaise, plan absent/invalide/tronqué signalé, aucune fausse trace d'outil, révision du plan tracée avec raison.
- **T2 — Choix** : mémoire utile => réutilisation ; mémoire vide et besoin multi-opérations => au moins un scénario positif de `function_try` ; primitive suffisante => pas de fonction artificielle. Tests de comportement, pas obligation globale de compteur non nul.
- **T3 — Réparation** : erreur TS, primitive interdite, fichier absent, chemin hors workspace, plage inversée, plage trop grande, révision incompatible, extrait différent, citations obligatoires absentes ; erreur exploitable, nouvel essai corrigé possible.
- **T4 — Partiel** : 9 citations valides et 1 invalide => sortie diagnostique conservée, essai non validé, **aucune persistance** avant correction.
- **T5 — Abandon** : plusieurs essais infructueux => candidat abandonné, code/erreurs dans logs seulement, Tour poursuivi si l'exploration le permet.
- **T6 — Consolidation** : sélection par LLM ≠ écriture ; version non essayée, non exécutée, Tour non validé, citation invalide ou description manquante/trop longue => refus. Rejeu exact et citations valides => persistance. Collision d'identifiant => pas d'écrasement.
- **T7 — Langue** : prompts/description/plan en anglais, Tour demandé en français généré en français, conformément à l'ADR de langue.
- **T8 — Réutilisation** : deux Tours successifs sur même dépôt avec catalogue partagé ; trace vérifiable de `memory_list` puis `memory_run` au Tour B, **sans recréer** le même code lors de ce scénario.
- **T9 — Plafonds et honnêteté** : budget généreux mais arrêts de sécurité observables ; rapport de tokens réels, plan non atteint vs consolidation non atteinte ; aucun résultat fictif affiché comme un run réel.
- **T10 — Diagnostic réel (si accès modèle disponible)** : exécuter le cas PostgreSQL avec le modèle configuré, comparer les logs avec les sorties réellement observées. Pas d'affirmation de réussite sans trace et test observés.

**Critère de succès minimal pour le premier test :** au moins **une procédure nouvelle utile**, effectivement exécutée et acceptée par la consolidation à la fin du Tour A, puis **réutilisée par `memory_run` dans un Tour B indépendant** avec le catalogue persistant. La réponse du Tour doit rester sourcée. Un simple appel `function_try` ou une création de catalogue non réutilisée ne suffisent pas.

## Out of Scope
- Deuxième phase ou comparaison ancien prompt/nouveau prompt avant le premier diagnostic.
- Démonstration immédiate de gains en tokens, point de rentabilité, campagne officielle de 80 runs, statistiques de performance.
- Déduplication sémantique, remplacement des fonctions, fusion intelligente, arbitrage par second LLM, scoring qualité, moteur de similarité, embeddings, graphe de dépendances et gestion complexe des versions.
- Fonction qui appelle une autre fonction mémorisée, cache de réponses, partage de mémoire inter-dépôts.
- Obliger une création à chaque sous-question, fixer un quota de fonctions ou un nombre arbitraire d'essais de réparation.
- Porte **supplémentaire de preuve de parité du modèle Vibe pendant le diagnostic** (mais **pas** levée des obligations du **benchmark officiel** #174).

## Further Notes
- **Décision finale du grill, 16/11/2026 :** priorité à un cycle réel **plan → courte exploration → création TypeScript → validation/auto-réparation → consolidation simple → réutilisation au Tour suivant**. Ne pas surconcevoir les doublons.
- **Précédence explicite :** cette issue #183 remplace, **pour la seule phase diagnostique**, les anciennes mentions « décompose mentalement », « pas de plan explicite », « déduplication intelligente et remplacement obligatoires » et « préflight Vibe bloquant avant toute expérimentation ». #172 et #174 restent les références pour les garanties de sécurité et **le benchmark officiel**.
- **Qualité :** une citation valide prouve l'existence du support documentaire, **pas** sa pertinence sémantique. L'analyse de qualité complète sera faite ultérieurement par l'évaluateur indépendant du benchmark ; aucun verdict flatteur sans mesure.
- **Aucun code ni benchmark n'est créé ou lancé par la publication de cette spécification.**


---

**Issue canonique :** https://github.com/maurice30120/codetour/issues/183
**Benchmark officiel distinct :** https://github.com/maurice30120/codetour/issues/174
