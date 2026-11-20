import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explore } from '../../packages/exploration-poc/src/explore.ts';
import { scriptMemory } from '../../packages/exploration-poc/src/memory.ts';
import { mistral } from '../../packages/exploration-poc/src/mistral.ts';
import { runScript } from '../../packages/exploration-sandbox/index.js';

const base = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(base, 'workspace');
const output = process.argv[2];
if (!output) throw Error('Usage: node toolbox-experiment.mjs output.json');
const tasks = JSON.parse(await readFile(path.join(base, 'tasks.json'), 'utf8'));
const candidates = [
  { description: 'Find literal occurrences of a symbol; query is the exact text.', code: 'search(params.query)', parameters: ['query'] },
  { description: 'Find up to 8 occurrences and read surrounding source lines. Inputs: query, radius (1 to 15).', code: 'search(params.query).slice(0,8).map(x => read(x.file, Math.max(1,x.line-Math.min(15,Math.max(1,params.radius || 5))), x.line+Math.min(15,Math.max(1,params.radius || 5))))', parameters: ['query', 'radius'] },
  { description: 'Find occurrences of several literal symbols. Input: queries, an array of up to 4 strings.', code: 'params.queries.slice(0,4).map(query => ({query, matches:search(query).slice(0,10)}))', parameters: ['queries'] },
];
// Validate that each function uses its input and returns source references before the paid runs.
const examples = [{query:'totalPrice'}, {query:'totalPrice',radius:3}, {queries:['totalPrice','postOrder']}];
for (let i = 0; i < candidates.length; i++) {
  const value = await runScript({ workspace: root, code: candidates[i].code, params: examples[i] });
  if (!JSON.stringify(value).includes('src/')) throw Error(`Candidate ${i} returned no source references`);
}
const key = process.env.MISTRAL_API_KEY || execFileSync('security', ['find-generic-password', '-s', 'ai.mistral.vibe', '-a', 'MISTRAL_API_KEY', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const modelName = process.env.MISTRAL_MODEL || 'mistral-small-latest';
const repetitions = Number(process.env.TOOLBOX_REPETITIONS || 2);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw Error('Invalid repetitions');
const budget = { iterations: 8, calls: 32, tokens: 32000, durationMs: 60000 };
const scratch = await mkdtemp(path.join(tmpdir(), 'codetour-toolbox-'));
const rows = [];
try {
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    for (const task of tasks) {
      const modes = repetition % 2 ? ['off', 'atomic', 'toolbox'] : ['toolbox', 'atomic', 'off'];
      for (const mode of modes) {
        const directory = path.join(scratch, `${repetition}-${task.id}-${mode}`);
        if (mode !== 'off') {
          const memory = await scriptMemory(root, directory);
          await memory.finish([], (mode === 'atomic' ? candidates.slice(0, 1) : candidates).map(c => ({ ...c, objective: 'Reusable repository exploration', verified: false })));
        }
        const calls = [];
        const baseModel = mistral(key, modelName);
        const model = { async complete(messages, options) {
          const response = await baseModel.complete(messages, options);
          calls.push(...(response.toolCalls || []).map(call => ({ name: call.name, arguments: call.arguments })));
          return response;
        } };
        let row;
        try {
          const result = await explore({ root, objective: task.objective, model, budget, codeMode: true, ...(mode === 'off' ? {} : { memory: { directory } }) });
          row = { repetition, task: task.id, mode, result, calls };
        } catch (error) { row = { repetition, task: task.id, mode, error: String(error.message).replaceAll(key, '[redacted]'), calls }; }
        rows.push(row);
        await writeFile(output, JSON.stringify({ timestamp: new Date().toISOString(), model: modelName, budget, candidates, rows }, null, 2) + '\n');
        console.log(JSON.stringify({ repetition, task: task.id, mode, status: row.result?.status ?? 'error', reuses: row.result?.metrics.memoryReuses, error: row.error }));
      }
    }
  }
} finally { await rm(scratch, { recursive: true, force: true }); }
