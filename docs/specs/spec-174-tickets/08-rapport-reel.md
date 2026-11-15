# T08 — Analyse et rapport contradictoire

**Spec**: [Spec #174 — Benchmark PostgreSQL réel vs sous-agent Vibe natif + décomposition des tâches](../../../specs/postgres-real-benchmark-2026-11-15.md)

**Status**: ⏳ Not Started
**Priority**: Medium
**Blocked By**: T07 (Pilote + 80 runs)
**Blocks**: None

## Objectif

Générer un **rapport contradictoire** avec:
- Métriques par série
- Coût marginal et cumulé
- Qualité
- Incertitude statistique
- Point de rentabilité en tokens
- Différences de configuration
- **Verdict imposé** par §7 de la spec

**Ce ticket ne peut démarrer qu'après T07.**

## Périmètre

- **Analyse**: Calcul des métriques à partir des données brutes
- **Rapport**: Document Markdown + JSON complet
- **Scripts**: Reproductibilité des calculs
- **Verdict**: VALIDÉ, INVALIDÉ, INDÉTERMINÉ, ou NO-GO

## Livrables

1. **Rapport Markdown**: Document lisible avec analyse et verdict
2. **Rapport JSON**: Données brutes structurées
3. **Scripts de reproduction**: Code pour recalculer les métriques
4. **Verdict final**: Imposé par les critères de §7

## Critères d'acceptation

### Verdict (imposé par §7)

Le verdict est déterminé **automatiquement** selon les critères suivants:

#### ✅ VALIDÉ (si TOUTES les conditions)

1. Données réelles complètes ✅
2. Toutes les portes G0-G5 satisfaites ✅
3. **Au moins 20% de gain** sur les tokens par Tour correct face à Vibe:
   - Pour la série R **ET**
   - Pour la série T
4. Intervalle de confiance bootstrap apparié à 95% **strictement > 0**:
   - Pour la série R **ET**
   - Pour la série T
5. Taux de Tours corrects du POC **≤ 5 points de pourcentage** en dessous de Vibe
6. **Aucune affirmation fausse critique** supplémentaire

#### ❌ INVALIDÉ (si)

- Les mesures sont complètes **MAIS** montrent:
  - Absence de gain utile (< 20% sur un des scénarios)
  - Dégradation de qualité au-delà de la tolérance
  - Fausses relations critiques

#### ⚠️ INDÉTERMINÉ (si)

- L'incertitude statistique empêche de conclure
- Le score est indéfini (zéro Tour correct)
- Une comparaison importante n'est pas appariée

#### 🛑 NO-GO (si)

- Données fictives
- Le vrai sous-agent natif n'est pas utilisé
- La télémétrie est lacunaire
- Les portes G0-G5 manquent

**Ne PAS rebaptiser un NO-GO en gain.**

### Métriques requises

#### Par série (R et T)

```typescript
interface SeriesMetrics {
  // Métriques principales
  total_runs: number;
  correct_tours: number;
  correct_rate: number;  // correct_tours / total_runs
  
  // Tokens
  codetour: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    per_correct_tour: number;  // total_tokens / correct_tours (si > 0)
  };
  vibe: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    per_correct_tour: number;
  };
  
  // Gain
  absolute_savings: number;  // codetour.total - vibe.total
  relative_savings: number;   // absolute_savings / vibe.total * 100
  
  // Qualité
  avg_coverage: number;
  false_claims: number;
  missing_relations: number;
  
  // Statistiques
  confidence_interval: {
    lower: number;
    upper: number;
    margin: number;
  };
}
```

#### Global

```typescript
interface GlobalMetrics {
  total_runs: number;
  total_correct_tours: number;
  overall_correct_rate: number;
  
  total_tokens_codetour: number;
  total_tokens_vibe: number;
  
  overall_savings: number;
  
  // Point de rentabilité
  breakeven_tokens: number;  // Tokens à partir desquels CodeTour devient plus économique
  
  // Qualité
  quality_score_codetour: number;
  quality_score_vibe: number;
  quality_difference: number;
}
```

### Intervalle de confiance bootstrap apparié

**Méthode**:
1. Pour chaque paire de runs (même question, les deux agents):
   - Calculer la différence de tokens: `Δ = tokens_vibe - tokens_codetour`
2. Générer 10,000 échantillons bootstrap:
   - Tirer avec remise N paires (N = nombre de paires)
   - Calculer la moyenne des Δ pour chaque échantillon
3. Intervalle à 95%: [2.5e percentile, 97.5e percentile]

**Critère**: La borne inférieure doit être **strictement > 0**

### Point de rentabilité

Calculer le nombre de tokens à partir duquel CodeTour devient plus économique:

```
breakeven = (fixed_cost_vibe - fixed_cost_codetour) / (marginal_savings_per_token)
```

Mais comme on optimise **uniquement sur les tokens**, le point de rentabilité est simplement:

```
breakeven_tokens = 0  // Si CodeTour utilise moins de tokens, c'est toujours rentable
```

**Attention**: C'est une simplification. En réalité, il faut considérer:
- Les coûts fixes (initialisation, etc.)
- Les coûts marginaux
- La qualité

Mais la spec dit: **"Ne pas utiliser le coût $ comme critère de décision"**, donc on reste sur les tokens.

## Implémentation

### Étape 1: Calculer les métriques

```typescript
// analyzer/src/metrics.ts

class MetricsCalculator {
  constructor(
    private runs: RunResult[],
    private evaluations: EvaluationResult[]
  ) {}

  calculateAll(): CompleteMetrics {
    // 1. Séparer par série
    const rSeries = this.separateBySeries('R');
    const tSeries = this.separateBySeries('T');
    
    // 2. Calculer pour chaque série
    const rMetrics = this.calculateSeriesMetrics(rSeries);
    const tMetrics = this.calculateSeriesMetrics(tSeries);
    
    // 3. Calculer les métriques globales
    const globalMetrics = this.calculateGlobalMetrics(rMetrics, tMetrics);
    
    // 4. Calculer les intervalles de confiance
    const rConfidence = this.calculateBootstrapCI(rSeries);
    const tConfidence = this.calculateBootstrapCI(tSeries);
    
    return {
      series: {
        R: { ...rMetrics, confidence_interval: rConfidence },
        T: { ...tMetrics, confidence_interval: tConfidence },
      },
      global: globalMetrics,
    };
  }

  private calculateSeriesMetrics(seriesData: SeriesData): SeriesMetrics {
    const codetourRuns = seriesData.runs.filter(r => r.agent === 'codetour');
    const vibeRuns = seriesData.runs.filter(r => r.agent === 'vibe-native');
    
    const codetourCorrect = codetourRuns.filter(r => 
      this.isCorrectTour(r, seriesData.evaluations)
    ).length;
    const vibeCorrect = vibeRuns.filter(r => 
      this.isCorrectTour(r, seriesData.evaluations)
    ).length;
    
    const codetourTokens = codetourRuns.reduce((sum, r) => sum + r.totalTokens.total, 0);
    const vibeTokens = vibeRuns.reduce((sum, r) => sum + r.totalTokens.total, 0);
    
    return {
      total_runs: seriesData.runs.length,
      correct_tours: codetourCorrect + vibeCorrect,
      correct_rate: (codetourCorrect + vibeCorrect) / seriesData.runs.length,
      
      codetour: {
        input_tokens: codetourRuns.reduce((sum, r) => sum + r.totalTokens.input, 0),
        output_tokens: codetourRuns.reduce((sum, r) => sum + r.totalTokens.output, 0),
        total_tokens: codetourTokens,
        per_correct_tour: codetourCorrect > 0 ? codetourTokens / codetourCorrect : 0,
      },
      
      vibe: {
        input_tokens: vibeRuns.reduce((sum, r) => sum + r.totalTokens.input, 0),
        output_tokens: vibeRuns.reduce((sum, r) => sum + r.totalTokens.output, 0),
        total_tokens: vibeTokens,
        per_correct_tour: vibeCorrect > 0 ? vibeTokens / vibeCorrect : 0,
      },
      
      absolute_savings: vibeTokens - codetourTokens,
      relative_savings: vibeTokens > 0 ? (vibeTokens - codetourTokens) / vibeTokens * 100 : 0,
      
      avg_coverage: this.calculateAvgCoverage(seriesData.evaluations),
      false_claims: this.countFalseClaims(seriesData.evaluations),
      missing_relations: this.countMissingRelations(seriesData.evaluations),
    };
  }

  private isCorrectTour(run: RunResult, evaluations: EvaluationResult[]): boolean {
    const evaluation = evaluations.find(e => e.run_id === run.runId);
    if (!evaluation) return false;
    
    return evaluation.correct && 
           evaluation.evidence_supported &&
           !evaluation.major_missing_relation &&
           !evaluation.critical_false_claim;
  }

  private calculateBootstrapCI(seriesData: SeriesData): ConfidenceInterval {
    const pairs = this.createPairedSamples(seriesData);
    const bootstrapSamples = this.generateBootstrapSamples(pairs, 10000);
    
    const sorted = bootstrapSamples.sort((a, b) => a - b);
    const lower = sorted[Math.floor(sorted.length * 0.025)];
    const upper = sorted[Math.floor(sorted.length * 0.975)];
    
    return {
      lower,
      upper,
      margin: upper - lower,
    };
  }

  private createPairedSamples(seriesData: SeriesData): number[] {
    // Pour chaque question, créer une paire (vibe_tokens - codetour_tokens)
    const pairs: number[] = [];
    
    // Grouper par question_id
    const byQuestion = this.groupByQuestion(seriesData.runs);
    
    for (const [questionId, runs] of Object.entries(byQuestion)) {
      const codetourRun = runs.find(r => r.agent === 'codetour');
      const vibeRun = runs.find(r => r.agent === 'vibe-native');
      
      if (codetourRun && vibeRun) {
        const delta = vibeRun.totalTokens.total - codetourRun.totalTokens.total;
        pairs.push(delta);
      }
    }
    
    return pairs;
  }

  private generateBootstrapSamples(samples: number[], count: number): number[] {
    const results: number[] = [];
    
    for (let i = 0; i < count; i++) {
      const sample = this.sampleWithReplacement(samples, samples.length);
      const mean = sample.reduce((a, b) => a + b, 0) / sample.length;
      results.push(mean);
    }
    
    return results;
  }

  private sampleWithReplacement<T>(array: T[], size: number): T[] {
    const result: T[] = [];
    for (let i = 0; i < size; i++) {
      const index = Math.floor(Math.random() * array.length);
      result.push(array[index]);
    }
    return result;
  }
}
```

### Étape 2: Déterminer le verdict

```typescript
// analyzer/src/verdict.ts

class VerdictCalculator {
  constructor(private metrics: CompleteMetrics) {}

  calculate(): Verdict {
    // 1. Vérifier que les données sont réelles et complètes
    if (!this.areDataComplete()) {
      return { status: 'NO-GO', reason: 'Données incomplètes ou non réelles' };
    }
    
    // 2. Vérifier les portes G0-G5
    // (Cela devrait avoir été vérifié avant T07, mais on re-vérifie)
    if (!this.areAllGatesSatisfied()) {
      return { status: 'NO-GO', reason: 'Portes G0-G5 non satisfaites' };
    }
    
    // 3. Vérifier les gains pour chaque série
    const rGain = this.metrics.series.R.relative_savings;
    const tGain = this.metrics.series.T.relative_savings;
    
    if (rGain < 20 || tGain < 20) {
      return {
        status: 'INVALIDATED',
        reason: `Gain insuffisant: R=${rGain.toFixed(1)}%, T=${tGain.toFixed(1)}% (20% requis)`,
      };
    }
    
    // 4. Vérifier les intervalles de confiance
    const rCI = this.metrics.series.R.confidence_interval;
    const tCI = this.metrics.series.T.confidence_interval;
    
    if (rCI.lower <= 0 || tCI.lower <= 0) {
      return {
        status: 'INDETERMINED',
        reason: `Intervalle de confiance inclut zéro: R=[${rCI.lower},${rCI.upper}], T=[${tCI.lower},${tCI.upper}]`,
      };
    }
    
    // 5. Vérifier la dégradation de qualité
    const qualityDiff = this.calculateQualityDifference();
    if (qualityDiff > 5) {
      return {
        status: 'INVALIDATED',
        reason: `Dégradation de qualité: ${qualityDiff.toFixed(1)}% (5% max autorisé)`,
      };
    }
    
    // 6. Vérifier les affirmations fausses critiques
    if (this.hasCriticalFalseClaims()) {
      return {
        status: 'INVALIDATED',
        reason: 'Affirmations fausses critiques détectées',
      };
    }
    
    // 7. Si tout passe, VALIDÉ
    return {
      status: 'VALIDATED',
      reason: 'Tous les critères satisfaits',
    };
  }

  private areDataComplete(): boolean {
    // Vérifier que toutes les données sont présentes
    // Vérifier qu'il n'y a pas de données mock
    return true; // À implémenter
  }

  private areAllGatesSatisfied(): boolean {
    // Vérifier que G0-G5 étaient satisfaits pendant T07
    return true; // À implémenter
  }

  private calculateQualityDifference(): number {
    const codetourRate = this.metrics.series.R.correct_rate * 100;
    const vibeRate = this.metrics.series.R.correct_rate * 100;
    
    // Taux de Tours corrects du POC inférieur au témoin de 5 points max
    return Math.max(0, vibeRate - codetourRate);
  }

  private hasCriticalFalseClaims(): boolean {
    // Vérifier s'il y a des critical_false_claim dans les évaluations
    return false; // À implémenter
  }
}
```

### Étape 3: Générer le rapport

```typescript
// analyzer/src/report-generator.ts

class ReportGenerator {
  constructor(
    private metrics: CompleteMetrics,
    private verdict: Verdict,
    private runs: RunResult[],
    private evaluations: EvaluationResult[]
  ) {}

  async generateMarkdown(): Promise<string> {
    return `# Rapport de Benchmark — Spec #174

## Verdict: ${this.verdict.status}

${this.verdict.reason}

---

## 1. Sommaire Exécutif

| Métrique | Série R | Série T | Global |
|----------|---------|---------|--------|
| Runs totaux | ${this.metrics.series.R.total_runs} | ${this.metrics.series.T.total_runs} | ${this.metrics.series.R.total_runs + this.metrics.series.T.total_runs} |
| Tours corrects | ${this.metrics.series.R.correct_tours} | ${this.metrics.series.T.correct_tours} | ${this.metrics.series.R.correct_tours + this.metrics.series.T.correct_tours} |
| Taux de correction | ${(this.metrics.series.R.correct_rate * 100).toFixed(1)}% | ${(this.metrics.series.T.correct_rate * 100).toFixed(1)}% | ${((this.metrics.series.R.correct_rate + this.metrics.series.T.correct_rate) / 2 * 100).toFixed(1)}% |
| Économies de tokens | ${this.metrics.series.R.relative_savings.toFixed(1)}% | ${this.metrics.series.T.relative_savings.toFixed(1)}% | ${((this.metrics.series.R.relative_savings + this.metrics.series.T.relative_savings) / 2).toFixed(1)}% |
| Intervalle de confiance | [${this.metrics.series.R.confidence_interval.lower.toFixed(1)}, ${this.metrics.series.R.confidence_interval.upper.toFixed(1)}] | [${this.metrics.series.T.confidence_interval.lower.toFixed(1)}, ${this.metrics.series.T.confidence_interval.upper.toFixed(1)}] | - |

---

## 2. Décomposition par Agent

### CodeTour

| Métrique | Série R | Série T | Total |
|----------|---------|---------|-------|
| Tokens totaux | ${this.metrics.series.R.codetour.total_tokens} | ${this.metrics.series.T.codetour.total_tokens} | ${this.metrics.series.R.codetour.total_tokens + this.metrics.series.T.codetour.total_tokens} |
| Tokens par Tour correct | ${this.metrics.series.R.codetour.per_correct_tour.toFixed(0)} | ${this.metrics.series.T.codetour.per_correct_tour.toFixed(0)} | - |

### Vibe Natif

| Métrique | Série R | Série T | Total |
|----------|---------|---------|-------|
| Tokens totaux | ${this.metrics.series.R.vibe.total_tokens} | ${this.metrics.series.T.vibe.total_tokens} | ${this.metrics.series.R.vibe.total_tokens + this.metrics.series.T.vibe.total_tokens} |
| Tokens par Tour correct | ${this.metrics.series.R.vibe.per_correct_tour.toFixed(0)} | ${this.metrics.series.T.vibe.per_correct_tour.toFixed(0)} | - |

---

## 3. Qualité

| Métrique | CodeTour | Vibe | Différence |
|----------|-----------|------|------------|
| Couverture moyenne | ${this.metrics.series.R.avg_coverage.toFixed(2)} | ${this.metrics.series.R.avg_coverage.toFixed(2)} | - |
| Affirmations fausses | ${this.metrics.series.R.false_claims} | - | - |
| Relations manquantes | ${this.metrics.series.R.missing_relations} | - | - |

---

## 4. Point de Rentabilité

Le point de rentabilité en tokens est **0** (CodeTour est plus économique dès le premier token économisé).

---

## 5. Distribution des Résultats

### Série R (Répétition)

` + await this.generateDistributionChart('R') + `

### Série T (Transfert)

` + await this.generateDistributionChart('T') + `

---

## 6. Analyse Statistique

### Bootstrap Apparié (95% CI)

- **Série R**: [${this.metrics.series.R.confidence_interval.lower.toFixed(1)}, ${this.metrics.series.R.confidence_interval.upper.toFixed(1)}]
- **Série T**: [${this.metrics.series.T.confidence_interval.lower.toFixed(1)}, ${this.metrics.series.T.confidence_interval.upper.toFixed(1)}]

**Interprétation**: Les intervalles de confiance ${this.metrics.series.R.confidence_interval.lower > 0 ? 'sont au-dessus de zéro' : 'incluent zéro'} pour la série R et ${this.metrics.series.T.confidence_interval.lower > 0 ? 'sont au-dessus de zéro' : 'incluent zéro'} pour la série T.

---

## 7. Différences de Configuration

` + this.generateConfigDifferences() + `

---

## 8. Conclusion

` + this.generateConclusion() + `

---

## 9. Annexes

- [Données brutes JSON](./data.json)
- [Scripts de reproduction](../scripts/)
- [Traces complètes](../runs/)
- [Manifeste gelé](../manifest-lock.json)
`;
  }

  private async generateDistributionChart(series: 'R' | 'T'): Promise<string> {
    // Générer un tableau ou un graphique de distribution
    // Peut utiliser Mermaid pour un graphique simple
    return `
\`\`\`mermaid
graph TD
    A[CodeTour: ${this.metrics.series[series].codetour.total_tokens} tokens] --> B[${this.metrics.series[series].codetour.correct_tours} Tours corrects]
    C[Vibe: ${this.metrics.series[series].vibe.total_tokens} tokens] --> D[${this.metrics.series[series].vibe.correct_tours} Tours corrects]
\`\`\``;
  }

  private generateConfigDifferences(): string {
    // Lister les différences de configuration entre CodeTour et Vibe
    return `Aucune différence substantielle de configuration.

| Paramètre | CodeTour | Vibe |
|-----------|-----------|------|
| Modèle | gpt-4 | gpt-4 |
| Température | 0.7 | 0.7 |
| Max Tokens | 4096 | 4096 |
| Limite de temps | 60s | 60s |`;
  }

  private generateConclusion(): string {
    switch (this.verdict.status) {
      case 'VALIDATED':
        return `## ✅ VALIDÉ

Le benchmark montre que CodeTour avec mémoire procédurale réduit significativement la consommation de tokens par Tour correct face au sous-agent Vibe natif, tout en maintenant une qualité comparable.

**Recommandation**: Intégrer cette approche dans la version production.

**Prochaines étapes**:
- Intégration produit
- Tests supplémentaires sur d'autres codebases
- Optimisation continue`;

      case 'INVALIDATED':
        return `## ❌ INVALIDÉ

Le benchmark montre que les gains de tokens ne sont pas suffisants ou que la qualité est dégradée.

**Recommandation**: Ne pas intégrer dans la version production.

**Prochaines étapes**:
- Analyser les causes de l'échec
- Améliorer l'approche
- Réessayer le benchmark`;

      case 'INDETERMINED':
        return `## ⚠️ INDÉTERMINÉ

Les résultats sont statistiquement incertains.

**Recommandation**: Étendre le benchmark à 50 demandes par série (si les règles pré-enregistrées le permettent).

**Prochaines étapes**:
- Exécuter 40 runs supplémentaires (20 R + 20 T)
- Recalculer les métriques
- Réévaluer le verdict`;

      case 'NO-GO':
        return `## 🛑 NO-GO

Le benchmark n'a pas pu être exécuté conformément au protocole.

**Raison**: ${this.verdict.reason}

**Recommandation**: Corriger les problèmes identifiés avant de relancer.

**Prochaines étapes**:
- Résoudre les problèmes de conformité
- Réexécuter le benchmark`;

      default:
        return 'Verdict inconnu';
    }
  }
}
```

### Étape 4: Générer le rapport JSON

```typescript
// analyzer/src/json-generator.ts

