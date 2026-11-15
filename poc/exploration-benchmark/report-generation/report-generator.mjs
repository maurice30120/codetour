#!/usr/bin/env node
/**
 * Report Generator for Spec #172 - POC Token Analysis
 * 
 * This module generates comprehensive reports comparing POC (with memory) vs Vibe
 * on token usage, costs, and effectiveness.
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Token and cost calculation functions
 */

/**
 * Calculate total tokens for a run (input + output)
 * @param {object} run - A benchmark run object
 * @returns {number} Total tokens
 */
export function calculateTotalTokens(run) {
  const metrics = run.result?.metrics || run.metrics || {};
  return (metrics.inputTokens || 0) + (metrics.outputTokens || 0);
}

/**
 * Calculate token cost for a run
 * @param {object} run - A benchmark run object
 * @param {object} pricing - Pricing configuration { inputPrice, outputPrice }
 * @returns {number} Token cost
 */
export function calculateTokenCost(run, pricing = { inputPrice: 0.000003, outputPrice: 0.000006 }) {
  const metrics = run.result?.metrics || run.metrics || {};
  const inputTokens = metrics.inputTokens || 0;
  const outputTokens = metrics.outputTokens || 0;
  return (inputTokens * pricing.inputPrice) + (outputTokens * pricing.outputPrice);
}

/**
 * Check if a run is complete (not partial)
 * @param {object} run - A benchmark run object
 * @returns {boolean} True if complete
 */
export function isCompleteRun(run) {
  const result = run.result || {};
  return result.status === 'complete' || result.status === 'success';
}

/**
 * Statistical calculation functions
 */

/**
 * Calculate mean of an array of numbers
 * @param {number[]} values - Array of numbers
 * @returns {number} Mean
 */
