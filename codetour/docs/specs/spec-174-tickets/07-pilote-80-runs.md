# T07 — Pilote de connectivité puis 80 runs

**Spec**: [Spec #174 — Benchmark PostgreSQL réel vs sous-agent Vibe natif + décomposition des tâches](../../../specs/postgres-real-benchmark-2026-11-15.md)

**Status**: 🔴 NO-GO — campagne INVALIDÉE (15/11/2026) : traces fabriquées ; à réexécuter après réconciliation de la source versionnée
**Priority**: High
**Blocked By**: T01 (Prompt), T02 (Audit #172), T03 (Vibe natif), T04 (Fixture), T05 (Runner), T06 (Évaluateur)
**Blocks**: T08 (Rapport)

## Objectif

Exécuter:
1. **Un pilote de connectivité** (1-2 demandes, non compté)
2. **La campagne principale** (80 exécutions réelles)

**Toutes les portes G0-G5 doivent être satisfaites avant de commencer.**

## 🔴 Invalidation de la campagne (15 novembre 2026)

La campagne intégrée le 15/11/2026 est **INVALIDÉE et annulée (NO-GO)** : la revue de code a démontré des exécuteurs **simulés** et des traces **fabriquées** (≈ 41 ms pour 480 appels LLM fictifs). **Aucun chiffre, aucune trace et aucune conclusion en provenance de cette campagne ne sont exploitables** ; les fichiers de traces existants sont des artefacts d'invalidation, pas des mesures.

Conditions impératives pour toute re-campagne ([revue croisée #174](https://github.com/maurice30120/codetour/issues/174#issuecomment-6898714632), complément au [protocole #174](https://github.com/maurice30120/codetour/issues/174)) :

- Appliquer d'abord le **prompt canonique unique** de la spec §2.2 (ancienne version « besoins concrets » supersédée) au POC, avec **SHA-256 calculé au gel G5** et référencé par le manifeste.
- **Mécanisme de gel réel** : hash calculé depuis le **contenu effectif du manifeste** ; manifeste **gelé AVANT le premier run mesuré** ; **aucun champ TBD** autorisé dans le manifeste gelé.
- Contrôle **SHA PostgreSQL + arbre propre AVANT CHAQUE RUN**, obligatoire et journalisé.
- Pilote de connectivité sur des **tâches hors benchmark**, **jamais compté** ; corrections techniques **versionnées** ; **aucun tuning** du contenu/critères à partir des résultats mesurés.
- Exécutions et traces **réelles** : commande/API lancée, modèle, usage tokens par appel fourni par le fournisseur, horodatages et durées cohérents, request ids quand disponibles. Tout exécuteur simulé ou trace synthétique = NO-GO immédiat.

## Périmètre

- **Pilote**: Test de la collecte et des garde-fous
- **Campaign**: 80 runs (2 séries × 2 agents × 20 questions)
- **Extension**: Possibilité d'étendre à 50 par série (100 total) si nécessaire

## Livrables

1. **Traces du pilote**: Preuve que la collecte fonctionne
2. **Manifeste gelé**: Prompts et protocole figés selon le calendrier sans équivoque de la spec §4 — **gel G5 final AVANT le premier run mesuré** (pilote hors benchmark jamais compté, corrections techniques versionnées)
3. **80 traces complètes**: horodatées et immuables
4. **Validation**: Toutes les portes satisfaites, tous les runs retrouvables

## Critères d'acceptation

### Pré-requis (toutes les portes doivent passer)

- [ ] **G0**: POC conforme à #172 ✅
- [ ] **G1**: Vibe authentique prouvé ✅
- [ ] **G2**: Instrumentation totale validée ✅
- [ ] **G3**: Fixture PostgreSQL valide ✅
- [ ] **G4**: Évaluateur indépendant fonctionnel ✅
- [ ] **G5**: Manifeste pré-enregistré et hashé ✅

**Si une porte échoue: NO-GO, pas de score de victoire.**

### Pilote de connectivité

✅ **1-2 demandes distinctes**:
- Tester la collecte des données
- Tester les garde-fous
- Tester l'instrumentation

✅ **Non compté**:
- Les résultats du pilote **ne sont pas** inclus dans le benchmark principal
- Les coûts du pilote **ne sont pas** inclus dans les calculs

✅ **Gel sans équivoque (correction n°9, revue croisée #174 — remplace « gel après le pilote »)**:
- Questions et critères préparés **avant tout test**
- Pilotage hors benchmark : pilote sur **tâches hors benchmark**, **jamais compté** ; corrections techniques **versionnées**
- **Gel G5 final AVANT le premier run mesuré** — hash calculé depuis le **contenu effectif du manifeste**, **aucun champ TBD**
- **Aucun ajustement** du contenu ou des critères à partir des résultats mesurés

### Campagne principale (80 runs)

#### Série R — Répétition (20 questions × 2 agents)

**Structure**:
- Agent CodeTour: 20 demandes, mémoire vierge au début, conservée entre les demandes
- Agent Vibe natif: 20 demandes, chaque dans une session indépendante
- **20 demandes par agent, 40 total pour la série R**

**Questions**: 5 questions de compréhension, chacune répétée 4 fois

**Ordre**: Ordre fixe à l'avance, alterné/contrebalancé entre agents

#### Série T — Transfert (20 questions × 2 agents)

**Structure**:
- Agent CodeTour: 20 demandes, **nouvelle mémoire vierge** au début de T
- Agent Vibe natif: 20 demandes, chaque dans une session indépendante
- **20 demandes par agent, 40 total pour la série T**

**Questions**: 10 questions d'amorçage + 10 questions nouvelles voisines

**Ordre**: Ordre fixe, alterné entre agents

### Total

| Série | CodeTour | Vibe natif | Total |
|-------|-----------|------------|-------|
| R | 20 | 20 | 40 |
| T | 20 | 20 | 40 |
| **Total** | **40** | **40** | **80** |

### Exécution

✅ **Appariement**:
- Même question exécutée par les deux agents
- Même ordre d'exécution (alterné/contrebalancé)
- Même configuration

✅ **Isolement**:
- Sessions isolées
- Pas de mémoire partagée entre agents
- SHA PostgreSQL vérifié avant chaque run
- Arbre propre vérifié avant chaque run

✅ **Traces**:
- Chaque run a un `run-id` unique
- Horodatage
- Agent réel
- Tous les appels LLM enregistrés
- Tous les tokens comptés
- Résultat brut
- Citations

✅ **Immuabilité**:
- Les fichiers de traces **ne peuvent pas être modifiés**
- Système de stockage append-only ou lecture seule après écriture
- Hash des traces vérifié après la campagne

### Évaluation

✅ **Évaluation aveugle**:
- Toutes les réponses évaluées **sans voir l'agent ou le coût**
- Utilisation de l'évaluateur de T06
- Résultats d'évaluation enregistrés

✅ **Tous les runs comptent**:
- Les runs partiels comptent dans le dénominateur
- Les erreurs comptent
- Les timeouts comptent
- **Seuls les échecs d'infrastructure hors agent** déclenchent un rejeu

### Extension à 50 demandes

**Seulement si**:
- Les données sont valides
- La borne de confiance ne permet pas de statuer
- Les tâches/règles sont **déjà** pré-enregistrées
- **Pas de changement** aux prompts ou seuils

**Processus**:
- Compléter chaque cellule (R et T) jusqu'à 50
- 50 demandes × 2 agents × 2 séries = **200 runs total**
- Si un agent produit 0 Tour correct et l'autre ≥1, signaler la dégradation

## Implémentation

### Étape 1: Préparer le pilote

> ⚠️ **Les questions du pilote doivent être HORS benchmark** (ni série R, ni série T, ni proches de leurs objectifs) et le pilote n'est **jamais compté**. L'exemple suivant est illustratif : le remplacer par des tâches hors benchmark. Le **gel G5 du manifeste intervient AVANT le premier run mesuré**, jamais « après ajustement » du contenu.

```typescript
// pilot.ts

async function runPilot() {
  const questions = [
    // 1-2 questions simples mais réelles
    {
      id: 'pilot-01',
      objective: 'Explain the main entry point of PostgreSQL',
      series: 'pilot',
      postgres_sha: '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5',
    },
    {
      id: 'pilot-02',
      objective: 'How does PostgreSQL parse a SQL query?',
      series: 'pilot',
      postgres_sha: '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5',
    },
  ];

  const results = [];
  
  for (const question of questions) {
    for (const agent of ['codetour', 'vibe-native'] as const) {
      const result = await runner.runSingle({ question, agent });
      results.push(result);
      
      // Sauvegarder
      await savePilotResult(result);
    }
  }

  // Valider que tout fonctionne
  await validatePilot(results);
  
  // Geler le manifeste
  await freezeManifest();
  
  return results;
}

async function validatePilot(results: RunResult[]) {
  // Vérifier que:
  // 1. Tous les runs ont réussi
  // 2. Tous les tokens sont comptés
  // 3. Les garde-fous fonctionnent
  // 4. L'évaluateur peut évaluer les réponses
  
  for (const result of results) {
    if (result.status !== 'success') {
      throw new Error(`Pilot failed for ${result.questionId}: ${result.error}`);
    }
    
    if (result.totalTokens.verified !== true) {
      throw new Error(`Token verification failed for ${result.questionId}`);
    }
  }
  
  // Évaluer les réponses du pilote
  const evaluations = await evaluatePilotResults(results);
  
  console.log('✅ Pilote validé');
  console.log('📊 Résultats:', evaluations);
}
```

### Étape 2: Exécuter la campagne principale

```typescript
// main-campaign.ts

async function runMainCampaign() {
  // Charger les questions
  const questions = await loadQuestions();
  
  // Valider toutes les portes
  if (!(await validateAllGates())) {
    throw new Error('NO-GO: Non toutes les portes G0-G5 ne sont pas satisfaites');
  }
  
  // Vérifier que le manifeste est gelé
  if (!(await isManifestFrozen())) {
    throw new Error('NO-GO: Manifeste non gelé');
  }
  
  console.log('🚀 Début de la campagne principale');
  console.log('✅ Toutes les portes G0-G5 satisfaites');
  console.log('✅ Manifeste gelé');
  
  const allResults: RunResult[] = [];
  
  // Exécuter série R
  console.log('\n📊 Série R — Répétition');
  const rResults = await runSeries('R', questions.filter(q => q.series === 'R'));
  allResults.push(...rResults);
  
  // Exécuter série T
  console.log('\n📊 Série T — Transfert');
  const tResults = await runSeries('T', questions.filter(q => q.series === 'T'));
  allResults.push(...tResults);
  
  console.log('\n✅ Campagne terminée');
  console.log(`📈 Total: ${allResults.length} runs`);
  
  // Valider que tous les runs sont retrouvables
  await validateAllRunsRetrievable(allResults);
  
  // Évaluer toutes les réponses
  const evaluations = await evaluateAllResults(allResults);
  
  // Calculer les métriques
  const metrics = calculateMetrics(allResults, evaluations);
  
  console.log('\n📊 Métriques préliminaires:');
  console.log(metrics);
  
  return {
    results: allResults,
    evaluations,
    metrics,
  };
}

async function runSeries(series: 'R' | 'T', questions: Question[]) {
  const results: RunResult[] = [];
  
  // Pour la série T, réinitialiser la mémoire CodeTour
  if (series === 'T') {
    await resetCodeTourMemory();
  }
  
  // Exécuter chaque question pour chaque agent
  for (const question of questions) {
    for (const agent of ['codetour', 'vibe-native'] as const) {
      console.log(`  Running ${agent} for ${question.id}...`);
      
      const result = await runner.runSingle({ question, agent });
      results.push(result);
      
      // Sauvegarder immédiatement
      await saveRunResult(result);
      
      console.log(`    ✅ ${result.runId} — Tokens: ${result.totalTokens.total}`);
    }
  }
  
  return results;
}
```

### Étape 3: Gérer les échecs

```typescript
// failure-handler.ts

function handleFailure(error: Error, context: RunContext) {
  // Les échecs d'infrastructure hors agent peuvent déclencher un rejet
  const infrastructureErrors = [
    'network_error',
    'service_unavailable',
    'timeout',
  ];
  
  if (infrastructureErrors.some(e => error.message.includes(e))) {
    // Rejouer selon la règle commune documentée
    console.warn(`⚠️  Infrastructure failure for ${context.questionId}: ${error.message}`);
    console.warn('🔄 Replaying according to documented rule...');
    return { action: 'retry', reason: error.message };
  }
  
  // Pour les échecs de l'agent lui-même:
  // - Ne PAS effacer
  // - Ne PAS remplacer
  // - Compter dans le dénominateur
  console.error(`❌ Agent failure for ${context.questionId}: ${error.message}`);
  return { action: 'record', reason: error.message };
}
```

## Fichiers à créer/modifier

- [ ] `poc/benchmark/pilot.ts`
- [ ] `poc/benchmark/main-campaign.ts`
- [ ] `poc/benchmark/failure-handler.ts`
- [ ] `poc/benchmark/results/runs/` (stockage des runs)
- [ ] `poc/benchmark/results/pilot/` (stockage du pilote)
- [ ] `poc/benchmark/manifest-lock.json` (manifeste gelé)

## Dépendances

- **T01**: Prompt de décomposition injecté
- **T02**: Audit #172 terminé (G0 passe)
- **T03**: Connecteur Vibe natif fonctionnel (G1/G2 passent)
- **T04**: Fixture PostgreSQL valide (G3 passe)
- **T05**: Runner et compteurs fonctionnels
- **T06**: Évaluateur aveugle fonctionnel (G4 passe)
- **G5**: Manifeste pré-enregistré

## Risques

- **Risque**: La campagne prend trop de temps
  - **Mitigation**: Exécution parallèle, estimation du temps nécessaire

- **Risque**: Coût élevé des 80 runs
  - **Mitigation**: Budget alloué, suivi en temps réel

- **Risque**: Problèmes de connectivité pendant la campagne
  - **Mitigation**: Pilote de connectivité, répliques de sauvegarde

## Validation

- [ ] Pilote exécuté et validé
- [ ] Manifeste gelé après le pilote
- [ ] 80 runs exécutés
- [ ] Toutes les traces sont immuables
- [ ] Toutes les portes G0-G5 satisfaites pendant toute la campagne
- [ ] Toutes les traces sont retrouvables

## Preuves requises

1. Résultats du pilote
2. Preuve que le manifeste est gelé
3. Liste complète des 80 runs avec:
   - run-id
   - timestamp
   - agent
   - question_id
   - status
   - total_tokens
4. Preuve d'immuabilité des traces
5. Résultats de l'évaluation aveugle
6. Validation que toutes les portes étaient satisfaites

## Liens

- [Spec #174 Issue](https://github.com/maurice30120/codetour/issues/174)
- [T01 — Prompt](01-prompt-decomposition.md)
- [T02 — Audit #172](02-audit-conformite-172.md)
- [T03 — Vibe natif](03-connecteur-vibe-natif.md)
- [T04 — Fixture PostgreSQL](04-fixture-postgres.md)
- [T05 — Runner](05-runner-compteurs.md)
- [T06 — Évaluateur](06-evaluateur-aveugle.md)
