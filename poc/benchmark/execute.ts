import fs from 'node:fs';
import path from 'node:path';
import { runPilot } from './pilot';
import { runMainCampaign, verifyAllRunsImmutable } from './main-campaign';
import { CAMPAIGN_CONFIG, PILOT_CONFIG } from './config';
import type { RunnerConfig } from './runner/src/index';

export async function executeT07(campaignConfig: RunnerConfig = CAMPAIGN_CONFIG, pilotConfig: RunnerConfig = PILOT_CONFIG) {
  const startedAt = new Date().toISOString();
  try {
    const pilot = await runPilot(pilotConfig, campaignConfig);
    if (!pilot.success) return { spec: 174, verdict: 'NO-GO', success: false, phase: 'pilot', started_at: startedAt, pilot };
    const campaign = await runMainCampaign(campaignConfig);
    const storage = verifyAllRunsImmutable(campaignConfig);
    const success = campaign.success && storage.total === 80 && storage.mutable === 0;
    return { spec: 174, verdict: success ? 'AWAITING_BLIND_EVALUATION' : 'NO-GO', success, phase: 'campaign', started_at: startedAt, pilot, campaign, storage };
  } catch (error) {
    return { spec: 174, verdict: 'NO-GO', success: false, phase: 'preconditions', started_at: startedAt, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function executeAndSave(campaignConfig: RunnerConfig = CAMPAIGN_CONFIG, pilotConfig: RunnerConfig = PILOT_CONFIG) {
  const result = await executeT07(campaignConfig, pilotConfig);
  fs.mkdirSync(campaignConfig.outputDir, { recursive: true });
  const filename = `execution-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path.join(campaignConfig.outputDir, filename), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o444 });
  return result;
}

if (require.main === module) {
  executeAndSave().then(result => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = result.success ? 0 : 2; }).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
}
