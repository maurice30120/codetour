import { test } from "node:test";
import assert from "node:assert/strict";
import { CostTracker } from "../../src/cost-tracking/cost-tracker";
import { CostTrackingConfig, ModelInfo } from "../../src/cost-tracking/types";

// Test 1: CostTracker initialization
test("CostTracker should initialize with default config", () => {
  const tracker = new CostTracker();
  const config = tracker.getConfig();

  assert.equal(config.trackInputTokens, true);
  assert.equal(config.trackOutputTokens, true);
  assert.equal(config.trackCacheTokens, true);
  assert.equal(config.trackAICredits, false);
  assert.equal(config.trackDuration, true);
  assert.equal(config.trackToolsCalled, true);
});

// Test 2: CostTracker with custom config
test("CostTracker should accept custom config", () => {
  const customConfig: Partial<CostTrackingConfig> = {
    trackAICredits: true,
    trackDuration: false,
  };
  const tracker = new CostTracker(customConfig);
  const config = tracker.getConfig();

  assert.equal(config.trackAICredits, true);
  assert.equal(config.trackDuration, false);
  assert.equal(config.trackInputTokens, true); // Default remains
});

// Test 3: CostTracker with custom model info
test("CostTracker should accept custom model info", () => {
  const modelInfo: ModelInfo = {
    model: "gpt-4",
    inputPricePerToken: 0.00001,
    outputPricePerToken: 0.00003,
    cachePricePerToken: 0.000005,
  };
  const tracker = new CostTracker({ modelInfo });
  const info = tracker.getModelInfo();

  assert.equal(info.model, "gpt-4");
  assert.equal(info.inputPricePerToken, 0.00001);
  assert.equal(info.outputPricePerToken, 0.00003);
  assert.equal(info.cachePricePerToken, 0.000005);
});

// Test 4: Add input tokens
test("CostTracker should track input tokens", () => {
  const tracker = new CostTracker();
  tracker.reset();
  
  tracker.addInputTokens(1000);
  tracker.addInputTokens(500);

  const usage = tracker.getTokenUsage();
  assert.equal(usage.inputTokens, 1500);
  assert.equal(usage.totalTokens, 1500);
});

// Test 5: Add output tokens
test("CostTracker should track output tokens", () => {
  const tracker = new CostTracker();
  tracker.reset();
  
  tracker.addOutputTokens(2000);
  tracker.addOutputTokens(1000);

  const usage = tracker.getTokenUsage();
  assert.equal(usage.outputTokens, 3000);
  assert.equal(usage.totalTokens, 3000);
});

// Test 6: Add cache tokens
test("CostTracker should track cache tokens", () => {
  const tracker = new CostTracker();
  tracker.reset();
  
  tracker.addCacheTokens(500);
  tracker.addCacheTokens(250);

  const usage = tracker.getTokenUsage();
  assert.equal(usage.cacheTokens, 750);
  assert.equal(usage.totalTokens, 750);
});

// Test 7: Mixed token tracking
test("CostTracker should track mixed token types", () => {
  const tracker = new CostTracker();
  tracker.reset();
  
  tracker.addInputTokens(1000);
  tracker.addOutputTokens(2000);
  tracker.addCacheTokens(500);

  const usage = tracker.getTokenUsage();
  assert.equal(usage.inputTokens, 1000);
  assert.equal(usage.outputTokens, 2000);
  assert.equal(usage.cacheTokens, 500);
  assert.equal(usage.totalTokens, 3500);
});

// Test 8: Tool call tracking
test("CostTracker should track tool calls", () => {
  const tracker = new CostTracker();
  tracker.reset();
  
  for (let i = 0; i < 5; i++) {
    tracker.recordToolCall();
  }

  assert.equal(tracker.getToolsCalled(), 5);
});

// Test 9: Duration tracking
test("CostTracker should track duration", async () => {
  const tracker = new CostTracker();
  tracker.reset();
  
  // Small delay to ensure duration is measured
  await new Promise(resolve => setTimeout(resolve, 10));
  
  const duration = tracker.getDurationMs();
  assert.ok(duration >= 10, `Duration should be at least 10ms, got ${duration}ms`);
});

