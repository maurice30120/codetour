#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { explore } from './explore.ts';
import { mistral } from './mistral.ts';
import { PROMPT_SHA256 } from './decomposition-prompt.ts';
import type { Budget, Model } from './explore.ts';

let model: Model | undefined;
try {
const args = process.argv.slice(2);
let codeMode = false;
let memoryEnabled = false;
let legacyMemory: string | undefined;
let workspacePath: string | undefined;
const budget: Budget = {};
const positive = (value: string | undefined): number => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error('Budgets must be positive numbers');
  return number;
};
if (process.env.CODETOUR_TOKEN_BUDGET) budget.tokens = positive(process.env.CODETOUR_TOKEN_BUDGET);
if (process.env.CODETOUR_TIME_BUDGET_MS) budget.durationMs = positive(process.env.CODETOUR_TIME_BUDGET_MS);
let temperature = process.env.MISTRAL_TEMPERATURE === undefined ? 0 : Number(process.env.MISTRAL_TEMPERATURE);
while (args[0]?.startsWith('--')) {
  const option = args.shift();
  if (option === '--code') codeMode = true;
  else if (option === '--memory') {
    memoryEnabled = true;
    // Retain the previous directory argument when it is visibly a path.
    if (args[0] && (args[0].startsWith('/') || args[0].startsWith('./') || args[0].startsWith('../'))) legacyMemory = args.shift();
  }
  else if ((option === '--workspace' || option === '--root') && args[0]) workspacePath = args.shift();
  else if (option === '--tokens' || option === '--token-budget') budget.tokens = positive(args.shift());
  else if (option === '--duration-ms' || option === '--time-budget-ms') budget.durationMs = positive(args.shift());
  else if (option === '--iterations') budget.iterations = positive(args.shift());
  else if (option === '--calls') budget.calls = positive(args.shift());
  else if (option === '--temperature' && args[0] !== undefined) temperature = Number(args.shift());
  else throw new Error('Unknown or incomplete option');
}
if (!args.length) throw new Error('Usage: codetour-research [--workspace <directory>] [--code] [--memory] [--tokens <n>] [--duration-ms <n>] <question>');
// Preserve the old positional workspace form when the first argument is an existing directory.
if (!workspacePath && args.length > 1) {
  try { if ((await stat(resolve(args[0]))).isDirectory()) workspacePath = args.shift(); } catch { /* question, not a directory */ }
}
const requestedRoot = resolve(workspacePath ?? process.cwd());
const root = await realpath(requestedRoot);
if (!(await stat(root)).isDirectory()) throw new Error('Workspace must be a single project directory; select a root explicitly for multi-root workspaces');
await access(root, constants.R_OK | constants.W_OK | constants.X_OK);
const objective = args.join(' ').trim();
if (!objective) throw new Error('A research question is required');
const canonicalMemory = join(root, '.tours', 'memory');
if (legacyMemory && resolve(legacyMemory) !== canonicalMemory) throw new Error(`Memory must be stored at ${canonicalMemory}`);
const memory = memoryEnabled ? { directory: canonicalMemory } : undefined;
if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) throw new Error('Temperature must be between 0 and 1');
model = mistral(process.env.MISTRAL_API_KEY ?? '', process.env.MISTRAL_MODEL, { temperature });
if (codeMode) {
  // Exercise the real sandbox before starting a model run, including QuickJS and TypeScript.
  const { runScript } = await import('codetour-exploration-sandbox');
  try { await runScript({ workspace: root, code: '() => 1', params: {}, strict: true, timeoutMs: 5000 }); }
  catch (error) { throw new Error(`Sandbox preflight failed: ${(error as Error).message}`); }
}
const result = await explore({ root, objective, codeMode, memory, budget, model });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const failure = ((error as any).exploration) ?? { status: 'failed', error: String((error as Error).message ?? error).slice(0, 500), promptSha256: PROMPT_SHA256, modelConfig: model?.snapshot?.(), metrics: { modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, usageAvailable: false }, callTrace: [] };
  process.stdout.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
}