class JsonReportGenerator {
  constructor(
    private metrics: CompleteMetrics,
    private verdict: Verdict,
    private runs: RunResult[],
    private evaluations: EvaluationResult[],
    private manifest: Manifest
  ) {}

  generate(): any {
    return {
      spec_version: '174',
      generated_at: new Date().toISOString(),
      
      verdict: this.verdict,
      
      metrics: {
        series: {
          R: this.sanitizeMetrics(this.metrics.series.R),
          T: this.sanitizeMetrics(this.metrics.series.T),
        },
        global: this.metrics.global,
      },
      
      runs: this.runs.map(this.sanitizeRun),
      evaluations: this.evaluations,
      
      manifest: this.manifest,
      
      metadata: {
        postgres_sha: '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5',
        runner_version: '1.0.0',
        evaluator_version: '1.0.0',
      },
    };
  }

  private sanitizeMetrics(metrics: SeriesMetrics): any {
    return {
      total_runs: metrics.total_runs,
      correct_tours: metrics.correct_tours,
      correct_rate: metrics.correct_rate,
      codetour: metrics.codetour,
      vibe: metrics.vibe,
      absolute_savings: metrics.absolute_savings,
      relative_savings: metrics.relative_savings,
      avg_coverage: metrics.avg_coverage,
      false_claims: metrics.false_claims,
      missing_relations: metrics.missing_relations,
      confidence_interval: metrics.confidence_interval,
    };
  }

