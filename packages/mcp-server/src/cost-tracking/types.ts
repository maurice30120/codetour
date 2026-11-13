/**
 * Cost tracking types for TokenEconomizer POC and Copilot cost baseline
 * Part of spec #92, ticket #113
 */

/**
 * Types of cost metrics that can be tracked
 */
export enum CostMetricType {
  InputTokens = "inputTokens",
  OutputTokens = "outputTokens",
  CacheTokens = "cacheTokens",
  AICredits = "aiCredits",
  EstimatedCost = "estimatedCost",
  DurationMs = "durationMs",
  ToolsCalled = "toolsCalled",
}

/**
 * Token usage metrics from a single agent interaction
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  timestamp: string;
}

/**
 * Model pricing information for cost estimation
 */
export interface ModelInfo {
  model: string;
  inputPricePerToken?: number;
  outputPricePerToken?: number;
  cachePricePerToken?: number;
}

/**
 * Configuration for cost tracking
 */
export interface CostTrackingConfig {
  trackInputTokens: boolean;
  trackOutputTokens: boolean;
  trackCacheTokens: boolean;
  trackAICredits: boolean;
  trackDuration: boolean;
  trackToolsCalled: boolean;
  modelInfo?: ModelInfo;
}

/**
 * Cost information for a generation run
 */
export interface CostInfo {
  aiCredits?: number; // Native Copilot AI Credits if available
  estimatedCost?: number; // Estimated cost based on token counts and pricing
}

/**
 * Metrics for a single Tour generation
 */
export interface TourGenerationMetrics {
  tourType: "project" | "changes";
  reviewMode?: "neutral" | "critical";
  sha: string;
  timestamp: string;
  tokenUsage: TokenUsage;
  cost: CostInfo;
  durationMs: number;
  toolsCalled: number;
  stepsGenerated: number;
  validationWarnings: number;
  success: boolean;
  error?: string;
}

/**
 * TokenEconomizer plugin settings
 */
export interface TokenEconomizerSettings {
  toolPrune?: "off" | "propose" | "aggressive";
  microSkills?: boolean;
  loopGuard?: boolean;
}

/**
 * TokenEconomizer configuration
 */
export interface TokenEconomizerConfig {
  enabled: boolean;
  pluginPath?: string;
  pythonPath?: string;
  version?: string;
  settings: TokenEconomizerSettings;
  copilotVersion?: string;
  compatible: boolean;
  error?: string;
}

/**
 * Comparison result between baseline and TokenEconomizer scenarios
 */
export interface BaselineComparison {
  scenario: string;
  sha: string;
  model?: string;
  timestamp: string;
  baseline: {
    metrics: TourGenerationMetrics;
    label: string;
  };
  withTokenEconomizer?: {
    metrics: TourGenerationMetrics;
    label: string;
  };
  costSavings?: {
    absolute: number;
    percentage: number;
    measured: boolean;
  };
  tokenSavings?: {
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    totalTokens: number;
  };
  verdict: "prometteur" | "non rentable" | "incompatible" | "données insuffisantes" | "indéterminé";
}

/**
 * Complete benchmark report
 */
export interface BenchmarkReport {
  version: string;
  timestamp: string;
  environment: {
    os: string;
    nodeVersion: string;
    copilotVersion?: string;
    tokenEconomizerVersion?: string;
    repository: string;
    sha: string;
  };
  comparisons: BaselineComparison[];
  summary: {
    totalCostSavings?: number;
    totalTokenSavings?: number;
    overallVerdict: string;
    recommendations: string[];
  };
}
