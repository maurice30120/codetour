# Spécification — Benchmark réel CodeTour vs sous-agent de recherche natif Vibe sur PostgreSQL

**Statut :** proposition de protocole, à implémenter puis pré-enregistrer avant toute mesure.
**Date :** 2026-11-15
**Liens :** [spec fonctionnelle #172](https://github.com/maurice30120/codetour/issues/172) ; [PR POC #173](https://github.com/maurice30120/codetour/pull/173).
**But unique d'optimisation :** réduire la consommation **réelle et totale de tokens LLM** par Tour correct, sans dégrader la qualité. Ni la latence ni le coût monétaire ne servent à décider.

## 0. Constat et règle d'honnêteté

La PR #173 annonce 77–82 % d'économies, mais les rapports de comparaison Vibe qu'elle embarque utilisent des jeux `*-mock.json`. Ces chiffres NE SONT PAS une mesure du sous-agent natif Vibe. Les essais historiques sur PostgreSQL sont exploratoires, souvent partiels, et ne valident pas l'hypothèse. Tout rapport doit porter explicitement l'un des trois états : `mesure réelle vérifiée`, `diagnostic/pilote sans portée comparative`, `simulation — interdite dans le résultat principal`.

**Interdit :** créer des compteurs de tokens, des réponses, des résultats Vibe, des jugements de qualité ou des exécutions fictifs ; remplacer sans l'indiquer le sous-agent de recherche natif par Vibe headless, le harnais sans mémoire, une façade de ses outils, ou une approximation ; annoncer un pourcentage non calculé depuis les traces réelles. Si le sous-agent natif ou la télémétrie ne sont pas accessibles, **ARRÊT : benchmark principal non réalisable**. Ne pas contourner.

## 1. Conditions de démarrage (portes bloquantes)

- [ ] **G0 — conformité POC à #172** : dix primitives testées et bornées ; `function_try(source,params)` valide du TypeScript en mode strict, restreint aux dix primitives, transpile et exécute en QuickJS avec traces ; `memory_list(query)` et `memory_run(id,params)` fonctionnent ; aucune fonction mémorisée n'appelle une autre fonction mémorisée ; consolidation uniquement après Tour validé, sur version réellement essayée ; pas de cache de réponses ni de purge par inactivité. Des interfaces `code` JavaScript / `list,read,search` seules ne suffisent pas. Chaque exigence possède un test automatique concret.
- [ ] **G1 — Vibe authentique** : une exécution sentinelle prouve l'invocation du **sous-agent de recherche natif de Vibe**, avec nom/API/version, identifiant d'exécution, outils réellement utilisés, configuration modèle, résultat et vraie consommation de tokens. Une simple session Vibe headless ou un adaptateur qui simule ses actions ne satisfait pas la porte.
- [ ] **G2 — instrumentation totale** : compteurs fiables côté fournisseur / infrastructure pour chaque appel de modèle, y compris orchestrateur et sous-agent Vibe, prompts, recherches, retries, corrections et consolidation POC. Si un appel LLM n'a pas de mesure fiable, marquer `usage_missing=true` et ne PAS calculer de gain global.
- [ ] **G3 — fixture réelle** : clone en lecture seule de `postgres/postgres` au SHA **`70c4a57b64d39c526eb4c44a925eb92a6e56f3c5`**, sous-modules/checkout/étendue documentés, état propre, empreinte vérifiée avant chaque série. Même arbre pour les deux agents. Les citations doivent viser le code de ce SHA.
- [ ] **G4 — évaluateur indépendant** : format commun des réponses, vérification à l'aveugle contre le code, protocole de désaccord, et seuils de qualité définis **avant** d'observer les résultats.
- [ ] **G5 — pré-enregistrement** : tâche, ordre, version des prompts, modèles, paramètres, plafonds, politique cache, grille de notation et seuils écrits dans un manifeste hashé, non modifié pendant le benchmark.

Tout G0–G5 non satisfait = **NO-GO** ; aucun benchmark principal n'est lancé, aucune économie n'est publiée.

## 2. Incitation à la décomposition : changement produit à effectuer AVANT le benchmark

### 2.1 Comportement voulu

L'agent qui prépare un Tour doit chercher à **décomposer le besoin en quelques questions de recherche réutilisables** plutôt que générer d'emblée une grosse fonction ad hoc. Pour chaque besoin, il explore d'abord les fonctions déjà mémorisées ; si une fonction convient, il l'exécute avec des paramètres pertinents ; sinon il utilise une primitive existante ou essaie la **plus petite** fonction TypeScript générique réellement nécessaire. Les étapes peuvent rester internes ; **ne pas imposer de long plan narratif au LLM**. La décomposition est une heuristique, pas un objectif en soi : elle ne doit pas multiplier artificiellement les appels.

### 2.2 Texte court à injecter au prompt d'exploration du POC (pas dans Vibe)

> Avant d'explorer, décompose mentalement l'objectif du Tour en quelques besoins concrets et indépendants : localiser les points d'entrée, repérer les appels ou définitions, suivre les relations, vérifier les lignes de preuve. Pour chaque besoin, recherche d'abord une fonction réutilisable via `memory_list(query)`. Si elle convient, utilise `memory_run(id, params)` avec les bons paramètres. Sinon, utilise une primitive disponible ou essaie avec `function_try(source, params)` la plus petite fonction TypeScript réutilisable qui répond à ce besoin. Privilégie les opérations ciblées, paramétrées et vérifiables. Ne crée pas une fonction si un appel existant suffit. Ne recommence pas une recherche de catalogue sans raison nouvelle. Regroupe les besoins si cela évite des appels, arrête l'exploration dès que les preuves sont suffisantes, et signale les relations non démontrées. Ne mémorise jamais une réponse figée : seules des procédures réellement exécutées sont candidates à la consolidation après validation du Tour.

Ne pas mettre ce texte dans le comparateur natif Vibe ; il doit conserver son comportement par défaut. Journaliser la version et l'empreinte du prompt exact envoyé.

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

## 3. Benchmark PostgreSQL : données et tâches pré-enregistrées

Source : `https://github.com/postgres/postgres` au SHA G3, déjà utilisé dans `poc/exploration-benchmark/`. Réutiliser et **réviser** `postgres-tour-tasks.json` et `screen-postgres.mjs` : les seules lignes attendues ne prouvent pas la justesse sémantique.

Deux séries isolées :

**R — répétition** : cinq questions réelles de compréhension du code PostgreSQL, chacune répétée quatre fois selon un ordre fixé à l'avance : **20 demandes par agent**. L'agent CodeTour part d'une mémoire vide et la conserve entre ses 20 demandes ; Vibe démarre chaque demande dans une session indépendante (hors mémoire native explicitement documentée).

**T — transfert** : dix demandes de construction d'expérience sur des parcours du code, puis dix demandes nouvelles mais voisines, pré-définies, non identiques et non visibles comme réponses aux agents : **20 demandes par agent**. Nouvelle mémoire CodeTour vierge au début de T ; pas de mémoire issue de R. Les dix demandes d'amorçage T sont **comptées** dans le coût et la qualité, jamais exclues du résultat.

**Total principal minimal : 80 exécutions réelles (2 séries × 2 agents × 20 demandes).** Une extension éventuelle à 50 demandes par série et agent est décidée selon les règles pré-enregistrées, jamais en fonction de la seule beauté du score.

Pour chaque demande, figer avant le test : `id`, `objective`, `series`, `phase`, `repeat_index`, `postgres_sha`, éventuelles zones attendues pour l'évaluateur **non révélées aux agents**, critères de correction et relations à vérifier. Les cas doivent couvrir du code réellement présent ; aucune question imaginaire ou résultat mock.

Le dossier de référence est rédigé/vérifié par un évaluateur distinct avant les runs, avec plusieurs chemins de preuves admissibles pour éviter le surapprentissage d'une ligne précise. Requêtes et attentes pré-enregistrées, prompts identiques entre agents sauf consignes propres à leur système de recherche. Ne pas entraîner/ajuster le POC sur ce jeu de mesure après gel.

## 4. Conditions d'équité, exécution et provenance

- Utiliser le **même modèle, version, température, repo/commit, objectifs de sortie et limite de tokens** chaque fois que Vibe le permet. Documenter chaque divergence ; une différence substantielle de modèle, d'accès au dépôt ou de plafond empêche une attribution causale du gain.
- Respecter les outils natifs de Vibe, ne pas lui imposer les dix primitives du POC. Aucune mémoire partagée entre les agents. Ne pas transmettre au modèle les solutions de référence.
- Fixer une enveloppe tokens et des limites d'appels par demande avant les runs ; comptabiliser les dépassements mesurés, les retries et les interruptions, sans retrancher les runs ratés.
- Alterner/contrebalancer l'ordre d'exécution des agents pour limiter les effets de service ; conserver l'ordre chronologique d'apprentissage **au sein** de chaque série CodeTour.
- Isoler les sessions et snapshots ; ne pas muter PostgreSQL ; vérifier SHA et arbre propre à chaque run.
- Un pilote de connectivité de 1–2 demandes distinctes sert à tester la collecte et les garde-fous, **jamais** à ajuster les tâches ni à entrer dans les chiffres de la série principale. Geler les prompts et le plan après ce pilote.
- Chaque run produit un journal `run-id` immuable : date, agent réel, versions exactes, commande/API lancée, modèle, paramètres, SHA PostgreSQL, hash des prompts et du manifeste, appels outils, fonctions créées/essayées/réutilisées/remplacées, traces d'erreur, résultat brut, citations, usage tokens par appel et sommes contrôlées. Aucune clé secrète dans les traces.

## 5. Mesure des tokens : source de vérité

**Mesure primaire :** somme réelle des tokens LLM d'entrée et de sortie de **tous les appels** nécessaires à la demande, à la consolidation et aux corrections. Les tokens d'entrée servis depuis un cache sont déjà inclus dans l'entrée totale du fournisseur : les déclarer séparément, **sans double comptage**. Fournir aussi les éventuels compteurs billed/cache-read/cache-write à titre descriptif. Sur Vibe, inclure orchestrateur + recherche native + post-traitement LLM nécessaires au résultat ; sur CodeTour, inclure recherche, `memory_list`, essais `function_try`, diagnostics, retries, sélection et consolidation. Aucun coût de l'évaluateur indépendant n'est attribué à l'un ou l'autre : il est rapporté séparément et symétriquement.

Calculer par série et par agent : tokens totaux **cumulés**, tokens marginaux par demande et par rang, évolution des tokens après apprentissage, taux de Tours corrects, tokens totaux / nombre de Tours corrects (si dénominateur non nul), couverture/pertinence des preuves, fausses relations, fonctions réellement réutilisées, coûts d'apprentissage, point de rentabilité **en tokens**. Ne pas utiliser le coût $ comme critère de décision.

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
3. Intervalle de confiance bootstrap apparié à 95 % de la réduction **strictement supérieur à 0** ;
4. Taux de Tours corrects du POC inférieur au témoin de **5 points de pourcentage maximum**, et **aucune affirmation fausse critique** supplémentaire.

**INVALIDÉ** si les mesures sont complètes mais montrent absence de gain utile (moins de 20 % sur l'un des scénarios), dégradation de qualité au-delà de la tolérance ou fausses relations critiques. **INDÉTERMINÉ** si l'incertitude statistique empêche de conclure, si le score est indéfini (zéro Tour correct) ou si une comparaison importante n'est pas appariée. **NO-GO / protocole invalide** si des données sont fictives, le vrai sous-agent natif n'est pas utilisé, la télémétrie est lacunaire, ou les portes G0–G5 manquent. Ne pas rebaptiser un NO-GO en gain.

**Extension 50** : uniquement si les données sont valides mais la borne de confiance ne permet pas de statuer ; compléter chaque cellule jusqu'à 50 avec tâches/règles déjà pré-enregistrées, sans changer prompts ni seuils. Si un agent produit zéro Tour correct et l'autre au moins un, signaler la dégradation plutôt que diviser par zéro. Fournir les métriques par série même si le score global est favorable.

## 8. Sous-tâches d'implémentation (une responsabilité et une preuve par ticket)

### T01 — Prompt de décomposition et tests de comportement
**Périmètre :** prompt d'exploration CodeTour uniquement, aucune modification du baseline Vibe.
**Livrable :** texte de §2.2 injecté une seule fois, tests avec catalogue vide/utile, primitive suffisante, relations manquantes et traces d'appels.
**Acceptation :** les comportements de §2.4 sont démontrés par tests ; aucune génération de plan verbeux imposée.

### T02 — Audit et remise en conformité technique #172
**Périmètre :** dix primitives, interface `function_try` TypeScript strict + whitelist + QuickJS, `memory_list(query)` / `memory_run`, traces, mémoire/consolidation. Réutiliser #172 plutôt que créer un second moteur.
**Livrable :** matrice exigence → chemin de code → test → résultat.
**Acceptation :** G0 entièrement vert. Ne pas déclarer conforme sur la seule base de noms de fichiers ou de tests hérités.

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

### T08 — Analyse et rapport contradictoire
**Périmètre :** générer métriques par série, coût marginal/cumulé, qualité, incertitude, break-even en tokens, différences de configuration.
**Livrable :** rapport Markdown + JSON complet + scripts de reproduction.
**Acceptation :** chaque nombre traçable à des runs réels ; conclusion VALIDÉ/INVALIDÉ/INDÉTERMINÉ/NO-GO imposée par §7, y compris si le résultat est négatif.

**Dépendances :** T01 et T02 avant tout benchmark ; T03 et T04 indépendants en parallèle ; T05 après T02/T03/T04 ; T06 après T04 ; T07 après T01–T06 ; T08 après T07. Ne pas déclarer une tâche finie parce que son code existe : exiger ses tests d'acceptation.

## 9. Hors périmètre et garde-fou éditorial

Ne pas optimiser pour la latence, l'argent, la taille des prompts isolément ou le nombre d'appels outils. Pas d'embeddings, score de fonctions, moteur de plans, caches de réponses, IA juge complaisante ou graphiques avec données fictives. Aucune modification du code de PostgreSQL. Pas d'intégration produit tant que le benchmark n'a pas produit un verdict valide.

**Règle pour l'implémenteur :** aucun chiffre favorable n'est publié sans lien vers ses traces réelles et l'évaluation indépendante ; un échec documenté est un résultat utile, une simulation déguisée ne l'est pas.
