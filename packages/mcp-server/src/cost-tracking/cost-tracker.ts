/**
 * Cost Tracker for Copilot and TokenEconomizer POC
 * Part of spec #92, ticket #113
 */

import {
  CostTrackingConfig,
  TokenUsage,
  TourGenerationMetrics,
  CostInfo,
  ModelInfo,
} from "./types";

/**
 * Tracks token usage and costs for Tour generation
 */
export class CostTracker {
  private config: CostTrackingConfig;
  private modelInfo: ModelInfo;
  private startTime: number = 0;
  private toolsCalled: number = 0;
  private tokenUsage: TokenUsage;

  constructor(config: Partial<CostTrackingConfig> = {}) {
    this.config = {
      trackInputTokens: true,
      trackOutputTokens: true,
      trackCacheTokens: true,
      trackAICredits: false,
      trackDuration: true,
      trackToolsCalled: true,
      ...config,
    };
    this.modelInfo = config.modelInfo || {
      model: "unknown",
      inputPricePerToken: 0.00001,
      outputPricePerToken: 0.00003,
      cachePricePerToken: 0.000005,
    };
    this.tokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      totalTokens: 0,
      timestamp: new Date().toISOString(),
    };
    this.reset();
  }

  /**
   * Reset all tracked metrics
   */
  reset(): void {
    this.startTime = Date.now();
    this.toolsCalled = 0;
    this.tokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      totalTokens: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Record input tokens
   */
  addInputTokens(count: number): void {
    if (this.config.trackInputTokens) {
      this.tokenUsage.inputTokens += count;
      this.updateTotalTokens();
    }
  }

  /**
   * Record output tokens
   */
  addOutputTokens(count: number): void {
    if (this.config.trackOutputTokens) {
      this.tokenUsage.outputTokens += count;
      this.updateTotalTokens();
    }
  }

  /**
   * Record cache tokens
   */
  addCacheTokens(count: number): void {
    if (this.config.trackCacheTokens) {
      this.tokenUsage.cacheTokens += count;
      this.updateTotalTokens();
    }
  }

  /**
   * Record tool call
   */
  recordToolCall(): void {
    if (this.config.trackToolsCalled) {
      this.toolsCalled++;
    }
  }

  /**
   * Update total tokens
   */
  private updateTotalTokens(): void {
    this.tokenUsage.totalTokens =
      this.tokenUsage.inputTokens +
      this.tokenUsage.outputTokens +
      this.tokenUsage.cacheTokens;
    this.tokenUsage.timestamp = new Date().toISOString();
  }

  /**
   * Calculate estimated cost based on token usage
   */
  calculateEstimatedCost(): number {
    const inputCost =
      this.tokenUsage.inputTokens * (this.modelInfo.inputPricePerToken || 0);
    const outputCost =
      this.tokenUsage.outputTokens * (this.modelInfo.outputPricePerToken || 0);
    const cacheCost =
      this.tokenUsage.cacheTokens * (this.modelInfo.cachePricePerToken || 0);
    return inputCost + outputCost + cacheCost;
  }

  /**
   * Get current duration in milliseconds
   */
  getDurationMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get current token usage
   */
  getTokenUsage(): TokenUsage {
    return { ...this.tokenUsage };
  }

  /**
   * Get current tools called count
   */
  getToolsCalled(): number {
    return this.toolsCalled;
  }

  /**
   * Build cost info from current state
   */
  buildCostInfo(aiCredits?: number): CostInfo {
    const costInfo: CostInfo = {};
    
    if (this.config.trackAICredits && aiCredits !== undefined) {
      costInfo.aiCredits = aiCredits;
    }
    
    costInfo.estimatedCost = this.calculateEstimatedCost();
    
    return costInfo;
  }

  /**
   * Finalize metrics for a Tour generation
   */
  finalizeMetrics(
    tourType: "project" | "changes",
    reviewMode: "neutral" | "critical" | undefined,
    sha: string,
    stepsGenerated: number,
    validationWarnings: number,
    success: boolean,
    error?: string,
    aiCredits?: number
  ): TourGenerationMetrics {
    return {
      tourType,
      reviewMode,
      sha,
      timestamp: new Date().toISOString(),
      tokenUsage: this.getTokenUsage(),
      cost: this.buildCostInfo(aiCredits),
      durationMs: this.getDurationMs(),
      toolsCalled: this.getToolsCalled(),
      stepsGenerated,
      validationWarnings,
      success,
      error,
    };
  }

  /**
   * Get model info
   */
  getModelInfo(): ModelInfo {
    return { ...this.modelInfo };
  }

  /**
   * Update model info
   */
  setModelInfo(modelInfo: ModelInfo): void {
    this.modelInfo = { ...modelInfo };
  }

  /**
   * Get configuration
   */
  getConfig(): CostTrackingConfig {
    return { ...this.config };
  }
}
