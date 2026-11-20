#!/usr/bin/env node
/**
 * Generate reports from benchmark data
 * This script creates JSON and Markdown reports comparing POC vs Vibe
 */

import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCHMARK_DIR = resolve(__dirname, '..');

// Import the report generator
const reportGeneratorPath = resolve(__dirname, 'report-generator.mjs');
let reportGenerator;

try {
  const module = await import(reportGeneratorPath);
  reportGenerator = module.default || module;
  console.log('Loaded report generator module');
} catch (e) {
  console.error('Error loading report generator:', e.message);
  process.exit(1);
}

/**
 * Load benchmark data from file
 */
function loadData(filePath) {
  try {
    const absolutePath = resolve(BENCHMARK_DIR, filePath);
    if (!existsSync(absolutePath)) {
      console.error(`File not found: ${absolutePath}`);
      return null;
    }
    const content = readFileSync(absolutePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    console.error(`Error loading ${filePath}:`, e.message);
    return null;
  }
}

/**
 * Save report to file
 */
function saveReport(content, filePath) {
  try {
    const absolutePath = resolve(__dirname, filePath);
    // Ensure directory exists
    const dir = dirname(absolutePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(absolutePath, content, 'utf8');
    console.log(`  ✓ Saved: ${filePath}`);
  } catch (e) {
    console.error(`Error saving ${filePath}:`, e.message);
  }
}

/**
 * Generate reports for repetition benchmark
 */
function generateRepetitionReports() {
  console.log('\n=== Generating Repetition Benchmark Reports ===');
  
  const pocData = loadData('results-mistral-atomic-repetition-2026-11-14.json');
  const vibeData = loadData('results-vibe-atomic-repetition-mock.json');
  
  if (!pocData) {
    console.log('  ⚠ POC repetition data not found, skipping');
    return;
  }
  
  if (!vibeData) {
    console.log('  ⚠ Vibe repetition data not found, using mock data');
    // Fallback to mock
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPrefix = `report-repetition-${timestamp}`;
  
  // Generate JSON report
  const jsonReport = reportGenerator.generateJSONReport(pocData, vibeData, { 
    includeRawData: true,
    pricing: { inputPrice: 0.000003, outputPrice: 0.000006 }
  });
  saveReport(jsonReport, `${outputPrefix}.json`);
  
  // Generate Markdown report
  const mdReport = reportGenerator.generateMarkdownReport(pocData, vibeData, {
    pricing: { inputPrice: 0.000003, outputPrice: 0.000006 }
  });
  saveReport(mdReport, `${outputPrefix}.md`);
  
  console.log(`  Generated reports: ${outputPrefix}.json, ${outputPrefix}.md`);
}

/**
 * Generate reports for transfer benchmark
 */
function generateTransferReports() {
  console.log('\n=== Generating Transfer Benchmark Reports ===');
  
  const pocData = loadData('results-mistral-atomic-transfer-2026-11-14.json');
  const vibeData = loadData('results-vibe-atomic-transfer-mock.json');
  
  if (!pocData) {
    console.log('  ⚠ POC transfer data not found, skipping');
    return;
  }
  
  if (!vibeData) {
    console.log('  ⚠ Vibe transfer data not found, using mock data');
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPrefix = `report-transfer-${timestamp}`;
  
  // Generate JSON report
  const jsonReport = reportGenerator.generateJSONReport(pocData, vibeData, {
    includeRawData: true,
    pricing: { inputPrice: 0.000003, outputPrice: 0.000006 }
  });
  saveReport(jsonReport, `${outputPrefix}.json`);
  
  // Generate Markdown report
  const mdReport = reportGenerator.generateMarkdownReport(pocData, vibeData, {
    pricing: { inputPrice: 0.000003, outputPrice: 0.000006 }
  });
  saveReport(mdReport, `${outputPrefix}.md`);
  
  console.log(`  Generated reports: ${outputPrefix}.json, ${outputPrefix}.md`);
}

/**
 * Generate combined report from multiple POC files
 */
function generateCombinedReport() {
  console.log('\n=== Generating Combined Benchmark Report ===');
  
  // Load multiple POC files
  const pocFiles = [
    'results-mistral-atomic-repetition-2026-11-14.json',
    'results-mistral-atomic-transfer-2026-11-14.json'
  ];
  
  const vibeFiles = [
    'results-vibe-atomic-repetition-mock.json',
    'results-vibe-atomic-transfer-mock.json'
  ];
  
  // Combine POC data
  let combinedPoc = { rows: [] };
  for (const file of pocFiles) {
    const data = loadData(file);
    if (data && data.rows) {
      combinedPoc.rows = [...combinedPoc.rows, ...data.rows];
      if (data.timestamp) combinedPoc.timestamp = data.timestamp;
      if (data.model) combinedPoc.model = data.model;
      if (data.budget) combinedPoc.budget = data.budget;
    }
  }
  
  // Combine Vibe data
  let combinedVibe = { rows: [] };
  for (const file of vibeFiles) {
    const data = loadData(file);
    if (data && data.rows) {
      combinedVibe.rows = [...combinedVibe.rows, ...data.rows];
      if (data.timestamp) combinedVibe.timestamp = data.timestamp;
      if (data.model) combinedVibe.model = data.model;
      if (data.budget) combinedVibe.budget = data.budget;
    } else if (data && data.records) {
      // Convert records to rows format
      for (const record of data.records) {
        combinedVibe.rows.push({
          task: 'vibe-transfer',
          repetition: combinedVibe.rows.length + 1,
          mode: 'vibe',
          run: combinedVibe.rows.length + 1,
          calls: [],
          scriptCalls: [],
          library: record.library || [],
          wallTimeMs: record.result?.metrics?.durationMs || 0,
          result: record.result || {},
          metrics: record.result?.metrics || {}
        });
      }
      if (data.timestamp) combinedVibe.timestamp = data.timestamp;
      if (data.model) combinedVibe.model = data.model;
    }
  }
  
  console.log(`  Combined POC: ${combinedPoc.rows.length} runs`);
  console.log(`  Combined Vibe: ${combinedVibe.rows.length} runs`);
  
  if (combinedPoc.rows.length === 0 || combinedVibe.rows.length === 0) {
    console.log('  ⚠ Not enough data, skipping combined report');
    return;
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPrefix = `report-combined-${timestamp}`;
  
  // Generate JSON report
  const jsonReport = reportGenerator.generateJSONReport(combinedPoc, combinedVibe, {
    includeRawData: true,
    pricing: { inputPrice: 0.000003, outputPrice: 0.000006 }
  });
  saveReport(jsonReport, `${outputPrefix}.json`);
  
  // Generate Markdown report
  const mdReport = reportGenerator.generateMarkdownReport(combinedPoc, combinedVibe, {
    pricing: { inputPrice: 0.000003, outputPrice: 0.000006 }
  });
  saveReport(mdReport, `${outputPrefix}.md`);
  
  console.log(`  Generated reports: ${outputPrefix}.json, ${outputPrefix}.md`);
}

/**
 * Analyze and report on PostgreSQL benchmark data
 */
function generatePostgresReports() {
  console.log('\n=== Generating PostgreSQL Benchmark Reports ===');
  
  const postgresFiles = [
    'results-postgres-autoselect-v4.json',
    'results-postgres-memoryonly.json'
  ];
  
  let allData = { rows: [] };
  
  for (const file of postgresFiles) {
    const data = loadData(file);
    if (data && data.rows) {
      allData.rows = [...allData.rows, ...data.rows];
      if (data.timestamp) allData.timestamp = data.timestamp;
      if (data.model) allData.model = data.model;
      if (data.budget) allData.budget = data.budget;
    }
  }
  
  console.log(`  Loaded PostgreSQL data: ${allData.rows.length} runs`);
  
  if (allData.rows.length === 0) {
    console.log('  ⚠ No PostgreSQL data found, skipping');
    return;
  }
  
  // Separate by mode
  const modes = {};
  for (const row of allData.rows) {
    const mode = row.mode || 'unknown';
    if (!modes[mode]) modes[mode] = [];
    modes[mode].push(row);
  }
  
  console.log('  Modes found:', Object.keys(modes).join(', '));
  
  // Generate report for each mode comparison
  for (const [mode, rows] of Object.entries(modes)) {
    if (rows.length < 2) continue;
    
    // Split into two groups for comparison
    const group1 = rows.slice(0, Math.floor(rows.length / 2));
    const group2 = rows.slice(Math.floor(rows.length / 2));
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPrefix = `report-postgres-${mode}-${timestamp}`;
    
    const jsonReport = reportGenerator.generateJSONReport(
      { rows: group1, model: allData.model, timestamp: allData.timestamp },
      { rows: group2, model: allData.model, timestamp: allData.timestamp },
      { includeRawData: false, pricing: { inputPrice: 0.000003, outputPrice: 0.000006 } }
    );
    saveReport(jsonReport, `${outputPrefix}.json`);
    
    console.log(`  Generated: ${outputPrefix}.json`);
  }
}

/**
 * Generate a sample report with just 2-3 runs for quick testing
 */
function generateSampleReport() {
  console.log('\n=== Generating Sample Report (Quick Test) ===');
  
  const samplePoc = {
    timestamp: new Date().toISOString(),
    model: 'mistral-small-latest',
    budget: { iterations: 8, calls: 32, tokens: 32000, durationMs: 60000 },
    rows: [
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
  
  const sampleVibe = {
    timestamp: new Date().toISOString(),
    model: 'mistral-small-latest',
    budget: { iterations: 8, calls: 32, tokens: 32000, durationMs: 60000 },
    rows: [
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
          relations: [{ from: 'createOrder', to: 'totalPrice', evidence: [{ file: 'src/order.js', startLine: 5, endLine: 5 }] }],
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
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPrefix = `report-sample-${timestamp}`;
  
  // Generate JSON report
  const jsonReport = reportGenerator.generateJSONReport(samplePoc, sampleVibe, {
    includeRawData: true,
    pricing: { inputPrice: 0.000003, outputPrice: 0.000006 }
  });
  saveReport(jsonReport, `${outputPrefix}.json`);
  
  // Generate Markdown report
  const mdReport = reportGenerator.generateMarkdownReport(samplePoc, sampleVibe, {
    pricing: { inputPrice: 0.000003, outputPrice: 0.000006 }
  });
  saveReport(mdReport, `${outputPrefix}.md`);
  
  console.log(`  Generated reports: ${outputPrefix}.json, ${outputPrefix}.md`);
}

// Main execution
console.log('Starting report generation...\n');

try {
  // Generate sample report first for quick verification
  generateSampleReport();
  
  // Generate repetition reports
  generateRepetitionReports();
  
  // Generate transfer reports
  generateTransferReports();
  
  // Generate combined report
  generateCombinedReport();
  
  // Generate PostgreSQL reports
  generatePostgresReports();
  
  console.log('\n✅ All reports generated successfully!');
  console.log(`\nReports saved to: ${resolve(__dirname, '')}/`);
  
} catch (e) {
  console.error('\n❌ Error during report generation:', e);
  process.exit(1);
}
