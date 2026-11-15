import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';

const base = path.dirname(fileURLToPath(import.meta.url));
const options = { args: [], repetitions: 2, timeout: 120000 };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const value = args[i + 1];
  if (value === undefined) throw new Error(`Missing value for ${args[i]}`);
  if (args[i] === '--arg') options.args.push(value);
  else if (args[i] === '--adapter') options.adapter = value;
  else if (args[i] === '--output') options.output = value;
  else if (args[i] === '--budget') options.budget = value;
  else if (args[i] === '--repetitions') options.repetitions = Number(value);
  else if (args[i] === '--timeout-ms') options.timeout = Number(value);
  else throw new Error(`Unknown option ${args[i]}`);
}
if (!options.adapter || !options.output || !Number.isInteger(options.repetitions) || options.repetitions < 1 || !Number.isInteger(options.timeout) || options.timeout < 1) throw new Error('Usage: node run-memory.mjs --adapter executable --output new-directory [--arg value] [--budget file] [--repetitions 2] [--timeout-ms 120000]');
const tasks = JSON.parse(await readFile(path.join(base, 'tasks.json'), 'utf8'));
const budget = { iterations: 8, calls: 32, tokens: 32000, durationMs: 60000, ...(options.budget ? JSON.parse(await readFile(options.budget, 'utf8')) : {}) };
if (Object.values(budget).some(value => !Number.isFinite(value) || value <= 0)) throw new Error('Budgets must be positive numbers');
const orders = [
  ['function', 'class', 'flow', ...Array(6).fill(['class', 'flow']).flat(), 'function'],
  ['function', 'flow', 'class', ...Array(6).fill(['flow', 'class']).flat(), 'function']
];
const fingerprint = {};
for (const file of ['tasks.json', 'expected.json', 'workspace/src/math.js', 'workspace/src/catalog.js', 'workspace/src/order.js', 'workspace/src/api.js']) fingerprint[file] = createHash('sha256').update(await readFile(path.join(base, file))).digest('hex');
const output = path.resolve(options.output);
await mkdir(output); // keep earlier experiments immutable
const scratch = await mkdtemp(path.join(tmpdir(), 'codetour-memory-benchmark-'));

function execute(command, argv, input, env = process.env) {
  return new Promise(resolve => {
    const started = performance.now(), decoder = new StringDecoder('utf8');
    let stdout = '', bytes = 0, failure = null, finished = false;
    const child = spawn(command, argv, { env, stdio: ['pipe', 'pipe', 'ignore'] });
    const timer = setTimeout(() => { failure = 'timeout'; child.kill('SIGKILL'); }, options.timeout);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 4_000_000) { failure = 'output_limit'; child.kill('SIGKILL'); } else stdout += decoder.write(chunk); });
    child.on('error', () => { failure = 'spawn_error'; finish(null, null); });
    child.stdin.on('error', () => {});
    child.on('close', (code, signal) => finish(code, signal));
    child.stdin.end(input);
    function finish(code, signal) {
      if (finished) return;
      finished = true; clearTimeout(timer); stdout += decoder.end();
      resolve({ stdout, status: failure ?? (code === 0 ? 'ok' : 'process_error'), exitCode: code, signal, wallTimeMs: performance.now() - started });
    }
  });
}

