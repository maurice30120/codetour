const fs = require('node:fs');
process.loadEnvFile('/Users/damien/Documents/codetour/.env.local');
const c = require('/Users/damien/Documents/codetour/packages/vibe-connector/dist/src/index.js');
(async () => {
 const execution = await c.invokeVibeNativeAgent('Explain how the pg_config utility handles a request for command-line help; cite the source.', { workDir:'/Users/damien/Documents/codetour/poc/benchmark/postgres', vibeCommand:'/tmp/spec174-vibe-retain-journals-20261116/vibe', outputDir:'/tmp/spec174-vibe-retain-journals-20261116/sentinel-evidence-2', maxTokens:600000,timeoutMs:600000 });
 const g1=c.validateG1(execution),g2=c.validateG2(execution);
 fs.writeFileSync('/tmp/spec174-vibe-retain-journals-20261116/sentinel.json',JSON.stringify({g1_passed:g1,g2_passed:g2,execution},null,2),{flag:'wx',mode:0o444});
 const sums=execution.perCallUsage.reduce((a,x)=>({input:a.input+x.inputTokens,output:a.output+x.outputTokens,total:a.total+x.totalTokens}),{input:0,output:0,total:0});
 console.log(JSON.stringify({g1,g2,tokens:execution.tokens,perCall:sums,calls:execution.perCallUsage.length,unreconciled:execution.sessionsUnreconciled??[]}));
 process.exitCode=g1&&g2?0:2;
})().catch(e=>{console.error(e.message);process.exitCode=2});
