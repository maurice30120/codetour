import fs from 'node:fs';
import path from 'node:path';
import { BenchmarkRunner, type RunnerConfig, type RunSummary } from './runner/src/index';
import { validateManifestFrozen } from './runner/src/storage/logger';
import { CAMPAIGN_CONFIG } from './config';

export { CAMPAIGN_CONFIG } from './config';

export function separateQuestions<T extends { series: string }>(questions: T[]) {
  return { seriesR: questions.filter(question => question.series === 'R'), seriesT: questions.filter(question => question.series === 'T') };
}

export async function runMainCampaign(config: RunnerConfig = CAMPAIGN_CONFIG) {
  const runner = new BenchmarkRunner(config);
  const questions = await runner.loadQuestions();
  const { seriesR, seriesT } = separateQuestions(questions);
  if (seriesR.length !== 20 || seriesT.length !== 20 || new Set(questions.map(question => question.id)).size !== 40) {
    throw new Error('NO-GO: expected 40 unique paired questions, 20 per series.');
  }
  const runs = await runner.runMain();
  // Pair controls with THIS campaign's runs by runId (listRuns reads every
  // trace file, so stale archived traces must neither satisfy nor invalidate).
  // Agent-side failures (AGENT_FAILED envelope truncation) are recorded data
  // (spec section 6), not protocol violations: only the latter block the
  // campaign; per-run outcomes are handed to the blind evaluation and the
  // section-7 verdict.
  const ids = new Set(runs.map(run => run.runId));
  const tracesById = new Map(runner.getAllRuns().filter(trace => ids.has(trace.run_id)).map(trace => [trace.run_id, trace]));
  const noGoChecks = runs.map(run => {
    const trace = tracesById.get(run.runId);
    return trace ? runner.getLogger().validateNoGoControls(trace) : { passed: false, errors: ['missing trace'] };
  });
  const protocolViolations = runs.filter((run, index) => !noGoChecks[index].passed && !/^AGENT_FAILED/.test(run.error ?? ''));
  const manifestValid = validateManifestFrozen(config.manifestFile, config.manifestLockFile);
  const success = manifestValid && runs.length === 80 && ids.size === 80 && !ids.has('') && protocolViolations.length === 0;
  const series = (label: string) => ({ runs: runs.filter(run => run.series === label), errors: runs.filter(run => run.series === label && run.error).map(run => run.error!), noGoChecks });
  return { success, totalRuns: runs.length, seriesR: series('R'), seriesT: series('T'), allErrors: runs.filter(run => run.error).map(run => run.error!), allNoGoChecks: noGoChecks, manifestValid, allGatesValid: true };
}

export function getAllCampaignRuns(config: RunnerConfig = CAMPAIGN_CONFIG) {
  return new BenchmarkRunner(config).getAllRuns();
}

export function verifyAllRunsImmutable(config: RunnerConfig = CAMPAIGN_CONFIG) {
  const directory = new BenchmarkRunner(config).getLogger().getResultsDir();
  const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.endsWith('.json')) : [];
  const immutableList = files.filter(name => (fs.statSync(path.join(directory, name)).mode & 0o222) === 0);
  const mutableList = files.filter(name => !immutableList.includes(name));
  return { total: files.length, immutable: immutableList.length, mutable: mutableList.length, immutableList, mutableList };
}

export type CampaignRun = RunSummary;

if (require.main === module) {
  runMainCampaign().then(result => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = result.success ? 0 : 2; }).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
}
