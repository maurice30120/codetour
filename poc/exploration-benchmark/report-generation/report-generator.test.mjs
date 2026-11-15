#!/usr/bin/env node
/**
 * TDD Tests for Report Generator
 * 
 * Seams under test:
 * - report-generator.mjs: main module that generates reports from benchmark data
 * - What it catches: correctness of token analysis, statistical calculations, report formatting
 * - What it misses: actual Vibe integration (mocked), file I/O (test with in-memory data)
 */

import { strict as assert } from 'node:assert';
import { describe, it, before, after } from 'node:test';

// Mock data for testing
const mockPocData = {
  timestamp: '2026-11-15T00:00:00.000Z',
  model: 'mistral-small-latest',
  budget: {
    iterations: 8,
    calls: 32,
    tokens: 32000,
    durationMs: 60000
  },
  rows: [
    // POC with memory ON - should be more efficient
    {
      task: 'function',
      repetition: 1,
      mode: 'on',
      run: 1,
      calls: ['code', 'read'],
      scriptCalls: [{ name: 'code', arguments: { code: 'search(params.query)' } }],
      library: [{ id: 'abc123', successes: 1, failures: 0 }],
      wallTimeMs: 5000,
      result: {
        objective: 'How does totalPrice work?',
        entryPoints: [{ name: 'totalPrice', evidence: [{ file: 'src/math.js', startLine: 1, endLine: 3 }] }],
        components: [{ name: 'math.js', evidence: [{ file: 'src/math.js', startLine: 1, endLine: 3 }] }],
        relations: [{ from: 'createOrder', to: 'totalPrice', evidence: [{ file: 'src/order.js', startLine: 5, endLine: 5 }] }],
        uncertainties: [],
        status: 'complete',
        stopReason: null,
        metrics: {
          inputTokens: 5000,
          outputTokens: 500,
          usageAvailable: true,
          modelCalls: 2,
          toolCalls: 2,
          durationMs: 5000,
          outputBytes: 1000,
          cost: null,
          memoryReuses: 2,
          memoryPurges: 0
        }
      }
    },
    // POC with memory OFF - should be less efficient
    {
      task: 'function',
      repetition: 1,
      mode: 'off',
      run: 1,
      calls: ['list', 'search', 'read', 'read', 'read', 'read', 'search', 'search'],
      scriptCalls: [],
      library: [],
      wallTimeMs: 8000,
      result: {
        objective: 'How does totalPrice work?',
        entryPoints: [],
        components: [],
        relations: [],
        uncertainties: ['Exploration stopped before a structured result was produced.'],
        status: 'partial',
        stopReason: 'iterations',
        metrics: {
          inputTokens: 8000,
          outputTokens: 200,
          usageAvailable: true,
          modelCalls: 8,
          toolCalls: 8,
          durationMs: 8000,
          outputBytes: 500,
          cost: null,
          memoryReuses: 0,
          memoryPurges: 0
        }
      }
    }
  ]
};

const mockVibeData = {
  timestamp: '2026-11-15T00:00:00.000Z',
  model: 'mistral-small-latest',
  budget: {
    iterations: 8,
    calls: 32,
    tokens: 32000,
    durationMs: 60000
  },
  rows: [
    // Vibe - no memory, each run independent
    {
      task: 'function',
      repetition: 1,
      mode: 'vibe',
      run: 1,
      calls: ['list', 'search', 'read', 'read'],
      scriptCalls: [],
      library: [],
      wallTimeMs: 6500,
      result: {
        objective: 'How does totalPrice work?',
        entryPoints: [{ name: 'totalPrice', evidence: [{ file: 'src/math.js', startLine: 1, endLine: 3 }] }],
        components: [{ name: 'math.js', evidence: [{ file: 'src/math.js', startLine: 1, endLine: 3 }] }],
        relations: [],
        uncertainties: [],
        status: 'complete',
        stopReason: null,
        metrics: {
          inputTokens: 7000,
          outputTokens: 600,
          usageAvailable: true,
          modelCalls: 5,
          toolCalls: 5,
          durationMs: 6500,
          outputBytes: 1200,
          cost: null,
          memoryReuses: 0,
          memoryPurges: 0
        }
      }
    }
  ]
};

