const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = '/Users/damien/Documents/codetour';
const benchmark = path.join(root, 'poc/benchmark');
const out = __dirname;
require(path.join(benchmark, 'runner/node_modules/ts-node')).register({ project: path.join(benchmark, 'tsconfig.json'), transpileOnly: true });
const { CAMPAIGN_CONFIG } = require(path.join(benchmark, 'config.ts'));
const { BenchmarkRunner } = require(path.join(benchmark, 'runner/src/index.ts'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifestFile = path.join(out, 'protocol.json');
const manifestLockFile = path.join(out, 'protocol-lock.json');
if (fs.existsSync(manifestFile) || fs.existsSync(manifestLockFile)) throw new Error('Fresh diagnostic directory required');
fs.cpSync(path.join(benchmark, 'gate-evidence'), path.join(out, 'gate-evidence'), { recursive: true, errorOnExist: true });
const config = { ...CAMPAIGN_CONFIG, manifestFile, manifestLockFile, outputDir: out, gateEvidenceDir: path.join(out, 'gate-evidence'), codetour: { ...CAMPAIGN_CONFIG.codetour, model: 'mistral-medium-3.5' } };
const runner = new BenchmarkRunner(config);
const rows = [];
const started = new Date().toISOString();
const emit = message => console.log(JSON.stringify({ at: new Date().toISOString(), ...message }));
function saveSummary(state, error) {
  const traces = runner.getAllRuns();
  const allUsageVerified = traces.every(t => t.total_tokens.verified);
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ diagnostic: true, included_in_campaign: false, measured_campaign_started: false, requested_runs: 10, started_at: started, state, error, configuration: { codetour: config.codetour, vibe: config.vibe, timeoutMs: config.timeoutMs }, completed_runs: traces.length, all_usage_verified: allUsageVerified, semantic_evaluation: 'Pending independent assessment; success below is execution status only.', totals: allUsageVerified ? ['codetour', 'vibe-native'].map(agent => { const ts=traces.filter(t=>t.agent===agent); return { agent, runs: ts.length, execution_successes: ts.filter(t=>t.status==='success').length, tokens: ts.reduce((n,t)=>n+t.total_tokens.total,0), created: ts.reduce((n,t)=>n+(t.functions_created?.length??0),0), reuses: ts.reduce((n,t)=>n+(t.functions_reused?.length??0),0) }; }) : null, results: rows }, null, 2)+'\n');
}
(async () => {
  const questions = (await runner.loadQuestions()).filter(q => q.series==='R' && q.repeat_index===1);
  if (questions.length!==5) throw new Error('Expected five R families, first repeat');
  const manifest = JSON.parse(fs.readFileSync(CAMPAIGN_CONFIG.manifestFile, 'utf8'));
  manifest.status = 'DIAGNOSTIC_ONLY';
  manifest.models.codetour = 'mistral-medium-3.5; exact effective identity in each trace';
  manifest.execution.total_runs = 10;
  manifest.diagnostic = { outside_measured_campaign: true, source_manifest_sha256: hash(CAMPAIGN_CONFIG.manifestFile), selected_question_ids: questions.map(q=>q.id), ordered_pairs: 'CodeTour first for odd family indices; Vibe first for even family indices.', memory: 'Fresh R memory at start; retained across all five CodeTour requests.', rationale: 'User selected Medium 3.5 after a source-verified standalone CodeTour search. No blind quality or reduction verdict from this diagnostic.' };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest,null,2)+'\n', {flag:'wx'});
  fs.writeFileSync(path.join(out,'configuration.json'), JSON.stringify(config,null,2)+'\n', {flag:'wx',mode:0o444});
  if (!(await runner.validateGates({requireFrozenManifest:false}))) throw new Error('NO-GO: diagnostic prerequisites G0-G4 failed');
  const source = fs.readFileSync(path.join(root,'packages/exploration-poc/src/decomposition-prompt.ts'),'utf8');
  const match=source.match(/export const DECOMPOSITION_PROMPT\s*=\s*("(?:[^"\\]|\\.)*")\s*;/);
  if (!match) throw new Error('Canonical prompt unavailable');
  const promptSha256=crypto.createHash('sha256').update(JSON.parse(match[1])).digest('hex');
  await runner.freezeManifest({promptSha256});
  if (!(await runner.validateGates())) throw new Error('NO-GO: diagnostic source/configuration seal failed');
  fs.chmodSync(manifestFile,0o444);
  await runner.beginSeries('R');
  saveSummary('running');
  emit({ event:'ready', gates:'G0-G5 PASS for diagnostic snapshot', output:out, model:config.codetour.model });
  for (let i=0;i<questions.length;i++) {
    const question=questions[i];
    for (const agent of i%2===0?['codetour','vibe-native']:['vibe-native','codetour']) {
      const began=Date.now();
      emit({event:'begin',number:rows.length+1,of:10,question:question.id,agent});
      let summary;
      try { summary=await runner.runSingle({question,agent}); }
      catch(error) { saveSummary('NO-GO',error.message); throw error; }
      const trace=runner.getAllRuns().find(t=>t.run_id===summary.runId);
      let h;try{h=JSON.parse(trace.result?.raw_response??'null');}catch{h=null;}
      const row={...summary, duration_ms:Date.now()-began, model:trace.model, usage_verified:trace.total_tokens.verified, functions_created:trace.functions_created?.map(f=>f.function_id)??[], functions_reused:trace.functions_reused??[], consolidation:h?.consolidationReport, model_calls:h?.metrics?.modelCalls, tool_calls:h?.metrics?.toolCalls, citations:trace.result?.citations?.length??0, source_seal:trace.manifest_hash, quality:'not independently evaluated'};
      rows.push(row);saveSummary('running');emit({event:'result',number:rows.length,of:10,...row});
    }
  }
  if (!(await runner.validateGates())) throw new Error('NO-GO: final seal invalid');
  saveSummary('complete');
  fs.chmodSync(path.join(out,'summary.json'),0o444);
  emit({event:'complete',runs:rows.length,output:out});
})().catch(error=>{
  saveSummary('NO-GO',error.message);
  fs.chmodSync(path.join(out,'summary.json'),0o444);
  emit({event:'stopped',error:error.message,completed:rows.length});
  process.exitCode=2;
});
