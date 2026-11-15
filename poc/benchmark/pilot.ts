import { BenchmarkRunner, type RunnerConfig, type RunSummary } from './runner/src/index';
import { PILOT_CONFIG, CAMPAIGN_CONFIG, MANIFEST_LOCK_PATH } from './config';

export { PILOT_CONFIG, MANIFEST_LOCK_PATH } from './config';

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
  await campaign.freezeManifest();
  return { success: true, results, errors, noGoChecks, manifestFrozen: true };
}

if (require.main === module) {
  runPilot().then(result => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = result.success ? 0 : 2; }).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
}