let reportGenerator;

// Helper to load the module after file creation
async function loadModule() {
  const { dirname, resolve } = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  
  try {
    const modulePath = resolve(__dirname, 'report-generator.mjs');
    const module = await import(modulePath);
    return module.default || module;
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      // Module doesn't exist yet - that's expected during TDD
      return null;
    }
    throw e;
  }
}

describe('Report Generator - Token Analysis', async () => {
  before(async () => {
    reportGenerator = await loadModule();
  });

  it('should calculate total tokens for a run', async () => {
    // This test will fail until we implement the function
    if (!reportGenerator) {
      assert.fail('Report generator module not found');
    }
    
    const run = mockPocData.rows[0];
    const totalTokens = reportGenerator.calculateTotalTokens(run);
    
    // inputTokens + outputTokens
    assert.equal(totalTokens, 5000 + 500, 'Total tokens should be input + output');
  });

  it('should calculate token cost per run', async () => {
    if (!reportGenerator) {
      assert.fail('Report generator module not found');
    }
    
    const run = mockPocData.rows[0];
    const cost = reportGenerator.calculateTokenCost(run, { inputPrice: 0.000003, outputPrice: 0.000006 });
    
    // (5000 * 0.000003) + (500 * 0.000006) = 0.015 + 0.003 = 0.018
    const expectedCost = (5000 * 0.000003) + (500 * 0.000006);
    assert.equal(cost, expectedCost, 'Token cost should be calculated correctly');
  });

  it('should identify complete vs partial runs', async () => {
    if (!reportGenerator) {
      assert.fail('Report generator module not found');
    }
    
    const completeRun = mockPocData.rows[0];
    const partialRun = mockPocData.rows[1];
    
    assert.equal(reportGenerator.isCompleteRun(completeRun), true, 'Complete run should be identified');
    assert.equal(reportGenerator.isCompleteRun(partialRun), false, 'Partial run should be identified');
  });
});

describe('Report Generator - Statistical Analysis', async () => {
  it('should calculate mean token count', async () => {
    if (!reportGenerator) {
      assert.fail('Report generator module not found');
    }
    
    const tokens = [5000, 6000, 7000, 8000, 9000];
    const mean = reportGenerator.calculateMean(tokens);
    
    assert.equal(mean, 7000, 'Mean should be 7000');
  });

  it('should calculate median token count', async () => {
    if (!reportGenerator) {
      assert.fail('Report generator module not found');
    }
    
    const tokens = [5000, 6000, 7000, 8000, 9000];
    const median = reportGenerator.calculateMedian(tokens);
    
    assert.equal(median, 7000, 'Median of odd-length array should be middle value');
    
    const tokensEven = [5000, 6000, 7000, 8000];
    const medianEven = reportGenerator.calculateMedian(tokensEven);
    
    assert.equal(medianEven, 6500, 'Median of even-length array should be average of two middle values');
  });

  it('should calculate standard deviation', async () => {
    if (!reportGenerator) {
      assert.fail('Report generator module not found');
    }
    
    const tokens = [2, 4, 4, 4, 5, 5, 7, 9];
    const stdDev = reportGenerator.calculateStdDev(tokens);
    
    // Expected: mean=5, variance=4, stdDev=2
    assert.equal(stdDev, 2, 'Standard deviation should be calculated correctly');
  });

  it('should calculate dispersion metrics', async () => {
    if (!reportGenerator) {
      assert.fail('Report generator module not found');
    }
    
    const tokens = [5000, 6000, 7000, 8000, 9000];
    const dispersion = reportGenerator.calculateDispersion(tokens);
    
    assert.equal(dispersion.min, 5000, 'Min should be 5000');
    assert.equal(dispersion.max, 9000, 'Max should be 9000');
    assert.equal(dispersion.median, 7000, 'Median should be 7000');
    assert.ok(dispersion.mean >= 6999 && dispersion.mean <= 7001, 'Mean should be approximately 7000');
    assert.ok(dispersion.stdDev > 0, 'StdDev should be positive');
  });
});

