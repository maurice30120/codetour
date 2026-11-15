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
 * Where <mode> is one of: baseline, code-mode, memory-on, memory-off, vibe-baseline, vibe-research
 * And stdin contains: {root, objective, mode, budget}
 */

import { spawn } from 'node:child_process';
import { mkdir, rm, readFile, readdir } from 'node:fs/promises';
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

// Validate mode (use from request if not provided as argument)
const expectedMode = process.argv[2] || mode;
if (!expectedMode) {
  process.stderr.write('Error: mode is required as command-line argument or in request\n');
  process.exit(1);
}

// Mode must be one of the valid modes
const validModes = ['baseline', 'code-mode', 'memory-on', 'memory-off', 'vibe-baseline', 'vibe-research', 'vibe-repetition', 'vibe-transfer'];
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

  // Parse stdout as JSON array
  let sessionData = [];
  try {
    sessionData = JSON.parse(stdout);
    if (!Array.isArray(sessionData)) {
      sessionData = [];
    }
  } catch {
    sessionData = [];
  }

  // Also try to read from journal files
  try {
    const journalDir = path.join(vibeOutputDir, 'session', 'journal');
    const files = await readdir(journalDir);
    for (const file of files) {
      if (file.endsWith('.jsonl')) {
        const journalPath = path.join(journalDir, file);
        const journalContent = await readFile(journalPath, 'utf8');
        const lines = journalContent.split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.payload) {
              sessionData.push(entry.payload);
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    }
  } catch {
    // Journal directory might not exist
  }

  // Extract evidence from session data
  const evidence = extractEvidenceFromSession(sessionData, absRoot);
  
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
    'finished': null, // Map to null for completed status
    'iteration_limit': 'iterations',
  };
  const mapped = mapping[reason];
  return mapped !== undefined ? mapped : reason;
}

/**
 * Extract evidence from session data (conversation entries)
 */
function extractEvidenceFromSession(entries, root) {
  const evidence = [];
  
  for (const entry of entries) {
    // Handle effect entries with tool calls
    if (entry.type === 'effect') {
      const toolName = entry.toolName || entry.detail?.toolName;
      
      // Extract from bash tool output
      if (toolName === 'file_system.bash') {
        const output = entry.state?.output?.stdout || entry.state?.outputText || '';
        if (output) {
          evidence.push(...parseToolOutput(output, root));
        }
      }
      
      // Extract from grep tool output
      if (toolName === 'grep') {
        const output = entry.state?.output;
        if (output) {
          // Handle both string and object output
          if (typeof output === 'string') {
            evidence.push(...parseToolOutput(output, root));
          } else if (output.matches) {
            // Output is an object with matches field
            evidence.push(...parseGrepMatches(output.matches, root));
          } else if (output.parsedMatches) {
            // Output has parsedMatches with file, line, content
            evidence.push(...parseGrepParsedMatches(output.parsedMatches, root));
          }
        }
      }
      
      // Extract from read_resource tool (Vibe's native tool)
      if (toolName === 'read_resource') {
        const file = entry.input?.uri || entry.state?.input?.uri;
        if (file) {
          const normalized = normalizeFilePath(file, root);
          if (normalized) {
            evidence.push({ file: normalized, startLine: 1, endLine: 1 });
          }
        }
      }
      
      // Extract from list_resources tool
      if (toolName === 'list_resources') {
        const resources = entry.state?.output?.resources || [];
        for (const resource of resources) {
          const file = resource.uri || resource.path;
          if (file) {
            const normalized = normalizeFilePath(file, root);
            if (normalized) {
              evidence.push({ file: normalized, startLine: 1, endLine: 1 });
            }
          }
        }
      }
      
      // Extract from read_file tool
      if (toolName === 'read_file') {
        const file = entry.input?.file || entry.state?.input?.file;
        const startLine = entry.input?.startLine ?? entry.state?.input?.startLine ?? 1;
        const endLine = entry.input?.endLine ?? entry.state?.input?.endLine ?? startLine;
        if (file) {
          const normalized = normalizeFilePath(file, root);
          if (normalized) evidence.push({ file: normalized, startLine, endLine });
        }
      }
      
      // Extract from file_system.read tool
      if (toolName === 'file_system.read') {
        const file = entry.input?.path || entry.state?.input?.path || entry.state?.output?.file;
        const startLine = entry.input?.startLine ?? entry.state?.input?.startLine ?? 1;
        const endLine = entry.input?.endLine ?? entry.state?.input?.endLine ?? startLine;
        if (file) {
          const normalized = normalizeFilePath(file, root);
          if (normalized) evidence.push({ file: normalized, startLine, endLine });
        }
      }
    }
    
    // Extract from assistant messages - this is where line numbers are mentioned
    if (entry.type === 'message' && entry.role === 'assistant' && entry.content) {
      for (const contentItem of entry.content) {
        if (contentItem.text) {
          evidence.push(...parseTextForFileRefs(contentItem.text, root));
        }
      }
    }
  }
  
  return deduplicateEvidence(evidence);
}

/**
 * Parse grep parsed matches (with file, line, content)
 */