export function calculateMean(values) {
  if (!values || values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Calculate median of an array of numbers
 * @param {number[]} values - Array of numbers
 * @returns {number} Median
 */
export function calculateMedian(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

/**
 * Calculate standard deviation of an array of numbers
 * @param {number[]} values - Array of numbers
 * @returns {number} Standard deviation
 */
export function calculateStdDev(values) {
  if (!values || values.length <= 1) return 0;
  
  const mean = calculateMean(values);
  const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
  const variance = calculateMean(squaredDiffs);
  return Math.sqrt(variance);
}

/**
 * Calculate dispersion metrics for an array of numbers
 * @param {number[]} values - Array of numbers
 * @returns {object} Dispersion metrics { min, max, mean, median, stdDev }
 */
export function calculateDispersion(values) {
  if (!values || values.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0, stdDev: 0 };
  }
  
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: calculateMean(values),
    median: calculateMedian(sorted),
    stdDev: calculateStdDev(values)
  };
}

/**
 * Break-even analysis functions
 */

/**
 * Calculate break-even point between POC and Vibe
 * @param {object} pocMetrics - POC metrics { totalTokens, totalCost, runCount }
 * @param {object} vibeMetrics - Vibe metrics { totalTokens, totalCost, runCount }
 * @returns {object} Break-even analysis { reached, pocCost, vibeCost, pocAvgCost, vibeAvgCost, savings }
 */
export function calculateBreakEven(pocMetrics, vibeMetrics) {
  const pocAvgCost = pocMetrics.totalCost / pocMetrics.runCount;
  const vibeAvgCost = vibeMetrics.totalCost / vibeMetrics.runCount;
  const savings = vibeMetrics.totalCost - pocMetrics.totalCost;
  
  return {
    reached: pocMetrics.totalCost < vibeMetrics.totalCost,
    pocCost: pocMetrics.totalCost,
    vibeCost: vibeMetrics.totalCost,
    pocAvgCost,
    vibeAvgCost,
    savings: savings > 0 ? savings : 0,
    tokenSavings: vibeMetrics.totalTokens - pocMetrics.totalTokens
  };
}

/**
 * Calculate marginal token cost per run
 * @param {object[]} runs - Array of runs
 * @param {object} pricing - Pricing configuration
 * @returns {number[]} Array of marginal costs
 */
export function calculateMarginalTokenCosts(runs, pricing) {
  return runs.map(run => calculateTokenCost(run, pricing));
}

/**
 * Calculate cumulative token cost
 * @param {number[]} costs - Array of costs
 * @returns {number[]} Array of cumulative costs
 */
export function calculateCumulativeTokenCosts(costs) {
  const cumulative = [];
  let sum = 0;
  for (const cost of costs) {
    sum += cost;
    cumulative.push(sum);
  }
  return cumulative;
}

/**
 * Calculate tokens per correct Tour
 * @param {object[]} runs - Array of runs
 * @returns {object} Tokens per correct Tour metrics
 */
export function calculateTokensPerCorrectTour(runs) {
  const totalTokens = runs.reduce((sum, run) => sum + calculateTotalTokens(run), 0);
  const correctRuns = runs.filter(run => isCompleteRun(run)).length;
  
  return {
    totalTokens,
    correctRuns,
    tokensPerCorrectTour: correctRuns > 0 ? totalTokens / correctRuns : 0,
    completionRate: correctRuns / runs.length
  };
}

/**
 * Verdict determination functions
 */

/**
 * Determine verdict based on comparison of POC and Vibe metrics
 * @param {object} pocMetrics - POC metrics
 * @param {object} vibeMetrics - Vibe metrics
 * @returns {string} Verdict: 'validé' | 'invalidé' | 'indéterminé'
 */
export function determineVerdict(pocMetrics, vibeMetrics) {
  // POC is valid if:
  // 1. Lower or equal average tokens
  // 2. Higher or equal completion rate
  // 3. Lower or equal total cost
  const pocBetterTokens = pocMetrics.avgTokens <= vibeMetrics.avgTokens;
  const pocBetterCompletion = pocMetrics.completeRate >= vibeMetrics.completeRate;
  const pocBetterCost = pocMetrics.totalCost <= vibeMetrics.totalCost;
  
  // If POC is better in all aspects
  if (pocBetterTokens && pocBetterCompletion && pocBetterCost) {
    // Check if it's significantly better
    const tokenSavings = vibeMetrics.avgTokens - pocMetrics.avgTokens;
    const costSavings = vibeMetrics.totalCost - pocMetrics.totalCost;
    
    if (tokenSavings > 0 && costSavings > 0) {
      return 'validé';
    }
    return 'indéterminé';
  }
  
  // If Vibe is better in all aspects
  if (!pocBetterTokens && !pocBetterCompletion && !pocBetterCost) {
    return 'invalidé';
  }
  
  // Mixed results
  return 'indéterminé';
}

/**
 * Data processing functions
 */

/**
 * Normalize benchmark data to a common format
 * @param {object} data - Benchmark data in various formats
 * @returns {object} Normalized data { runs: [], metadata: {} }
 */
export function normalizeBenchmarkData(data) {
  const normalized = { runs: [], metadata: {} };
  
  // Copy metadata
  if (data.timestamp) normalized.metadata.timestamp = data.timestamp;
  if (data.model) normalized.metadata.model = data.model;
  if (data.budget) normalized.metadata.budget = data.budget;
  
  // Handle rows format (POC data)
  if (data.rows) {
    for (const row of data.rows) {
      const run = {
        task: row.task,
        repetition: row.repetition,
        mode: row.mode,
        run: row.run,
        calls: row.calls,
        scriptCalls: row.scriptCalls || [],
        library: row.library || [],
        wallTimeMs: row.wallTimeMs,
        result: row.result || {},
        metrics: row.result?.metrics || row.metrics || {}
      };
      normalized.runs.push(run);
    }
  }
  
  // Handle records format (Vibe/other data)
  if (data.records) {
    for (const record of data.records) {
      const run = {
        task: record.task || 'unknown',
        repetition: record.repetition || 1,
        mode: record.mode || 'vibe',
        run: record.run || 1,
        calls: record.calls || [],
        scriptCalls: record.scriptCalls || [],
        library: record.library || [],
        wallTimeMs: record.wallTimeMs || 0,
        result: record.result || {},
        metrics: record.result?.metrics || record.metrics || {}
      };
      normalized.runs.push(run);
    }
  }
  
  return normalized;
}

/**
 * Extract runs by mode (on/off/vibe/etc)
 * @param {object[]} runs - Array of normalized runs
 * @param {string} mode - Mode to filter by
 * @returns {object[]} Filtered runs
 */
export function filterRunsByMode(runs, mode) {
  return runs.filter(run => run.mode === mode);
}

/**
 * Extract all token values from runs
 * @param {object[]} runs - Array of runs
 * @param {string} tokenType - 'input', 'output', or 'total'
 * @returns {number[]} Array of token values
 */
export function extractTokenValues(runs, tokenType = 'total') {
  return runs.map(run => {
    const metrics = run.result?.metrics || run.metrics || {};
    switch (tokenType) {
      case 'input': return metrics.inputTokens || 0;
      case 'output': return metrics.outputTokens || 0;
      case 'total': return (metrics.inputTokens || 0) + (metrics.outputTokens || 0);
      default: return (metrics.inputTokens || 0) + (metrics.outputTokens || 0);
    }
  });
}

/**
 * Aggregate metrics for a set of runs
 * @param {object[]} runs - Array of runs
 * @returns {object} Aggregated metrics
 */
export function aggregateMetrics(runs) {
  const inputTokens = [];
  const outputTokens = [];
  const modelCalls = [];
  const toolCalls = [];
  const durations = [];
  const costs = [];
  const memoryReuses = [];
  const memoryPurges = [];
  
  let completeCount = 0;
  let partialCount = 0;
  
  for (const run of runs) {
    const metrics = run.result?.metrics || run.metrics || {};
    const result = run.result || {};
    
    inputTokens.push(metrics.inputTokens || 0);
    outputTokens.push(metrics.outputTokens || 0);
    modelCalls.push(metrics.modelCalls || 0);
    toolCalls.push(metrics.toolCalls || 0);
    durations.push(metrics.durationMs || run.wallTimeMs || 0);
    memoryReuses.push(metrics.memoryReuses || 0);
    memoryPurges.push(metrics.memoryPurges || 0);
    
    // Calculate cost (using default pricing)
    costs.push(calculateTokenCost(run));
    
    if (isCompleteRun(run)) {
      completeCount++;
    } else if (result.status === 'partial') {
      partialCount++;
    }
  }
  
  const totalTokens = inputTokens.reduce((a, b) => a + b, 0) + outputTokens.reduce((a, b) => a + b, 0);
  const totalCost = costs.reduce((a, b) => a + b, 0);
  const totalTokensPerRun = inputTokens.map((t, i) => t + outputTokens[i]);
  
  return {
    count: runs.length,
    completeCount,
    partialCount,
    completionRate: runs.length > 0 ? completeCount / runs.length : 0,
    totalInputTokens: inputTokens.reduce((a, b) => a + b, 0),
    totalOutputTokens: outputTokens.reduce((a, b) => a + b, 0),
    totalTokens,
    avgInputTokens: calculateMean(inputTokens),
    avgOutputTokens: calculateMean(outputTokens),
    avgTotalTokens: calculateMean(totalTokensPerRun),
    totalModelCalls: modelCalls.reduce((a, b) => a + b, 0),
    avgModelCalls: calculateMean(modelCalls),
    totalToolCalls: toolCalls.reduce((a, b) => a + b, 0),
    avgToolCalls: calculateMean(toolCalls),
    totalDurationMs: durations.reduce((a, b) => a + b, 0),
    avgDurationMs: calculateMean(durations),
    totalCost,
    avgCost: calculateMean(costs),
    totalMemoryReuses: memoryReuses.reduce((a, b) => a + b, 0),
    totalMemoryPurges: memoryPurges.reduce((a, b) => a + b, 0),
    dispersion: {
      inputTokens: calculateDispersion(inputTokens),
      outputTokens: calculateDispersion(outputTokens),
      totalTokens: calculateDispersion(totalTokensPerRun),
      cost: calculateDispersion(costs),
      duration: calculateDispersion(durations)
    },
    marginalCosts: costs,
    cumulativeCosts: calculateCumulativeTokenCosts(costs),
    tokenValues: {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens.map((t, i) => t + outputTokens[i])
    }
  };
}

/**
 * Main report generation functions
 */

/**
 * Generate comprehensive analysis for POC vs Vibe
 * @param {object} pocData - POC benchmark data
 * @param {object} vibeData - Vibe benchmark data
 * @param {object} options - Options { pricing, includeRawData }
 * @returns {object} Complete analysis
 */
export function generateAnalysis(pocData, vibeData, options = {}) {
  const { pricing = { inputPrice: 0.000003, outputPrice: 0.000006 }, includeRawData = false } = options;
  
  // Normalize data
  const normalizedPoc = normalizeBenchmarkData(pocData);
  const normalizedVibe = normalizeBenchmarkData(vibeData);
  
  // Separate POC modes (on = with memory, off = without memory)
  const pocWithMemory = filterRunsByMode(normalizedPoc.runs, 'on');
  const pocWithoutMemory = filterRunsByMode(normalizedPoc.runs, 'off');
  
  // All POC runs (combined)
  const allPocRuns = [...pocWithMemory, ...pocWithoutMemory];
  
  // Vibe runs (all assumed to be without memory)
  const allVibeRuns = normalizedVibe.runs;
  
  // Aggregate metrics
  const pocWithMemoryMetrics = aggregateMetrics(pocWithMemory);
  const pocWithoutMemoryMetrics = aggregateMetrics(pocWithoutMemory);
  const allPocMetrics = aggregateMetrics(allPocRuns);
  const vibeMetrics = aggregateMetrics(allVibeRuns);
  
  // Token curves
  const pocTokenCurve = allPocMetrics.tokenValues.total;
  const vibeTokenCurve = vibeMetrics.tokenValues.total;
  
  // Dispersion analysis
  const pocDispersion = allPocMetrics.dispersion;
  const vibeDispersion = vibeMetrics.dispersion;
  
  // Marginal and cumulative costs
  const pocMarginalCosts = allPocMetrics.marginalCosts;
  const pocCumulativeCosts = allPocMetrics.cumulativeCosts;
  const vibeMarginalCosts = vibeMetrics.marginalCosts;
  const vibeCumulativeCosts = vibeMetrics.cumulativeCosts;
  
  // Tokens per correct Tour
  const pocTokensPerCorrect = calculateTokensPerCorrectTour(allPocRuns);
  const vibeTokensPerCorrect = calculateTokensPerCorrectTour(allVibeRuns);
  
  // Break-even analysis
  const breakEven = calculateBreakEven(
    { totalTokens: allPocMetrics.totalTokens, totalCost: allPocMetrics.totalCost, runCount: allPocRuns.length },
    { totalTokens: vibeMetrics.totalTokens, totalCost: vibeMetrics.totalCost, runCount: allVibeRuns.length }
  );
  
  // Verdict
  const verdict = determineVerdict(
    { avgTokens: allPocMetrics.avgTotalTokens, completeRate: allPocMetrics.completionRate, totalCost: allPocMetrics.totalCost },
    { avgTokens: vibeMetrics.avgTotalTokens, completeRate: vibeMetrics.completionRate, totalCost: vibeMetrics.totalCost }
  );
  
  // Document all measurements
  const measurements = documentMeasurements(normalizedPoc, normalizedVibe, pricing);
  
  // Build the complete analysis
  const analysis = {
    metadata: {
      timestamp: new Date().toISOString(),
      pocMetadata: normalizedPoc.metadata,
      vibeMetadata: normalizedVibe.metadata,
      pricing
    },
    tokenCurves: {
      poc: pocTokenCurve,
      vibe: vibeTokenCurve,
      pocWithMemory: extractTokenValues(pocWithMemory, 'total'),
      pocWithoutMemory: extractTokenValues(pocWithoutMemory, 'total')
    },
    dispersionAnalysis: {
      poc: pocDispersion,
      vibe: vibeDispersion
    },
    marginalTokenCost: {
      poc: pocMarginalCosts,
      vibe: vibeMarginalCosts
    },
    cumulativeTokenCost: {
      poc: pocCumulativeCosts,
      vibe: vibeCumulativeCosts
    },
    tokensPerCorrectTour: {
      poc: pocTokensPerCorrect,
      vibe: vibeTokensPerCorrect
    },
    breakEvenPoint: breakEven,
    verdict,
    measurements,
    summary: {
      poc: {
        runs: allPocRuns.length,
        complete: allPocMetrics.completeCount,
        partial: allPocMetrics.partialCount,
        avgTokens: allPocMetrics.avgTotalTokens,
        totalCost: allPocMetrics.totalCost,
        avgCost: allPocMetrics.avgCost
      },
      vibe: {
        runs: allVibeRuns.length,
        complete: vibeMetrics.completeCount,
        partial: vibeMetrics.partialCount,
        avgTokens: vibeMetrics.avgTotalTokens,
        totalCost: vibeMetrics.totalCost,
        avgCost: vibeMetrics.avgCost
      }
    }
  };
  
  // Include raw data if requested
  if (includeRawData) {
    analysis.rawData = {
      poc: normalizedPoc,
      vibe: normalizedVibe
    };
  }
  
  return analysis;
}

/**
 * Document all measurements as required by spec
 * @param {object} pocData - Normalized POC data
 * @param {object} vibeData - Normalized Vibe data
 * @param {object} pricing - Pricing configuration
 * @returns {object} Documented measurements
 */
export function documentMeasurements(pocData, vibeData, pricing) {
  const measurements = {
    exploration: {
      poc: [],
      vibe: []
    },
    search: {
      poc: [],
      vibe: []
    },
    diagnostics: {
      poc: [],
      vibe: []
    },
    corrections: {
      poc: [],
      vibe: []
    },
    selection: {
      poc: [],
      vibe: []
    },
    consolidation: {
      poc: [],
      vibe: []
    },
    qualityAndCoverage: {
      poc: { proofs: 0, correct: 0, incorrect: 0, coverage: 0 },
      vibe: { proofs: 0, correct: 0, incorrect: 0, coverage: 0 }
    },
    failures: {
      poc: [],
      vibe: []
    },
    partialTours: {
      poc: [],
      vibe: []
    },
    configurationDifferences: []
  };
  
  // Extract measurements from POC data
  for (const run of pocData.runs) {
    const result = run.result || {};
    const metrics = result.metrics || {};
    
    // Categorize based on calls
    if (run.calls) {
      const callCounts = countCalls(run.calls);
      
      if (callCounts.list > 0) {
        measurements.exploration.poc.push({
          run: `${run.task}-${run.repetition}-${run.run}`,
          calls: callCounts.list,
          tokens: metrics.inputTokens || 0
        });
      }
      
      if (callCounts.search > 0) {
        measurements.search.poc.push({
          run: `${run.task}-${run.repetition}-${run.run}`,
          calls: callCounts.search,
          tokens: metrics.inputTokens || 0
        });
      }
      
      if (callCounts.read > 0) {
        measurements.diagnostics.poc.push({
          run: `${run.task}-${run.repetition}-${run.run}`,
          calls: callCounts.read,
          tokens: metrics.inputTokens || 0
        });
      }
    }
    
    // Quality and coverage
    if (result.entryPoints) {
      measurements.qualityAndCoverage.poc.proofs += result.entryPoints.length;
    }
    if (result.components) {
      measurements.qualityAndCoverage.poc.proofs += result.components.length;
    }
    if (result.relations) {
      measurements.qualityAndCoverage.poc.proofs += result.relations.length;
    }
    
    // Failures and partial tours
    if (result.status === 'partial') {
      measurements.partialTours.poc.push({
        run: `${run.task}-${run.repetition}-${run.run}`,
        stopReason: result.stopReason,
        uncertainties: result.uncertainties
      });
    }
    
    if (result.status === 'failed' || result.status === 'error') {
      measurements.failures.poc.push({
        run: `${run.task}-${run.repetition}-${run.run}`,
        reason: result.stopReason || 'Unknown error'
      });
    }
    
    // Memory operations (consolidation)
    if (metrics.memoryReuses > 0 || metrics.memoryPurges > 0) {
      measurements.consolidation.poc.push({
        run: `${run.task}-${run.repetition}-${run.run}`,
        reuses: metrics.memoryReuses,
        purges: metrics.memoryPurges
      });
    }
    
    // Script calls (selection)
    if (run.scriptCalls && run.scriptCalls.length > 0) {
      measurements.selection.poc.push({
        run: `${run.task}-${run.repetition}-${run.run}`,
        scriptCalls: run.scriptCalls.length
      });
    }
  }
  
  // Extract measurements from Vibe data
  for (const run of vibeData.runs) {
    const result = run.result || {};
    const metrics = result.metrics || {};
    
    // Similar extraction for Vibe
    if (run.calls) {
      const callCounts = countCalls(run.calls);
      
      if (callCounts.list > 0) {
        measurements.exploration.vibe.push({
          run: `${run.task}-${run.repetition}-${run.run}`,
          calls: callCounts.list,
          tokens: metrics.inputTokens || 0
        });
      }
      
      if (callCounts.search > 0) {
        measurements.search.vibe.push({
          run: `${run.task}-${run.repetition}-${run.run}`,
          calls: callCounts.search,
          tokens: metrics.inputTokens || 0
        });
      }
      
      if (callCounts.read > 0) {
        measurements.diagnostics.vibe.push({
          run: `${run.task}-${run.repetition}-${run.run}`,
          calls: callCounts.read,
          tokens: metrics.inputTokens || 0
        });
      }
    }
    
    // Quality and coverage
    if (result.entryPoints) {
      measurements.qualityAndCoverage.vibe.proofs += result.entryPoints.length;
    }
    if (result.components) {
      measurements.qualityAndCoverage.vibe.proofs += result.components.length;
    }
    if (result.relations) {
      measurements.qualityAndCoverage.vibe.proofs += result.relations.length;
    }
    
    // Failures and partial tours
    if (result.status === 'partial') {
      measurements.partialTours.vibe.push({
        run: `${run.task}-${run.repetition}-${run.run}`,
        stopReason: result.stopReason,
        uncertainties: result.uncertainties
      });
    }
    
    if (result.status === 'failed' || result.status === 'error') {
      measurements.failures.vibe.push({
        run: `${run.task}-${run.repetition}-${run.run}`,
        reason: result.stopReason || 'Unknown error'
      });
    }
  }
  
  // Configuration differences
  if (pocData.metadata.model !== vibeData.metadata.model) {
    measurements.configurationDifferences.push({
      attribute: 'model',
      poc: pocData.metadata.model,
      vibe: vibeData.metadata.model
    });
  }
  
  if (JSON.stringify(pocData.metadata.budget) !== JSON.stringify(vibeData.metadata.budget)) {
    measurements.configurationDifferences.push({
      attribute: 'budget',
      poc: pocData.metadata.budget,
      vibe: vibeData.metadata.budget
    });
  }
  
  return measurements;
}

/**
 * Count occurrences of each call type
 * @param {string[]} calls - Array of call names
 * @returns {object} Call counts
 */
function countCalls(calls) {
  const counts = {};
  for (const call of calls) {
    counts[call] = (counts[call] || 0) + 1;
  }
  return counts;
}

/**
 * Generate JSON report
 * @param {object} pocData - POC benchmark data
 * @param {object} vibeData - Vibe benchmark data
 * @param {object} options - Options
 * @returns {string} JSON report
 */
export function generateJSONReport(pocData, vibeData, options = {}) {
  const analysis = generateAnalysis(pocData, vibeData, options);
  return JSON.stringify(analysis, null, 2);
}

/**
 * Generate Markdown report
 * @param {object} pocData - POC benchmark data
 * @param {object} vibeData - Vibe benchmark data
 * @param {object} options - Options
 * @returns {string} Markdown report
 */
export function generateMarkdownReport(pocData, vibeData, options = {}) {
  const analysis = generateAnalysis(pocData, vibeData, options);
  
  const lines = [];
  
  // Title
  lines.push('# Rapport d\'Analyse des Tokens - Spec #172');
  lines.push('');
  lines.push(`**Date**: ${analysis.metadata.timestamp}`);
  lines.push(`**Modèle**: ${analysis.metadata.pocMetadata.model || analysis.metadata.vibeMetadata.model || 'Non spécifié'}`);
  lines.push('');
  
  // Summary
  lines.push('## 📊 Résumé Exécutif');
  lines.push('');
  lines.push(`| Métrique | POC | Vibe |`);
  lines.push(`|----------|-----|------|`);
  lines.push(`| Nombre de runs | ${analysis.summary.poc.runs} | ${analysis.summary.vibe.runs} |`);
  lines.push(`| Runs complétés | ${analysis.summary.poc.complete} | ${analysis.summary.vibe.complete} |`);
  lines.push(`| Runs partiels | ${analysis.summary.poc.partial} | ${analysis.summary.vibe.partial} |`);
  lines.push(`| Taux de complétion | ${(analysis.summary.poc.completionRate * 100).toFixed(1)}% | ${(analysis.summary.vibe.completionRate * 100).toFixed(1)}% |`);
  lines.push(`| Tokens moyens par run | ${analysis.summary.poc.avgTokens.toFixed(0)} | ${analysis.summary.vibe.avgTokens.toFixed(0)} |`);
  lines.push(`| Coût total | $${analysis.summary.poc.totalCost.toFixed(4)} | $${analysis.summary.vibe.totalCost.toFixed(4)} |`);
  lines.push(`| Coût moyen par run | $${analysis.summary.poc.avgCost.toFixed(4)} | $${analysis.summary.vibe.avgCost.toFixed(4)} |`);
  lines.push('');
  
  // Verdict
  lines.push('## ✅ Verdict');
  lines.push('');
  const verdictEmoji = {
    'validé': '✅',
    'invalidé': '❌',
    'indéterminé': '❓'
  };
  lines.push(`**Verdict**: ${verdictEmoji[analysis.verdict] || ''} **${analysis.verdict.toUpperCase()}**`);
  lines.push('');
  lines.push('### Justification:');
  lines.push('');
  
  if (analysis.verdict === 'validé') {
    lines.push('- La solution POC utilise moins de tokens en moyenne');
    lines.push(`- Taux de complétion supérieur ou égal (${(analysis.summary.poc.completionRate * 100).toFixed(1)}% vs ${(analysis.summary.vibe.completionRate * 100).toFixed(1)}%)`);
    lines.push(`- Coût total inférieur ($${analysis.summary.poc.totalCost.toFixed(4)} vs $${analysis.summary.vibe.totalCost.toFixed(4)})`);
    lines.push(`- Économie de tokens: ${analysis.breakEvenPoint.tokenSavings.toFixed(0)} tokens`);
    lines.push(`- Économie de coût: $${analysis.breakEvenPoint.savings.toFixed(4)}`);
  } else if (analysis.verdict === 'invalidé') {
    lines.push('- La solution Vibe performe mieux sur les critères principaux');
    lines.push(`- Tokens moyens: ${analysis.summary.poc.avgTokens.toFixed(0)} (POC) vs ${analysis.summary.vibe.avgTokens.toFixed(0)} (Vibe)`);
    lines.push(`- Taux de complétion: ${(analysis.summary.poc.completionRate * 100).toFixed(1)}% (POC) vs ${(analysis.summary.vibe.completionRate * 100).toFixed(1)}% (Vibe)`);
  } else {
    lines.push('- Les résultats sont trop proches pour déterminer un gagnant clair');
    lines.push(`- Différence de tokens: ${Math.abs(analysis.summary.poc.avgTokens - analysis.summary.vibe.avgTokens).toFixed(0)} tokens`);
    lines.push(`- Différence de coût: $${Math.abs(analysis.summary.poc.totalCost - analysis.summary.vibe.totalCost).toFixed(4)}`);
  }
  lines.push('');
  
  // Token Curves
  lines.push('## 📈 Courbes de Tokens');
  lines.push('');
  lines.push('### POC (avec et sans mémoire)');
  lines.push('');
  lines.push('```');
  lines.push('Run | Mode | Total Tokens');
  lines.push('----|------|-------------');
  
  const pocRuns = [];
  for (let i = 0; i < Math.max(analysis.tokenCurves.pocWithMemory.length, analysis.tokenCurves.pocWithoutMemory.length); i++) {
    const withMemory = i < analysis.tokenCurves.pocWithMemory.length ? analysis.tokenCurves.pocWithMemory[i] : '-';
    const withoutMemory = i < analysis.tokenCurves.pocWithoutMemory.length ? analysis.tokenCurves.pocWithoutMemory[i] : '-';
    pocRuns.push(`Run ${i + 1} | with memory: ${withMemory} | without memory: ${withoutMemory}`);
  }
  lines.push(...pocRuns);
  lines.push('```');
  lines.push('');
  
  lines.push('### Vibe');
  lines.push('');
  lines.push('```');
  lines.push('Run | Total Tokens');
  lines.push('----|-------------');
  for (let i = 0; i < analysis.tokenCurves.vibe.length; i++) {
    lines.push(`Run ${i + 1} | ${analysis.tokenCurves.vibe[i]}`);
  }
  lines.push('```');
  lines.push('');
  
  // Dispersion Analysis
  lines.push('## 📊 Analyse de Dispersion');
  lines.push('');
  lines.push('### POC');
  lines.push('');
  lines.push(`| Métrique | Min | Max | Médiane | Moyenne | Écart-type |`);
  lines.push(`|----------|-----|-----|--------|---------|------------|`);
  lines.push(`| Input Tokens | ${analysis.dispersionAnalysis.poc.inputTokens.min} | ${analysis.dispersionAnalysis.poc.inputTokens.max} | ${analysis.dispersionAnalysis.poc.inputTokens.median.toFixed(0)} | ${analysis.dispersionAnalysis.poc.inputTokens.mean.toFixed(0)} | ${analysis.dispersionAnalysis.poc.inputTokens.stdDev.toFixed(0)} |`);
  lines.push(`| Output Tokens | ${analysis.dispersionAnalysis.poc.outputTokens.min} | ${analysis.dispersionAnalysis.poc.outputTokens.max} | ${analysis.dispersionAnalysis.poc.outputTokens.median.toFixed(0)} | ${analysis.dispersionAnalysis.poc.outputTokens.mean.toFixed(0)} | ${analysis.dispersionAnalysis.poc.outputTokens.stdDev.toFixed(0)} |`);
  lines.push(`| Coût | ${analysis.dispersionAnalysis.poc.cost.min.toFixed(4)} | ${analysis.dispersionAnalysis.poc.cost.max.toFixed(4)} | ${analysis.dispersionAnalysis.poc.cost.median.toFixed(4)} | ${analysis.dispersionAnalysis.poc.cost.mean.toFixed(4)} | ${analysis.dispersionAnalysis.poc.cost.stdDev.toFixed(4)} |`);
  lines.push('');
  
  lines.push('### Vibe');
  lines.push('');
  lines.push(`| Métrique | Min | Max | Médiane | Moyenne | Écart-type |`);
  lines.push(`|----------|-----|-----|--------|---------|------------|`);
  lines.push(`| Input Tokens | ${analysis.dispersionAnalysis.vibe.inputTokens.min} | ${analysis.dispersionAnalysis.vibe.inputTokens.max} | ${analysis.dispersionAnalysis.vibe.inputTokens.median.toFixed(0)} | ${analysis.dispersionAnalysis.vibe.inputTokens.mean.toFixed(0)} | ${analysis.dispersionAnalysis.vibe.inputTokens.stdDev.toFixed(0)} |`);
  lines.push(`| Output Tokens | ${analysis.dispersionAnalysis.vibe.outputTokens.min} | ${analysis.dispersionAnalysis.vibe.outputTokens.max} | ${analysis.dispersionAnalysis.vibe.outputTokens.median.toFixed(0)} | ${analysis.dispersionAnalysis.vibe.outputTokens.mean.toFixed(0)} | ${analysis.dispersionAnalysis.vibe.outputTokens.stdDev.toFixed(0)} |`);
  lines.push(`| Coût | ${analysis.dispersionAnalysis.vibe.cost.min.toFixed(4)} | ${analysis.dispersionAnalysis.vibe.cost.max.toFixed(4)} | ${analysis.dispersionAnalysis.vibe.cost.median.toFixed(4)} | ${analysis.dispersionAnalysis.vibe.cost.mean.toFixed(4)} | ${analysis.dispersionAnalysis.vibe.cost.stdDev.toFixed(4)} |`);
  lines.push('');
  
  // Marginal Token Cost
  lines.push('## 💰 Coût Marginal par Run');
  lines.push('');
  lines.push('### POC');
  lines.push('');
  lines.push('```');
  for (let i = 0; i < Math.min(analysis.marginalTokenCost.poc.length, 10); i++) {
    lines.push(`Run ${i + 1}: $${analysis.marginalTokenCost.poc[i].toFixed(4)}`);
  }
  if (analysis.marginalTokenCost.poc.length > 10) {
    lines.push(`... (and ${analysis.marginalTokenCost.poc.length - 10} more)`);
  }
  lines.push('```');
  lines.push('');
  
  // Cumulative Token Cost
  lines.push('## 📈 Coût Cumulatif');
  lines.push('');
  lines.push('```');
  lines.push('Run | POC Cumulative | Vibe Cumulative');
  lines.push('----|----------------|-----------------');
  for (let i = 0; i < Math.min(analysis.cumulativeTokenCost.poc.length, analysis.cumulativeTokenCost.vibe.length, 10); i++) {
    lines.push(`Run ${i + 1} | $${analysis.cumulativeTokenCost.poc[i].toFixed(4)} | $${analysis.cumulativeTokenCost.vibe[i].toFixed(4)}`);
  }
  lines.push('```');
  lines.push('');
  
  // Tokens per Correct Tour
  lines.push('## 🎯 Tokens par Tour Correct');
  lines.push('');
  lines.push(`| Solution | Tokens Totaux | Tours Corrects | Tokens/Tour | Taux de Complétion |`);
  lines.push(`|----------|---------------|----------------|-------------|-------------------|`);
  lines.push(`| POC | ${analysis.tokensPerCorrectTour.poc.totalTokens} | ${analysis.tokensPerCorrectTour.poc.correctRuns} | ${analysis.tokensPerCorrectTour.poc.tokensPerCorrectTour.toFixed(0)} | ${(analysis.tokensPerCorrectTour.poc.completionRate * 100).toFixed(1)}% |`);
  lines.push(`| Vibe | ${analysis.tokensPerCorrectTour.vibe.totalTokens} | ${analysis.tokensPerCorrectTour.vibe.correctRuns} | ${analysis.tokensPerCorrectTour.vibe.tokensPerCorrectTour.toFixed(0)} | ${(analysis.tokensPerCorrectTour.vibe.completionRate * 100).toFixed(1)}% |`);
  lines.push('');
  
  // Break-even Point
  lines.push('## 🎯 Point de Rentabilité (Break-even)');
  lines.push('');
  lines.push(`| Métrique | Valeur |`);
  lines.push(`|----------|--------|`);
  lines.push(`| Point de rentabilité atteint | ${analysis.breakEvenPoint.reached ? '✅ Oui' : '❌ Non'} |`);
  lines.push(`| Coût total POC | $${analysis.breakEvenPoint.pocCost.toFixed(4)} |`);
  lines.push(`| Coût total Vibe | $${analysis.breakEvenPoint.vibeCost.toFixed(4)} |`);
  lines.push(`| Coût moyen POC | $${analysis.breakEvenPoint.pocAvgCost.toFixed(4)} |`);
  lines.push(`| Coût moyen Vibe | $${analysis.breakEvenPoint.vibeAvgCost.toFixed(4)} |`);
  lines.push(`| Économie | $${analysis.breakEvenPoint.savings.toFixed(4)} |`);
  lines.push(`| Économie de tokens | ${analysis.breakEvenPoint.tokenSavings} tokens |`);
  lines.push('');
  
  // Measurements Documentation
  lines.push('## 📋 Mesures Documentées');
  lines.push('');
  
  // Exploration
  lines.push('### 🔍 Exploration');
  lines.push('');
  lines.push(`- **POC**: ${analysis.measurements.exploration.poc.length} appels d'exploration`);
  lines.push(`- **Vibe**: ${analysis.measurements.exploration.vibe.length} appels d'exploration`);
  lines.push('');
  
  // Search
  lines.push('### 🔎 Recherche');
  lines.push('');
  lines.push(`- **POC**: ${analysis.measurements.search.poc.length} appels de recherche`);
  lines.push(`- **Vibe**: ${analysis.measurements.search.vibe.length} appels de recherche`);
  lines.push('');
  
  // Diagnostics
  lines.push('### 🔬 Diagnostic');
  lines.push('');
  lines.push(`- **POC**: ${analysis.measurements.diagnostics.poc.length} appels de diagnostic`);
  lines.push(`- **Vibe**: ${analysis.measurements.diagnostics.vibe.length} appels de diagnostic`);
  lines.push('');
  
  // Corrections
  lines.push('### 🛠️ Corrections');
  lines.push('');
  lines.push(`- **POC**: ${analysis.measurements.corrections.poc.length} corrections`);
  lines.push(`- **Vibe**: ${analysis.measurements.corrections.vibe.length} corrections`);
  lines.push('');
  
  // Selection
  lines.push('### ✅ Sélection');
  lines.push('');
  lines.push(`- **POC**: ${analysis.measurements.selection.poc.length} appels de script`);
  lines.push(`- **Vibe**: ${analysis.measurements.selection.vibe.length} appels de script`);
  lines.push('');
  
  // Consolidation
  lines.push('### 💾 Consolidation (Mémoire)');
  lines.push('');
  lines.push(`- **POC**: ${analysis.measurements.consolidation.poc.length} opérations de mémoire`);
  lines.push(`- **Vibe**: ${analysis.measurements.consolidation.vibe.length} opérations de mémoire`);
  lines.push('');
  
  // Quality and Coverage
  lines.push('### ⭐ Qualité et Couverture des Preuves');
  lines.push('');
  lines.push(`| Solution | Preuves | Correctes | Incorrectes | Couverture |`);
  lines.push(`|----------|---------|-----------|-------------|------------|`);
  lines.push(`| POC | ${analysis.measurements.qualityAndCoverage.poc.proofs} | ${analysis.measurements.qualityAndCoverage.poc.correct} | ${analysis.measurements.qualityAndCoverage.poc.incorrect} | ${analysis.measurements.qualityAndCoverage.poc.coverage.toFixed(1)}% |`);
  lines.push(`| Vibe | ${analysis.measurements.qualityAndCoverage.vibe.proofs} | ${analysis.measurements.qualityAndCoverage.vibe.correct} | ${analysis.measurements.qualityAndCoverage.vibe.incorrect} | ${analysis.measurements.qualityAndCoverage.vibe.coverage.toFixed(1)}% |`);
  lines.push('');
  
  // Failures
  lines.push('### ❌ Échecs');
  lines.push('');
  lines.push(`- **POC**: ${analysis.measurements.failures.poc.length} échecs`);
  lines.push(`- **Vibe**: ${analysis.measurements.failures.vibe.length} échecs`);
  lines.push('');
  
  // Partial Tours
  lines.push('### ⚠️ Tours Partiels');
  lines.push('');
  lines.push(`- **POC**: ${analysis.measurements.partialTours.poc.length} tours partiels`);
  lines.push(`- **Vibe**: ${analysis.measurements.partialTours.vibe.length} tours partiels`);
  lines.push('');
  
  // Configuration Differences
  if (analysis.measurements.configurationDifferences.length > 0) {
    lines.push('### ⚙️ Différences de Configuration');
    lines.push('');
    for (const diff of analysis.measurements.configurationDifferences) {
      lines.push(`- **${diff.attribute}**: POC=${JSON.stringify(diff.poc)}, Vibe=${JSON.stringify(diff.vibe)}`);
    }
    lines.push('');
  }
  
  // Raw Data Note
  lines.push('## 📦 Données Brutes');
  lines.push('');
  lines.push('Les données brutes complètes sont disponibles dans le rapport JSON pour la reproductibilité.');
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Load benchmark data from file
 * @param {string} filePath - Path to benchmark data file
 * @returns {object} Benchmark data
 */
export function loadBenchmarkData(filePath) {
  try {
    const absolutePath = resolve(__dirname, filePath);
    const content = readFileSync(absolutePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    console.error(`Error loading benchmark data from ${filePath}:`, e.message);
    return null;
  }
}

/**
 * Save report to file
 * @param {string} report - Report content (JSON or Markdown)
 * @param {string} filePath - Output file path
 * @param {boolean} isJson - Whether the report is JSON
 */
export function saveReport(report, filePath, isJson = true) {
  try {
    const absolutePath = resolve(__dirname, filePath);
    if (isJson && typeof report !== 'string') {
      report = JSON.stringify(report, null, 2);
    }
    writeFileSync(absolutePath, report, 'utf8');
    console.log(`Report saved to ${absolutePath}`);
  } catch (e) {
    console.error(`Error saving report to ${filePath}:`, e.message);
  }
}

// Export all functions as default for module import
export default {
  // Token calculations
  calculateTotalTokens,
  calculateTokenCost,
  isCompleteRun,
  
  // Statistical calculations
  calculateMean,
  calculateMedian,
  calculateStdDev,
  calculateDispersion,
  
  // Break-even analysis
  calculateBreakEven,
  calculateMarginalTokenCosts,
  calculateCumulativeTokenCosts,
  calculateTokensPerCorrectTour,
  
  // Verdict
  determineVerdict,
  
  // Data processing
  normalizeBenchmarkData,
  filterRunsByMode,
  extractTokenValues,
  aggregateMetrics,
  documentMeasurements,
  
  // Report generation
  generateAnalysis,
  generateJSONReport,
  generateMarkdownReport,
  loadBenchmarkData,
  saveReport
};