// Test 10: Cost estimation
test("CostTracker should calculate estimated cost", () => {
  const modelInfo: ModelInfo = {
    model: "test-model",
    inputPricePerToken: 0.00001,
    outputPricePerToken: 0.00003,
    cachePricePerToken: 0.000005,
  };
  const tracker = new CostTracker({ modelInfo });
  tracker.reset();
  
  tracker.addInputTokens(1000);
  tracker.addOutputTokens(500);
  tracker.addCacheTokens(200);

  const estimatedCost = tracker.calculateEstimatedCost();
  // input: 1000 * 0.00001 = 0.01
  // output: 500 * 0.00003 = 0.015
  // cache: 200 * 0.000005 = 0.001
  // total: 0.026
  assert.equal(estimatedCost, 0.026);
});

// Test 11: Build cost info
test("CostTracker should build cost info", () => {
  const modelInfo: ModelInfo = {
    model: "test-model",
    inputPricePerToken: 0.00001,
    outputPricePerToken: 0.00003,
  };
  const tracker = new CostTracker({ modelInfo });
  tracker.reset();
  
  tracker.addInputTokens(1000);
  
  const costInfo = tracker.buildCostInfo(5.0);
  assert.equal(costInfo.aiCredits, 5.0);
  assert.equal(costInfo.estimatedCost, 0.01);
});

// Test 12: Finalize metrics for Changes Tour
test("CostTracker should finalize metrics for Changes Tour", () => {
  const tracker = new CostTracker();
  tracker.reset();
  
  tracker.addInputTokens(1000);
  tracker.addOutputTokens(500);
  
  const metrics = tracker.finalizeMetrics(
    "changes",
    "neutral",
    "abc123",
    3,
    0,
    true
  );

  assert.equal(metrics.tourType, "changes");
  assert.equal(metrics.reviewMode, "neutral");
  assert.equal(metrics.sha, "abc123");
  assert.equal(metrics.stepsGenerated, 3);
  assert.equal(metrics.validationWarnings, 0);
  assert.equal(metrics.success, true);
  assert.equal(metrics.tokenUsage.inputTokens, 1000);
  assert.equal(metrics.tokenUsage.outputTokens, 500);
});

// Test 13: Finalize metrics for Project Tour
test("CostTracker should finalize metrics for Project Tour", () => {
  const tracker = new CostTracker();
  tracker.reset();
  
  tracker.addInputTokens(2000);
  tracker.addOutputTokens(1000);
  
  const metrics = tracker.finalizeMetrics(
    "project",
    undefined,
    "def456",
    5,
    1,
    true
  );

  assert.equal(metrics.tourType, "project");
  assert.equal(metrics.reviewMode, undefined);
  assert.equal(metrics.sha, "def456");
  assert.equal(metrics.stepsGenerated, 5);
  assert.equal(metrics.validationWarnings, 1);
});

// Test 14: Reset clears all metrics
test("CostTracker reset should clear all metrics", () => {
  const tracker = new CostTracker();
  
  tracker.addInputTokens(1000);
  tracker.addOutputTokens(500);
  tracker.recordToolCall();
  
  tracker.reset();

  const usage = tracker.getTokenUsage();
  assert.equal(usage.inputTokens, 0);
  assert.equal(usage.outputTokens, 0);
  assert.equal(usage.cacheTokens, 0);
  assert.equal(usage.totalTokens, 0);
  assert.equal(tracker.getToolsCalled(), 0);
});

// Test 15: Set model info dynamically
test("CostTracker should allow dynamic model info update", () => {
  const tracker = new CostTracker();
  tracker.reset();
  
  tracker.addInputTokens(1000);
  
  const modelInfo: ModelInfo = {
    model: "gpt-4",
    inputPricePerToken: 0.00002,
    outputPricePerToken: 0.00006,
  };
  tracker.setModelInfo(modelInfo);

  const estimatedCost = tracker.calculateEstimatedCost();
  assert.equal(estimatedCost, 0.02);
});