function parseGrepParsedMatches(matches, root) {
  const evidence = [];
  if (!Array.isArray(matches)) return evidence;
  
  for (const match of matches) {
    const file = match.file || match.filePath;
    const line = match.line || match.lineNumber || 1;
    if (file) {
      const normalized = normalizeFilePath(file, root);
      if (normalized) {
        evidence.push({ 
          file: normalized, 
          startLine: parseInt(line, 10) || 1, 
          endLine: parseInt(line, 10) || 1 
        });
      }
    }
  }
  return evidence;
}

/**
 * Parse grep matches string
 */
function parseGrepMatches(matches, root) {
  const evidence = [];
  if (typeof matches !== 'string') return evidence;
  
  const lines = matches.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Parse file:line:content format
    const match = trimmed.match(/^([^:]+):(\d+):/);
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
 * Parse tool output (like bash ls or grep) for file references
 */
function parseToolOutput(text, root) {
  const evidence = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Try to parse as grep -n output: file:line:content
    const grepNMatch = trimmed.match(/^([^:]+):(\d+):/);
    if (grepNMatch) {
      const normalized = normalizeFilePath(grepNMatch[1], root);
      if (normalized) {
        evidence.push({ 
          file: normalized, 
          startLine: parseInt(grepNMatch[2], 10), 
          endLine: parseInt(grepNMatch[2], 10) 
        });
      }
      continue;
    }
    
    // Try to parse as grep -n output without trailing colon: file:line content
    const grepNMatch2 = trimmed.match(/^([^:]+):(\d+)\s/);
    if (grepNMatch2) {
      const normalized = normalizeFilePath(grepNMatch2[1], root);
      if (normalized) {
        evidence.push({ 
          file: normalized, 
          startLine: parseInt(grepNMatch2[2], 10), 
          endLine: parseInt(grepNMatch2[2], 10) 
        });
      }
      continue;
    }
    
    // Try to parse as grep output with range: file:start-end:content
    const grepRangeMatch = trimmed.match(/^([^:]+):(\d+)-(\d+):/);
    if (grepRangeMatch) {
      const normalized = normalizeFilePath(grepRangeMatch[1], root);
      if (normalized) {
        evidence.push({ 
          file: normalized, 
          startLine: parseInt(grepRangeMatch[2], 10), 
          endLine: parseInt(grepRangeMatch[3], 10) 
        });
      }
      continue;
    }
    
    // If it's just a file path, add it with line 1
    const normalized = normalizeFilePath(trimmed, root);
    if (normalized) {
      evidence.push({ file: normalized, startLine: 1, endLine: 1 });
    }
  }
  
  return evidence;
}

/**
 * Parse text for file references and line numbers
 * Only extracts explicit line number references to avoid false positives
 */
function parseTextForFileRefs(text, root) {
  const evidence = [];
  
  // Pattern 1: backtick file at line N (e.g., `src/catalog.js` (line 8) or `src/catalog.js` (ligne 8))
  // This is the most reliable pattern
  const backtickLineRegex = /`([^\s:`]+\.(?:js|ts|json|cjs|mjs|txt|md))`\s*\((?:lignes?|lines?|row|rows?|lineas?)\s*(\d+)\)/gi;
  let match;
  while ((match = backtickLineRegex.exec(text)) !== null) {
    const normalized = normalizeFilePath(match[1], root);
    if (normalized) {
      evidence.push({ 
        file: normalized, 
        startLine: parseInt(match[2], 10), 
        endLine: parseInt(match[2], 10) 
      });
    }
  }
  
  // Pattern 2: | file | line | (table format) - line number might be in bold
  const tableRegex = /\|\s*`([^`\s:\/]+\.(?:js|ts|json|cjs|mjs|txt|md))`\s*\|\s*(?:\*\*)?(\d+)(?:\*\*)?\s*\|/g;
  while ((match = tableRegex.exec(text)) !== null) {
    const normalized = normalizeFilePath(match[1], root);
    if (normalized) {
      evidence.push({ 
        file: normalized, 
        startLine: parseInt(match[2], 10), 
        endLine: parseInt(match[2], 10) 
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
    // Skip if filePath contains colon (likely a code snippet, not a file path)
    if (filePath.includes(':') && !path.isAbsolute(filePath)) {
      return null;
    }
    
    let normalized;
    
    if (path.isAbsolute(filePath)) {
      // On macOS, /private/tmp is symlinked to /tmp, so resolve both
      const realRoot = path.resolve(root);
      const realFilePath = path.resolve(filePath);
      
      // Check if within root directory
      if (realFilePath.startsWith(realRoot)) {
        normalized = path.relative(realRoot, realFilePath);
      } else if (realFilePath.startsWith('/private' + realRoot)) {
        // Handle /private/tmp vs /tmp
        normalized = path.relative(realRoot, realFilePath.replace('/private', ''));
      } else {
        // Try to extract from full path containing workspace
        const parts = realFilePath.split(path.sep);
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
    
    // Remove trailing slash
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    
    // Skip if the result contains invalid characters
    if (normalized.includes(':') || normalized.includes('`')) {
      return null;
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
