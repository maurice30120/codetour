import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, executor } from './helpers';

test('measured agent failure remains a retrievable immutable run, with its incurred cost', async () => {
  const f = fixture();
  f.manager.registerAgentExecutor(executor(async (_question, tracker) => {
    const id = tracker.startCall('prompt');
    tracker.completeCall(id, { input_tokens: 13, output_tokens: 7 });
    throw new Error('invalid generated tour');
  }));
  const run = await f.manager.executeSingle(f.question, 'codetour');
  assert.equal(run.status, 'error'); assert.equal(run.total_tokens.total, 20);
  assert.deepEqual(f.logger.loadRun(run.run_id), JSON.parse(JSON.stringify(run)));
  assert.equal(fs.statSync(path.join(f.logger.getResultsDir(), `${run.run_id}.json`)).mode & 0o777, 0o444);
});

test('replay retains measured failed-call costs and never retries missing telemetry', async () => {
  const f = fixture(); let attempt = 0;
  f.manager.registerAgentExecutor(executor(async (_question, tracker) => {
    const id = tracker.startCall('prompt');
    tracker.completeCall(id, { input_tokens: 10, output_tokens: 5 });
    if (++attempt === 1) throw Object.assign(new Error('provider disconnected'), { code: 'ECONNRESET' });
    return { calls: tracker.getCalls(), status: 'success' };
  }));
  const run = await f.manager.executeSingle(f.question, 'codetour');
  assert.equal(run.total_tokens.total, 30); assert.equal(run.calls.length, 2);
  assert.equal(new Set(run.calls.map(c => c.call_id)).size, 2);
});

test('an unfinished provider call stops execution and forbids campaign totals', async () => {
  const f = fixture();
  f.manager.registerAgentExecutor(executor(async (_question, tracker) => {
    tracker.startCall('prompt');
    const id = tracker.startCall('prompt'); tracker.completeCall(id, { input_tokens: 4, output_tokens: 2 });
    return { calls: tracker.getCalls(), status: 'success' };
  }));
  await assert.rejects(f.manager.executeSingle(f.question, 'codetour'), /NO-GO.*usage|NO-GO.*pending/i);
  assert.equal(f.logger.listRuns().length, 1);
  assert.equal(f.logger.listRuns()[0].no_go, true);
  assert.throws(() => f.manager.getSummary(), /NO-GO/);
});

test('series preserves CodeTour learning, resets at transfer, and alternates the leading agent', async () => {
  const f = fixture(); let learned = 0;
  const codetour = Object.assign(executor(async (_q, tracker) => {
    const id = tracker.startCall('prompt'); tracker.completeCall(id, { input_tokens: 2, output_tokens: 1 });
    return { calls: tracker.getCalls(), status: 'success', result: { raw_response: String(learned++) } };
  }), { beginSeries: async () => { learned = 0; } });
  f.manager.registerAgentExecutor(codetour);
  f.manager.registerAgentExecutor(executor(async (_q, tracker) => {
    const id = tracker.startCall('prompt'); tracker.completeCall(id, { input_tokens: 2, output_tokens: 1 });
    return { calls: tracker.getCalls(), status: 'success' };
  }, 'vibe-native'));
  const questions = [f.question, { ...f.question, id: 'R-2' }, { ...f.question, id: 'T-1', series: 'T' as const, phase: 'priming' as const }];
  const runs = await f.manager.executeAll(questions);
  assert.deepEqual(runs.map(r => `${r.question_id}:${r.agent}`), ['R-1:codetour', 'R-1:vibe-native', 'R-2:vibe-native', 'R-2:codetour', 'T-1:codetour', 'T-1:vibe-native']);
  assert.deepEqual(runs.filter(r => r.agent === 'codetour').map(r => r.result?.raw_response), ['0', '1', '0']);
});

test('agents receive the objective and fixture provenance without evaluation answers', async () => {
  const f = fixture();
  f.manager.registerAgentExecutor(executor(async (question, tracker) => {
    const id = tracker.startCall('prompt'); tracker.completeCall(id, { input_tokens: 2, output_tokens: 1 });
    return { calls: tracker.getCalls(), status: 'success', result: { raw_response: JSON.stringify(question) } };
  }));
  const run = await f.manager.executeSingle({ ...f.question, expected_areas: ['SECRET_REFERENCE'], criteria: ['SECRET_CRITERION'], relations_to_verify: [{from:'SECRET',to:'ANSWER',type:'calls',file:'hidden.c'}] }, 'codetour');
  assert.doesNotMatch(run.result!.raw_response!, /SECRET|expected_areas|criteria|relations_to_verify/);
  assert.match(run.result!.raw_response!, /Explain entry/);
});