const rows = [];
try {
  for (let repetition = 1; repetition <= options.repetitions; repetition++) {
    for (let order = 0; order < orders.length; order++) {
      for (const mode of (repetition + order) % 2 ? ['memory-off', 'memory-on'] : ['memory-on', 'memory-off']) {
        const prefix = `r${repetition}-o${order + 1}-${mode}`;
        const root = path.join(scratch, `${prefix}-workspace`);
        const memoryDirectory = path.join(scratch, `${prefix}-memory`);
        await cp(path.join(base, 'workspace'), root, { recursive: true });
        await mkdir(memoryDirectory); // a fresh library for each sequence
        const sequence = [...orders[order], 'function'];
        for (let index = 0; index < sequence.length; index++) {
          const changed = index === sequence.length - 1;
          if (changed) {
            const file = path.join(root, 'src/math.js');
            const original = await readFile(file, 'utf8');
            const updated = original.replace('return price * quantity;', 'return quantity * price;');
            if (updated === original) throw new Error('Fixture mutation did not apply');
            await writeFile(file, updated);
          }
          const task = tasks.find(item => item.id === sequence[index]);
          const id = `${prefix}-${String(index + 1).padStart(2, '0')}-${task.id}${changed ? '-changed' : ''}`;
          const request = { root, objective: task.objective, mode, budget, ...(mode === 'memory-on' ? { memoryDirectory } : {}) };
          const run = await execute(options.adapter, [...options.args, mode], JSON.stringify(request), { ...process.env, EXPLORATION_MODE: mode });
          await writeFile(path.join(output, `${id}.stdout.json`), run.stdout);
          let result = null, assessment = null;
          if (run.status === 'ok') {
            try {
              result = JSON.parse(run.stdout);
              const evidence = result.evidence ?? ['entryPoints', 'components', 'relations'].flatMap(key => (result[key] ?? []).flatMap(item => item.evidence ?? []));
              const adapted = path.join(scratch, `${id}.json`);
              await writeFile(adapted, JSON.stringify({ taskId: task.id, evidence }));
              const evaluated = await execute(process.execPath, [path.join(base, 'evaluate.mjs'), adapted, '--workspace', root], '');
              if (evaluated.status === 'ok') assessment = JSON.parse(evaluated.stdout);
              else run.status = 'evaluation_error';
            } catch { run.status = 'invalid_json_or_result'; }
          }
          const m = result?.metrics ?? {}, known = m.usageAvailable !== false;
          const metrics = Object.fromEntries(Object.entries({ inputTokens: known ? m.inputTokens : null, outputTokens: known ? m.outputTokens : null, modelCalls: m.modelCalls, toolCalls: m.toolCalls, durationMs: m.durationMs, cost: m.cost, outputBytes: m.outputBytes, memoryReuses: m.memoryReuses, memoryPurges: m.memoryPurges }).map(([key, value]) => [key, Number.isFinite(value) ? value : null]));
          const row = { id, repetition, order: order + 1, index: index + 1, taskId: task.id, scenario: changed ? 'changed-code' : 'sequence', mode, status: run.status, exitCode: run.exitCode, signal: run.signal, wallTimeMs: run.wallTimeMs, explorationStatus: result?.status ?? null, stopReason: result?.stopReason ?? null, metrics, assessment, correctness: 'manual_review_required' };
          await writeFile(path.join(output, `${id}.meta.json`), JSON.stringify(row, null, 2) + '\n');
          rows.push(row);
        }
      }
    }
  }
  const metricNames = ['inputTokens', 'outputTokens', 'modelCalls', 'toolCalls', 'durationMs', 'cost', 'outputBytes', 'memoryReuses', 'memoryPurges'];
  const summarize = runs => ({ runs: runs.length, failed: runs.filter(run => run.status !== 'ok').length, partial: runs.filter(run => run.explorationStatus === 'partial').length,
    metrics: Object.fromEntries(metricNames.map(name => {
      const values = runs.map(row => row.metrics[name]).filter(value => value !== null).sort((a, b) => a - b), n = values.length;
      return [name, { available: n, missing: runs.length - n, median: n ? n % 2 ? values[(n - 1) / 2] : (values[n / 2 - 1] + values[n / 2]) / 2 : null, min: n ? values[0] : null, max: n ? values[n - 1] : null, total: n === runs.length && n ? values.reduce((a, b) => a + b, 0) : null }];
    })) });
  const summary = Object.fromEntries(['memory-off', 'memory-on'].map(mode => [mode, summarize(rows.filter(row => row.mode === mode && row.scenario === 'sequence'))]));
  const byTask = Object.fromEntries(tasks.map(task => [task.id, Object.fromEntries(['memory-off', 'memory-on'].map(mode => [mode, summarize(rows.filter(row => row.taskId === task.id && row.mode === mode && row.scenario === 'sequence'))]))]));
  await writeFile(path.join(output, 'summary.json'), JSON.stringify({ repetitions: options.repetitions, orders, budget, fixtureSha256: fingerprint, runtime: process.version, model: process.env.MISTRAL_MODEL ?? null, timeoutMs: options.timeout, summary, byTask, runs: rows, costPerCorrectExploration: null, verdict: 'non_concluant_sans_revue_manuelle' }, null, 2) + '\n');
} finally { await rm(scratch, { recursive: true, force: true }); }
