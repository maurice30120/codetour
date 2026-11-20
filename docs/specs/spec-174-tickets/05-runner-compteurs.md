# T05 — Runner et compteurs

**Spec**: [Spec #174 — Benchmark PostgreSQL réel vs sous-agent Vibe natif + décomposition des tâches](../../../specs/postgres-real-benchmark-2026-11-15.md)

**Status**: ⏳ Not Started
**Priority**: High
**Blocked By**: T02 (Audit #172), T03 (Connecteur Vibe natif), T04 (Fixture PostgreSQL)
**Blocks**: T07 (Pilote + 80 runs)

## Objectif

Créer un **runner équitable** qui:
1. Exécute les agents CodeTour et Vibe natif de manière appariée
2. Isole les mémoires et sessions
3. Capture tous les compteurs de tokens (fournisseur)
4. Persiste les traces de manière immuable
5. Contrôle les conditions NO-GO

**Ce ticket bloque T07**. Ne peut pas démarrer avant que T02, T03, T04 soient terminés.

## ⚠️ Addendum — invalidation T07 + mécanisme de gel réel (15 novembre 2026)

La campagne T07 intégrée le 15/11/2026 est **INVALIDÉE (NO-GO)** : la revue de code a démontré des **traces fabriquées** — exécuteurs simulés, ≈ 41 ms pour 480 appels LLM fictifs. **Aucun de ses chiffres n'est exploitable.** Conséquences pour ce ticket :

- Le **mécanisme de gel doit être réel** : hash calculé à partir du **contenu effectif du manifeste**, manifeste **gelé AVANT le premier run mesuré**, et **aucun champ TBD** autorisé dans le manifeste gelé.
- Le contrôle **SHA PostgreSQL + arbre propre est obligatoire AVANT CHAQUE RUN** (pas seulement par série), exécuté et journalisé à chaque run.
- Le pilote de connectivité s'exécute sur des **tâches hors benchmark** et n'est **jamais compté** ; les corrections techniques qu'il révèle sont **versionnées** ; **aucun ajustement** du contenu/critères à partir des résultats mesurés (cf. correction n°9 de la [revue croisée #174](https://github.com/maurice30120/codetour/issues/174#issuecomment-6898714632)).
- Les traces doivent venir d'exécutions **réelles** : commande/API lancée, modèle, usage tokens par appel fourni par le fournisseur, horodatages et durées cohérents entre appels, request ids du fournisseur quand disponibles ; tout générateur simulé en chemin de production = NO-GO immédiat.

## Périmètre

- **Runner**: Script/programme qui orchestrer les exécutions
- **Compteurs**: Récupération des tokens depuis le fournisseur
- **Traces**: Logging complet et immuable
- **Contrôles**: Vérification des conditions avant exécution

## Livrables

1. **Runner**: Programme d'orchestration
2. **Schéma JSON**: Format des traces et résultats
3. **Tests d'injection**: Vérifier les contrôles NO-GO
4. **Validation**: Preuve que le runner fonctionne

## Critères d'acceptation

### Appariement équitable

✅ **Même configuration**:
- Même modèle LLM
- Même version
- Même température
- Même repo/commit (PostgreSQL)
- Même objectifs de sortie
- Même limite de tokens

✅ **Documentation des divergences**:
- Si une divergence est nécessaire, la documenter
- Une divergence substantielle empêche l'attribution causale

### Isolation

✅ **Isolation des mémoires**:
- CodeTour: une mémoire vierge pour la série R, une nouvelle pour la série T
- Vibe: chaque demande dans une session indépendante (hors mémoire native explicitement documentée)
- **Pas de mémoire partagée** entre les agents

✅ **Isolation des sessions**:
- Chaque run est isolé
- Pas de mutation de PostgreSQL
- SHA et arbre propre vérifiés avant chaque run

### Instrumentation

✅ **Compteurs fournisseur**:
- Récupération des tokens **depuis le fournisseur**
- Pour chaque appel de modèle
- Y compris orchestrateur et sous-agent Vibe
- Prompts, recherches, retries, corrections, consolidation

✅ **Traçabilité**:
- Chaque run a un `run-id` unique
- Date/heure
- Agent réel (CodeTour ou Vibe natif)
- Versions exactes
- Commande/API lancée
- Modèle et paramètres
- SHA PostgreSQL
- Hash des prompts et du manifeste
- Appels outils
- Fonctions créées/essayées/réutilisées/remplacées
- Traces d'erreur
- Résultat brut
- Citations
- Usage tokens par appel
- Sommes contrôlées

### Contrôles NO-GO

✅ **Le runner REFUSE de produire des résultats principaux si**:
- Provenance manquante (quel agent ? quelle question ?)
- Usage tokens manquant
- Mauvais agent (pas celui attendu)
- Mauvais SHA PostgreSQL
- Fixture corrompue

✅ **Aucun générateur mock en chemin de production**:
- Pas de `*-mock.json`
- Pas de données inventées
- Pas de simulation

### Pilote de connectivité

✅ **1-2 demandes distinctes** pour tester:
- La collecte des données
- Les garde-fous
- L'instrumentation

✅ **Jamais** utiliser le pilote pour:
- Ajustement des tâches
- Entrer dans les chiffres de la série principale
- Modifier les seuils

✅ **Gel sans équivoque (correction n°9, revue croisée #174 — remplace « geler après le pilote »)**:
- Questions, critères et grilles préparés **avant tout test**
- Pilote **hors benchmark**, jamais compté ; corrections techniques **versionnées**
- **Gel G5 final AVANT le premier run mesuré** : hash calculé depuis le **contenu effectif du manifeste**, **aucun champ TBD** autorisé
- **Aucun ajustement** du contenu ou des critères à partir des résultats mesurés

## Implémentation

### Structure des fichiers

```
poc/benchmark/
├── runner/
│   ├── src/
│   │   ├── index.ts          # Point d'entrée
│   │   ├── agents/
│   │   │   ├── codetour.ts    # Agent CodeTour
│   │   │   └── vibe.ts        # Agent Vibe natif
│   │   ├── execution/
│   │   │   ├── manager.ts     # Gestion des exécutions
│   │   │   └── tracker.ts     # Suivi des tokens
│   │   └── storage/
│   │       └── logger.ts     # Logging immuable
│   ├── schemas/
│   │   └── run-schema.json   # Schéma JSON des runs
│   └── test/
│       ├── injection.test.ts # Tests d'injection
│       └── runner.test.ts    # Tests du runner
├── results/
│   └── runs/                 # Stockage des runs
└── manifest.json            # Manifeste scellé
```

### Schéma JSON (run-schema.json)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "run_id": {"type": "string", "format": "uuid"},
    "timestamp": {"type": "string", "format": "date-time"},
    "agent": {"type": "string", "enum": ["codetour", "vibe-native"]},
    "agent_version": {"type": "string"},
    "model": {"type": "string"},
    "model_params": {
      "type": "object",
      "properties": {
        "temperature": {"type": "number"},
        "max_tokens": {"type": "integer"},
        "top_p": {"type": "number"}
      }
    },
    "question_id": {"type": "string"},
    "series": {"type": "string", "enum": ["R", "T"]},
    "phase": {"type": "string", "enum": ["repetition", "transfer", "priming"]},
    "repeat_index": {"type": "integer"},
    "postgres_sha": {"type": "string", "pattern": "^[a-f0-9]{40}$"},
    "manifest_hash": {"type": "string"},
    "prompt_hash": {"type": "string"},
    "calls": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "call_id": {"type": "string"},
          "call_type": {"type": "string", "enum": ["prompt", "search", "tool", "memory_list", "memory_run", "function_try", "consolidation", "retry", "correction"]},
          "input_tokens": {"type": "integer", "minimum": 0},
          "output_tokens": {"type": "integer", "minimum": 0},
          "duration_ms": {"type": "integer", "minimum": 0},
          "tool_name": {"type": "string"},
          "parameters": {"type": "object"},
          "result": {"type": ["string", "object", "null"]},
          "error": {"type": ["string", "null"]},
          "usage_missing": {"type": "boolean"}
        },
        "required": ["call_id", "call_type", "input_tokens", "output_tokens"]
      }
    },
    "functions_created": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "function_id": {"type": "string"},
          "source": {"type": "string"},
          "parameters_schema": {"type": "object"},
          "created_at": {"type": "string", "format": "date-time"},
          "reuse_count": {"type": "integer", "minimum": 0}
        }
      }
    },
    "functions_reused": {
      "type": "array",
      "items": {"type": "string"}
    },
    "total_tokens": {
      "type": "object",
      "properties": {
        "input": {"type": "integer", "minimum": 0},
        "output": {"type": "integer", "minimum": 0},
        "total": {"type": "integer", "minimum": 0},
        "verified": {"type": "boolean"}
      }
    },
    "result": {
      "type": "object",
      "properties": {
        "tour_title": {"type": "string"},
        "steps": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "step_id": {"type": "string"},
              "description": {"type": "string"},
              "file": {"type": "string"},
              "line": {"type": "integer"},
              "citations": {
                "type": "array",
                "items": {"type": "string"}
              }
            }
          }
        },
        "raw_response": {"type": "string"},
        "citations": {
          "type": "array",
          "items": {"type": "string"}
        }
      }
    },
    "error": {"type": ["string", "null"]},
    "status": {"type": "string", "enum": ["success", "error", "timeout"]}
  },
  "required": ["run_id", "timestamp", "agent", "question_id", "series", "postgres_sha", "calls", "total_tokens"]
}
```

### Runner principal

```typescript
// runner/src/index.ts

