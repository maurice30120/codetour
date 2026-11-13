import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CostMetricType,
  TokenUsage,
  CostTrackingConfig,
  TourGenerationMetrics,
  BaselineComparison,
  TokenEconomizerConfig,
} from "../../src/cost-tracking/types";

// Test 1: CostMetricType enum values
test("CostMetricType should have expected values", () => {
  assert.equal(CostMetricType.InputTokens, "inputTokens");
  assert.equal(CostMetricType.OutputTokens, "outputTokens");
  assert.equal(CostMetricType.CacheTokens, "cacheTokens");
  assert.equal(CostMetricType.AICredits, "aiCredits");
  assert.equal(CostMetricType.EstimatedCost, "estimatedCost");
  assert.equal(CostMetricType.DurationMs, "durationMs");
  assert.equal(CostMetricType.ToolsCalled, "toolsCalled");
});

// Test 2: TokenUsage interface
test("TokenUsage should track token counts", () => {
  const usage: TokenUsage = {
    inputTokens: 1000,
    outputTokens: 500,
    cacheTokens: 200,
    totalTokens: 1700,
    timestamp: new Date().toISOString(),
  };

  assert.equal(usage.inputTokens, 1000);
  assert.equal(usage.outputTokens, 500);
  assert.equal(usage.cacheTokens, 200);
  assert.equal(usage.totalTokens, 1700);
  assert.ok(usage.timestamp);
});

// Test 3: CostTrackingConfig interface
test("CostTrackingConfig should have required fields", () => {
  const config: CostTrackingConfig = {
    trackInputTokens: true,
    trackOutputTokens: true,
    trackCacheTokens: true,
    trackAICredits: false, // Not always available
    trackDuration: true,
    trackToolsCalled: true,
    modelInfo: {
      model: "gpt-4",
      inputPricePerToken: 0.00001,
      outputPricePerToken: 0.00003,
      cachePricePerToken: 0.000005,
    },
  };

  assert.equal(config.trackInputTokens, true);
  assert.equal(config.trackOutputTokens, true);
  assert.equal(config.trackCacheTokens, true);
  assert.equal(config.trackAICredits, false);
  assert.equal(config.trackDuration, true);
  assert.equal(config.modelInfo?.model, "gpt-4");
});

// Test 4: TourGenerationMetrics interface
test("TourGenerationMetrics should capture all metrics", () => {
  const metrics: TourGenerationMetrics = {
    tourType: "changes",
    reviewMode: "neutral",
    sha: "abc123",
    timestamp: new Date().toISOString(),
    tokenUsage: {
      inputTokens: 5000,
      outputTokens: 2000,
      cacheTokens: 1000,
      totalTokens: 8000,
      timestamp: new Date().toISOString(),
    },
    cost: {
      aiCredits: undefined, // Not available
      estimatedCost: 0.08,
    },
    durationMs: 15000,
    toolsCalled: 5,
    stepsGenerated: 3,
    validationWarnings: 0,
    success: true,
  };

  assert.equal(metrics.tourType, "changes");
  assert.equal(metrics.reviewMode, "neutral");
  assert.equal(metrics.sha, "abc123");
  assert.equal(metrics.tokenUsage.totalTokens, 8000);
  assert.equal(metrics.cost.estimatedCost, 0.08);
  assert.equal(metrics.durationMs, 15000);
  assert.equal(metrics.toolsCalled, 5);
  assert.equal(metrics.stepsGenerated, 3);
  assert.equal(metrics.validationWarnings, 0);
  assert.equal(metrics.success, true);
});

// Test 5: BaselineComparison interface
test("BaselineComparison should compare A and B scenarios", () => {
  const comparison: BaselineComparison = {
    scenario: "changes-tour-neutral",
    sha: "abc123",
    model: "gpt-4",
    timestamp: new Date().toISOString(),
    baseline: {
      metrics: {
        tourType: "changes",
        reviewMode: "neutral",
        sha: "abc123",
        timestamp: new Date().toISOString(),
        tokenUsage: {
          inputTokens: 5000,
          outputTokens: 2000,
          cacheTokens: 1000,
          totalTokens: 8000,
          timestamp: new Date().toISOString(),
        },
        cost: { estimatedCost: 0.08 },
        durationMs: 15000,
        toolsCalled: 5,
        stepsGenerated: 3,
        validationWarnings: 0,
        success: true,
      },
      label: "A (Copilot historique)",
    },
    withTokenEconomizer: {
      metrics: {
        tourType: "changes",
        reviewMode: "neutral",
        sha: "abc123",
        timestamp: new Date().toISOString(),
        tokenUsage: {
          inputTokens: 4000,
          outputTokens: 1800,
          cacheTokens: 800,
          totalTokens: 6600,
          timestamp: new Date().toISOString(),
        },
        cost: { estimatedCost: 0.066 },
        durationMs: 14000,
        toolsCalled: 5,
        stepsGenerated: 3,
        validationWarnings: 0,
        success: true,
      },
      label: "B (Copilot + TokenEconomizer)",
    },
    costSavings: {
      absolute: 0.014,
      percentage: 17.5,
      measured: true,
    },
    tokenSavings: {
      inputTokens: 1000,
      outputTokens: 200,
      cacheTokens: 200,
      totalTokens: 1400,
    },
    verdict: "prometteur",
  };

  assert.equal(comparison.scenario, "changes-tour-neutral");
  assert.equal(comparison.baseline.label, "A (Copilot historique)");
  assert.equal(comparison.withTokenEconomizer?.label, "B (Copilot + TokenEconomizer)");
  assert.equal(comparison.costSavings?.absolute, 0.014);
  assert.equal(comparison.costSavings?.percentage, 17.5);
  assert.equal(comparison.tokenSavings?.totalTokens, 1400);
  assert.equal(comparison.verdict, "prometteur");
});

// Test 6: TokenEconomizerConfig interface
test("TokenEconomizerConfig should have plugin settings", () => {
  const config: TokenEconomizerConfig = {
    enabled: true,
    pluginPath: "/path/to/tokeneconomizer",
    pythonPath: "/usr/bin/python3",
    version: "1.0.0",
    settings: {
      toolPrune: "off",
      microSkills: false,
      loopGuard: false,
    },
    copilotVersion: "1.0.105",
    compatible: true,
  };

  assert.equal(config.enabled, true);
  assert.equal(config.pluginPath, "/path/to/tokeneconomizer");
  assert.equal(config.pythonPath, "/usr/bin/python3");
  assert.equal(config.version, "1.0.0");
  assert.equal(config.settings.toolPrune, "off");
  assert.equal(config.settings.microSkills, false);
  assert.equal(config.copilotVersion, "1.0.105");
  assert.equal(config.compatible, true);
});