  private sanitizeRun(run: RunResult): any {
    return {
      run_id: run.runId,
      question_id: run.questionId,
      agent: run.agent,
      series: run.series,
      total_tokens: run.totalTokens,
      status: run.status,
      timestamp: run.timestamp,
    };
  }
}
```

## Fichiers à créer

- [ ] `poc/benchmark/analyzer/package.json`
- [ ] `poc/benchmark/analyzer/tsconfig.json`
- [ ] `poc/benchmark/analyzer/src/index.ts`
- [ ] `poc/benchmark/analyzer/src/metrics.ts`
- [ ] `poc/benchmark/analyzer/src/verdict.ts`
- [ ] `poc/benchmark/analyzer/src/report-generator.ts`
- [ ] `poc/benchmark/analyzer/src/json-generator.ts`
- [ ] `poc/benchmark/analyzer/src/types.ts`
- [ ] `poc/benchmark/results/report.md`
- [ ] `poc/benchmark/results/data.json`
- [ ] `poc/benchmark/analyzer/scripts/`

## Dépendances

- **T07**: 80 runs exécutés avec traces
- **T06**: Évaluations aveugles disponibles
- **Node.js**: Pour exécuter l'analyse

## Risques

- **Risque**: Le verdict est subjectif
  - **Mitigation**: Verdict déterminé automatiquement par les critères

- **Risque**: Erreurs dans les calculs
  - **Mitigation**: Tests unitaires, scripts de reproduction

- **Risque**: Interprétation incorrecte des résultats
  - **Mitigation**: Rapport clair avec toutes les métriques

## Validation

- [ ] Toutes les métriques calculées correctement
- [ ] Verdict déterminé correctement selon §7
- [ ] Rapport Markdown généré
- [ ] Rapport JSON généré
- [ ] Scripts de reproduction fonctionnels
- [ ] Chaque nombre traçable à des runs réels

## Preuves requises

1. Code de l'analyseur
2. Rapport Markdown complet
3. Rapport JSON complet
4. Scripts de reproduction
5. Validation que chaque nombre est traçable
6. Preuve que le verdict est imposé par les critères

## Liens

- [Spec #174 Issue](https://github.com/maurice30120/codetour/issues/174)
- [Section 7 — Verdict](https://github.com/maurice30120/codetour/blob/spec-postgres-real-benchmark-2026-11-15/docs/specs/postgres-real-benchmark-2026-11-15.md#7-verdict-fig%C3%A9-%C3%A0-lavance)
- [T07 — Pilote + 80 runs](07-pilote-80-runs.md)
