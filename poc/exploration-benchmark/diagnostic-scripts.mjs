import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explore } from '../../packages/exploration-poc/src/explore.ts';
import { mistral } from '../../packages/exploration-poc/src/mistral.ts';

const base = path.dirname(fileURLToPath(import.meta.url));
const output = process.argv[2];
if (!output) throw new Error('Provide a new output file');
const key = process.env.MISTRAL_API_KEY || execFileSync('security', ['find-generic-password', '-s', 'ai.mistral.vibe', '-a', 'MISTRAL_API_KEY', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const scratch = await mkdtemp(path.join(tmpdir(), 'codetour-script-diagnostic-'));
const root = path.join(scratch, 'workspace'), directory = path.join(scratch, 'memory');
const records = [];
try {
  await cp(path.join(base, 'workspace'), root, { recursive: true });
  await mkdir(directory);
  const objectives = process.env.DIAGNOSTIC_TRANSFER ? [
    'Comment totalPrice calcule-t-elle son résultat ?',
    'Quelles dépendances la classe Catalog utilise-t-elle et où ?',
    'Quel est le flux de postOrder jusqu’au calcul du total ?'
  ] : [
    'Comment totalPrice calcule-t-elle son résultat ? Pour cette expérience, utilise obligatoirement code avec un script paramétré et remember=true pour rechercher totalPrice, puis cite les lignes pertinentes.',
    'Comment totalPrice calcule-t-elle son résultat ? Utilise le script enregistré si pertinent puis cite les lignes pertinentes.'
  ];
  for (const objective of objectives) {
    const trace = [];
    const underlying = mistral(key);
    const model = { async complete(messages, options) {
      const response = await underlying.complete(messages, options);
      trace.push({ calls: response.toolCalls ?? [], toolMessages: messages.filter(m => m.role === 'tool').slice(-8) });
      return response;
    } };
    try {
      const result = await explore({ root, objective, model, codeMode: true, memory: { directory }, budget: { iterations: 12, calls: 40, tokens: 48000, durationMs: 60000 } });
      const files = await readdir(directory);
      const library = files.length ? JSON.parse(await readFile(path.join(directory, files[0]), 'utf8')) : [];
      records.push({ result, trace, library });
    } catch (e) { records.push({ error: String(e.message).replaceAll(key, '[redacted]'), trace }); }
  }
  await writeFile(output, JSON.stringify({ model: 'mistral-small-latest', records }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(records.map(r => ({ status: r.result?.status ?? 'error', calls: r.trace.flatMap(t => t.calls.map(c => c.name)), scripts: r.library?.length, reuses: r.result?.metrics.memoryReuses }))));
} finally { await rm(scratch, { recursive: true, force: true }); }
