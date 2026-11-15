import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explore } from '../../packages/exploration-poc/src/explore.ts';
import { scriptMemory } from '../../packages/exploration-poc/src/memory.ts';
import { mistral } from '../../packages/exploration-poc/src/mistral.ts';
import { runScript } from '../../packages/exploration-sandbox/index.js';
import { probeLiteralQuery } from '../../packages/exploration-poc/src/query-probe.mjs';
import { selectForTask } from './autoselect.mjs';

const base = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.EXPERIMENT_ROOT ? path.resolve(process.env.EXPERIMENT_ROOT) : path.join(base, 'workspace');
const output = process.argv[2];
if (!output) throw Error('Usage: node tour-memory-experiment.mjs OUTPUT');
const tasks = JSON.parse(await readFile(process.env.EXPERIMENT_TASKS || path.join(base, 'tour-tasks.json'), 'utf8'));
if (process.env.TRANSFER) tasks.push({ id: 'project-transfer', objective: 'Pour une étape du Project Tour, retrouve la définition de totalPrice, explique le calcul et donne le fichier et les lignes qui le prouvent.' });
const key = process.env.MISTRAL_API_KEY || execFileSync('security', ['find-generic-password', '-s', 'ai.mistral.vibe', '-a', 'MISTRAL_API_KEY', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const modelName = process.env.MISTRAL_MODEL || 'mistral-small-latest';
const budget = { iterations: Number(process.env.EXPERIMENT_ITERATIONS || 12), calls: Number(process.env.EXPERIMENT_CALLS || 40), tokens: Number(process.env.EXPERIMENT_TOKENS || 48000), durationMs: Number(process.env.EXPERIMENT_MS || 90000) };
if (Object.values(budget).some(value => !Number.isInteger(value) || value <= 0)) throw Error('Invalid budget');
const concludeRatio = process.env.CONCLUDE_RATIO ? Number(process.env.CONCLUDE_RATIO) : null;
if (concludeRatio !== null && !(concludeRatio > 0 && concludeRatio < 1)) throw Error('Invalid conclude ratio');
const repetitions = Number(process.env.EXPERIMENT_REPETITIONS || 2);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw Error('Invalid repetitions');
const commit = process.env.EXPERIMENT_ROOT ? execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() : null;
const rows = [];
await writeFile(output, JSON.stringify({ model: modelName, root, commit, budget, concludeRatio, repetitions, tasks, rows }), { flag: 'wx' });
const scratch = await mkdtemp(path.join(tmpdir(), 'tour-empty-memory-'));
try {
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    const modes = process.env.MODES ? process.env.MODES.split(',') : ['off', 'memory', 'guided'];
    if (modes.some(mode => !['off', 'classic_final', 'memory', 'guided', 'validated', 'primitives', 'primitives_final', 'memory_final', 'memory_guided_final', 'primitives_guided_final', 'memory_contract_final', 'primitives_contract_final', 'memory_selected_contract_final', 'memory_guided_dedup_final', 'memory_named_contract_final', 'primitives_named_contract_final', 'primitives_named_exclusive_contract_final', 'primitives_named_exclusive_compact_contract_final', 'primitives_scoped_named_exclusive_contract_final', 'primitives_named_exclusive_autoselect_contract_final', 'primitives_named_multi_autoselect_contract_final', 'primitives_scoped_named_exclusive_autoselect_contract_final', 'primitives_scoped_memoryonly_autoselect_contract_final'].includes(mode))) throw Error('Unknown mode');
    for (const mode of repetition % 2 ? modes : [...modes].reverse()) {
      const directory = path.join(scratch, `${repetition}-${mode}`);
      // The unique directory does not exist yet: no user or prior-run memory is touched.
      let primitiveCodes = [];
      if (mode.startsWith('primitives')) {
        const store = await scriptMemory(root, directory);
        const primitives = [
          { description: 'List workspace file paths; no parameters.', code: 'list()', parameters: [] },
          mode.includes('_scoped_') ? { description: 'Find literal occurrences, optionally by path prefix and page; inputs query, pathPrefix, offset.', code: 'search(params.query,{pathPrefix:params.pathPrefix||"",offset:params.offset||0,limit:10})', parameters: ['query', 'pathPrefix', 'offset'] } : { description: 'Find literal occurrences; input query.', code: 'search(params.query)', parameters: ['query'] },
          { description: 'Read a numbered source range; inputs file, start, end.', code: 'read(params.file,params.start,params.end)', parameters: ['file', 'start', 'end'] }
        ];
        primitiveCodes = primitives.map(entry => entry.code);
        await store.finish([], primitives.map(entry => ({ ...entry, objective: 'Composable repository primitive', verified: false })));
      }
      for (const task of tasks) {
        let selectedId = null;
        let selectedTerm = null;
        let selectedHits = null;
        let selectedPrefix = null;
        let selectionTools;
        let selectionMs = 0;
        if (mode.includes('_autoselect_')) {
          const start = Date.now();
          const store = await scriptMemory(root, directory);
          const selection = await selectForTask(store, root, task.objective, probeLiteralQuery, { primitiveCodes });
          selectedId = selection.query?.id ?? null;
          selectedTerm = selection.query?.term ?? null;
          selectedHits = selection.query?.hits ?? null;
          selectedPrefix = selection.query?.pathPrefix ?? null;
          selectionMs = Date.now() - start;
          if (mode.includes('_multi_')) selectionTools = selection.namedTools;
        } else if ((mode === 'memory_selected_contract_final' && task.id === 'project-transfer') || mode.includes('_named_')) {
          const start = Date.now();
          const store = await scriptMemory(root, directory);
          for (const entry of store.catalog()) {
            if (!entry.parameters.includes('query') || entry.parameters.some(p => !['query', ...(mode.includes('_scoped_') ? ['pathPrefix', 'offset'] : [])].includes(p))) continue;
            const source = store.get(entry.id);
            if ((await probeLiteralQuery(source.code, store.sources())).status === 'pass') { selectedId = entry.id; break; }
          }
          selectionMs = Date.now() - start;
        }
        const calls = [];
        let modelCalls = 0;
        const validationFeedback = [];
        const feedbackSeen = new Set();
        const observedUsage = { inputTokens: 0, outputTokens: 0, responsesMissingUsage: 0 };
        const exclusive = mode.includes('_exclusive_') && !!selectedId;
        const memoryOnly = mode.includes('_memoryonly_');
        const underlying = mistral(key, modelName, {
          ...(mode.includes('_named_') && selectedId ? { memorySearchId: selectedId, memorySearchExclusive: exclusive, memorySearchScoped: mode.includes('_scoped_'), ...(selectionTools?.length ? { memoryTools: selectionTools } : {}) } : {}),
          ...(memoryOnly ? { removeSearch: true, removeCode: true } : {})
        });
        const model = { async complete(messages, options) {
          for (const message of messages) {
            if (message.role !== 'tool' || feedbackSeen.has(message.tool_call_id)) continue;
            feedbackSeen.add(message.tool_call_id);
            try { const value = JSON.parse(message.content); if (value.memoryValidation) validationFeedback.push(value.memoryValidation); } catch { /* Not a contract validation result. */ }
          }
          let adjusted = !mode.includes('guided') ? messages : messages.map((message, index) => index ? message : { ...message, content: message.content + ' For a useful reusable primitive composition, use code with remember=true and a generic description. Keep the changing symbol in params.query. Return bounded, numbered evidence for both definitions and usages. search takes one literal string and returns {file,line,text}; read returns {file,start,lines}. For example a composed expression may search(params.query), select a few hits, then read nearby lines. Do not assume a relation merely from a matching name. On the next task, reuse a relevant stored function with new inputs; inspect additional evidence if needed.' });
          if (exclusive) adjusted = adjusted.map((message, index) => index ? message : { ...message, content: message.content.split(' Script memory is enabled.')[0] + ' A reusable literal search is available as memory_search. Use list and read to inspect the workspace, and record unresolved gaps.' });
          if (mode.includes('_compact_')) adjusted = adjusted.map((message, index) => index ? message : { ...message, content: message.content + ' Search output is bounded and may omit matches; use exact search terms and read source lines to verify. Identical repeated searches refer to their earlier output.' });
          if (mode.includes('_scoped_')) adjusted = adjusted.map((message, index) => index ? message : { ...message, content: message.content + ' Search is literal and paginated. Use optional pathPrefix to narrow searches based on evidence, and use offset if hasMore is true. A path prefix must be a workspace-relative path. Read relevant source lines to verify claims.' });
          if (selectedId && mode === 'memory_selected_contract_final') adjusted = adjusted.map((message, index) => index ? message : { ...message, content: message.content + ` For the initial literal lookup, reuse memory_run with id ${selectedId} and params {"query":"totalPrice"}; read any extra context needed and verify evidence.` });
          if (selectedId && mode.includes('_named_')) adjusted = adjusted.map((message, index) => index ? message : { ...message, content: message.content + ' The memory_search tool is a reusable script tested on small synthetic probes. Use it for relevant literal searches; choose the query based on the task. Read additional evidence if needed.' });
          if (selectedTerm && mode.includes('_autoselect_')) {
            const params = { query: selectedTerm, ...(selectedPrefix ? { pathPrefix: selectedPrefix } : {}) };
            const call = mode.includes('_named_') ? `memory_search with ${JSON.stringify(params)}` : `memory_run with id ${selectedId} and params ${JSON.stringify(params)}`;
            adjusted = adjusted.map((message, index) => index ? message : { ...message, content: message.content + ` Start by calling ${call}: a probe-tested reusable search with ${selectedHits} whole-word matches in this workspace. Then read the cited lines to verify claims.` });
          }
          modelCalls++;
          const shouldConclude = mode.endsWith('_final') && (modelCalls === budget.iterations || (concludeRatio !== null && observedUsage.inputTokens + observedUsage.outputTokens >= budget.tokens * concludeRatio));
          const messagesWithReminder = shouldConclude ? [...adjusted, { role: 'user', content: 'This is the final model call. Return the required JSON now, without further tool calls. Cite only evidence already observed; explicitly list every missing fact or uncertain relation in uncertainties. Use empty arrays when needed; never invent evidence.' }] : adjusted;
          const response = await underlying.complete(messagesWithReminder, options);
          if (exclusive && response.toolCalls?.some(call => ['search', 'code'].includes(call.name))) throw Error('Model called a tool unavailable in this experiment');
          // In memory-only mode a stray search/code call degrades to a tool error and the model recovers.
          if (response.usage) { observedUsage.inputTokens += response.usage.inputTokens; observedUsage.outputTokens += response.usage.outputTokens; }
          else observedUsage.responsesMissingUsage++;
          calls.push(...(response.toolCalls || []).map(call => ({ name: call.name, arguments: call.arguments })));
          return response;
        } };
        let row;
        try {
          const noMemory = mode === 'off' || mode === 'classic_final';
          const result = await explore({ root, objective: task.objective, model, budget, codeMode: mode !== 'classic_final', ...(noMemory ? {} : { memory: { directory, validateQuery: mode === 'validated' || mode.startsWith('primitives') || mode.endsWith('_final'), queryContract: mode.includes('_contract_'), deduplicate: mode.includes('_dedup_'), compactSearch: mode.includes('_compact_') } }) });
          let library = [];
          if (!noMemory) {
            const files = await readdir(directory).catch(() => []);
            if (files.length) library = JSON.parse(await readFile(path.join(directory, files[0]), 'utf8'));
          }
          const probes = [];
          for (const entry of (process.env.EXPERIMENT_ROOT ? [] : library.filter(entry => entry.parameters.includes('query')))) {
            for (const query of ['totalPrice', 'Catalog', 'unseen_missing_902']) {
              try { const value = await runScript({ workspace: root, code: entry.code, params: { query } }); probes.push({ id: entry.id, query, value }); }
              catch (error) { probes.push({ id: entry.id, query, error: String(error.message) }); }
            }
          }
          row = { repetition, mode, task: task.id, selectedId, selectedTerm, selectedHits, selectedPrefix, namedTools: selectionTools?.map(tool => tool.name) ?? null, selectionMs, result, calls, library, probes, validationFeedback };
        } catch (error) { row = { repetition, mode, task: task.id, selectedId, selectedTerm, selectedHits, selectedPrefix, namedTools: selectionTools?.map(tool => tool.name) ?? null, selectionMs, error: String(error.message).replaceAll(key, '[redacted]'), observedUsage, calls, validationFeedback }; }
        rows.push(row);
        await writeFile(output, JSON.stringify({ model: modelName, root, commit, budget, concludeRatio, repetitions, tasks, rows }, null, 2) + '\n');
        console.log(JSON.stringify({ repetition, mode, task: task.id, status: row.result?.status ?? 'error', scripts: row.library?.length, reused: row.result?.metrics.memoryReuses, selectedTerm: row.selectedTerm ?? null }));
      }
    }
  }
} finally { await rm(scratch, { recursive: true, force: true }); }
