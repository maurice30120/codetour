import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { screenPostgres } from './screen-postgres.mjs';

// Same PostgreSQL tasks and budgets as tour-memory-experiment.mjs
// (results-postgres-memoryonly-v2.json), but explored by the Vibe CLI agent
// itself in headless mode (vibe -p) with its native tools. The output JSON
// block uses the harness result schema so screenPostgres applies unchanged.
const base = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.EXPERIMENT_ROOT ? path.resolve(process.env.EXPERIMENT_ROOT) : '/private/tmp/postgres';
const output = process.argv[2];
if (!output) throw Error('Usage: node vibe-agent-postgres.mjs OUTPUT');
const tasks = JSON.parse(await readFile(path.join(base, 'postgres-tour-tasks.json'), 'utf8'));
const key = process.env.MISTRAL_API_KEY || execFileSync('security', ['find-generic-password', '-s', 'ai.mistral.vibe', '-a', 'MISTRAL_API_KEY', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const modelName = process.env.VIBE_AGENT_MODEL || 'mistral-small-latest';
const repetitions = Number(process.env.EXPERIMENT_REPETITIONS || 2);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw Error('Invalid repetitions');
// Parity with the memoryonly run: 160k tokens / 20 iterations / 180 s.
// Vibe has no tool-call cap flag; --max-turns approximates iterations.
const budget = { iterations: 20, tokens: 160000, durationMs: 180000, concludeRatio: 0.6, calls: 'not enforceable via vibe flags (recorded only)' };
const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const run = promisify(execFile);

const ENABLED_TOOLS = ['read_file', 'grep', 'bash', 'glob', 'list'];

function buildPrompt(objective) {
  return `Tu explores le dépôt courant (checkout PostgreSQL, commit ${commit.slice(0, 7)}, sources src/backend et src/include).

Objectif : ${objective}

Contraintes : au plus 20 tours et environ 160 000 tokens au total ; conclus dès que tu as suffisamment de preuves, sans remplissage. N'utilise ni skill, ni todo, ni task, ni ask_user_question : explore directement le code avec read_file, grep, bash, glob et list. Cite uniquement des extraits que tu as réellement lus dans les fichiers.${process.env.BOUNDED === '1' ? '\n\nGarde chaque sortie d\'outil courte : grep avec un motif précis et peu de résultats (tronque si besoin), read_file par plages de ~50 lignes avec offset/limit, évite list/bash sur de gros répertoires. Chaque sortie d\'outil est renvoyée dans le contexte à chaque tour : la verbosité fait exploser le budget.' : ''}

Termine ta réponse par un unique bloc JSON (délimité par \`\`\`json ... \`\`\`) avec exactement ce schéma :
{"objective": string, "entryPoints": [{"name": string, "evidence": [{"file": string, "startLine": number, "endLine": number}]}], "components": [{"name": string, "evidence": [{"file": string, "startLine": number, "endLine": number}]}], "relations": [{"from": string, "to": string, "evidence": [{"file": string, "startLine": number, "endLine": number}]}], "uncertainties": [string]}
- "file" est un chemin relatif au dépôt (ex. src/backend/tcop/postgres.c) ; startLine/endLine sont les lignes exactes de la preuve.
- relations : from/to sont des noms de fonctions ou de composants, chaque relation étayée par son evidence.
- uncertainties : liste explicite de tout fait non établi ou relation incertaine.
Ne mets aucun texte après le bloc JSON.`;
}

const rows = [];
const header = { method: 'vibe CLI headless (vibe -p, native tools, --auto-approve)', model: modelName, root, commit, budget, concludeRatio: 0.6, repetitions, tasks, rows };
await writeFile(output, JSON.stringify(header), { flag: 'wx' });
for (let repetition = 1; repetition <= repetitions; repetition++) {
  for (const task of tasks) {
    const outdir = await mkdtemp(path.join(tmpdir(), `vibe-pg-${task.id}-r${repetition}-`));
    const started = Date.now();
    let stdout = '', stderr = '', exitCode = 0, error = null;
    try {
      const args = ['-p', buildPrompt(task.objective), '--model', modelName, '--output', 'json', '--output-dir', outdir, '--max-turns', String(budget.iterations), '--max-tokens', String(budget.tokens), '--time-limit', String(budget.durationMs / 1000), '--auto-approve', '--trust', '--workdir', root];
      for (const tool of ENABLED_TOOLS) args.push('--enabled-tools', tool);
      const result = await run('vibe', args, { env: { ...process.env, MISTRAL_API_KEY: key }, maxBuffer: 64 * 1024 * 1024 });
      stdout = result.stdout;
    } catch (e) {
      exitCode = typeof e.code === 'number' ? e.code : 1;
      error = String(e.message).replaceAll(key, '[redacted]');
      stdout = e.stdout ?? '';
      stderr = String(e.stderr ?? '').replaceAll(key, '[redacted]');
    }
    let entries = [];
    try { const parsed = JSON.parse(stdout); if (Array.isArray(parsed)) entries = parsed; } catch { /* non-JSON stdout */ }
    let finalText = '';
    for (const entry of entries) {
      if (entry?.type === 'message' && entry.role === 'assistant' && Array.isArray(entry.content)) {
        for (const block of entry.content) if (block.type === 'text') finalText = block.text;
      }
    }
    // Tool calls are counted from the session journal: every model completion
    // whose parts contain a tool_call is one executed tool call.
    const toolCalls = [];
    try {
      const journal = path.join(outdir, 'session', 'journal');
      const collect = (value) => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) { value.forEach(collect); return; }
        if (value.type === 'tool_call' && typeof value.name === 'string') toolCalls.push(value.name);
        Object.values(value).forEach(collect);
      };
      for (const file of await readdir(journal).catch(() => [])) {
        if (!file.endsWith('.jsonl')) continue;
        for (const line of await readFile(path.join(journal, file), 'utf8').then(text => text.split('\n'))) {
          if (!line.trim()) continue;
          try { collect(JSON.parse(line)); } catch { /* partial line */ }
        }
      }
    } catch { /* journal missing */ }
    if (!finalText) {
      // Fallback: last text part in the journal.
      try {
        const journal = path.join(outdir, 'session', 'journal');
        for (const file of (await readdir(journal).catch(() => [])).reverse()) {
          if (!file.endsWith('.jsonl')) continue;
          const lines = (await readFile(path.join(journal, file), 'utf8')).split('\n').filter(Boolean).reverse();
          for (const line of lines) {
            const stack = [JSON.parse(line)];
            while (stack.length) {
              const value = stack.pop();
              if (value?.type === 'text' && typeof value.text === 'string' && value.text.trim()) { finalText = value.text; break; }
              if (value && typeof value === 'object') stack.push(...Object.values(value));
            }
            if (finalText) break;
          }
          if (finalText) break;
        }
      } catch { /* journal missing */ }
    }
    let result = null, parseError = null;
    const fences = [...finalText.matchAll(/```json\s*([\s\S]*?)```/g)].map(m => m[1].trim());
    for (const candidate of [...fences.reverse(), finalText.trim()]) {
      if (!candidate.startsWith('{')) continue;
      try { const parsed = JSON.parse(candidate); if (parsed && typeof parsed === 'object' && (parsed.entryPoints || parsed.relations || parsed.components)) { result = parsed; break; } } catch (e) { parseError = String(e.message); }
    }
    const status = result ? 'complete' : 'incomplete';
    const full = result ? { objective: task.objective, entryPoints: result.entryPoints ?? [], components: result.components ?? [], relations: result.relations ?? [], uncertainties: result.uncertainties ?? [], status } : null;
    const screen = screenPostgres(task.id, full);
    let exp = null;
    try { exp = JSON.parse(await readFile(path.join(outdir, 'export.json'), 'utf8')); } catch { /* export missing */ }
    const row = {
      repetition, mode: 'vibe-agent-headless', task: task.id, status, parseError,
      screen, result: full, finalTextTail: finalText.slice(-4000),
      toolCalls, toolCallCount: toolCalls.length,
      usage: exp?.usage ? { inputTokens: exp.usage.input_tokens, outputTokens: exp.usage.output_tokens, totalTokens: exp.usage.total_tokens, cachedInputTokens: exp.usage.cached_input_tokens ?? null, costUsd: exp.cost_usd } : null,
      steps: exp?.steps ?? null, stopReason: exp?.stop_reason ?? null, outcome: exp?.outcome ?? null,
      exitCode, wallTimeMs: Date.now() - started, outdir, error, stderrTail: stderr.slice(-400) || null
    };
    rows.push(row);
    await writeFile(output, JSON.stringify(header, null, 2) + '\n');
    console.log(JSON.stringify({ repetition, task: task.id, status, screen: screen.status, missing: screen.missing, inputTokens: row.usage?.inputTokens ?? null, outputTokens: row.usage?.outputTokens ?? null, toolCalls: row.toolCallCount, steps: row.steps, stop: row.stopReason, outcome: row.outcome, exitCode, wallMs: row.wallTimeMs }));
  }
}
