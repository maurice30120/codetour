import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BenchmarkRunner, validateManifestFrozen } from '../src/index';
import { fixture } from './helpers';

test('freeze uses the same default lock path as validation and binds execution configuration', async () => {
  const f = fixture();
  const manifestFile = path.join(f.dir, 'manifest.json');
  const questionsFile = path.join(f.dir, 'questions.json');
  fs.writeFileSync(manifestFile, JSON.stringify({ model: 'offline-test' }));
  fs.writeFileSync(questionsFile, JSON.stringify({ series_R: [f.question], series_T: [] }));
  const runner = new BenchmarkRunner({ manifestFile, questionsFile, postgresPath: f.root, outputDir: path.join(f.dir, 'runner-out') });
  await runner.freezeManifest();
  assert.equal(validateManifestFrozen(manifestFile), true);
  const lock = JSON.parse(fs.readFileSync(path.join(f.dir, 'manifest-lock.json'), 'utf8'));
  assert.ok(lock.execution_config_sha256);
  assert.ok(lock.artifacts.some((a: {path: string}) => a.path === questionsFile));
});

test('changing sealed questions blocks the very next run before any agent invocation', async () => {
  const f = fixture();
  const manifestFile = path.join(f.dir, 'manifest.json'); const questionsFile = path.join(f.dir, 'questions.json');
  fs.writeFileSync(manifestFile, '{"model":"offline-test"}'); fs.writeFileSync(questionsFile, '{}');
  const runner = new BenchmarkRunner({ manifestFile, questionsFile, postgresPath: f.root, outputDir: path.join(f.dir, 'runner-out') });
  await runner.freezeManifest(); fs.writeFileSync(questionsFile, '{"changed":true}');
  await assert.rejects(runner.runSingle({ question: f.question, agent: 'codetour' }), /NO-GO.*(manifest|sealed|freeze)/i);
});

test('pilot gate guard is available before freeze and refuses self-declared pass booleans', async () => {
  const f = fixture(); const evidenceDir = path.join(f.dir, 'evidence'); fs.mkdirSync(evidenceDir);
  const manifestFile = path.join(f.dir, 'manifest.json'); const questionsFile = path.join(f.dir, 'questions.json');
  fs.writeFileSync(manifestFile, '{"model":"offline-test"}'); fs.writeFileSync(questionsFile, JSON.stringify({series_R:[{...f.question, postgres_sha:'70c4a57b64d39c526eb4c44a925eb92a6e56f3c5'}]}));
  for (const [name, evidence] of Object.entries({
    'g0-conformance.json': { passed:true, failed_count:0, total_tests:1, command:'npm test' },
    'g1-sentinel.json': {g1_passed:true,session_id:'invented',vibe_version:'1',model:'model',subagent_detected:true,tools_count:1},
    'g2-instrumentation.json': {g2_passed:true,calls_total:1,calls_without_usage:0},
    'g4-evaluator.json': {criteria_registered:true,adversarial_case_rejected:true},
  })) fs.writeFileSync(path.join(evidenceDir,name), JSON.stringify(evidence));
  const runner = new BenchmarkRunner({ manifestFile, questionsFile, postgresPath:f.root, outputDir:path.join(f.dir,'runner-out'),gateEvidenceDir:evidenceDir });
  await runner.loadQuestions();
  assert.equal(await runner.validateGates({ requireFrozenManifest:false }), false);
  assert.equal(fs.existsSync(path.join(f.dir,'manifest-lock.json')), false);
});

test('production freeze refuses absent effective model configuration', async () => {
  const f=fixture();const manifestFile=path.join(f.dir,'manifest.json');const questionsFile=path.join(f.dir,'questions.json');
  fs.writeFileSync(manifestFile,JSON.stringify({models:{primary:{name:null,version:'',provider:null}}}));fs.writeFileSync(questionsFile,'{}');
  const runner=new BenchmarkRunner({manifestFile,questionsFile,postgresPath:f.root,outputDir:path.join(f.dir,'runner-out')});
  await assert.rejects(runner.freezeManifest(),/NO-GO.*(model|configuration)/i);
  assert.equal(fs.existsSync(path.join(f.dir,'manifest-lock.json')),false);
});
