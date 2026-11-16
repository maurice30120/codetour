import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import * as processApi from 'node:process';
import { fileURLToPath } from 'node:url';
import { explore } from './explore.ts';
import { mistral } from './mistral.ts';
import { PROMPT_SHA256 } from './decomposition-prompt.ts';
import type { Budget, Model } from './explore.ts';

let model: Model | undefined;
try {
const localEnv = fileURLToPath(new URL('../../../.env.local', import.meta.url));
if (existsSync(localEnv)) (processApi as typeof processApi & { loadEnvFile(path: string): void }).loadEnvFile(localEnv);
const args = process.argv.slice(2);
let codeMode = false;
let memory: { directory: string } | undefined;
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
  else if (option === '--memory' && args[0]) memory = { directory: resolve(args.shift()!) };
  else if (option === '--tokens' || option === '--token-budget') budget.tokens = positive(args.shift());
  else if (option === '--duration-ms' || option === '--time-budget-ms') budget.durationMs = positive(args.shift());
  else if (option === '--iterations') budget.iterations = positive(args.shift());
  else if (option === '--calls') budget.calls = positive(args.shift());
  else if (option === '--temperature' && args[0] !== undefined) temperature = Number(args.shift());
  else throw new Error('Unknown or incomplete option');
}
const [root, ...objective] = args;
if (!root || !objective.length) throw new Error('Usage: npm run explore -- [--code] [--memory <directory>] [--tokens <n>] [--duration-ms <n>] [--temperature <n>] <workspace> <objective>');
if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) throw new Error('Temperature must be between 0 and 1');
model = mistral(process.env.MISTRAL_API_KEY ?? '', process.env.MISTRAL_MODEL, { temperature });
const result = await explore({ root: resolve(root), objective: objective.join(' '), codeMode, memory, budget, model });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const failure = ((error as any).exploration) ?? { status: 'failed', error: String((error as Error).message ?? error).slice(0, 500), promptSha256: PROMPT_SHA256, modelConfig: model?.snapshot?.(), metrics: { modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, usageAvailable: false }, callTrace: [] };
  process.stdout.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
}
