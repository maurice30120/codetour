# Spécification — Benchmark réel CodeTour vs sous-agent de recherche natif Vibe sur PostgreSQL

**Statut :** proposition de protocole, à implémenter puis pré-enregistrer avant toute mesure. *(Réconciliation du 15/11/2026 : complément au protocole et corrections bloquantes de la revue croisée intégrés — cf. §2.5 et §4 ; la campagne T07 du 15/11/2026 est INVALIDÉE, traces fabriquées, NO-GO — aucun de ses chiffres n'est exploitable.)*
**Date :** 2026-11-15
**Liens :** [spec fonctionnelle #172](https://github.com/maurice30120/codetour/issues/172) ; [PR POC #173](https://github.com/maurice30120/codetour/pull/173).
**But unique d'optimisation :** réduire la consommation **réelle et totale de tokens LLM** par Tour correct, sans dégrader la qualité. Ni la latence ni le coût monétaire ne servent à décider.

## 0. Constat et règle d'honnêteté

La PR #173 annonce 77–82 % d'économies, mais les rapports de comparaison Vibe qu'elle embarque utilisent des jeux `*-mock.json`. Ces chiffres NE SONT PAS une mesure du sous-agent natif Vibe. Les essais historiques sur PostgreSQL sont exploratoires, souvent partiels, et ne valident pas l'hypothèse. Tout rapport doit porter explicitement l'un des trois états : `mesure réelle vérifiée`, `diagnostic/pilote sans portée comparative`, `simulation — interdite dans le résultat principal`.

**Interdit :** créer des compteurs de tokens, des réponses, des résultats Vibe, des jugements de qualité ou des exécutions fictifs ; remplacer sans l'indiquer le sous-agent de recherche natif par Vibe headless, le harnais sans mémoire, une façade de ses outils, ou une approximation ; annoncer un pourcentage non calculé depuis les traces réelles. Si le sous-agent natif ou la télémétrie ne sont pas accessibles, **ARRÊT : benchmark principal non réalisable**. Ne pas contourner.

## 1. Conditions de démarrage (portes bloquantes)

- [ ] **G0 — conformité POC à #172** : dix primitives testées et bornées ; `function_try(source,params)` valide du TypeScript en mode strict, restreint aux dix primitives, transpile et exécute en QuickJS avec traces ; `memory_list(query)` et `memory_run(id,params)` fonctionnent ; aucune fonction mémorisée n'appelle une autre fonction mémorisée ; consolidation uniquement après Tour validé, sur version réellement essayée ; pas de cache de réponses ni de purge par inactivité. Des interfaces `code` JavaScript / `list,read,search` seules ne suffisent pas. Chaque exigence possède un test automatique concret. **Complément #174 (15/11/2026)** : la définition de G0 inclut en outre les **sept tests d'acceptation** suivants : (1) deux formulations de la même question ne créent pas deux capacités ; (2) même fonction réutilisée sans relecture du code ; (3) une primitive suffisante ⇒ aucune création ; (4) question composite ⇒ procédures indépendantes et exploration du manque ; (5) sortie avec preuves et limites, signal de bornage/troncature ; (6) candidate non exécutée refusée ; (7) résultat syntaxiquement plausible mais preuve de relation absente ⇒ incertitude/échec explicite.
- [ ] **G1 — Vibe authentique** : une exécution sentinelle prouve l'invocation du **sous-agent de recherche natif de Vibe**, avec nom/API/version, identifiant d'exécution, outils réellement utilisés, configuration modèle, résultat et vraie consommation de tokens. Une simple session Vibe headless ou un adaptateur qui simule ses actions ne satisfait pas la porte.
- [ ] **G2 — instrumentation totale** : compteurs fiables côté fournisseur / infrastructure pour chaque appel de modèle, y compris orchestrateur et sous-agent Vibe, prompts, recherches, retries, corrections et consolidation POC. Si un appel LLM n'a pas de mesure fiable, marquer `usage_missing=true` et ne PAS calculer de gain global.
- [ ] **G3 — fixture réelle** : clone en lecture seule de `postgres/postgres` au SHA **`70c4a57b64d39c526eb4c44a925eb92a6e56f3c5`**, sous-modules/checkout/étendue documentés, état propre, empreinte vérifiée avant chaque série. Même arbre pour les deux agents. Les citations doivent viser le code de ce SHA.
- [ ] **G4 — évaluateur indépendant** : format commun des réponses, vérification à l'aveugle contre le code, protocole de désaccord, et seuils de qualité définis **avant** d'observer les résultats.
- [ ] **G5 — pré-enregistrement** : tâche, ordre, version des prompts, modèles, paramètres, plafonds, politique cache, grille de notation et seuils écrits dans un manifeste hashé, non modifié pendant le benchmark.

Tout G0–G5 non satisfait = **NO-GO** ; aucun benchmark principal n'est lancé, aucune économie n'est publiée.

## 2. Incitation à la décomposition : changement produit à effectuer AVANT le benchmark

### 2.1 Comportement voulu

L'agent qui prépare un Tour doit chercher à **décomposer le besoin en quelques questions de recherche réutilisables** plutôt que générer d'emblée une grosse fonction ad hoc. Pour chaque besoin, il explore d'abord les fonctions déjà mémorisées ; si une fonction convient, il l'exécute avec des paramètres pertinents ; sinon il utilise une primitive existante ou essaie la **plus petite** fonction TypeScript générique réellement nécessaire. Les étapes peuvent rester internes ; **ne pas imposer de long plan narratif au LLM**. La décomposition est une heuristique, pas un objectif en soi : elle ne doit pas multiplier artificiellement les appels.

### 2.2 Texte canonique unique à injecter au prompt d'exploration du POC (pas dans Vibe)

**Version canonique unique** (correction n°1 de la revue croisée #174, 15/11/2026) : une seule version canonique du prompt existe, reprise à l'identique de l'[issue #172](https://github.com/maurice30120/codetour/issues/172), section « Prompt cible d'exploration (à injecter uniquement dans le POC) » du 15 novembre 2026, et déclarée prioritaire par #174 en cas d'écart. L'ancien prompt « besoins concrets » (version antérieure du présent §) est **supersédé et ne doit plus être utilisé ni reproduit** ; aucune paraphrase ni seconde variante n'est admise. La version versionnée ci-dessous définit la chaîne exacte à hacher.

> Avant d'explorer le dépôt, décompose mentalement l'objectif du Tour en quelques questions concrètes et indépendantes. Pour chacune, cherche les questions équivalentes via memory_list(query). Si une procédure répond déjà, exécute-la avec memory_run(id, params), vérifie ses preuves et complète seulement ce qui manque. Sinon, utilise d'abord les primitives permanentes ; si une question fonctionnelle autonome paraît réutilisable, essaie une procédure TypeScript paramétrée avec function_try(source, params). Suis le nommage canonique et les contrats du catalogue. Ne recrée ni primitives, ni questions équivalentes ; n'imbrique aucune procédure mémorisée dans une autre. Retourne des résultats structurés, compacts, sourcés, avec limites et incertitudes. Ne mémorise pas de réponse figée : seules les procédures exécutées peuvent être proposées après validation du Tour. Arrête l'exploration lorsque les preuves sont suffisantes ; n'explicite pas systématiquement la décomposition.

SHA256(prompt canonique) : à calculer au gel G5

Ne pas mettre ce texte dans le comparateur natif Vibe ; il doit conserver son comportement par défaut. Journaliser la version et l'empreinte (SHA-256) du prompt exact envoyé, calculée sur cette version canonique unique et référencée par le manifeste G5.

### 2.3 Exemples de besoins sur PostgreSQL

- `pg-parse` : trouver `exec_simple_query`, trouver l'appel à `pg_parse_query`, lire `pg_parse_query` et `raw_parser`, établir les lignes.
- `pg-analyze` : localiser l'analyse et la réécriture (`pg_analyze_and_rewrite_fixedparams`, `parse_analyze_fixedparams`, `pg_rewrite_query`), confirmer la chaîne et les preuves.
- `pg-flow` : relier parsing, analyse/réécriture et planification (`pg_plan_queries`) sans inventer les relations manquantes.

Ces exemples servent aux tests et au dossier de référence, **pas à une injection de réponses** dans les agents du benchmark.

### 2.4 Critères de réussite de la modification

- Test avec mémoire utile : la trace montre catalogue consulté et `memory_run` avec des paramètres valides, sans nouvelle fonction redondante.
- Test avec mémoire vide : la trace montre une fonction ciblée, paramétrée, exécutée avec succès via `function_try` ; ni réponse pré-enregistrée ni fonction jamais essayée.
- Test de besoin déjà couvert par primitive : aucune création de fonction imposée.
- Test de besoin composite : réutilisation de plusieurs petites opérations si utile ; interdiction d'appel fonction-mémorisée → fonction-mémorisée.
- Test de sortie erronée/absence de preuve : correction ou incertitude explicite, pas de faux succès.
- Comparer les tokens du prompt et les appels sur ces tests ; la décomposition ne doit pas être considérée utile du seul fait qu'elle est observée.

### 2.5 Complément au protocole — décisions validées le 15 novembre 2026

**Source :** [issue #174, « Complément au protocole » du 15 novembre 2026](https://github.com/maurice30120/codetour/issues/174) et [issue #172, « Complément validé — questions canoniques et qualité des fonctions »](https://github.com/maurice30120/codetour/issues/172). Ce complément complète T01, T02, T06 et T08 **sans modifier** les 80 runs prévus, les portes G0–G5 ni le comparateur principal (vrai sous-agent natif Vibe). Il s'applique au POC **avant** le gel du manifeste G5 ; aucun retouchement des prompts ou des critères à partir des résultats mesurés.

**Règle de priorité documentaire :** pour les points couverts par ce complément, le complément des issues #172/#174 **précise et prime sur** le présent document de benchmark ; toute implémentation doit suivre conjointement les deux.

**Décisions intégrées :**

1. **Questions fonctionnelles autonomes et durables (T01).** L'agent découpe le Tour en questions fonctionnelles indépendantes et durables, jamais en wrappers techniques. Pour chaque question, rechercher d'abord une question canonique équivalente dans la mémoire ; réutiliser par `memory_run` et ne compléter que le manque ; n'utiliser `function_try` que pour une question réellement manquante et plausible à réutiliser. Pas de plan explicatif imposé.
2. **Contrat `memory_list(query)` (T02).** Expose, **sans lecture du code source** des fonctions : identifiant, question canonique, description/périmètre, paramètres typés, contrat de sortie, limites et cas d'incertitude.
3. **Sortie `memory_run` / `function_try` (T02).** Objet **compact, structuré, borné et sourcé** (fichier/lignes/révision), avec relation démontrée vs incertitude, signalement de la troncature (une sortie tronquée n'est jamais interprétée comme exhaustive), état vide et erreurs explicites. Aucune narration ni réponse figée mise en mémoire.
4. **Normalisation et nommage.** Question canonique stable ; nom TypeScript en `camelCase` (`verbe + domaine + objet`) dans le vocabulaire du catalogue ; les variantes sont des paramètres, pas de nouveaux noms. Le nom seul n'est jamais une preuve d'équivalence.
5. **Déduplication.** Sur **question + périmètre + contrat**, jamais sur le nom seul. « Pas deux capacités pour une même question » est un objectif testé sur des cas de référence, pas une garantie absolue (`memory_list` est une recherche textuelle simple) ; répondre « non déterminé » plutôt que d'inventer une équivalence ; pas d'embeddings ni de classifieur.
6. **Composition hors du code mémorisé.** Une procédure mémorisée n'appelle **que les dix primitives permanentes** ; les réponses de plusieurs procédures se composent **par l'agent pendant le Tour**, jamais dans le code mémorisé.
7. **Consolidation.** Uniquement **ajouter / remplacer / ignorer** face aux questions proches, sur candidate effectivement exécutée, Tour validé et réexécution de la version exacte ; recouvrements partiels tolérés entre questions réellement distinctes ; **pas de** moteur de score, d'index sémantique, de graphe de dépendances, de purge par inactivité, ni de notation subjective systématique des fonctions.
8. **`function_try` valide la technique, pas la vérité métier (T06).** La qualité sémantique est mesurée **uniquement** par l'évaluateur indépendant et aveugle du benchmark, aux **critères préenregistrés** ; **aucun second LLM juge systématique en production**.
9. **Tokens et attribution (T08).** Mesurer les tokens totaux **cumulés par Tour correct**, y compris création, essais, diagnostics et consolidation ; journaliser les réutilisations et le coût observé des créations, mais **jamais transformer un nombre d'appels en économie attribuée** à une fonction sans contrefactuel valide. Distinguer « **validée techniquement** » (condition d'entrée) de « **bénéfice démontré expérimentalement** » (preuve a posteriori).
10. **Ablation optionnelle.** Un diagnostic d'attribution — **CodeTour, même harness, avec et sans mémoire** — peut éclairer l'effet causal de la mémoire : il est **distinct des 80 runs**, ne **remplace pas Vibe** et ne modifie pas la pré-régistration.

Les **sept tests d'acceptation** associés font partie de la définition de G0 (cf. §1).

## 3. Benchmark PostgreSQL : données et tâches pré-enregistrées

Source : `https://github.com/postgres/postgres` au SHA G3, déjà utilisé dans `poc/exploration-benchmark/`. Réutiliser et **réviser** `postgres-tour-tasks.json` et `screen-postgres.mjs` : les seules lignes attendues ne prouvent pas la justesse sémantique.

Deux séries isolées :

**R — répétition** : cinq questions réelles de compréhension du code PostgreSQL, chacune répétée quatre fois selon un ordre fixé à l'avance : **20 demandes par agent**. L'agent CodeTour part d'une mémoire vide et la conserve entre ses 20 demandes ; Vibe démarre chaque demande dans une session indépendante (hors mémoire native explicitement documentée). **Attention (complément #174, 15/11/2026) : ces 20 exécutions = 5 questions distinctes × 4 répétitions et ne forment PAS 20 observations indépendantes ; l'unité d'inférence est la famille de questions (cf. §5 et §7).**

**T — transfert** : dix demandes de construction d'expérience sur des parcours du code, puis dix demandes nouvelles mais voisines, pré-définies, non identiques et non visibles comme réponses aux agents : **20 demandes par agent**. Nouvelle mémoire CodeTour vierge au début de T ; pas de mémoire issue de R. Les dix demandes d'amorçage T sont **comptées** dans le coût et la qualité, jamais exclues du résultat.

**Total principal minimal : 80 exécutions réelles (2 séries × 2 agents × 20 demandes).** Une extension éventuelle à 50 demandes par série et agent est décidée selon les règles pré-enregistrées, jamais en fonction de la seule beauté du score.

Pour chaque demande, figer avant le test : `id`, `objective`, `series`, `phase`, `repeat_index`, `postgres_sha`, éventuelles zones attendues pour l'évaluateur **non révélées aux agents**, critères de correction et relations à vérifier. Les cas doivent couvrir du code réellement présent ; aucune question imaginaire ou résultat mock.

Le dossier de référence est rédigé/vérifié par un évaluateur distinct avant les runs, avec plusieurs chemins de preuves admissibles pour éviter le surapprentissage d'une ligne précise. Requêtes et attentes pré-enregistrées, prompts identiques entre agents sauf consignes propres à leur système de recherche. Ne pas entraîner/ajuster le POC sur ce jeu de mesure après gel.

## 4. Conditions d'équité, exécution et provenance

- Utiliser le **même modèle, version, température, repo/commit, objectifs de sortie et limite de tokens** chaque fois que Vibe le permet. Documenter chaque divergence ; une différence substantielle de modèle, d'accès au dépôt ou de plafond empêche une attribution causale du gain.
- **Outils distincts, documentés explicitement (correction n°2, revue croisée #174, 15/11/2026) : les dix primitives du POC appartiennent EXCLUSIVEMENT au POC CodeTour ; la baseline Vibe conserve ses outils natifs inchangés.** Toute idée de primitives partagées entre les deux variantes du benchmark est supprimée : elle est contradictoire avec le comparateur natif et ne concerne que le POC. Même source, questions, critères et modèle si possible ; outils distincts explicitement documentés. Aucune mémoire partagée entre les agents. Ne pas transmettre au modèle les solutions de référence.
- Fixer une enveloppe tokens et des limites d'appels par demande avant les runs ; comptabiliser les dépassements mesurés, les retries et les interruptions, sans retrancher les runs ratés.
- Alterner/contrebalancer l'ordre d'exécution des agents pour limiter les effets de service ; conserver l'ordre chronologique d'apprentissage **au sein** de chaque série CodeTour.
- Isoler les sessions et snapshots ; ne pas muter PostgreSQL ; **vérifier le SHA PostgreSQL et l'arbre propre AVANT CHAQUE RUN** — contrôle par run, obligatoire et journalisé, et non une simple vérification par série.
- **Calendrier gel/pilote sans équivoque (correction n°9, revue croisée #174, 15/11/2026)** : les questions, critères et grilles de notation sont préparés **avant tout test** ; le pilote de connectivité (1–2 demandes) porte **exclusivement sur des tâches hors benchmark**, sert uniquement à tester la collecte et les garde-fous, et n'est **jamais compté** dans la série principale ; les corrections techniques qu'il révèle sont **versionnées** ; le **gel G5 final des prompts et du plan a lieu AVANT le premier run mesuré** ; **aucun ajustement du contenu ou des critères à partir des résultats mesurés**. T05 construit le mécanisme de gel, T06 fournit la grille avant G5, T07 vérifie la preuve des portes.
- Chaque run produit un journal `run-id` immuable : date, agent réel, versions exactes, **commande/API lancée**, **modèle**, paramètres, SHA PostgreSQL, hash des prompts et du manifeste, appels outils, fonctions créées/essayées/réutilisées/remplacées, traces d'erreur, résultat brut, citations, **usage tokens par appel fourni par le fournisseur**, **horodatages et durées cohérents entre appels**, **identifiants de requête (request ids) du fournisseur quand disponibles**, et sommes contrôlées. Aucune clé secrète dans les traces.

## 5. Mesure des tokens : source de vérité

**Mesure primaire :** somme réelle des tokens LLM d'entrée et de sortie de **tous les appels** nécessaires à la demande, à la consolidation et aux corrections. Les tokens d'entrée servis depuis un cache sont déjà inclus dans l'entrée totale du fournisseur : les déclarer séparément, **sans double comptage**. Fournir aussi les éventuels compteurs billed/cache-read/cache-write à titre descriptif. Sur Vibe, inclure orchestrateur + recherche native + post-traitement LLM nécessaires au résultat ; sur CodeTour, inclure recherche, `memory_list`, essais `function_try`, diagnostics, retries, sélection et consolidation. Aucun coût de l'évaluateur indépendant n'est attribué à l'un ou l'autre : il est rapporté séparément et symétriquement.

Calculer par série et par agent : tokens totaux **cumulés**, tokens marginaux par demande et par rang, évolution des tokens après apprentissage, taux de Tours corrects, tokens totaux / nombre de Tours corrects (si dénominateur non nul), couverture/pertinence des preuves, fausses relations, fonctions réellement réutilisées, coûts d'apprentissage, point de rentabilité **en tokens**. Ne pas utiliser le coût $ comme critère de décision.

**Unité statistique pré-enregistrée (correction n°8, revue croisée #174, 15/11/2026)** : dans la série R, 20 exécutions = **5 questions distinctes × 4 répétitions**, jamais 20 observations indépendantes. Pré-enregistrer **avant tout run** : (a) l'**unité indépendante d'inférence** (famille de questions / séquence d'apprentissage) ; (b) une **méthode bootstrap adaptée à l'apprentissage cumulatif** — le bootstrap apparié naïf par run surestime potentiellement la confiance ; (c) un **plan de sensibilité**. Si les 5 familles de R ne suffisent pas à établir l'intervalle de confiance, le verdict est **INDÉTERMINÉ**. Toute extension à 50 demandes doit augmenter la **diversité des questions/familles**, pas seulement répéter les mêmes questions ; **aucun jeu de questions ne peut être modifié après avoir observé des résultats**.

Les coûts partiels, indisponibles ou inférés de la taille du texte ne sont **jamais** des mesures réelles ; un total incomplet invalide la comparaison chiffrée.

## 6. Évaluation indépendante et grille de qualité

L'évaluateur ne connaît ni l'agent, ni le rang d'exécution, ni le total de tokens. Il vérifie chaque affirmation et preuve contre le vrai code de PostgreSQL (SHA figé), en se servant des attendus comme guide et non comme simple recherche de lignes. L'évaluation ne se réduit jamais à `status=complete`, un JSON conforme, ou la présence de citations.

Chaque demande obtient : `correct` (oui/non), `evidence_supported` (oui/non), `major_missing_relation` (oui/non), `critical_false_claim` (oui/non), `coverage` et justification brève avec lignes vérifiées. Une demande est un **Tour correct** seulement si la réponse est pertinente, ses relations centrales sont justes, les preuves vérifiables, et aucun manque critique n'est ignoré. Un second contrôle arbitre les cas litigieux ; préserver le verdict initial et le motif de l'arbitrage.

Tous les runs partiels, erreurs, timeouts et preuves incorrectes comptent dans le dénominateur des demandes. Ne pas les effacer ni les remplacer par un nouveau run ; seul un échec de l'infrastructure hors agent déclenche un rejeu selon une règle commune documentée.

## 7. Verdict figé à l'avance

**Indicateur primaire :** baisse relative des **tokens cumulés par Tour correct**, calculée séparément pour R et T et sur l'ensemble des deux séries, en incluant TOUS les tokens de création/apprentissage.

**VALIDÉ** uniquement si, sur chacune des séries :

1. Données réelles complètes et les portes G0–G5 satisfaites ;
2. **Au moins 20 %** de gain ponctuel sur les tokens par Tour correct face à Vibe ;
3. Intervalle de confiance bootstrap à 95 % de la réduction **strictement supérieur à 0**, calculé sur l'**unité indépendante pré-enregistrée** (famille de questions / séquence d'apprentissage, pas les runs individuels — cf. §5) ;
4. Taux de Tours corrects du POC inférieur au témoin de **5 points de pourcentage maximum**, et **aucune affirmation fausse critique** supplémentaire.

**INVALIDÉ** si les mesures sont complètes mais montrent absence de gain utile (moins de 20 % sur l'un des scénarios), dégradation de qualité au-delà de la tolérance ou fausses relations critiques. **INDÉTERMINÉ** si l'incertitude statistique empêche de conclure — en particulier si les 5 familles de questions de R ne suffisent pas à l'intervalle de confiance (cf. §5) —, si le score est indéfini (zéro Tour correct) ou si une comparaison importante n'est pas appariée. **NO-GO / protocole invalide** si des données sont fictives, le vrai sous-agent natif n'est pas utilisé, la télémétrie est lacunaire, ou les portes G0–G5 manquent. Ne pas rebaptiser un NO-GO en gain.

**Portée du verdict (correction n°7, revue croisée #174, 15/11/2026)** : Vibe contre CodeTour compare **deux systèmes et deux outillages** ; la campagne principale peut trancher le **gain produit** (comparaison contre le sous-agent natif Vibe) mais **ne prouve pas l'effet causal propre de la mémoire**. Le rapport (T08) doit distinguer explicitement **performance produit** et **mécanisme mémoire**. Un diagnostic d'ablation optionnel — **CodeTour, même harness, avec et sans mémoire** — peut éclairer l'attribution causale : il est **distinct des 80 runs**, ne **remplace pas Vibe** et ne modifie pas la pré-régistration.

**Extension 50** : uniquement si les données sont valides mais la borne de confiance ne permet pas de statuer ; compléter chaque cellule jusqu'à 50 avec tâches/règles déjà pré-enregistrées, **en augmentant la diversité des questions/familles** plutôt qu'en répétant les mêmes questions, sans changer prompts ni seuils, et **sans modifier les jeux de questions après avoir observé des résultats**. Si un agent produit zéro Tour correct et l'autre au moins un, signaler la dégradation plutôt que diviser par zéro. Fournir les métriques par série même si le score global est favorable.

## 8. Sous-tâches d'implémentation (une responsabilité et une preuve par ticket)

### T01 — Prompt de décomposition et tests de comportement
**Périmètre :** prompt d'exploration CodeTour uniquement, aucune modification du baseline Vibe.
**Livrable :** texte de §2.2 injecté une seule fois, tests avec catalogue vide/utile, primitive suffisante, relations manquantes et traces d'appels.
**Acceptation :** les comportements de §2.4 sont démontrés par tests ; aucune génération de plan verbeux imposée.

### T02 — Audit et remise en conformité technique #172
**Périmètre :** dix primitives, interface `function_try` TypeScript strict + whitelist + QuickJS, `memory_list(query)` / `memory_run`, traces, mémoire/consolidation. Réutiliser #172 plutôt que créer un second moteur.
**Livrable :** matrice exigence → chemin de code → test → résultat.
**Acceptation :** G0 entièrement vert. Ne pas déclarer conforme sur la seule base de noms de fichiers ou de tests hérités.

**Addendum complément #174 (15/11/2026) — robustesse du remplacement et validation de Tour :**
- **Robustesse au run :** `memory_run` contrôle la **révision** et la **validité des preuves** ; un résultat incertain ou obsolète produit un **signal explicite** et déclenche une exploration alternative, jamais une preuve périmée (cf. correction n°5 de la revue croisée).
- **Robustesse au remplacement :** avant de **remplacer** une fonction mémorisée, vérifier la candidate sur **ses propres paramètres ET un jeu représentatif de tests de l'ancienne version** (aucune régression silencieuse) ; conserver le **rollback**.
- **Signal concret de validation de Tour** déclenchant la consolidation : disponibilité d'une **sortie/contrat structuré**, **preuves structurelles**, **statut d'exécution** — **jamais** le juge aveugle du benchmark, qui évalue a posteriori.
- **Cas Tour partiel/échec :** aucune consolidation ; les traces restent enregistrées pendant le run ; **aucune mutation du catalogue en cours de run**.

### T03 — Intégration du véritable sous-agent Vibe
**Périmètre :** appeler le sous-agent de recherche natif comme produit par Vibe et obtenir ses résultats bruts, sans façade.
**Livrable :** adaptateur d'invocation vérifié, exécution sentinelle et manifeste d'identité/version/outils.
**Acceptation :** G1/G2 passent ; sinon ticket bloqué et aucun benchmark principal.

### T04 — Fixture PostgreSQL et jeu de questions scellé
**Périmètre :** checkout au SHA fixé, 20 tâches R et 20 tâches T, attentes sémantiques distinctes des prompts.
**Livrable :** manifeste JSON + empreinte, dossiers de preuves vérifiables, test d'intégrité du dépôt.
**Acceptation :** questions réelles, corrigées avant test, aucun indice de réponse envoyé aux agents.

### T05 — Instrumentation et runner équitable
**Périmètre :** exécutions appariées, isolation des mémoires et sessions, compteurs fournisseurs par appel, tous frais LLM, persistance des traces, contrôles NO-GO.
**Livrable :** runner + schéma JSON + tests d'injection (usage manquant, mauvais agent, mauvais SHA, reprise après erreur).
**Acceptation :** le runner refuse de produire des résultats principaux si provenance ou usage manquent ; aucun générateur mock en chemin de production.

### T06 — Évaluateur indépendant aveugle
**Périmètre :** vérifier pertinence, relations et preuves du code, sans agent ni coût visibles.
**Livrable :** grille, export anonymisé, arbitrage et verdict justifié.
**Acceptation :** il rejette des preuves qui pointent sur la bonne ligne mais affirment la mauvaise relation.

### T07 — Pilote technique, puis campagne figée
**Périmètre :** un pilote de connectivité non compté, gel du manifeste, exécution 20×2×2, éventuellement extension prédéfinie.
**Livrable :** traces complètes horodatées et fichiers bruts non modifiables.
**Acceptation :** toutes les portes satisfaites et les 80 exécutions retrouvables ; sinon publier NO-GO, pas de score de victoire.

**Note d'invalidation (15/11/2026) :** la campagne T07 intégrée ce jour est **INVALIDÉE et annulée (NO-GO)** — la revue de code a établi des exécuteurs simulés et des traces fabriquées (≈ 41 ms pour 480 appels LLM fictifs) ; aucun de ses chiffres n'est exploitable. Toute nouvelle campagne repart de cette version réconciliée, exige des exécutions et des traces **réelles**, et un **gel G5 effectif AVANT le premier run mesuré** (cf. §4 et tickets 05/07).

### T08 — Analyse et rapport contradictoire
**Périmètre :** générer métriques par série, coût marginal/cumulé, qualité, incertitude, break-even en tokens, différences de configuration.
**Livrable :** rapport Markdown + JSON complet + scripts de reproduction.
**Acceptation :** chaque nombre traçable à des runs réels ; conclusion VALIDÉ/INVALIDÉ/INDÉTERMINÉ/NO-GO imposée par §7, y compris si le résultat est négatif.

**Addendum complément #174 (15/11/2026) — rapport (correction n°7) :**
- Ne **jamais** transformer un nombre d'appels ou de réutilisations en économie de tokens attribuée à une fonction **sans contrefactuel valide** ; les appels/réutilisations sont des traces descriptives, pas une mesure directe d'économie.
- Distinguer « **validée techniquement** » (condition d'entrée) de « **bénéfice démontré expérimentalement** » (preuve a posteriori) pour chaque capacité évoquée.
- Distinguer explicitement **performance produit** (comparaison vs sous-agent natif Vibe) et **effet propre du mécanisme mémoire** (deux systèmes, deux outillages) ; l'ablation optionnelle même-harness avec/sans mémoire est un **diagnostic séparé**, distinct des 80 runs.
- L'inférence statistique suit l'**unité indépendante pré-enregistrée** (famille de questions/séquence, cf. §5 et §7) ; sinon INDÉTERMINÉ.

**Dépendances :** T01 et T02 avant tout benchmark ; T03 et T04 indépendants en parallèle ; T05 après T02/T03/T04 ; T06 après T04 ; T07 après T01–T06 ; T08 après T07. Ne pas déclarer une tâche finie parce que son code existe : exiger ses tests d'acceptation.

## 9. Hors périmètre et garde-fou éditorial

Ne pas optimiser pour la latence, l'argent, la taille des prompts isolément ou le nombre d'appels outils. Pas d'embeddings, score de fonctions, moteur de plans, caches de réponses, IA juge complaisante ou graphiques avec données fictives. Aucune modification du code de PostgreSQL. Pas d'intégration produit tant que le benchmark n'a pas produit un verdict valide.

**Règle pour l'implémenteur :** aucun chiffre favorable n'est publié sans lien vers ses traces réelles et l'évaluation indépendante ; un échec documenté est un résultat utile, une simulation déguisée ne l'est pas.
