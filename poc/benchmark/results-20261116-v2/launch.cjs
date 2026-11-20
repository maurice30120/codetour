const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'runner/node_modules/ts-node')).register({ project: path.join(root, 'tsconfig.json'), transpileOnly: true });
const { CAMPAIGN_CONFIG, PILOT_CONFIG } = require(path.join(root, 'config.ts'));
const { runPilot } = require(path.join(root, 'pilot.ts'));
const { BenchmarkRunner } = require(path.join(root, 'runner/src/index.ts'));
const { runMainCampaign, verifyAllRunsImmutable } = require(path.join(root, 'main-campaign.ts'));
const manifestFile = path.join(root, 'preregistration-manifest-20261116-v2.json');
const manifestLockFile = path.join(root, 'manifest-lock-20261116-v2.json');
if (fs.existsSync(manifestFile) || fs.existsSync(manifestLockFile)) throw new Error('Fresh manifest paths required');
fs.copyFileSync(CAMPAIGN_CONFIG.manifestFile, manifestFile, fs.constants.COPYFILE_EXCL);
fs.copyFileSync(CAMPAIGN_CONFIG.manifestFile, path.join(__dirname, 'previous-manifest.json'), fs.constants.COPYFILE_EXCL);
fs.copyFileSync(CAMPAIGN_CONFIG.manifestLockFile, path.join(__dirname, 'previous-lock.json'), fs.constants.COPYFILE_EXCL);
const campaign = { ...CAMPAIGN_CONFIG, manifestFile, manifestLockFile, outputDir: __dirname };
const pilot = { ...PILOT_CONFIG, manifestFile, manifestLockFile, outputDir: path.join(__dirname, 'pilot') };
fs.writeFileSync(path.join(__dirname, 'configuration.json'), JSON.stringify({ campaign, pilot, previous_runs_preserved: CAMPAIGN_CONFIG.outputDir }, null, 2), { flag: 'wx' });
const seen = new Set();
function progress() {
  for (const [phase, base] of [['pilot', pilot.outputDir], ['campaign', campaign.outputDir]]) {
    const dir = path.join(base, 'runs');
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (!name.endsWith('.json') || seen.has(file)) continue;
      let t; try { t = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      seen.add(file);
      let h; try { h = JSON.parse(t.result?.raw_response ?? 'null'); } catch { h = null; }
      console.log(JSON.stringify({ phase, run: t.run_id, question: t.question_id, agent: t.agent, status: t.status, error: t.error, tokens: t.total_tokens, created: t.functions_created?.map(f => f.function_id), reused: t.functions_reused, consolidation: h?.consolidationReport, replay_attempts: h?.callTrace?.filter(c => c.type === 'memory_run').map(c => ({ name: c.name, error: c.error, outcome: c.outcome })) }));
    }
  }
}
const timer = setInterval(progress, 5000);
(async () => {
  console.log(JSON.stringify({ phase: 'pilot_start', at: new Date().toISOString(), output: __dirname }));
  const pilotResult = await runPilot(pilot, campaign);
  progress();
  fs.writeFileSync(path.join(__dirname, 'pilot-result.json'), JSON.stringify(pilotResult, null, 2), { flag: 'wx', mode: 0o444 });
  if (!pilotResult.success) throw new Error('NO-GO: pilot failed');
  const runner = new BenchmarkRunner(campaign);
  if (!(await runner.validateGates())) throw new Error('NO-GO: final gates failed');
  console.log(JSON.stringify({ phase: 'campaign_start', at: new Date().toISOString(), gates: 'G0-G5 PASS' }));
  const result = await runMainCampaign(campaign);
  progress();
  const storage = verifyAllRunsImmutable(campaign);
  fs.writeFileSync(path.join(__dirname, 'execution.json'), JSON.stringify({ result, storage, verdict: result.success && storage.total === 80 && !storage.mutable ? 'AWAITING_BLIND_EVALUATION' : 'NO-GO' }, null, 2), { flag: 'wx', mode: 0o444 });
  console.log(JSON.stringify({ phase: 'finished', success: result.success, storage }));
  process.exitCode = result.success ? 0 : 2;
})().catch(error => {
  console.error(error.stack);
  fs.writeFileSync(path.join(__dirname, 'stopped.json'), JSON.stringify({ at: new Date().toISOString(), reason: error.message }, null, 2), { flag: 'wx', mode: 0o444 });
  process.exitCode = 2;
}).finally(() => clearInterval(timer));
