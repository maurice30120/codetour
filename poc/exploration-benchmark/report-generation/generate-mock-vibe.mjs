#!/usr/bin/env node
/**
 * Generate mock Vibe benchmark data for testing
 * This simulates what the Vibe comparator (ticket 05) would produce
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCHMARK_DIR = resolve(__dirname, '..');

// Load existing POC data as reference
const pocRepetitionPath = resolve(BENCHMARK_DIR, 'results-mistral-atomic-repetition-2026-11-14.json');
const pocTransferPath = resolve(BENCHMARK_DIR, 'results-mistral-atomic-transfer-2026-11-14.json');

let pocRepetitionData;
let pocTransferData;

try {
  pocRepetitionData = JSON.parse(readFileSync(pocRepetitionPath, 'utf8'));
  console.log('Loaded POC repetition data');
} catch (e) {
  console.log('Could not load POC repetition data:', e.message);
}

try {
  pocTransferData = JSON.parse(readFileSync(pocTransferPath, 'utf8'));
  console.log('Loaded POC transfer data');
} catch (e) {
  console.log('Could not load POC transfer data:', e.message);
}

/**
 * Generate mock Vibe data based on POC data
 * Vibe doesn't have memory, so each run is independent and typically uses more tokens
 */
function generateMockVibeData() {
  // Use repetition data as base, but modify to simulate Vibe behavior
  // Vibe characteristics:
  // - No memory, so no scriptCalls or library
  // - More tool calls (list, search, read) to find information
  // - Higher token usage
  // - No memoryReuses or memoryPurges
  
  const timestamp = new Date().toISOString();
  const model = 'mistral-small-latest';
  const budget = {
    iterations: 8,
    calls: 32,
    tokens: 32000,
    durationMs: 60000
  };
  
  const rows = [];
  const tasks = ['function', 'class', 'flow'];
  const objectives = {
    function: 'Comprendre comment la fonction totalPrice calcule son résultat.',
    class: 'Analyser la structure de la classe Order et ses méthodes.',
    flow: 'Décrire le flux de traitement des commandes.'
  };
  
  // Generate 20 runs (10 repetitions x 2 series, but simplified)
  // Series 1: repetition (same questions)
  for (let rep = 1; rep <= 2; rep++) {
    for (const task of tasks) {
      for (let run = 1; run <= 2; run++) {
        // Vibe always starts fresh, so no memory benefits
        const baseInputTokens = 7000 + Math.floor(Math.random() * 2000);
        const baseOutputTokens = 400 + Math.floor(Math.random() * 200);
        
        // Simulate more exploration needed without memory
        const calls = ['list', 'search', 'read', 'read', 'search', 'read'];
        const wallTimeMs = 5000 + Math.floor(Math.random() * 3000);
        
        // Simulate Vibe's results - may have partial completions
        const status = Math.random() > 0.3 ? 'complete' : 'partial';
        const stopReason = status === 'partial' ? 'iterations' : null;
        
        rows.push({
          task,
          repetition: rep,
          mode: 'vibe',  // Vibe mode
          run,
          calls,
          scriptCalls: [],  // No scripts for Vibe
          library: [],      // No library for Vibe
          wallTimeMs,
          result: {
            objective: objectives[task] || `Analyser ${task}`,
            entryPoints: status === 'complete' ? [{ name: task, evidence: [{ file: `src/${task}.js`, startLine: 1, endLine: 3 }] }] : [],
            components: status === 'complete' ? [{ name: `${task}.js`, evidence: [{ file: `src/${task}.js`, startLine: 1, endLine: 3 }] }] : [],
            relations: status === 'complete' ? [{ from: 'createOrder', to: task, evidence: [{ file: `src/${task}.js`, startLine: 5, endLine: 5 }] }] : [],
            uncertainties: status === 'partial' ? ['Exploration stopped before a structured result was produced.'] : [],
            status,
            stopReason,
            metrics: {
              inputTokens: baseInputTokens,
              outputTokens: baseOutputTokens,
              usageAvailable: true,
              modelCalls: 6,
              toolCalls: 6,
              durationMs: wallTimeMs,
              outputBytes: 1000 + Math.floor(Math.random() * 500),
              cost: null,
              memoryReuses: 0,
              memoryPurges: 0
            }
          }
        });
      }
    }
  }
  
  return {
    timestamp,
    model,
    budget,
    rows,
    metadata: {
      description: 'Mock Vibe benchmark data for comparison with POC',
      generated: timestamp,
      note: 'This is simulated data. Real Vibe comparator data should replace this.'
    }
  };
}

/**
 * Generate mock Vibe transfer data
 */
function generateMockVibeTransferData() {
  const timestamp = new Date().toISOString();
  const model = 'mistral-small-latest';
  
  const records = [];
  const tasks = [
    { id: 'function', objective: 'Comprendre comment totalPrice calcule son résultat.' },
    { id: 'class', objective: 'Analyser la structure de Order.' },
    { id: 'flow', objective: 'Décrire le flux de traitement.' }
  ];
  
  // Transfer learning - new but related questions
  for (let i = 0; i < 3; i++) {
    const task = tasks[i % tasks.length];
    const baseInputTokens = 6000 + Math.floor(Math.random() * 1500);
    const baseOutputTokens = 350 + Math.floor(Math.random() * 150);
    
    records.push({
      result: {
        objective: task.objective,
        entryPoints: [{ name: task.id, evidence: [{ file: `src/${task.id}.js`, startLine: 1, endLine: 3 }] }],
        components: [{ name: `${task.id}.js`, evidence: [{ file: `src/${task.id}.js`, startLine: 1, endLine: 3 }] }],
        relations: [{ from: 'createOrder', to: task.id, evidence: [{ file: `src/${task.id}.js`, startLine: 5, endLine: 5 }] }],
        uncertainties: [],
        status: 'complete',
        stopReason: null,
        metrics: {
          inputTokens: baseInputTokens,
          outputTokens: baseOutputTokens,
          usageAvailable: true,
          modelCalls: 4 + Math.floor(Math.random() * 2),
          toolCalls: 3 + Math.floor(Math.random() * 2),
          durationMs: 4000 + Math.floor(Math.random() * 2000),
          outputBytes: 800 + Math.floor(Math.random() * 400),
          cost: null,
          memoryReuses: 0,
          memoryPurges: 0
        }
      },
      library: [],
      trace: []
    });
  }
  
  return {
    timestamp,
    model,
    records,
    metadata: {
      description: 'Mock Vibe transfer benchmark data',
      generated: timestamp
    }
  };
}

// Generate and save mock data
const mockVibeRepetition = generateMockVibeData();
const mockVibeTransfer = generateMockVibeTransferData();

// Save files
const outputDir = resolve(__dirname, '..');
writeFileSync(resolve(outputDir, 'results-vibe-atomic-repetition-mock.json'), JSON.stringify(mockVibeRepetition, null, 2), 'utf8');
writeFileSync(resolve(outputDir, 'results-vibe-atomic-transfer-mock.json'), JSON.stringify(mockVibeTransfer, null, 2), 'utf8');

console.log('Generated mock Vibe benchmark data:');
console.log(`  - results-vibe-atomic-repetition-mock.json (${mockVibeRepetition.rows.length} rows)`);
console.log(`  - results-vibe-atomic-transfer-mock.json (${mockVibeTransfer.records.length} records)`);
console.log('\nMock data saved for testing report generation.');
