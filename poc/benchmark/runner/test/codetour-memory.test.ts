import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMemoryActivity, type HarnessCallTraceItem } from '../src/agents/codetour';

test('memory telemetry records persisted creations and real successful replays only', () => {
  const old = { id: 'searchPostgresRules', code: 'old source' };
  const added = { id: 'tracePostgresBranch', code: 'new source' };
  const call = (name: string, error?: string): HarnessCallTraceItem => ({ seq: 1, type: 'memory_run', name, error, startedAt: '2026-11-16T00:00:00Z', endedAt: '2026-11-16T00:00:01Z', durationMs: 1000, inputTokens: null, outputTokens: null, usageMissing: false });
  const result = extractMemoryActivity({ objective: 'Offline telemetry regression', consolidationReport: { accepted: [old.id, added.id, 'notPersisted'] }, callTrace: [call(old.id), call(old.id), call('failedFunction', 'failure'), call('unknownFunction')] }, [old, { id: 'failedFunction', code: '' }], [old, added, { id: 'unselectedFunction', code: '' }]);
  assert.deepEqual(result.functions_reused, [old.id]);
  assert.equal(result.functions_created.length, 1);
  assert.equal(result.functions_created[0].function_id, added.id);
  assert.equal(result.functions_created[0].source, added.code);
  assert.equal(result.functions_created[0].created_at, '2026-11-16T00:00:01Z');
});

test('executor passes all budget options before positional workspace and objective', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { CodeTourExecutor } = await import('../src/agents/codetour');
  const { TokenTracker } = await import('../src/execution/tracker');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codetour-cli-options-'));
  const originalKey = process.env.MISTRAL_API_KEY;
  process.env.MISTRAL_API_KEY = 'offline-test';
  try {
    const cli = path.join(dir, 'harness.cjs');
    const captured = path.join(dir, 'args.json');
    fs.writeFileSync(cli, `require('fs').writeFileSync(${JSON.stringify(captured)}, JSON.stringify(process.argv.slice(2))); console.log(JSON.stringify({objective:'offline',status:'complete',promptSha256:process.env.CODETOUR_PROMPT_SHA256,modelConfig:JSON.parse(process.env.CODETOUR_MODEL_CONFIG),callTrace:[]}));`);
    const executor = new CodeTourExecutor({ harnessCliPath: cli, fixtureRoot: dir, memoryDir: path.join(dir, '..', path.basename(dir) + '-memory'), temperature: 0, maxTokens: 600000 });
    await executor.execute({ id: 'offline', objective: 'Explain a branch', series: 'R', phase: 'repetition', repeat_index: 1, postgres_sha: 'test' }, new TokenTracker());
    const args: string[] = JSON.parse(fs.readFileSync(captured, 'utf8'));
    assert.ok(args.indexOf('--iterations') < args.indexOf(dir));
    assert.ok(args.indexOf('--calls') < args.indexOf(dir));
    assert.deepEqual(args.slice(-2), [dir, 'Explain a branch']);
    fs.rmSync(path.join(dir, '..', path.basename(dir) + '-memory'), { recursive: true, force: true });
  } finally {
    if (originalKey === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = originalKey;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