interface RunnerOptions {
  questionsFile: string;
  manifestFile: string;
  postgresPath: string;
  outputDir: string;
  maxConcurrent: number;
  retryPolicy: RetryPolicy;
}

interface RunResult {
  runId: string;
  questionId: string;
  agent: 'codetour' | 'vibe-native';
  series: 'R' | 'T';
  totalTokens: { input: number; output: number; total: number };
  status: 'success' | 'error' | 'timeout';
  error?: string;
}

class BenchmarkRunner {
  constructor(private options: RunnerOptions) {}

  async runAll(): Promise<RunResult[]> {
    const results: RunResult[] = [];
    const questions = await this.loadQuestions();
    
    // Valider toutes les portes G0-G5 avant de commencer
    if (!(await this.validateGates())) {
      throw new Error('NO-GO: Gates G0-G5 not all satisfied');
    }

    // Pilote de connectivité : tâches HORS benchmark, jamais compté
    await this.runPilot();
    
    // Gel G5 : hash calculé depuis le CONTENU DU MANIFESTE, AVANT le premier
    // run mesuré, aucun champ TBD autorisé (cf. addendum invalidation T07, 15/11/2026)
    await this.freezeManifest();

    // Exécuter les 80 runs
    for (const question of questions) {
      for (const agent of ['codetour', 'vibe-native'] as const) {
        const result = await this.runSingle({
          question,
          agent,
        });
        results.push(result);
        
        // Sauvegarder immédiatement (immuable)
        await this.saveRun(result);
      }
    }

    return results;
  }

