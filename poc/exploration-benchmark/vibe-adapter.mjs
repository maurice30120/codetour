#!/usr/bin/env node

/**
 * Vibe Sub-Agent Comparator Adapter
 * 
 * Invokes Vibe's native research sub-agent for codebase exploration.
 * Receives workspace root and objective via stdin, returns results via stdout.
 * 
 * Usage:
 *   node vibe-adapter.mjs <mode>
 * 
 * Where <mode> is one of: baseline, code-mode, vibe-baseline, vibe-research
 * And stdin contains: {root, objective, mode, budget}
 */

import { spawn } from 'node:child_process';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

// Read input from stdin
let input = '';
for await (const chunk of process.stdin) input += chunk;

const request = JSON.parse(input);
const { root, objective, mode, budget } = request;

// Validate required fields
if (!root || !objective) {
  process.stderr.write('Error: root and objective are required\n');
  process.exit(1);
}

// Validate mode (must match process.argv[2] as per the benchmark runner)
const expectedMode = process.argv[2];
if (!expectedMode) {
  process.stderr.write('Error: mode is required as command-line argument\n');
  process.exit(1);
}

// Mode must be one of the valid modes and must match what was passed
const validModes = ['baseline', 'code-mode', 'memory-on', 'memory-off', 'vibe-baseline', 'vibe-research'];
if (!validModes.includes(expectedMode)) {
  process.stderr.write(`Error: Invalid mode. Expected one of: ${validModes.join(', ')}\n`);
  process.exit(1);
}

// Resolve absolute path for root
const absRoot = path.resolve(root);

