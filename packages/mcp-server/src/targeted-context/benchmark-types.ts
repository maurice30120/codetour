/**
 * Benchmark types for comprehensive Targeted Context comparison
 * Spec #92, Ticket #118
 * 
 * Compares 5 approaches:
 * A: No Targeted Context (baseline)
 * B: Basic Targeted Context for Changes Tour (ticket #115)
 * C: Progressive MCP exploration (ticket #116)
 * D: Project Tour Targeted Context (ticket #117)
 * TE: TokenEconomizer plugin (ticket #113)
 */

import { CodeSymbol } from "../parsing/symbol-extractor";
import { TokenUsage, CostInfo, TokenEconomizerConfig } from "../cost-tracking/types";
import { TargetedContext, TargetedContextConfig } from "./types";
import { ProjectTargetedContext, ProjectTargetedContextConfig } from "./project-types";
import { PaginatedTargetedContext } from "./types";

/**
 * Identifiers for the 5 benchmark approaches
 */
export type BenchmarkApproach = "A" | "B" | "C" | "D" | "TE";

/**
 * Labels for each approach
 */
export const APPROACH_LABELS: Record<BenchmarkApproach, string> = {
  A: "No Targeted Context (Baseline)",
  B: "Basic Targeted Context - Changes Tour (Ticket #115)",
  C: "Progressive MCP Exploration (Ticket #116)",
  D: "Project Tour Targeted Context (Ticket #117)",
  TE: "TokenEconomizer Plugin (Ticket #113)"
};

/**
 * Description of each approach
 */
export const APPROACH_DESCRIPTIONS: Record<BenchmarkApproach, string> = {
  A: "Traditional open-ended exploration without bounded context. The Tour Generator explores the entire codebase freely.",
  B: "Bounded context extraction from changed files only. Provides targeted symbols from files that changed between base and head commits.",
  C: "Progressive, paginated context exploration. Allows incremental discovery of symbols across the codebase with MCP server pagination.",
  D: "Comprehensive workspace-wide context. Extracts symbols from the entire project structure with configurable limits.",
  TE: "TokenEconomizer plugin integration. Uses the TokenEconomizer POC from ticket #113 to optimize token usage through tool pruning and micro-skills."
};

/**
 * Metrics collected during benchmark execution
 */
export interface BenchmarkMetrics {
  /**
   * Total symbols extracted/available
   */
  totalSymbols: number;
  /**
   * Total files processed
   */
  totalFiles: number;
  /**
   * Token usage for context generation
   */
  tokenUsage: TokenUsage;
  /**
   * Cost information for context generation
   */
  cost: CostInfo;
  /**
   * Duration of context generation in milliseconds
   */
  durationMs: number;
  /**
   * Peak memory usage in bytes (if available)
   */
  peakMemoryBytes?: number;
  /**
   * Number of MCP tool calls made
   */
  mcpToolCalls: number;
  /**
   * Number of API requests (simulated or actual)
   */
  apiRequests: number;
  /**
   * Size of context in bytes
   */
  contextSizeBytes: number;
  /**
   * Number of warnings during execution
   */
  warnings: number;
  /**
   * Number of errors during execution
   */
  errors: number;
}

/**
 * Result of running a single benchmark for one approach
 */
export interface ApproachBenchmarkResult {
  /**
   * The approach identifier
   */
  approach: BenchmarkApproach;
  /**
   * Label for this approach
   */
  label: string;
  /**
   * Description of this approach
   */
  description: string;
  /**
   * Whether the benchmark succeeded
   */
  success: boolean;
  /**
   * Metrics collected
   */
  metrics: BenchmarkMetrics;
  /**
   * Error message if failed
   */
  error?: string;
  /**
   * Timestamp when benchmark started
   */
  startedAt: string;
  /**
   * Timestamp when benchmark completed
   */
  completedAt: string;
  /**
   * Additional metadata specific to the approach
   */
  metadata?: Record<string, unknown>;
}

/**
 * Configuration for running benchmarks
 */
export interface BenchmarkConfig {
  /**
   * Workspace root path for project-wide benchmarks
   */
  workspaceRoot: string;
  /**
   * Base commit SHA for Changes Tour benchmarks
   */
  baseRef?: string;
  /**
   * Head commit SHA for Changes Tour benchmarks
   */
  headRef?: string;
  /**
   * Number of iterations to run each benchmark
   */
  iterations: number;
  /**
   * Whether to warm up before measuring (run once without measuring)
   */
  warmup: boolean;
  /**
   * Which approaches to benchmark (default: all)
   */
  approaches?: BenchmarkApproach[];
  /**
   * Configuration for Approach B (Changes Tour Targeted Context)
   */
  configB?: TargetedContextConfig;
  /**
   * Configuration for Approach C (Progressive Context)
   */
  configC?: TargetedContextConfig;
  /**
   * Configuration for Approach D (Project Tour Targeted Context)
   */
  configD?: ProjectTargetedContextConfig;
  /**
   * Configuration for Approach TE (TokenEconomizer)
   */
  configTE?: TokenEconomizerConfig;
  /**
   * Token price per 1000 tokens (for cost estimation)
   */
  tokenPricePer1000?: {
    input?: number;
    output?: number;
  };
  /**
   * Whether to collect memory usage (if supported)
   */
  collectMemory: boolean;
}

