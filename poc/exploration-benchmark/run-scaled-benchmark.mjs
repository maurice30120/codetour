/**
 * Scaled Benchmark Runner for Spec #172
 * 
 * Executes 20 runs per solution (POC and Vibe) with two independent series:
 * - Repetition series: Same questions repeated (10 runs)
 * - Transfer series: New but related questions (10 runs)
 * 
 * For POC: Memory preserved within series, reset between series
 * For Vibe: Sessions isolated between runs
 * 
 * Tracks all required metrics:
 * - Tokens (input/output/cache)
 * - Model calls, tool calls, duration, output bytes
 * - Functions created/reused/replaced
 * - Quality and coverage of proofs
 * - Failures
 * 
 * Usage:
 *   node run-scaled-benchmark.mjs \
 *     --adapter-poc "node" \
 *     --arg-poc "poc/exploration-benchmark/mistral-adapter.mjs" \
 *     --adapter-vibe "node" \
 *     --arg-vibe "poc/exploration-benchmark/vibe-adapter.mjs" \
 *     --output /tmp/scaled-benchmark-results \
 *     --runs-per-series 10
 */

import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';

const base = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const NUM_RUNS_PER_SERIES = 10;
const SERIES_TYPES = ['repetition', 'transfer'];
const SOLUTIONS = ['poc', 'vibe'];

// Default budget
const DEFAULT_BUDGET = {
  iterations: 8,
  calls: 32,
  tokens: 32000,
  durationMs: 60000
};

// Decode command line arguments
const args = process.argv.slice(2);
const options = {
  timeout: 120000,
  output: null,
  budget: null,
  runsPerSeries: NUM_RUNS_PER_SERIES,
  adapters: {}
};

let i = 0;
while (i < args.length) {
  const arg = args[i];
  const value = args[i + 1];
  
  if (arg.startsWith('--adapter-')) {
    const solution = arg.replace('--adapter-', '');
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    options.adapters[solution] = { executable: value };
    i += 2;
  } else if (arg.startsWith('--arg-')) {
    const solution = arg.replace('--arg-', '');
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    if (!options.adapters[solution]) {
      options.adapters[solution] = { executable: null };
    }
    if (!options.adapters[solution].args) {
      options.adapters[solution].args = [];
    }
    options.adapters[solution].args.push(value);
    i += 2;
  } else if (arg === '--output') {
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    options.output = value;
    i += 2;
  } else if (arg === '--budget') {
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    options.budget = value;
    i += 2;
  } else if (arg === '--runs-per-series') {
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    options.runsPerSeries = Number(value);
    i += 2;
  } else if (arg === '--timeout-ms') {
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    options.timeout = Number(value);
    i += 2;
  } else {
    throw new Error(`Unknown option ${arg}`);
  }
}

// Validate required options
if (!options.output || !Number.isInteger(options.runsPerSeries) || options.runsPerSeries < 1 || 
    !Number.isInteger(options.timeout) || options.timeout < 1) {
  throw new Error('Usage: node run-scaled-benchmark.mjs --output new-directory [--budget budget.json] [--runs-per-series 10] [--timeout-ms 120000] [--adapter-poc executable --arg-poc value] [--adapter-vibe executable --arg-vibe value]');
}

// Validate that we have adapters for all solutions
for (const solution of SOLUTIONS) {
  if (!options.adapters[solution] || !options.adapters[solution].executable) {
    throw new Error(`Missing adapter for solution: ${solution}. Use --adapter-${solution} and --arg-${solution}`);
  }
}

// Load tasks
const repetitionTasks = JSON.parse(await readFile(path.join(base, 'tasks.json'), 'utf8'));

// Create transfer tasks - new but related questions
const transferTasks = [
  {
    "id": "dependencies",
    "objective": "Quelles sont toutes les dépendances entre les modules de ce répertoire ?"
  },
  {
    "id": "error-handling",
    "objective": "Comment ce code gère-t-il les erreurs de recherche dans le catalogue ?"
  },
  {
    "id": "data-flow",
    "objective": "Quel est le flux de données de la requête postOrder jusqu'à la réponse finale ?"
  }
];

