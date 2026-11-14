import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';

const base = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const options = { args: [], repetitions: 3, timeout: 120000 };
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
if (!options.adapter || !options.output || !Number.isInteger(options.repetitions) || options.repetitions < 1 || !Number.isInteger(options.timeout) || options.timeout < 1) {
  throw new Error('Usage: node run.mjs --adapter executable --output new-directory [--arg value] [--budget budget.json] [--repetitions 3] [--timeout-ms 120000]');
}
const tasks = JSON.parse(await readFile(path.join(base, 'tasks.json'), 'utf8'));
const budget = { iterations: 8, calls: 32, tokens: 32000, durationMs: 60000, ...(options.budget ? JSON.parse(await readFile(options.budget, 'utf8')) : {}) };
if (Object.values(budget).some(value => !Number.isFinite(value) || value <= 0)) throw new Error('Budgets must be positive numbers');
const fingerprint = {};
for (const file of ['tasks.json', 'expected.json', 'workspace/src/math.js', 'workspace/src/catalog.js', 'workspace/src/order.js', 'workspace/src/api.js']) {
  fingerprint[file] = createHash('sha256').update(await readFile(path.join(base, file))).digest('hex');
}
const output = path.resolve(options.output);
await mkdir(output); // refuse to overwrite a previous experiment
const scratch = await mkdtemp(path.join(tmpdir(), 'codetour-benchmark-'));

function execute(command, argv, input, env = process.env) {
  return new Promise(resolve => {
    const started = performance.now();
    let stdout = '', bytes = 0, failure = null, finished = false;
    const decoder = new StringDecoder('utf8');
    const child = spawn(command, argv, { env, stdio: ['pipe', 'pipe', 'ignore'] });
    const timer = setTimeout(() => { failure = 'timeout'; child.kill('SIGKILL'); }, options.timeout);
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 4_000_000) { failure = 'output_limit'; child.kill('SIGKILL'); }
      else stdout += decoder.write(chunk);
    });
    child.on('error', () => { failure = 'spawn_error'; finish(null, null); });
    child.stdin.on('error', () => {});
    child.on('close', (code, signal) => finish(code, signal));
    child.stdin.end(input);
    function finish(code, signal) {
      if (finished) return;
      finished = true; clearTimeout(timer); stdout += decoder.end();
      resolve({ stdout, status: failure ?? (code === 0 ? 'ok' : 'process_error'), exitCode: code, signal, elapsedMs: performance.now() - started });
    }
  });
}

const rows = [];
try {
  for (let repetition = 1; repetition <= options.repetitions; repetition++) {
    for (const task of tasks) {
      const modes = repetition % 2 ? ['baseline', 'code-mode'] : ['code-mode', 'baseline'];
      for (const mode of modes) {
        const id = `${String(repetition).padStart(2, '0')}-${task.id}-${mode}`;
        const root = path.join(scratch, id);
        await cp(path.join(base, 'workspace'), root, { recursive: true });
        const request = { root, objective: task.objective, mode, budget };
        const run = await execute(options.adapter, [...options.args, mode], JSON.stringify(request), { ...process.env, EXPLORATION_MODE: mode });
        await writeFile(path.join(output, `${id}.stdout.json`), run.stdout);
        let result = null, assessment = null;
        if (run.status === 'ok') {
          try {
            result = JSON.parse(run.stdout);
            const evidence = result.evidence ?? ['entryPoints', 'components', 'relations'].flatMap(key => (result[key] ?? []).flatMap(item => item.evidence ?? []));
            const adaptedFile = path.join(scratch, `${id}.json`);
            await writeFile(adaptedFile, JSON.stringify({ taskId: task.id, evidence }));
            const evaluated = await execute(process.execPath, [path.join(base, 'evaluate.mjs'), adaptedFile, '--workspace', root], '');
            if (evaluated.status === 'ok') assessment = JSON.parse(evaluated.stdout);
            else run.status = 'evaluation_error';
          } catch { run.status = 'invalid_json_or_result'; }
        }
        const supplied = result?.metrics ?? {};
        const totalCalls = Number.isFinite(supplied.modelCalls) && Number.isFinite(supplied.toolCalls) ? supplied.modelCalls + supplied.toolCalls : supplied.calls;
        const usageKnown = supplied.usageAvailable !== false;
        const metrics = Object.fromEntries(Object.entries({ inputTokens: usageKnown ? supplied.inputTokens : null, outputTokens: usageKnown ? supplied.outputTokens : null, calls: totalCalls, modelCalls: supplied.modelCalls, toolCalls: supplied.toolCalls, durationMs: supplied.durationMs, cost: supplied.cost, volumeReturnedBytes: supplied.volumeReturnedBytes ?? supplied.outputBytes }).map(([key, value]) => [key, Number.isFinite(value) ? value : null]));
        const row = { id, repetition, taskId: task.id, mode, status: run.status, exitCode: run.exitCode, signal: run.signal, explorationStatus: result?.status ?? null, stopReason: result?.stopReason ?? null, wallTimeMs: run.elapsedMs, metrics, assessment, correctness: 'manual_review_required' };
        await writeFile(path.join(output, `${id}.meta.json`), JSON.stringify(row, null, 2) + '\n');
        rows.push(row);
      }
    }
  }
  const metricNames = ['inputTokens', 'outputTokens', 'calls', 'modelCalls', 'toolCalls', 'durationMs', 'cost', 'volumeReturnedBytes'];
  const summarize = runs => {
    const metrics = Object.fromEntries(metricNames.map(name => {
      const values = runs.map(row => row.metrics[name]).filter(value => value !== null).sort((a, b) => a - b);
      const n = values.length;
      return [name, n ? { available: n, missing: runs.length - n, median: n % 2 ? values[(n - 1) / 2] : (values[n / 2 - 1] + values[n / 2]) / 2, min: values[0], max: values[n - 1] } : { available: 0, missing: runs.length, median: null, min: null, max: null }];
    }));
    return { runs: runs.length, failed: runs.filter(run => run.status !== 'ok').length, partial: runs.filter(run => run.explorationStatus === 'partial').length, metrics };
  };
  const summary = Object.fromEntries(['baseline', 'code-mode'].map(mode => [mode, summarize(rows.filter(row => row.mode === mode))]));
  const byTask = Object.fromEntries(tasks.map(task => [task.id, Object.fromEntries(['baseline', 'code-mode'].map(mode => [mode, summarize(rows.filter(row => row.mode === mode && row.taskId === task.id))]))]));
  await writeFile(path.join(output, 'summary.json'), JSON.stringify({ repetitions: options.repetitions, budget, fixtureSha256: fingerprint, runtime: process.version, model: process.env.MISTRAL_MODEL ?? null, timeoutMs: options.timeout, summary, byTask, runs: rows, verdict: 'non_concluant_sans_revue_manuelle' }, null, 2) + '\n');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