/**
 * Default benchmark configuration
 */
export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  workspaceRoot: process.cwd(),
  iterations: 3,
  warmup: true,
  approaches: ["A", "B", "C", "D", "TE"],
  collectMemory: true,
  tokenPricePer1000: {
    input: 0.00001,
    output: 0.00003
  }
};

/**
 * Comparison data between two approaches
 */
export interface ApproachComparison {
  /**
   * First approach
   */
  approach1: BenchmarkApproach;
  /**
   * Second approach
   */
  approach2: BenchmarkApproach;
  /**
   * Symbol count difference
   */
  symbolDifference: number;
  /**
   * Token usage difference
   */
  tokenDifference: {
    input: number;
    output: number;
    total: number;
  };
  /**
   * Duration difference in milliseconds
   */
  durationDifferenceMs: number;
  /**
   * Cost difference
   */
  costDifference: number;
  /**
   * Memory difference in bytes
   */
  memoryDifferenceBytes: number;
  /**
   * Efficiency ratio (higher is better)
   */
  efficiencyRatio: {
    symbolsPerToken: number;
    symbolsPerMs: number;
    tokensPerMs: number;
  };
  /**
   * Whether approach2 is better than approach1
   */
  isApproach2Better: boolean;
  /**
   * Improvement percentage (positive if approach2 is better)
   */
  improvementPercentage: {
    symbols?: number;
    tokens?: number;
    duration?: number;
    cost?: number;
  };
}

/**
 * Complete benchmark report for Targeted Context
 */
export interface TargetedContextBenchmarkReport {
  /**
   * Report version
   */
  version: string;
  /**
   * Timestamp when report was generated
   */
  timestamp: string;
  /**
   * Environment information
   */
  environment: {
    os: string;
    nodeVersion: string;
    workspaceRoot: string;
    repository?: string;
    sha?: string;
  };
  /**
   * Benchmark configuration used
   */
  config: BenchmarkConfig;
  /**
   * Results for each approach
   */
  results: ApproachBenchmarkResult[];
  /**
   * Pairwise comparisons
   */
  comparisons: ApproachComparison[];
  /**
   * Summary statistics and recommendations
   */
  summary: BenchmarkSummary;
}

/**
 * Summary of benchmark results
 */
export interface BenchmarkSummary {
  /**
   * Total benchmarks run
   */
  totalBenchmarks: number;
  /**
   * Successful benchmarks
   */
  successfulBenchmarks: number;
  /**
   * Failed benchmarks
   */
  failedBenchmarks: number;
  /**
   * Best approach by different metrics
   */
  bestByMetric: {
    mostSymbols: BenchmarkApproach;
    fastest: BenchmarkApproach;
    lowestCost: BenchmarkApproach;
    mostEfficient: BenchmarkApproach;
    lowestMemory: BenchmarkApproach;
  };
  /**
   * Overall winner (if applicable)
   */
  overallWinner?: BenchmarkApproach;
  /**
   * Key findings
   */
  findings: string[];
  /**
   * Recommendations
   */
  recommendations: string[];
  /**
   * Performance tiers (grouped by performance characteristics)
   */
  tiers: {
    tier1: BenchmarkApproach[];
    tier2: BenchmarkApproach[];
    tier3: BenchmarkApproach[];
    tier4: BenchmarkApproach[];
  };
}

/**
 * Context sample for demonstration purposes
 */
export interface BenchmarkContextSample {
  /**
   * Sample of symbols from the approach
   */
  symbols: CodeSymbol[];
  /**
   * Sample of files included
   */
  files: string[];
  /**
   * Total available (may be more than sample)
   */
  totalAvailable: {
    symbols: number;
    files: number;
  };
}

/**
 * Metrics for a specific file in benchmark
 */
export interface FileBenchmarkMetrics {
  filePath: string;
  symbolCount: number;
  tokenCount: number;
  extractionDurationMs: number;
  sizeBytes: number;
}

/**
 * Per-file breakdown for an approach
 */
export interface ApproachFileBreakdown {
  approach: BenchmarkApproach;
  files: FileBenchmarkMetrics[];
  totalSymbols: number;
  totalTokens: number;
  totalDurationMs: number;
}