// Load budget
const budget = {
  ...DEFAULT_BUDGET,
  ...(options.budget ? JSON.parse(await readFile(options.budget, 'utf8')) : {})
};

if (Object.values(budget).some(value => !Number.isFinite(value) || value <= 0)) {
  throw new Error('Budgets must be positive numbers');
}

// Compute fingerprints for reproducibility
const fingerprint = {};
for (const file of ['tasks.json', 'expected.json', 'workspace/src/math.js', 'workspace/src/catalog.js', 'workspace/src/order.js', 'workspace/src/api.js']) {
  fingerprint[file] = createHash('sha256').update(await readFile(path.join(base, file))).digest('hex');
}

const output = path.resolve(options.output);
await mkdir(output);
const scratch = await mkdtemp(path.join(tmpdir(), 'codetour-scaled-benchmark-'));

/**
 * Execute a command with input and capture output
 */
function execute(command, argv, input, env = process.env) {
  return new Promise(resolve => {
    const started = performance.now();
    let stdout = '', bytes = 0, failure = null, finished = false;
    const decoder = new StringDecoder('utf8');
    const child = spawn(command, argv, { env, stdio: ['pipe', 'pipe', 'ignore'] });
    const timer = setTimeout(() => { 
      failure = 'timeout'; 
      child.kill('SIGKILL'); 
    }, options.timeout);
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 4_000_000) { 
        failure = 'output_limit'; 
        child.kill('SIGKILL'); 
      } else {
        stdout += decoder.write(chunk);
      }
    });
    child.on('error', () => { 
      failure = 'spawn_error'; 
      finish(null, null); 
    });
    child.stdin.on('error', () => {});
    child.on('close', (code, signal) => finish(code, signal));
    child.stdin.end(input);
    
    function finish(code, signal) {
      if (finished) return;
      finished = true; 
      clearTimeout(timer); 
      stdout += decoder.end();
      resolve({
        stdout, 
        status: failure ?? (code === 0 ? 'ok' : 'process_error'), 
        exitCode: code, 
        signal, 
        wallTimeMs: performance.now() - started 
      });
    }
  });
}

/**
 * Extract metrics from result
 */
function extractMetrics(result, supplied = {}) {
  const usageKnown = supplied.usageAvailable !== false;
  const totalCalls = Number.isFinite(supplied.modelCalls) && Number.isFinite(supplied.toolCalls) 
    ? supplied.modelCalls + supplied.toolCalls 
    : supplied.calls;
  
  return Object.fromEntries(Object.entries({
    inputTokens: usageKnown ? supplied.inputTokens : null,
    outputTokens: usageKnown ? supplied.outputTokens : null,
    cacheTokens: usageKnown ? supplied.cacheTokens : null,
    modelCalls: supplied.modelCalls,
    toolCalls: supplied.toolCalls,
    totalCalls,
    durationMs: supplied.durationMs,
    cost: supplied.cost,
    outputBytes: supplied.outputBytes ?? supplied.volumeReturnedBytes,
    functionsCreated: supplied.functionsCreated,
    functionsReused: supplied.functionsReused,
    functionsReplaced: supplied.functionsReplaced,
    memoryReuses: supplied.memoryReuses,
    memoryPurges: supplied.memoryPurges
  }).map(([key, value]) => [key, Number.isFinite(value) ? value : null]));
}

/**
 * Run evaluation on a result
 */
