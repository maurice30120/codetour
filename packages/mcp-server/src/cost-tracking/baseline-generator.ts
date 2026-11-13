/**
 * Baseline Generator for Copilot Cost Measurement
 * Part of spec #92, ticket #113
 */

import {
  CostTracker,
} from "./cost-tracker";
import {
  TokenEconomizerPOC,
} from "./tokeneconomizer-poc";
import {
  TourGenerationMetrics,
  BaselineComparison,
  CostTrackingConfig,
  ModelInfo,
} from "./types";

/**
 * Generates baseline cost measurements for Tour generation
 */
export class BaselineGenerator {
  private costTracker: CostTracker;
  private tokenEconomizer?: TokenEconomizerPOC;
  private results: Map<string, TourGenerationMetrics>;

  constructor(config?: Partial<CostTrackingConfig>) {
    this.costTracker = new CostTracker(config);
    this.results = new Map();
  }

  /**
   * Initialize TokenEconomizer for comparison
   */
  async initializeTokenEconomizer(
    settings?: Partial<import("./types").TokenEconomizerConfig>
  ): Promise<TokenEconomizerPOC> {
    this.tokenEconomizer = new TokenEconomizerPOC(settings);
    await this.tokenEconomizer.initialize();
    return this.tokenEconomizer;
  }

  /**
   * Record metrics for a Tour generation
   */
  recordTourGeneration(
    metrics: Partial<TourGenerationMetrics> & {
      tourType: "project" | "changes";
      sha: string;
    }
  ): TourGenerationMetrics {
    const fullMetrics: TourGenerationMetrics = {
      tourType: metrics.tourType,
      reviewMode: metrics.reviewMode,
      sha: metrics.sha,
      timestamp: new Date().toISOString(),
      tokenUsage: {
        inputTokens: metrics.tokenUsage?.inputTokens || 0,
        outputTokens: metrics.tokenUsage?.outputTokens || 0,
        cacheTokens: metrics.tokenUsage?.cacheTokens || 0,
        totalTokens: metrics.tokenUsage?.totalTokens || 0,
        timestamp: new Date().toISOString(),
      },
      cost: metrics.cost || {},
      durationMs: metrics.durationMs || 0,
      toolsCalled: metrics.toolsCalled || 0,
      stepsGenerated: metrics.stepsGenerated || 0,
      validationWarnings: metrics.validationWarnings || 0,
      success: metrics.success ?? true,
      error: metrics.error,
    };

    const key = this.getMetricsKey(fullMetrics);
    this.results.set(key, fullMetrics);

    return fullMetrics;
  }

  /**
   * Generate a unique key for metrics
   */
  private getMetricsKey(metrics: TourGenerationMetrics): string {
    return `${metrics.tourType}:${metrics.reviewMode || "none"}:${metrics.sha}`;
  }

  /**
   * Get stored metrics
   */
  getMetrics(key: string): TourGenerationMetrics | undefined {
    return this.results.get(key);
  }

  /**
   * Get all stored metrics
   */
  getAllMetrics(): TourGenerationMetrics[] {
    return Array.from(this.results.values());
  }

  /**
   * Compare baseline (A) with TokenEconomizer (B)
   */
  compareBaseline(
    baseline: TourGenerationMetrics,
    withTokenEconomizer: TourGenerationMetrics
  ): BaselineComparison {
    const scenario = this.getScenarioLabel(baseline);

    // Calculate cost savings
    const baselineCost = baseline.cost.estimatedCost || 0;
    const teCost = withTokenEconomizer.cost.estimatedCost || 0;
    const absoluteSavings = baselineCost - teCost;
    const percentageSavings =
      baselineCost > 0 ? (absoluteSavings / baselineCost) * 100 : 0;

    // Calculate token savings
    const inputSavings =
      baseline.tokenUsage.inputTokens - withTokenEconomizer.tokenUsage.inputTokens;
    const outputSavings =
      baseline.tokenUsage.outputTokens - withTokenEconomizer.tokenUsage.outputTokens;
    const cacheSavings =
      baseline.tokenUsage.cacheTokens - withTokenEconomizer.tokenUsage.cacheTokens;
    const totalTokenSavings =
      baseline.tokenUsage.totalTokens - withTokenEconomizer.tokenUsage.totalTokens;

    // Determine verdict
    let verdict: BaselineComparison["verdict"];
    if (absoluteSavings > 0 && percentageSavings > 0) {
      verdict = "prometteur";
    } else if (absoluteSavings < 0) {
      verdict = "non rentable";
    } else if (this.tokenEconomizer?.isAvailable()) {
      verdict = "données insuffisantes";
    } else {
      verdict = "incompatible";
    }

    return {
      scenario,
      sha: baseline.sha,
      model: baseline.tokenUsage?.timestamp ? undefined : "unknown",
      timestamp: new Date().toISOString(),
      baseline: {
        metrics: baseline,
        label: "A (Copilot historique)",
      },
      withTokenEconomizer: {
        metrics: withTokenEconomizer,
        label: "B (Copilot + TokenEconomizer)",
      },
      costSavings: {
        absolute: absoluteSavings,
        percentage: percentageSavings,
        measured: baselineCost > 0,
      },
      tokenSavings: {
        inputTokens: inputSavings,
        outputTokens: outputSavings,
        cacheTokens: cacheSavings,
        totalTokens: totalTokenSavings,
      },
      verdict,
    };
  }

  /**
   * Generate scenario label
   */
  private getScenarioLabel(metrics: TourGenerationMetrics): string {
    const parts: string[] = [metrics.tourType];
    if (metrics.reviewMode) {
      parts.push(metrics.reviewMode);
    }
    return parts.join("-");
  }

  /**
   * Reset all tracked data
   */
  reset(): void {
    this.costTracker.reset();
    this.results.clear();
  }

  /**
   * Get the cost tracker
   */
  getCostTracker(): CostTracker {
    return this.costTracker;
  }

  /**
   * Get TokenEconomizer instance
   */
  getTokenEconomizer(): TokenEconomizerPOC | undefined {
    return this.tokenEconomizer;
  }

  /**
   * Set model info for cost estimation
   */
  setModelInfo(modelInfo: ModelInfo): void {
    this.costTracker.setModelInfo(modelInfo);
  }
}
