# T06 — Évaluateur indépendant aveugle

**Spec**: [Spec #174 — Benchmark PostgreSQL réel vs sous-agent Vibe natif + décomposition des tâches](../../../specs/postgres-real-benchmark-2026-11-15.md)

**Status**: ⏳ Not Started
**Priority**: High
**Blocked By**: T04 (Fixture PostgreSQL)
**Blocks**: T07 (Pilote + 80 runs)
**Gate**: G4 (Évaluateur indépendant)

## Objectif

Créer un **évaluateur indépendant et aveugle** qui:
1. Vérifie chaque affirmation et preuve contre le vrai code de PostgreSQL
2. Ne connaît **ni l'agent, ni le rang, ni le coût**
3. Utilise une grille de qualité objective
4. Fournit un verdict justifié pour chaque demande

**Ce ticket bloque T07**. Si G4 ne passe pas, NO-GO.

## Périmètre

- **Évaluateur**: Programme/logique qui juge les réponses
- **Format commun**: Tous les agents produisent des réponses dans le même format
- **Blindage**: L'évaluateur ne voit pas les métadonnées de l'agent
- **Hors Périmètre**: Modification des agents

## Livrables

1. **Grille d'évaluation**: Critères objectifs de correction
2. **Export anonymisé**: Format des données pour l'évaluateur
3. **Arbitrage**: Processus pour les cas litigieux
4. **Verdicts justifiés**: Explication pour chaque évaluation
5. **Validation G4**: Sign-off que G4 passe

## Critères d'acceptation

### G4 — Évaluateur indépendant

✅ **Format commun des réponses**:
- Tous les agents (CodeTour et Vibe) produisent des réponses dans le **même format**
- Format doit permettre l'évaluation aveugle
- Doit inclure: affirmations, preuves (citations), relations

✅ **Vérification à l'aveugle**:
- L'évaluateur **ne connaît pas**:
  - Quel agent a produit la réponse
  - Quel était le rang d'exécution
  - Quel était le coût en tokens
- Seule information disponible: la réponse et le code PostgreSQL

✅ **Protocole de désaccord**:
- Processus clair pour les cas litigieux
- Deuxième évaluation possible
- Conservation du verdict initial et du motif d'arbitrage

✅ **Seuils de qualité définis à l'avance**:
- Définis **avant** d'observer les résultats
- Inclus dans le manifeste
- Non modifiables pendant le benchmark

### Grille de qualité

Pour chaque demande, l'évaluateur produit:

```typescript
interface EvaluationResult {
  // Jugement global
  correct: boolean;                    // oui/non
  
  // Jugements détaillés
  evidence_supported: boolean;        // Toutes les affirmations sont soutenues
  major_missing_relation: boolean;    // Une relation majeure est absente
  critical_false_claim: boolean;      // Une affirmation critique est fausse
  
  // Métriques
  coverage: number;                    // 0-1, couverture des preuves
  
  // Justification
  justification: string;              // Explication brève
  verified_lines: string[];            // Lignes du code vérifiées
  failed_claims: FailedClaim[];        // Affirmations fausses ou non prouvées
}

interface FailedClaim {
  claim: string;                       // L'affirmation
  reason: string;                      // Pourquoi elle échoue
  expected: string;                    // Ce qui était attendu
  actual: string;                      // Ce qui était dans la réponse
}
```

### Définition de "Tour correct"

Un **Tour correct** si:
- ✅ `correct === true`
- ✅ `evidence_supported === true`
- ✅ `major_missing_relation === false`
- ✅ `critical_false_claim === false`

**Toutes les conditions doivent être satisfaites.**

### Cas litigieux

Si désaccord entre évaluateurs:
1. **Deuxième évaluation** par un arbitre
2. **Conserver** le verdict initial
3. **Documenter** le motif de l'arbitrage

```typescript
interface Arbitration {
  initial_judgment: EvaluationResult;
  arbitrator_judgment: EvaluationResult;
  final_judgment: EvaluationResult;    // = arbitrator_judgment
  reason: string;                      // Pourquoi l'arbitrage était nécessaire
}
```

### Export anonymisé

Avant l'évaluation, exporter les données dans un format aveugle:

```json
{
  "evaluation_set_id": "set-001",
  "evaluations": [
    {
      "evaluation_id": "eval-001",
      "response": {
        "tour_title": "...",
        "steps": [...],
        "citations": [...]
      },
      "question": {
        "objective": "...",
        "expected_areas": [...],
        "criteria": [...]
      },
      "postgres_sha": "70c4a57b64d39c526eb4c44a925eb92a6e56f3c5"
    }
  ]
}
```

**Important**: Aucune information sur l'agent ou les tokens.

## Implémentation

### Étape 1: Définir le format commun des réponses

Tous les agents doivent produire des réponses avec:

```typescript
interface AgentResponse {
  // Métadonnées (seront retirées pour l'évaluation aveugle)
  run_id: string;
  agent: string;
  timestamp: Date;
  
  // Contenu à évaluer
  tour: {
    title: string;
    description: string;
    steps: TourStep[];
  };
  
  // Preuves
  citations: Citation[];
  
  // Affirmations (extraites automatiquement ou fournies)
  claims: Claim[];
  
  // Relations affirmées
  relations: Relation[];
}

interface TourStep {
  id: string;
  description: string;
  file?: string;
  line?: number;
  code?: string;
}

interface Citation {
  file: string;
  line: number;
  content: string;
  context: string;  // Quelques lignes avant/après
}

interface Claim {
  id: string;
  statement: string;
  confidence: number;  // 0-1
  citations: string[]; // IDs des citations qui soutiennent cette affirmation
}

interface Relation {
  from: string;
  to: string;
  type: 'calls' | 'uses' | 'defines' | 'includes' | 'extends' | 'implements' | 'other';
  citations: string[]; // IDs des citations qui soutiennent cette relation
}
```

### Étape 2: Créer la grille d'évaluation

```typescript
// evaluator/src/grader.ts

class TourGrader {
  constructor(
    private postgresPath: string,
    private question: Question
  ) {}

  async evaluate(response: AgentResponse): Promise<EvaluationResult> {
    const result: EvaluationResult = {
      correct: true,
      evidence_supported: true,
      major_missing_relation: false,
      critical_false_claim: false,
      coverage: 0,
      justification: '',
      verified_lines: [],
      failed_claims: [],
    };

    // 1. Vérifier chaque affirmation
    for (const claim of response.claims) {
      const claimResult = await this.evaluateClaim(claim, response.citations);
      
      if (!claimResult.supported) {
        result.evidence_supported = false;
        result.failed_claims.push({
          claim: claim.statement,
          reason: 'Unsupported claim',
          expected: claim.statement,
          actual: 'No supporting evidence found',
        });
      }
      
      if (claimResult.false) {
        result.critical_false_claim = true;
        result.failed_claims.push({
          claim: claim.statement,
          reason: 'False claim',
          expected: claimResult.expected,
          actual: claim.statement,
        });
        result.correct = false;
      }
    }

    // 2. Vérifier les relations
    const missingRelations = await this.checkMissingRelations(
      response.relations,
      this.question.relations_to_verify
    );
    
    if (missingRelations.some(r => r.critical)) {
      result.major_missing_relation = true;
      result.correct = false;
    }

    // 3. Calculer la couverture
    result.coverage = await this.calculateCoverage(
      response.citations,
      this.question.expected_areas
    );

    // 4. Générer la justification
    result.justification = this.generateJustification(result);

    return result;
  }

  private async evaluateClaim(claim: Claim, citations: Citation[]): Promise<{supported: boolean; false: boolean; expected?: string}> {
    // 1. Vérifier si l'affirmation est soutenue par des citations
    const supportingCitations = citations.filter(c => 
      claim.citations.includes(c.id)
    );
    
    if (supportingCitations.length === 0) {
      return { supported: false, false: false };
    }

    // 2. Vérifier chaque citation contre le code PostgreSQL
    for (const citation of supportingCitations) {
      const codeContent = await this.readPostgresFile(citation.file);
      
      // Vérifier que la citation existe dans le code
      if (!codeContent.includes(citation.content)) {
        // La citation n'est pas dans le code -> affirmation fausse
        return { supported: false, false: true, expected: 'Citation not found in code' };
      }
      
      // Vérifier que la citation soutient l'affirmation
      if (!this.citationSupportsClaim(citation, claim)) {
        return { supported: false, false: false };
      }
    }

    return { supported: true, false: false };
  }

  private async checkMissingRelations(
    providedRelations: Relation[],
    expectedRelations: Relation[]
  ): Promise<{relation: Relation; critical: boolean}[]> {
    const missing: {relation: Relation; critical: boolean}[] = [];
    
    for (const expected of expectedRelations) {
      const found = providedRelations.find(r => 
        this.relationsMatch(r, expected)
      );
      
      if (!found) {
        // Vérifier si la relation est critique
        const critical = this.question.criteria.some(c => 
          c.includes(expected.from) || c.includes(expected.to)
        );
        
        missing.push({ relation: expected, critical });
      }
    }

    return missing;
  }

  private relationsMatch(r1: Relation, r2: Relation): boolean {
    // Deux relations matchent si elles connectent les mêmes entités
    // avec le même type (ou type compatible)
    return (r1.from === r2.from && r1.to === r2.to) ||
           (r1.from === r2.to && r1.to === r2.from && 
            (r1.type === 'calls' || r2.type === 'calls' || 
             r1.type === 'uses' || r2.type === 'uses'));
  }

  private citationSupportsClaim(citation: Citation, claim: Claim): boolean {
    // Vérifier que le contenu de la citation soutient l'affirmation
    // Implémentation dépend du contexte
    // Peut utiliser LLM pour vérifier ou des règles sémantiques
    return true; // Simplification pour l'exemple
  }
}
```

### Étape 3: Anonymiser les réponses

```typescript
// evaluator/src/blinder.ts

function anonymizeResponse(response: AgentResponse): BlindedResponse {
  const { run_id, agent, timestamp, ...blindedData } = response;
  
  return {
    ...blindedData,
    // Générer un ID aléatoire pour l'évaluation
    evaluation_id: generateEvaluationId(),
    // Retirer toute trace de l'agent
    metadata: undefined,
  };
}

function createEvaluationSet(responses: AgentResponse[]): EvaluationSet {
  const blindedResponses = responses.map(anonymizeResponse);
  
  // Mélanger pour éviter les patterns
  shuffleArray(blindedResponses);
  
  return {
    evaluation_set_id: generateSetId(),
    evaluations: blindedResponses,
    created_at: new Date().toISOString(),
  };
}
```

### Étape 4: Implémenter l'arbitrage

```typescript
// evaluator/src/arbitrator.ts

class Arbitrator {
  constructor(private graders: TourGrader[]) {}

  async arbitrate(
    response: AgentResponse,
    question: Question
  ): Promise<Arbitration> {
    // 1. Première évaluation
    const grader1 = this.graders[0];
    const initialJudgment = await grader1.evaluate(response, question);
    
    // 2. Deuxième évaluation (si désaccord)
    const grader2 = this.graders[1];
    const secondJudgment = await grader2.evaluate(response, question);
    
    // 3. Si les deux sont d'accord, utiliser ce jugement
    if (this.judgmentsMatch(initialJudgment, secondJudgment)) {
      return {
        initial_judgment: initialJudgment,
        arbitrator_judgment: secondJudgment,
        final_judgment: secondJudgment,
        reason: 'Both graders agreed',
      };
    }
    
    // 4. Sinon, utiliser la deuxième évaluation comme arbitrage
    return {
      initial_judgment: initialJudgment,
      arbitrator_judgment: secondJudgment,
      final_judgment: secondJudgment,
      reason: 'Graders disagreed, using second judgment as arbitration',
    };
  }

  private judgmentsMatch(j1: EvaluationResult, j2: EvaluationResult): boolean {
    return j1.correct === j2.correct &&
           j1.evidence_supported === j2.evidence_supported &&
           j1.major_missing_relation === j2.major_missing_relation &&
           j1.critical_false_claim === j2.critical_false_claim;
  }
}
```

### Étape 5: Intégrer avec le runner

Le runner doit:
1. Produire des réponses dans le format commun
2. Anonymiser les réponses avant évaluation
3. Enregistrer les résultats d'évaluation

## Fichiers à créer

- [ ] `poc/benchmark/evaluator/package.json`
- [ ] `poc/benchmark/evaluator/tsconfig.json`
- [ ] `poc/benchmark/evaluator/src/grader.ts`
- [ ] `poc/benchmark/evaluator/src/blinder.ts`
- [ ] `poc/benchmark/evaluator/src/arbitrator.ts`
- [ ] `poc/benchmark/evaluator/src/types.ts`
- [ ] `poc/benchmark/evaluator/test/grader.test.ts`
- [ ] `poc/benchmark/evaluator/test/blinder.test.ts`
- [ ] `docs/specs/spec-174-tickets/06-evaluateur-aveugle-evidence.md`

## Dépendances

- **T04**: Fixture PostgreSQL pour vérifier les citations
- **Node.js**: Pour exécuter l'évaluateur
- **TypeScript**: Pour le développement

## Risques

- **Risque**: L'évaluateur est trop strict ou trop indulgent
  - **Mitigation**: Définir des critères objectifs et les tester

- **Risque**: Biais dans l'évaluation aveugle
  - **Mitigation**: Mélanger les réponses et utiliser plusieurs évaluateurs

- **Risque**: Temps d'évaluation trop long
  - **Mitigation**: Optimiser la vérification des citations

## Validation

- [ ] Format commun des réponses défini
- [ ] Grille d'évaluation implémentée
- [ ] Export anonymisé fonctionnel
- [ ] Processus d'arbitrage défini
- [ ] Tests de l'évaluateur passent
- [ ] G4 validé (évaluateur indépendant fonctionnel)

## Preuves requises

1. Code de l'évaluateur
2. Schéma du format commun
3. Exemple d'export anonymisé
4. Résultats des tests de l'évaluateur
5. Preuve que l'évaluateur rejette correctement les affirmations fausses
6. Validation que G4 passe

## Liens

- [Spec #174 Issue](https://github.com/maurice30120/codetour/issues/174)
- [T04 — Fixture PostgreSQL](04-fixture-postgres.md)