describe('Report Generator - Break-even Analysis', async () => {
  it('should calculate break-even point', async () => {
    if (!reportGenerator) {
      assert.fail('Report generator module not found');
    }
    
    // POC: 10 runs, total tokens = 50000, total cost = 0.15
    // Vibe: 10 runs, total tokens = 70000, total cost = 0.21
    const pocMetrics = { totalTokens: 50000, totalCost: 0.15, runCount: 10 };
    const vibeMetrics = { totalTokens: 70000, totalCost: 0.21, runCount: 10 };
    
    const breakEven = reportGenerator.calculateBreakEven(pocMetrics, vibeMetrics);
    
    // We need to define what break-even means in this context
    // For now, let's assume it's when POC total cost < Vibe total cost
    assert.ok(breakEven.reached, 'Break-even should be reached if POC is cheaper');
    assert.equal(breakEven.pocCost, 0.15, 'POC cost should be correct');
    assert.equal(breakEven.vibeCost, 0.21, 'Vibe cost should be correct');
  });
});

describe('Report Generator - Report Formatting', async () => {
  it('should generate JSON report', async () => {
    if (!reportGenerator) {
      assert.fail('Report generator module not found');
    }
    
    const jsonReport = reportGenerator.generateJSONReport(mockPocData, mockVibeData);
    
    assert.ok(jsonReport, 'JSON report should be generated');
    assert.ok(typeof jsonReport === 'string' || typeof jsonReport === 'object', 'Report should be string or object');
    
    const report = typeof jsonReport === 'string' ? JSON.parse(jsonReport) : jsonReport;
    assert.ok(report.tokenCurves, 'Report should have token curves');
    assert.ok(report.dispersionAnalysis, 'Report should have dispersion analysis');
    assert.ok(report.breakEvenPoint, 'Report should have break-even analysis');
    assert.ok(report.verdict, 'Report should have verdict');
  });

  it('should generate Markdown report', async () => {
    if (!reportGenerator) {
      assert.fail('Report generator module not found');
    }
    
    const mdReport = reportGenerator.generateMarkdownReport(mockPocData, mockVibeData);
    
    assert.ok(mdReport, 'Markdown report should be generated');
    assert.ok(typeof mdReport === 'string', 'Report should be a string');
    assert.ok(mdReport.includes('#'), 'Report should include headers');
    assert.ok(mdReport.includes('Token'), 'Report should include token information');
    assert.ok(mdReport.includes('Verdict'), 'Report should include verdict');
  });

  it('should determine verdict based on data', async () => {
    if (!reportGenerator) {
      assert.fail('Report generator module not found');
    }
    
    // POC is better (lower tokens, more complete)
    const verdict1 = reportGenerator.determineVerdict(
      { avgTokens: 5000, completeRate: 0.9, totalCost: 0.15 },
      { avgTokens: 7000, completeRate: 0.7, totalCost: 0.21 }
    );
    
    assert.equal(verdict1, 'validé', 'Verdict should be validé when POC is better');
    
    // Vibe is better
    const verdict2 = reportGenerator.determineVerdict(
      { avgTokens: 7000, completeRate: 0.7, totalCost: 0.21 },
      { avgTokens: 5000, completeRate: 0.9, totalCost: 0.15 }
    );
    
    assert.equal(verdict2, 'invalidé', 'Verdict should be invalidé when Vibe is better');
    
    // Indeterminate
    const verdict3 = reportGenerator.determineVerdict(
      { avgTokens: 6000, completeRate: 0.8, totalCost: 0.18 },
      { avgTokens: 6000, completeRate: 0.8, totalCost: 0.18 }
    );
    
    assert.equal(verdict3, 'indéterminé', 'Verdict should be indéterminé when equal');
  });
});

console.log('\nNote: These tests will fail until report-generator.mjs is implemented.');
console.log('This is expected in TDD - write the failing tests first, then implement the code.');
