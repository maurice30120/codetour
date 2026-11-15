import { BenchmarkRunner, type RunnerConfig, type RunSummary } from './runner/src/index';
import { PILOT_CONFIG, CAMPAIGN_CONFIG, MANIFEST_LOCK_PATH } from './config';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { RunTrace } from './runner/src/storage/logger';

export { PILOT_CONFIG, MANIFEST_LOCK_PATH } from './config';

const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex');

/**
 * Resolve the pre-registration manifest from REAL observations before G5 —
 * never from invented values:
 * - content bindings (questions, expected answers, evaluator criteria) are the
 *   exact SHA-256 of the reviewed files;
 * - the canonical prompt hash derives from the POC's single constant
 *   (packages/exploration-poc/src/decomposition-prompt.ts);
 * - the two arms' model identities and the temperature divergences come from
 *   the pilot traces and the G1 sentinel evidence, with their provenance;
 * - the statistical method is the dependency-aware plan pre-registered by the
 *   spec (§5), before any measured run.
 */
export function resolveManifestPreRegistration(campaignConfig: RunnerConfig, pilotTraces: RunTrace[]): string {
  const manifestFile = path.resolve(campaignConfig.manifestFile);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Record<string, any>;
  // Binding files are written REPO-ROOT-relative; the manifest sits two
  // levels below the repo root (poc/benchmark/…).
  const repoRoot = path.resolve(path.dirname(manifestFile), '..', '..');
  const bindFile = (binding: { file: string; hash: string }): void => {
    const target = path.resolve(repoRoot, binding.file);
    if (!fs.existsSync(target)) throw new Error(`NO-GO: pre-registration binding target does not exist: ${target}`);
    binding.hash = 'sha256:' + sha256(fs.readFileSync(target, 'utf8'));
  };
  bindFile(manifest.questions);
  bindFile(manifest.expected_answers);
  const criteriaFile = path.resolve(repoRoot, manifest.evaluation.criteria_file);
  if (!fs.existsSync(criteriaFile)) throw new Error(`NO-GO: evaluator criteria file does not exist: ${criteriaFile}`);
  manifest.evaluation.criteria_hash = 'sha256:' + sha256(fs.readFileSync(criteriaFile, 'utf8'));

  // Canonical prompt: derived from the single source of truth constant — the
  // file is parsed, the constant extracted, and its UTF-8 bytes hashed (never
  // a copied literal here).
  const promptFile = path.resolve(repoRoot, manifest.prompts.codetour);
  const promptSource = fs.readFileSync(promptFile, 'utf8');
  const constantMatch = promptSource.match(/export const DECOMPOSITION_PROMPT\s*=\s*("(?:[^"\\]|\\.)*")\s*;/);
  if (!constantMatch) throw new Error(`NO-GO: cannot locate DECOMPOSITION_PROMPT in ${promptFile}`);
  const canonicalPrompt = JSON.parse(constantMatch[1]) as string;
  if (canonicalPrompt.length < 100) throw new Error('NO-GO: extracted canonical prompt looks truncated');
  manifest.prompts.hash = 'sha256:' + sha256(canonicalPrompt);

  // Model identities: configured value + what the real executions reported.
  const codetourTrace = pilotTraces.find(trace => trace.agent === 'codetour' && trace.model);
  if (!codetourTrace) throw new Error('NO-GO: no CodeTour pilot trace with a model identity');
  const sentinelFile = path.resolve(path.dirname(campaignConfig.manifestFile), 'gate-evidence', 'sentinel.json');
  const sentinel = JSON.parse(fs.readFileSync(sentinelFile, 'utf8')) as Record<string, any>;
  const sentinelExecution = sentinel.execution;
  const childModel = sentinelExecution?.agent?.model ?? undefined;
  const observedVibe = pilotTraces.find(trace => trace.agent === 'vibe-native' && trace.model);
  manifest.models.codetour =
    `provider alias ${codetourTrace.model} (configured for the CodeTour arm; exact per-run identity in trace.model)`;
  manifest.models.vibe =
    `vibe CLI ${sentinelExecution?.agent?.version ?? 'version reported by sentinel'}; ` +
    `root session${sentinelExecution?.id ? ` ${sentinelExecution.id}` : ''}${observedVibe?.model ? ` configured ${observedVibe.model}` : ''}; ` +
    `native research child (${sentinelExecution?.subagent ?? 'research'}) on model ${childModel ?? 'session model'}; per-run identity in trace.model`;
  const codetourTemperature = codetourTrace.model_params?.temperature;
  manifest.parameters.temperature =
    `CodeTour: ${codetourTemperature ?? 'configured value in trace.model_params'}; ` +
    `Vibe: provider default for the root session${sentinelExecution?.agent?.modelConfig?.temperature !== undefined ? ` (sentinel observed ${sentinelExecution?.agent?.modelConfig?.temperature} on the root)` : ''} and its native child — recorded as a documented divergence, not equalized`;

  manifest.statistics.method =
    'Paired, dependency-aware bootstrap (10,000 resamples, seed 174) over the pre-registered independent units — in series R the 5 question families (4 repetitions each), in series T the learning sequences — of the cumulative tokens per correct Tour per agent. ' +
    'The 95% confidence interval of the relative reduction must be strictly positive on EACH series; leave-one-family-out re-computation and the cumulative-denominator including failed runs form the sensitivity plan. ' +
    'Fewer than 5 independent information units, an unmatched comparison, or any missing usage forbids a global reduction and yields INDÉTERMINÉ.';
  manifest.status = 'PREREGISTERED';
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  return manifest.prompts.hash.replace('sha256:', '');
}

export async function runPilot(config: RunnerConfig = PILOT_CONFIG, campaignConfig: RunnerConfig = CAMPAIGN_CONFIG) {
  const runner = new BenchmarkRunner(config);
  const questions = await runner.loadQuestions();
  const measuredQuestions = await new BenchmarkRunner(campaignConfig).loadQuestions();
  if (questions.length < 1 || questions.length > 2 || questions.some(question => measuredQuestions.some(measured => measured.id === question.id || measured.objective === question.objective))) {
    throw new Error('NO-GO: pilot requires one or two questions outside the measured set.');
  }
  if (config.outputDir === campaignConfig.outputDir) throw new Error('NO-GO: pilot storage must be separate from the main campaign.');
  if (!(await runner.validateGates({ requireFrozenManifest: false }))) throw new Error('NO-GO: pilot prerequisites G0-G4 are not verified.');
  const results: RunSummary[] = [];
  for (const question of questions) {
    for (const agent of ['codetour', 'vibe-native'] as const) results.push(await runner.runSingle({ question, agent }));
  }
  const noGoChecks = runner.getAllRuns().map(trace => runner.getLogger().validateNoGoControls(trace));
  const errors = results.filter(result => result.status !== 'success').map(result => result.error ?? `Pilot ${result.runId} failed.`);
  if (noGoChecks.length !== results.length || noGoChecks.some(check => !check.passed)) errors.push('Pilot evidence is incomplete.');
  if (errors.length > 0) return { success: false, results, errors, noGoChecks, manifestFrozen: false };
  const campaign = new BenchmarkRunner(campaignConfig);
  await campaign.loadQuestions();
  const promptSha256 = resolveManifestPreRegistration(campaignConfig, runner.getAllRuns());
  await campaign.freezeManifest({ promptSha256 });
  return { success: true, results, errors, noGoChecks, manifestFrozen: true };
}

if (require.main === module) {
  runPilot().then(result => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = result.success ? 0 : 2; }).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
}
