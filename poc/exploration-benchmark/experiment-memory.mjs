import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explore } from '../../packages/exploration-poc/src/explore.ts';
import { mistral } from '../../packages/exploration-poc/src/mistral.ts';

// Synthetic fixture only. The secret is read into memory and never written or printed.
const base = path.dirname(fileURLToPath(import.meta.url));
const output = process.argv[2];
if (!output) throw new Error('Provide a new output file');
const key = process.env.MISTRAL_API_KEY || execFileSync('security', ['find-generic-password', '-s', 'ai.mistral.vibe', '-a', 'MISTRAL_API_KEY', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const modelName = process.env.MISTRAL_MODEL || 'mistral-small-latest';
const tasks = JSON.parse(await readFile(path.join(base, 'tasks.json'), 'utf8'));
const budget = { iterations: 8, calls: 32, tokens: 32000, durationMs: 60000 };
const scratch = await mkdtemp(path.join(tmpdir(), 'codetour-memory-experiment-'));
const rows = [];
try {
  const selectedTasks = process.env.EXPERIMENT_TASK ? tasks.filter(task => task.id === process.env.EXPERIMENT_TASK) : tasks;
  if (!selectedTasks.length) throw new Error('Unknown task');
  const repetitions = Number(process.env.EXPERIMENT_REPETITIONS || 1), requests = Number(process.env.EXPERIMENT_REQUESTS || 2);
  if (![repetitions, requests].every(n => Number.isInteger(n) && n > 0 && n <= 10)) throw new Error('Invalid repetitions or requests');
  for (let repetition = 1; repetition <= repetitions * selectedTasks.length; repetition++) {
    const task = selectedTasks[(repetition - 1) % selectedTasks.length];
    for (const mode of process.env.EXPERIMENT_MODE ? [process.env.EXPERIMENT_MODE] : repetition % 2 ? ['off', 'on'] : ['on', 'off']) {
      if (!['on', 'off'].includes(mode)) throw new Error('Invalid mode');
      const root = path.join(scratch, `${repetition}-${mode}`, 'workspace');
      const directory = path.join(scratch, `${repetition}-${mode}`, 'memory');
      await mkdir(path.dirname(root), { recursive: true });
      await cp(path.join(base, 'workspace'), root, { recursive: true });
      for (let run = 1; run <= requests; run++) {
        const calls = [], scriptCalls = [];
        const underlying = mistral(key, modelName);
        const model = { async complete(messages, options) {
          const response = await underlying.complete(messages, options);
          calls.push(...(response.toolCalls || []).map(call => call.name));
          scriptCalls.push(...(response.toolCalls || []).filter(call => ['code', 'memory_run'].includes(call.name)).map(call => ({ name: call.name, arguments: call.arguments })));
          return response;
        } };
        const started = Date.now();
        try {
          const result = await explore({ root, objective: task.objective, codeMode: true, model, budget, ...(mode === 'on' ? { memory: { directory } } : {}) });
          let library = [];
          if (mode === 'on') { const files = await readdir(directory).catch(() => []); if (files.length) library = JSON.parse(await readFile(path.join(directory, files[0]), 'utf8')); }
          rows.push({ task: task.id, repetition, mode, run, calls, scriptCalls, library, wallTimeMs: Date.now() - started, result });
        } catch (error) {
          rows.push({ task: task.id, repetition, mode, run, calls, scriptCalls, wallTimeMs: Date.now() - started, error: String(error.message).replaceAll(key, '[redacted]') });
        }
        console.log(JSON.stringify({ task: task.id, repetition, mode, run, calls, status: rows.at(-1).result?.status ?? 'error' }));
      }
    }
  }
  await writeFile(output, JSON.stringify({ timestamp: new Date().toISOString(), model: modelName, budget, rows }, null, 2) + '\n', { flag: 'wx' });
} finally { await rm(scratch, { recursive: true, force: true }); }
