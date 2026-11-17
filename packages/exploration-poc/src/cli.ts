#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { access, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { explore } from './explore.ts';
import { mistral } from './mistral.ts';
import { loadConfig } from './config.ts';
import { PROMPT_SHA256 } from './decomposition-prompt.ts';
import { summarize } from './summary.ts';
import type { Budget, Model } from './explore.ts';

let model: Model | undefined;
let outputFile: string | undefined;
const emit = async (value: unknown) => {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  if (outputFile) {
    await writeFile(outputFile, json);
    process.stdout.write(`${JSON.stringify(summarize(value, outputFile))}\n`);
  } else process.stdout.write(json);
};
let releaseLock: (() => Promise<void>) | undefined;
// Refuses a second run on the same output file while the first process is alive; stale locks of dead pids are replaced.
const acquireLock = async (root: string, file: string) => {
  const target = resolve(file);
  const dir = join(root, '.tours', '.log', 'locks');
  const lock = join(dir, `${createHash('sha256').update(target).digest('hex')}.lock`);
  await mkdir(dir, { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try { await writeFile(lock, JSON.stringify({ pid: process.pid, outputFile: target, startedAt: Date.now() }), { flag: 'wx' }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pid = Number(JSON.parse(await readFile(lock, 'utf8').catch(() => '{}')).pid);
      let alive = false;
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); alive = true; } catch (e) { alive = (e as NodeJS.ErrnoException).code === 'EPERM'; }
      }
      if (alive || attempt > 0) throw Object.assign(new Error(`Run already active for ${target} (pid ${pid})`), { lockConflict: true });
      await rm(lock, { force: true });
    }
  }
  releaseLock = () => rm(lock, { force: true });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void releaseLock!().finally(() => process.exit(1)); });
};
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
let temperature: number | undefined;
let modelName: string | undefined;
while (args[0]?.startsWith('--')) {
  const option = args.shift();
  if (option === '--code') codeMode = true;
  else if (option === '--memory') {
    memoryEnabled = true;
    // Retain the previous directory argument when it is visibly a path.
    if (args[0] && (args[0].startsWith('/') || args[0].startsWith('./') || args[0].startsWith('../'))) legacyMemory = args.shift();
  }
  else if ((option === '--workspace' || option === '--root') && args[0]) workspacePath = args.shift();
  else if (option === '--output-file' && args[0] && !args[0].startsWith('--')) outputFile = args.shift();
  else if (option === '--tokens' || option === '--token-budget') budget.tokens = positive(args.shift());
  else if (option === '--duration-ms' || option === '--time-budget-ms') budget.durationMs = positive(args.shift());
  else if (option === '--iterations') budget.iterations = positive(args.shift());
  else if (option === '--calls') budget.calls = positive(args.shift());
  else if (option === '--temperature' && args[0] !== undefined) temperature = Number(args.shift());
  else if (option === '--model' && args[0]) modelName = args.shift();
  else throw new Error('Unknown or incomplete option');
}
if (!args.length) throw new Error('Usage: codetour-research [--workspace <directory>] [--code] [--memory] [--output-file <path>] [--tokens <n>] [--duration-ms <n>] <question>');
// Preserve the old positional workspace form when the first argument is an existing directory.
if (!workspacePath && args.length > 1) {
  try { if ((await stat(resolve(args[0]))).isDirectory()) workspacePath = args.shift(); } catch { /* question, not a directory */ }
}
const requestedRoot = resolve(workspacePath ?? process.cwd());
const root = await realpath(requestedRoot);
if (!(await stat(root)).isDirectory()) throw new Error('Workspace must be a single project directory; select a root explicitly for multi-root workspaces');
await access(root, constants.R_OK | constants.W_OK | constants.X_OK);
if (outputFile) await acquireLock(root, outputFile);
const objective = args.join(' ').trim();
if (!objective) throw new Error('A research question is required');
const canonicalMemory = join(root, '.tours', '.memory');
if (legacyMemory && resolve(legacyMemory) !== canonicalMemory) throw new Error(`Memory must be stored at ${canonicalMemory}`);
const memory = memoryEnabled ? { directory: canonicalMemory } : undefined;
// .tours/config.json holds every setting; CLI options override it per run. Only the API key may also come from the environment.
const config = await loadConfig(root);
const effectiveTemperature = temperature ?? config.mistral.temperature;
if (!Number.isFinite(effectiveTemperature) || effectiveTemperature < 0 || effectiveTemperature > 1) throw new Error('Temperature must be between 0 and 1');
model = mistral(process.env.MISTRAL_API_KEY || config.mistral.apiKey, modelName ?? config.mistral.model, { ...config.mistral, temperature: effectiveTemperature });
if (codeMode) {
  // Exercise the real sandbox before starting a model run, including QuickJS and TypeScript.
  const { runScript } = await import('codetour-exploration-sandbox');
  try { await runScript({ workspace: root, code: '() => 1', params: {}, strict: true, timeoutMs: config.limits.scriptTimeoutMs }); }
  catch (error) { throw new Error(`Sandbox preflight failed: ${(error as Error).message}`); }
}
// Progress is appended as JSON lines next to the output file so a long run can be followed with tail -f.
let onProgress: ((event: Record<string, unknown>) => void) | undefined;
if (outputFile) {
  const progressFile = `${outputFile}.progress`;
  await writeFile(progressFile, '');
  onProgress = event => appendFileSync(progressFile, `${JSON.stringify(event)}\n`);
}
const result = await explore({ root, objective, codeMode, memory, budget, model, config, onProgress });
await emit(result);
} catch (error) {
  if ((error as any).lockConflict) { process.stderr.write(`${(error as Error).message}\n`); process.exitCode = 1; }
  else {
  const failure = ((error as any).exploration) ?? { status: 'failed', error: String((error as Error).message ?? error).slice(0, 500), promptSha256: PROMPT_SHA256, modelConfig: model?.snapshot?.(), metrics: { modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, usageAvailable: false }, callTrace: [] };
  try { await emit(failure); }
  catch (writeError) { process.stderr.write(`Unable to write output file: ${(writeError as Error).message}\n`); }
  process.exitCode = 1;
  }
} finally {
  await releaseLock?.();
}