  private async validateGates(): Promise<boolean> {
    // Vérifier G0-G5
    const g0 = await this.validateG0(); // Audit #172
    const g1 = await this.validateG1(); // Vibe authentique
    const g2 = await this.validateG2(); // Instrumentation
    const g3 = await this.validateG3(); // Fixture
    const g4 = await this.validateG4(); // Évaluateur
    const g5 = await this.validateG5(); // Pré-enregistrement
    
    return g0 && g1 && g2 && g3 && g4 && g5;
  }

  private async runSingle(params: { question: Question; agent: AgentType }): Promise<RunResult> {
    // 1. Vérifier provenance
    if (!this.verifyProvenance(params)) {
      throw new Error('NO-GO: Provenance check failed');
    }

    // 2. Exécuter l'agent
    const execution = await this.runAgent(params);
    
    // 3. Vérifier usage
    if (execution.calls.some(call => call.usage_missing)) {
      throw new Error('NO-GO: Usage missing for some calls');
    }

    // 4. Calculer les tokens totaux
    const totalTokens = execution.calls.reduce((acc, call) => {
      return {
        input: acc.input + call.input_tokens,
        output: acc.output + call.output_tokens,
        total: acc.total + call.input_tokens + call.output_tokens,
      };
    }, { input: 0, output: 0, total: 0 });

    // 5. Sauvegarder
    return {
      runId: generateRunId(),
      questionId: params.question.id,
      agent: params.agent,
      series: params.question.series,
      totalTokens,
      status: execution.status,
      error: execution.error,
    };
  }

