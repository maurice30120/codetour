import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { explore } from '../../packages/exploration-poc/src/explore.ts';
import { mistral } from '../../packages/exploration-poc/src/mistral.ts';
import { scriptMemory } from '../../packages/exploration-poc/src/memory.ts';

// Sequential exploratory diagnostic. API calls may incur charges.
// Second pass (generous budget): the first pass at 100k tokens stopped after
// ~13 model calls — the growing conversation alone consumes the ceiling before
// any function_try — and 4/10 runs died on a strict final-answer JSON parse
// (fixed in the harness: typed error + one visible recovery). The goal of this
// pass is to observe function creation and cross-tour reuse after
// reconciliation, so the ceilings are raised far above the expected need; the
// stop reason stays recorded whatever ends the run.
const root = resolve('.');
const output = resolve(process.argv[2] ?? '/tmp/codetour-spec183-ten-tickets-generous');
const memory = { directory: resolve(output, 'memory') };
const key = process.env.MISTRAL_API_KEY || execFileSync('security', ['find-generic-password', '-s', 'ai.mistral.vibe', '-a', 'MISTRAL_API_KEY', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const modelName = process.env.MISTRAL_MODEL || 'mistral-medium-3.5';
const budget = { iterations: 100, calls: 400, tokens: 2000000, durationMs: 1200000 };
const tasks = [
  [161, 'Explorer un dépôt avec LangGraph.js et Mistral', 'Explique comment le harnais orchestre les appels au modèle Mistral et les outils d’exploration, avec des références au code.'],
  [162, 'Explorer avec des scripts Code Mode confinés', 'Explique comment les scripts Code Mode sont compilés, confinés et exécutés, avec les limites et références au code.'],
  [163, 'Terminer une exploration sous budget avec des preuves vérifiées', 'Explique comment le harnais applique les budgets et vérifie les preuves avant de terminer une exploration.'],
  [164, 'Comparer le harnais avec et sans Code Mode', 'Identifie les chemins d’exécution avec et sans Code Mode et les différences observables dans le harnais.'],
  [165, 'Mémoriser et réexécuter un script utile', 'Explique comment une fonction utile est essayée, consolidée et réexécutée depuis la mémoire.'],
  [166, 'Appliquer les règles de rétention de la mémoire', 'Explique les règles de persistance, de refus et de collision du catalogue mémoire actuel.'],
  [167, 'Comparer la mémoire et produire le bilan du spike', 'Identifie les métriques et traces disponibles pour examiner la création et la réutilisation des fonctions mémoire.'],
  [175, 'Préparer et figer le prompt CodeTour pour le benchmark officiel', 'Explique où le prompt de décomposition est défini, versionné et incorporé dans le harnais.'],
  [176, 'Auditer la conformité du moteur de mémoire avant benchmark', 'Explique les validations déterministes des fonctions et de leurs citations avant consolidation en mémoire.'],
  [179, 'Exécuter deux bras comparables avec télémétrie complète et NO-GO', 'Identifie comment le harnais enregistre les appels, les tokens et les raisons d’arrêt, et signale les limites de ces données.'],
];
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ root, revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), model: modelName, budget, tasks, scope: 'exploratory diagnostic, not benchmark #174' }, null, 2));
for (const [number, title, objective] of tasks) {
  const started = new Date().toISOString();
  let result;
  try {
    result = await explore({ root, objective, codeMode: true, memory, budget, model: mistral(key, modelName, { temperature: 0 }) });
  } catch (error) {
    result = error.exploration ?? { status: 'failed', error: String(error.message ?? error) };
  }
  const catalogue = (await scriptMemory(root, memory.directory)).catalog();
  const record = { number, title, objective, started, ended: new Date().toISOString(), result, catalogue };
  await writeFile(resolve(output, `${number}.json`), JSON.stringify(record, null, 2));
  process.stdout.write(`${JSON.stringify({ number, status: result.status, stopReason: result.stopReason, error: result.error, accepted: result.consolidationReport?.accepted, catalogue: catalogue.length })}\n`);
}