// Create a temporary output directory for Vibe
const sessionId = `vibe-adapter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const vibeOutputDir = path.join(tmpdir(), sessionId);
await mkdir(vibeOutputDir, { recursive: true });

// Prepare Vibe command
const maxTurns = budget?.iterations ?? 8;
const maxTokens = budget?.tokens ?? 32000;
const durationMs = budget?.durationMs ?? 60000;
const timeLimitSec = Math.floor(durationMs / 1000) + 5;

const vibeArgs = [
  '--workdir', absRoot,
  '-p', objective,
  '--output', 'json',
  '--max-turns', String(maxTurns),
  '--max-tokens', String(maxTokens),
  '--time-limit', String(timeLimitSec),
  '--auto-approve',
  '--output-dir', vibeOutputDir,
];

// Set environment variables
const env = {
  ...process.env,
  VIBE_TRUST: 'true',
};

let stdout = '';
let stderrOutput = '';

try {
  // Execute Vibe
  const vibeProcess = spawn('vibe', vibeArgs, { 
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  vibeProcess.stdout.on('data', (data) => { stdout += data; });
  vibeProcess.stderr.on('data', (data) => { stderrOutput += data; });

  const exitCode = await new Promise((resolve, reject) => {
    vibeProcess.on('close', (code) => resolve(code));
    vibeProcess.on('error', (err) => reject(err));
  });

  // Wait for export.json with retries
  let exportData = null;
  let attempts = 0;
  const exportPath = path.join(vibeOutputDir, 'export.json');
  while (attempts < 10 && !exportData) {
    attempts++;
    try {
      const exportJson = await readFile(exportPath, 'utf8');
      exportData = JSON.parse(exportJson);
    } catch {
      await setTimeout(200 * attempts);
    }
  }

  // Extract evidence from Vibe's session output
  const evidence = extractEvidence(stdout, absRoot);
  
  // Vibe's export.json uses snake_case for usage keys
  const usage = exportData?.usage ?? {};
  const cost = exportData?.cost_usd ?? null;
  const steps = exportData?.steps ?? null;

  // Determine stop reason
  let stopReason = null;
  if (exportData?.outcome) {
    stopReason = mapStopReason(exportData.outcome);
  }
  if (!stopReason && exportData?.stop_reason) {
    stopReason = mapStopReason(exportData.stop_reason);
  }
  if (!stopReason) {
    const stoppedMatch = stderrOutput.match(/Stopped:\s*(\w+)/);
    if (stoppedMatch) {
      stopReason = mapStopReason(stoppedMatch[1]);
    }
  }
  if (!stopReason && exitCode !== 0) {
    stopReason = 'error';
  }

  // Normalize the response for comparable evaluation
  const result = {
    objective,
    entryPoints: [],
    components: [],
    relations: [],
    evidence,
    uncertainties: [],
    status: exitCode === 0 && !stopReason ? 'completed' : 'partial',
    stopReason,
    metrics: {
      // Vibe's export.json uses snake_case
      inputTokens: usage.input_tokens ?? null,
      outputTokens: usage.output_tokens ?? null,
      cachedInputTokens: usage.cached_input_tokens ?? null,
      totalTokens: usage.total_tokens ?? null,
      cost: usage.input_tokens !== undefined || usage.output_tokens !== undefined ? cost : null,
      modelCalls: steps ?? null,
      toolCalls: null,
      durationMs: null,
      usageAvailable: usage.input_tokens !== undefined && usage.output_tokens !== undefined,
    },
  };

  // Output result as JSON
  process.stdout.write(JSON.stringify(result, null, 2));

} catch (error) {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exit(1);
} finally {
  // Clean up temporary directory
  await rm(vibeOutputDir, { recursive: true, force: true });
}

/**
 * Map Vibe stop reason to benchmark stop reason
 */
function mapStopReason(reason) {
  const mapping = {
    'turn_limit': 'iterations',
    'token_limit': 'tokens',
    'time_limit': 'duration',
    'limit': 'iterations',
    'interrupted': 'interrupted',
    'finished': null, // Map to null so status becomes 'completed'
  };
  return mapping[reason] ?? reason;
}

/**
 * Extract evidence from Vibe's JSON output
 */
function extractEvidence(stdout, root) {
  const evidence = [];
  try {
    const sessionOutput = JSON.parse(stdout);
    if (!Array.isArray(sessionOutput)) return evidence;
    
    for (const entry of sessionOutput) {
      // Extract from bash/grep tool output
      if (entry.type === 'effect' && entry.detail?.toolName === 'file_system.bash') {
        const outputText = entry.state?.outputText || entry.state?.output?.stdout || '';
        evidence.push(...parseGrepOutput(outputText, root));
      }
      
      // Extract from read_file tool
      if (entry.type === 'effect' && entry.detail?.toolName === 'read_file') {
        const file = entry.state?.input?.file;
        const startLine = entry.state?.input?.startLine ?? 1;
        const endLine = entry.state?.input?.endLine ?? startLine;
        if (file) {
          const normalized = normalizeFilePath(file, root);
          if (normalized) evidence.push({ file: normalized, startLine, endLine });
        }
      }
      
      // Extract from file_system.read tool
      if (entry.type === 'effect' && entry.detail?.toolName === 'file_system.read') {
        const file = entry.state?.output?.file;
        const startLine = entry.state?.output?.startLine ?? 1;
        const endLine = entry.state?.output?.endLine ?? startLine;
        if (file) {
          const normalized = normalizeFilePath(file, root);
          if (normalized) evidence.push({ file: normalized, startLine, endLine });
        }
      }
      
      // Extract from assistant messages
      if (entry.type === 'message' && entry.role === 'assistant' && entry.content) {
        for (const contentItem of entry.content) {
          if (contentItem.text) {
            evidence.push(...parseTextForFileRefs(contentItem.text, root));
          }
        }
      }
    }
  } catch {
    // If stdout is not JSON, try to extract from raw text
    evidence.push(...parseTextForFileRefs(stdout, root));
  }
  
  return deduplicateEvidence(evidence);
}

/**
 * Parse grep output format: file:line:content
 */
function parseGrepOutput(text, root) {
  const evidence = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^(\S+):(\d+):/);
    if (match) {
      const normalized = normalizeFilePath(match[1], root);
      if (normalized) {
        evidence.push({ 
          file: normalized, 
          startLine: parseInt(match[2], 10), 
          endLine: parseInt(match[2], 10) 
        });
      }
    }
  }
  return evidence;
}

/**
 * Parse text for file:line or file:line-line patterns
 */
function parseTextForFileRefs(text, root) {
  const evidence = [];
  
  // Pattern: filename.ext:line
  const fileLineRegex = /([^\s:\/]+\.(?:js|ts|json|cjs|mjs|txt|md)):(\d+)/g;
  let match;
  while ((match = fileLineRegex.exec(text)) !== null) {
    const normalized = normalizeFilePath(match[1], root);
    if (normalized) {
      evidence.push({ 
        file: normalized, 
        startLine: parseInt(match[2], 10), 
        endLine: parseInt(match[2], 10) 
      });
    }
  }
  
  // Pattern: filename.ext:start-end
  const fileRangeRegex = /([^\s:\/]+\.(?:js|ts|json|cjs|mjs|txt|md)):(\d+)-(\d+)/g;
  while ((match = fileRangeRegex.exec(text)) !== null) {
    const normalized = normalizeFilePath(match[1], root);
    if (normalized) {
      evidence.push({ 
        file: normalized, 
        startLine: parseInt(match[2], 10), 
        endLine: parseInt(match[3], 10) 
      });
    }
  }
  
  return evidence;
}

/**
 * Normalize file path to be relative to workspace root
 */
function normalizeFilePath(filePath, root) {
  try {
    let normalized;
    
    if (path.isAbsolute(filePath)) {
      // Check if within root directory
      if (filePath.startsWith(root)) {
        normalized = path.relative(root, filePath);
      } else {
        // Try to extract from full path containing workspace
        const parts = filePath.split(path.sep);
        const workspaceIdx = parts.findIndex(p => p === 'workspace');
        if (workspaceIdx !== -1 && workspaceIdx < parts.length - 1) {
          normalized = parts.slice(workspaceIdx + 1).join('/');
        } else {
          return null;
        }
      }
    } else {
      // Relative path
      normalized = filePath.replace(/^\.\//, '');
      if (normalized.startsWith('workspace/')) {
        normalized = normalized.slice('workspace/'.length);
      }
    }
    
    // Normalize path separators to forward slashes
    normalized = normalized.replace(/\\/g, '/');
    
    // Remove leading slash
    if (normalized.startsWith('/')) {
      normalized = normalized.slice(1);
    }
    
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Deduplicate evidence entries
 */
function deduplicateEvidence(evidence) {
  const seen = new Map();
  for (const e of evidence) {
    const key = `${e.file}:${e.startLine}-${e.endLine}`;
    if (!seen.has(key)) {
      seen.set(key, e);
    }
  }
  return Array.from(seen.values());
}