  private async saveRun(result: RunResult): Promise<void> {
    // Sauvegarder dans un fichier immuable
    // Utiliser un système de stockage qui empêche la modification
    // Ex: append-only log, ou système de fichiers en lecture seule après écriture
  }
}
```

### Tests d'injection

```typescript
// runner/test/injection.test.ts

describe('NO-GO Controls', () => {
  let runner: BenchmarkRunner;

  beforeEach(() => {
    runner = new BenchmarkRunner({ ... });
  });

  it('should refuse if provenance is missing', async () => {
    const params = { question: { id: 'test' }, agent: 'codetour' };
    
    // Simuler une provenance manquante
    (runner as any).verifyProvenance = () => false;
    
    await expect(runner.runSingle(params)).rejects.toThrow('NO-GO: Provenance check failed');
  });

  it('should refuse if usage is missing', async () => {
    // Simuler un appel avec usage_missing=true
    const execution = {
      calls: [{ call_id: '1', call_type: 'prompt', input_tokens: 100, output_tokens: 50, usage_missing: true }],
      status: 'success',
    };
    
    // Le runner doit détecter usage_missing et refuser
    await expect(runner.runSingle({ question: { id: 'test' }, agent: 'codetour' }))
      .rejects.toThrow('NO-GO: Usage missing');
  });

  it('should refuse if wrong agent', async () => {
    // Simuler un mauvais agent
    await expect(runner.runSingle({ question: { id: 'test' }, agent: 'fake-agent' as any }))
      .rejects.toThrow('NO-GO');
  });

  it('should refuse if wrong PostgreSQL SHA', async () => {
    // Simuler un mauvais SHA
    await expect(runner.runSingle({ 
      question: { id: 'test', postgres_sha: 'wrong-sha' }, 
      agent: 'codetour' 
    }))
      .rejects.toThrow('NO-GO');
  });
});
```

## Fichiers à créer

- [ ] `poc/benchmark/runner/package.json`
- [ ] `poc/benchmark/runner/tsconfig.json`
- [ ] `poc/benchmark/runner/src/index.ts`
- [ ] `poc/benchmark/runner/src/agents/codetour.ts`
- [ ] `poc/benchmark/runner/src/agents/vibe.ts`
- [ ] `poc/benchmark/runner/src/execution/manager.ts`
- [ ] `poc/benchmark/runner/src/execution/tracker.ts`
- [ ] `poc/benchmark/runner/src/storage/logger.ts`
- [ ] `poc/benchmark/runner/schemas/run-schema.json`
- [ ] `poc/benchmark/runner/test/injection.test.ts`
- [ ] `poc/benchmark/runner/test/runner.test.ts`

## Dépendances

- **T02**: Audit #172 terminé (G0 passe)
- **T03**: Connecteur Vibe natif fonctionnel (G1/G2 passent)
- **T04**: Fixture PostgreSQL valide (G3 passe)
- **Node.js**: Pour exécuter le runner
- **TypeScript**: Pour le développement

## Risques

- **Risque**: Runner trop lent pour 80 exécutions
  - **Mitigation**: Exécution parallèle avec limite de concurrence

- **Risque**: Perte de données si crash
  - **Mitigation**: Sauvegarde immuable après chaque run

- **Risque**: Incohérence entre les runs
  - **Mitigation**: Hash des prompts et manifeste gelé

## Validation

- [ ] Runner créé et fonctionnel
- [ ] Schéma JSON validé
- [ ] Tests d'injection passent
- [ ] Preuve d'exécution réussie sur une question test
- [ ] Toutes les conditions NO-GO vérifiées

## Preuves requises

1. Code du runner
2. Schéma JSON
3. Résultats des tests d'injection
4. Preuve d'exécution d'un run de test
5. Validation que le runner refuse correctement les conditions NO-GO

## Liens

- [Spec #174 Issue](https://github.com/maurice30120/codetour/issues/174)
- [T02 — Audit #172](02-audit-conformite-172.md)
- [T03 — Connecteur Vibe natif](03-connecteur-vibe-natif.md)
- [T04 — Fixture PostgreSQL](04-fixture-postgres.md)