test('real child harness receives persistent memory within a series and fresh memory at transfer', async () => {
  const f = fixture();
  const cli = path.join(f.dir, 'offline-harness.cjs');
  fs.writeFileSync(cli, `const fs=require('fs');const path=require('path');
    const args=process.argv.slice(2);const memory=args[args.indexOf('--memory')+1];
    fs.mkdirSync(memory,{recursive:true});const file=path.join(memory,'learned');
    const previous=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8')):0;fs.writeFileSync(file,String(previous+1));
    console.log(JSON.stringify({objective:'observed',status:'complete',promptSha256:process.env.CODETOUR_PROMPT_SHA256,
      modelConfig:JSON.parse(process.env.CODETOUR_MODEL_CONFIG),
      callTrace:[{seq:1,type:'model',name:'exploration',inputTokens:5,outputTokens:3,usageMissing:false,durationMs:1},{seq:2,type:'function_try',name:'try',usageMissing:false,inputTokens:null,outputTokens:null}],
      uncertainties:[String(previous)]}));`);
  const { CodeTourExecutor } = await import('../src/agents/codetour');
  const previousKey = process.env.MISTRAL_API_KEY; process.env.MISTRAL_API_KEY = 'offline-test-no-network';
  try {
    f.manager.registerAgentExecutor(new CodeTourExecutor({ harnessCliPath:cli,fixtureRoot:f.root,memoryDir:path.join(f.dir,'memory') } as ConstructorParameters<typeof CodeTourExecutor>[0]));
    await f.manager.beginSeries('R');
    const first = await f.manager.executeSingle(f.question,'codetour');
    const second = await f.manager.executeSingle({...f.question,id:'R-2'},'codetour');
    await f.manager.beginSeries('T');
    const transfer = await f.manager.executeSingle({...f.question,id:'T-1',series:'T',phase:'priming'},'codetour');
    assert.deepEqual([first,second,transfer].map(run=>JSON.parse(run.result!.raw_response!).uncertainties), [['0'],['1'],['0']]);
    assert.equal(first.calls.length,1); assert.equal(first.total_tokens.total,8);
  } finally { if (previousKey === undefined) delete process.env.MISTRAL_API_KEY; else process.env.MISTRAL_API_KEY=previousKey; }
});

test('a reused Vibe session is a fatal contamination error with the measured second run retained', async () => {
  const f = fixture();
  f.manager.registerAgentExecutor(executor(async (_q, tracker) => {
    const id = tracker.startCall('prompt'); tracker.completeCall(id,{input_tokens:3,output_tokens:2});
    return { calls:tracker.getCalls(),status:'success',session_id:'same-session',result:{raw_response:'partial research'} };
  },'vibe-native'));
  await f.manager.executeSingle(f.question,'vibe-native');
  await assert.rejects(f.manager.executeSingle({...f.question,id:'R-2'},'vibe-native'),/NO-GO.*session/i);
  const runs = f.logger.listRuns();
  assert.equal(runs.length,2);
  assert.equal(runs.find(r=>r.question_id==='R-2')!.total_tokens.total,5);
  assert.equal(runs.find(r=>r.question_id==='R-2')!.result!.raw_response,'partial research');
});

test('false native identity halts the campaign after retaining raw response and provider counters', async () => {
  const f=fixture();const moduleFile=path.join(f.dir,'connector.cjs');
  fs.writeFileSync(moduleFile, `module.exports={validateG1:()=>false,validateG2:()=>true,invokeVibeNativeAgent:async()=>({id:'isolated-session',agent:{name:'generic',version:'1',model:'model',agentType:'direct',modelConfig:{}},question:'Explain entry',response:'unverified answer',tokens:{input:8,output:2,total:10},perCallUsage:[{callIndex:0,inputTokens:8,outputTokens:2,cachedInputTokens:3,usageMissing:false}],toolsUsed:['read'],executionMetadata:{},outcome:'finished'})}`);
  const {VibeExecutor}=await import('../src/agents/vibe');
  f.manager.registerAgentExecutor(new VibeExecutor({connectorModulePath:moduleFile,workDir:f.root}));
  await assert.rejects(f.manager.executeSingle(f.question,'vibe-native'),/NO-GO.*G1/);
  const run=f.logger.listRuns()[0];assert.equal(run.total_tokens.total,10);assert.equal(run.total_tokens.cached_input,3);
  assert.match(run.result!.raw_response!,/unverified answer/);
});
