import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { explore } from '../../packages/exploration-poc/src/explore.ts';
import { mistral } from '../../packages/exploration-poc/src/mistral.ts';

const [root, output] = process.argv.slice(2);
if (!root || !output) throw new Error('Usage: postgres.mjs root output');
const key = process.env.MISTRAL_API_KEY || execFileSync('security', ['find-generic-password', '-s', 'ai.mistral.vibe', '-a', 'MISTRAL_API_KEY', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const tasks = [
  { id: 'parse', objective: 'Dans le traitement des requêtes SQL simples, quelle fonction transforme query_string en arbres syntaxiques bruts et où est-elle appelée ? Cite les lignes.' },
  { id: 'analyze', objective: 'Dans exec_simple_query, comment un arbre syntaxique brut est-il analysé et réécrit avant la planification ? Cite les appels et leurs définitions.' },
  { id: 'flow', objective: 'Dans exec_simple_query, décris le flux de query_string depuis le parsing jusqu’à la planification et cite les lignes des appels.' }
];
const budget = { iterations: 10, calls: 40, tokens: 48000, durationMs: 90000 };
const temp = await mkdtemp(path.join(tmpdir(), 'codetour-pg-memory-'));
const rows = [];
try {
  for (let repetition = 1; repetition <= 3; repetition++) {
    for (const mode of repetition % 2 ? ['off', 'on'] : ['on', 'off']) {
      const directory = path.join(temp, `${repetition}-${mode}`);
      for (const task of tasks) {
        const calls = [];
        const base = mistral(key);
        const model = { async complete(messages, options) {
          const response = await base.complete(messages, options);
          calls.push(...(response.toolCalls || []).map(call => ({ name: call.name, arguments: call.arguments })));
          return response;
        } };
        const started = Date.now();
        let row;
        try {
          const result = await explore({ root, objective: task.objective, model, codeMode: true, budget, ...(mode === 'on' ? { memory: { directory } } : {}) });
          let library = [];
          if (mode === 'on') { const files = await readdir(directory).catch(() => []); if (files.length) library = JSON.parse(await readFile(path.join(directory, files[0]), 'utf8')); }
          row = { repetition, mode, task: task.id, result, library, calls, wallTimeMs: Date.now() - started };
        } catch (error) { row = { repetition, mode, task: task.id, error: String(error.message).replaceAll(key, '[redacted]'), calls, wallTimeMs: Date.now() - started }; }
        rows.push(row);
        await writeFile(output, JSON.stringify({ timestamp: new Date().toISOString(), model: 'mistral-small-latest', commit, tasks, budget, rows }, null, 2));
        console.log(JSON.stringify({ repetition, mode, task: task.id, status: row.result?.status ?? 'error', calls: calls.map(c => c.name), scripts: row.library?.length, reuses: row.result?.metrics.memoryReuses }));
      }
    }
  }
} finally { await rm(temp, { recursive: true, force: true }); }
