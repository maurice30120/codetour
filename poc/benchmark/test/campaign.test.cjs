const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
require('../runner/node_modules/ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true });
const { executeT07 } = require('../execute.ts');
const { runPilot } = require('../pilot.ts');
const { runMainCampaign } = require('../main-campaign.ts');
const sha = '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5';

async function configs(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spec174-campaign-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const measured = { id: 'R-Q1', objective: 'Measured objective', series: 'R', phase: 'repetition', repeat_index: 1, postgres_sha: sha };
  await fs.writeFile(path.join(directory, 'questions.json'), JSON.stringify({ series_R: [measured], series_T: [] }));
  await fs.writeFile(path.join(directory, 'pilot.json'), JSON.stringify({ series_R: [{ ...measured, id: 'PILOT-1', objective: 'External connectivity task' }], series_T: [] }));
  const campaign = { questionsFile: path.join(directory, 'questions.json'), manifestFile: path.join(directory, 'manifest.json'), postgresPath: path.join(directory, 'missing-fixture'), outputDir: path.join(directory, 'main'), gateEvidenceDir: path.join(directory, 'missing-evidence') };
  const pilot = { ...campaign, questionsFile: path.join(directory, 'pilot.json'), outputDir: path.join(directory, 'pilot') };
  return { campaign, pilot, directory };
}

test('failed prerequisites return a NO-GO and never freeze a manifest or emit measured runs', async context => {
  const { campaign, pilot, directory } = await configs(context);
  const result = await executeT07(campaign, pilot);
  assert.equal(result.verdict, 'NO-GO');
  assert.equal(result.success, false);
  assert.match(result.reason, /NO-GO/);
  await assert.rejects(fs.readFile(path.join(directory, 'manifest-lock.json')));
  assert.deepEqual((await fs.readdir(campaign.outputDir, { recursive: true })).filter(filename => filename.endsWith('.json')), []);
});

test('the pilot refuses a measured question before any provider execution', async context => {
  const { campaign, pilot } = await configs(context);
  await assert.rejects(runPilot({ ...pilot, questionsFile: campaign.questionsFile }, campaign), /outside the measured set/);
});

test('the pilot refuses shared storage with the campaign', async context => {
  const { campaign, pilot } = await configs(context);
  await assert.rejects(runPilot({ ...pilot, outputDir: campaign.outputDir }, campaign), /storage must be separate/);
});

test('main campaign rejects an incomplete pairing plan before a model call', async context => {
  const { campaign } = await configs(context);
  await assert.rejects(runMainCampaign(campaign), /40 unique paired questions/);
});