async function evaluateResult(result, root, taskId, outputDir) {
  let assessment = null;
  if (result.status === 'ok') {
    try {
      const parsedResult = JSON.parse(result.stdout);
      const evidence = parsedResult.evidence ?? ['entryPoints', 'components', 'relations'].flatMap(
        key => (parsedResult[key] ?? []).flatMap(item => item.evidence ?? [])
      );
      
      const adaptedFile = path.join(scratch, `${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      await writeFile(adaptedFile, JSON.stringify({ taskId, evidence }));
      
      const evaluated = await execute(process.execPath, [
        path.join(base, 'evaluate.mjs'), 
        adaptedFile, 
        '--workspace', 
        root
      ], '');
      
      if (evaluated.status === 'ok') {
        assessment = JSON.parse(evaluated.stdout);
      } else {
        return { ...result, status: 'evaluation_error' };
      }
    } catch {
      return { ...result, status: 'invalid_json_or_result' };
    }
  }
  return { result, assessment };
}

/**
 * Run a single benchmark iteration
 */
async function runIteration(iterationConfig) {
  const {
    solution,
    series,
    seriesIndex,
    runIndex,
    task,
    mode,
    root,
    memoryDirectory,
    adapterConfig
  } = iterationConfig;
  
  const id = `s${seriesIndex+1}-r${runIndex+1}-${solution}-${series}-${task.id}`;
  
  // For POC, use the mode directly
  // For Vibe, construct the mode with series info
  const actualMode = solution === 'poc' ? mode : `vibe-${series}`;
  
  const request = {
    root,
    objective: task.objective,
    mode: actualMode,
    budget,
    ...(memoryDirectory ? { memoryDirectory } : {})
  };
  
  // Generate unique session ID for Vibe isolation
  const env = {
    ...process.env,
    EXPLORATION_MODE: actualMode,
    ...(solution === 'vibe' ? { VIBE_SESSION_ID: `${id}-${Date.now()}` } : {})
  };
  
  const run = await execute(
    adapterConfig.executable,
    [...(adapterConfig.args || []), actualMode],
    JSON.stringify(request),
    env
  );
  
  await writeFile(path.join(output, `${id}.stdout.json`), run.stdout);
  
  let result = null;
  let assessment = null;
  let metrics = {};
  
  if (run.status === 'ok') {
    try {
      const parsedResult = JSON.parse(run.stdout);
      const { assessment: evalAssessment } = await evaluateResult(run, root, task.id, output);
      assessment = evalAssessment;
      metrics = extractMetrics(run, parsedResult?.metrics ?? {});
      result = parsedResult;
    } catch {
      run.status = 'invalid_json_or_result';
    }
  }
  
  const row = {
    id,
    solution,
    series,
    seriesIndex,
    runIndex,
    taskId: task.id,
    mode: actualMode,
    status: run.status,
    exitCode: run.exitCode,
    signal: run.signal,
    wallTimeMs: run.wallTimeMs,
    explorationStatus: result?.status ?? null,
    stopReason: result?.stopReason ?? null,
    metrics,
    assessment,
    correctness: 'manual_review_required'
  };
  
  await writeFile(path.join(output, `${id}.meta.json`), JSON.stringify(row, null, 2) + '\n');
  return row;
}

/**
 * Main benchmark execution
 */
async function main() {
  const rows = [];
  
  try {
    // For each repetition (outer loop for statistical significance)
    for (let repetition = 1; repetition <= 1; repetition++) { // Start with 1 repetition for testing
      
      // For each solution
      for (const solution of SOLUTIONS) {
        
        // For each series (repetition and transfer)
        for (const series of SERIES_TYPES) {
          
          const tasks = series === 'repetition' ? repetitionTasks : transferTasks;
          const isTransfer = series === 'transfer';
          const seriesIndex = SERIES_TYPES.indexOf(series);
          
          // For POC: create memory directory that persists within series
          // For Vibe: each run gets isolated session (handled by adapter)
          let memoryDirectory = null;
          
          if (solution === 'poc' && series === 'repetition') {
            // Create a memory directory for this series
            memoryDirectory = path.join(scratch, `poc-memory-${repetition}-${series}`);
            await mkdir(memoryDirectory, { recursive: true });
          }
          
          // Run the series
          for (let runIndex = 0; runIndex < options.runsPerSeries; runIndex++) {
            
            for (const task of tasks) {
              
              // For POC: reset memory for transfer series
              if (solution === 'poc' && isTransfer) {
                memoryDirectory = null;
              }
              
              // For POC: use memory-on for repetition, memory-off or new memory for transfer
              const mode = solution === 'poc' ? (isTransfer ? 'memory-off' : 'memory-on') : 'baseline';
              
              // Create fresh workspace for each run
              const root = path.join(scratch, `s${seriesIndex+1}-r${runIndex+1}-${solution}-${series}-${task.id}-workspace`);
              await cp(path.join(base, 'workspace'), root, { recursive: true });
              
              // For POC with memory, create run-specific memory if in transfer series
              if (solution === 'poc' && isTransfer) {
                memoryDirectory = path.join(scratch, `poc-memory-${repetition}-${series}-${runIndex}-${task.id}`);
                await mkdir(memoryDirectory, { recursive: true });
              }
              
              const iterationConfig = {
                solution,
                series,
                seriesIndex,
                runIndex,
                task,
                mode,
                root,
                memoryDirectory,
                adapterConfig: options.adapters[solution]
              };
              
              const row = await runIteration(iterationConfig);
              rows.push(row);
              
              // Clean up workspace after each run
              await rm(root, { recursive: true, force: true });
              
              // For POC with memory in transfer series: clean up memory after each run
              if (solution === 'poc' && isTransfer && memoryDirectory) {
                await rm(memoryDirectory, { recursive: true, force: true });
              }
            }
          }
          
          // Clean up series memory for POC repetition series
          if (solution === 'poc' && series === 'repetition' && memoryDirectory) {
            await rm(memoryDirectory, { recursive: true, force: true });
          }
        }
      }
    }
    
    // Generate summary
    const metricNames = [
      'inputTokens', 'outputTokens', 'cacheTokens',
      'modelCalls', 'toolCalls', 'totalCalls',
      'durationMs', 'cost', 'outputBytes',
      'functionsCreated', 'functionsReused', 'functionsReplaced',
      'memoryReuses', 'memoryPurges'
    ];
    
    const summarize = (runs) => {
      const metrics = Object.fromEntries(metricNames.map(name => {
        const values = runs
          .map(row => row.metrics[name])
          .filter(value => value !== null)
          .sort((a, b) => a - b);
        const n = values.length;
        return [name, n ? {
          available: n,
          missing: runs.length - n,
          median: n % 2 ? values[(n - 1) / 2] : (values[n / 2 - 1] + values[n / 2]) / 2,
          min: values[0],
          max: values[n - 1],
          total: values.reduce((a, b) => a + b, 0)
        } : { available: 0, missing: runs.length, median: null, min: null, max: null, total: null }];
      }));
      
      return {
        runs: runs.length,
        failed: runs.filter(run => run.status !== 'ok').length,
        partial: runs.filter(run => run.explorationStatus === 'partial').length,
        metrics
      };
    };
    
    // Summarize by solution and series
    const summary = {};
    for (const solution of SOLUTIONS) {
      summary[solution] = {};
      for (const series of SERIES_TYPES) {
        summary[solution][series] = summarize(
          rows.filter(row => row.solution === solution && row.series === series)
        );
      }
    }
    
    // Summarize by task
    const allTasks = [...repetitionTasks, ...transferTasks];
    const byTask = Object.fromEntries(allTasks.map(task => [
      task.id,
      Object.fromEntries(SOLUTIONS.map(solution => [
        solution,
        Object.fromEntries(SERIES_TYPES.map(series => [
          series,
          summarize(rows.filter(row => 
            row.taskId === task.id && 
            row.solution === solution && 
            row.series === series
          ))
        ]))
      ]))
    ]));
    
    // Overall summary
    const overall = summarize(rows);
    
    await writeFile(
      path.join(output, 'summary.json'),
      JSON.stringify({
        repetitions: 1,
        runsPerSeries: options.runsPerSeries,
        totalRuns: rows.length,
        budget,
        fixtureSha256: fingerprint,
        runtime: process.version,
        model: process.env.MISTRAL_MODEL ?? null,
        vibeModel: process.env.VIBE_MODEL ?? null,
        timeoutMs: options.timeout,
        solutions: SOLUTIONS,
        seriesTypes: SERIES_TYPES,
        repetitionTasks,
        transferTasks,
        summary,
        byTask,
        overall,
        runs: rows,
        costPerCorrectExploration: null,
        verdict: 'non_concluant_sans_revue_manuelle'
      }, null, 2) + '\n'
    );
    
    console.log(`Benchmark completed: ${rows.length} runs executed`);
    console.log(`Output directory: ${output}`);
    console.log(`Summary written to: ${path.join(output, 'summary.json')}`);
    
  } finally {
    // Clean up temporary files
    await rm(scratch, { recursive: true, force: true });
  }
}

// Run main
main().catch(error => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
