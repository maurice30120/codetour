#!/usr/bin/env node

/**
 * Analyze existing benchmark data to understand structure and content
 */

import { readFileSync, readdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCHMARK_DIR = resolve(__dirname, '..');
const RESULTS = readdirSync(BENCHMARK_DIR)
  .filter(f => f.startsWith('results-') && f.endsWith('.json'))
  .map(f => resolve(BENCHMARK_DIR, f));

console.log(`Found ${RESULTS.length} result files`);
console.log('\n=== File List ===');
RESULTS.forEach(f => console.log(f.replace(BENCHMARK_DIR + '/', '')));

// Categorize files
const categories = {
  'mistral-atomic-repetition': [],
  'mistral-atomic-transfer': [],
  'mistral-atomic-pilot': [],
  'mistral-memory': [],
  'mistral-script-diagnostic': [],
  'mistral-smoke': [],
  'postgres': [],
  'tour': [],
  'toolbox': [],
  'generated': [],
  'compose': [],
  'lean': [],
  'other': []
};

RESULTS.forEach(file => {
  const name = file.replace(BENCHMARK_DIR + '/', '');
  let categorized = false;
  for (const [category, list] of Object.entries(categories)) {
    if (name.includes(category)) {
      list.push(name);
      categorized = true;
      break;
    }
  }
  if (!categorized) {
    categories.other.push(name);
  }
});

console.log('\n=== Categorization ===');
for (const [category, files] of Object.entries(categories)) {
  if (files.length > 0) {
    console.log(`${category}: ${files.length} files`);
    files.forEach(f => console.log(`  - ${f}`));
  }
}

// Analyze structure of a few files
console.log('\n=== Sample Data Structures ===');

const samples = [
  'results-mistral-atomic-repetition-2026-11-14.json',
  'results-mistral-atomic-transfer-2026-11-14.json',
  'results-mistral-memory-2026-11-14.json'
];

samples.forEach(sample => {
  const filePath = resolve(BENCHMARK_DIR, sample);
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    console.log(`\n--- ${sample} ---`);
    console.log('Top-level keys:', Object.keys(data));
    if (data.rows) {
      console.log(`Rows: ${data.rows.length}`);
      if (data.rows.length > 0) {
        console.log('First row keys:', Object.keys(data.rows[0]));
        console.log('First row result keys:', Object.keys(data.rows[0].result || {}));
        console.log('First row metrics:', JSON.stringify(data.rows[0].result?.metrics || data.rows[0].metrics || {}, null, 2));
      }
    }
    if (data.records) {
      console.log(`Records: ${data.records.length}`);
      if (data.records.length > 0) {
        console.log('First record keys:', Object.keys(data.records[0]));
        if (data.records[0].result) {
          console.log('First record result keys:', Object.keys(data.records[0].result));
          console.log('First record metrics:', JSON.stringify(data.records[0].result?.metrics || {}, null, 2));
        }
      }
    }
  } catch (e) {
    console.log(`Error reading ${sample}:`, e.message);
  }
});

// Look for files that might contain Vibe data
console.log('\n=== Searching for Vibe-related data ===');
let hasVibe = false;
RESULTS.forEach(file => {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const content = readFileSync(file, 'utf8');
    if (content.includes('Vibe') || content.includes('vibe') || content.includes('sub-agent')) {
      console.log(`Found potential Vibe data in: ${file.replace(BENCHMARK_DIR + '/', '')}`);
      hasVibe = true;
    }
    
    // Check for agent identifiers
    if (data.rows) {
      const modes = new Set();
      data.rows.forEach(row => {
        if (row.mode) modes.add(row.mode);
        if (row.agent) modes.add(row.agent);
      });
      if (modes.size > 0) {
        console.log(`Modes in ${file.replace(BENCHMARK_DIR + '/', '')}:`, Array.from(modes));
      }
    }
    
    if (data.records) {
      const hasResult = data.records.some(r => r.result);
      if (hasResult) {
        const firstResult = data.records[0].result;
        if (firstResult && firstResult.status) {
          const statuses = new Set();
          data.records.forEach(r => {
            if (r.result && r.result.status) statuses.add(r.result.status);
          });
          console.log(`Statuses in ${file.replace(BENCHMARK_DIR + '/', '')}:`, Array.from(statuses));
        }
      }
    }
  } catch (e) {
    // ignore
  }
});

if (!hasVibe) {
  console.log('No Vibe-related data found in result files');
}
