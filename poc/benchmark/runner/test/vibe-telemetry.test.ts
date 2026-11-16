import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VibeExecutor } from '../src/agents/vibe';
import { TokenTracker } from '../src/execution/tracker';

for (const { completeUsage, reportedOutput } of [{ completeUsage: false, reportedOutput: 2 }, { completeUsage: true, reportedOutput: 2 }, { completeUsage: true, reportedOutput: 3 }]) {
  test(`native token limit preserves completeness=${completeUsage}, session output=${reportedOutput}`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-telemetry-'));
    try {
      const connector = path.join(dir, 'connector.cjs');
      fs.writeFileSync(connector, `module.exports = {
        validateG1: () => false, validateG2: () => ${completeUsage},
        invokeVibeNativeAgent: async () => ({
          id: 'offline-regression', agent: { name: 'native-research', version: 'test', model: 'test' },
          response: '', outcome: 'token_limit', toolsUsed: [], tokens: { input: 10, output: ${reportedOutput}, total: ${10 + reportedOutput} },
          perCallUsage: [{ callIndex: 0, inputTokens: 10, outputTokens: 2, usageMissing: false }]
        })
      };`);
      const tracker = new TokenTracker();
      const executor = new VibeExecutor({ connectorModulePath: connector, workDir: dir });
      const result = await executor.execute({ id: 'outside-benchmark', objective: 'Offline regression', series: 'R', phase: 'repetition', repeat_index: 0, postgres_sha: 'test' }, tracker);
      assert.equal(result.status, 'error');
      assert.equal(tracker.calculateTotalTokens().total, 12);
      const reconciled = completeUsage && reportedOutput === 2;
      assert.equal(tracker.calculateTotalTokens().verified, reconciled);
      if (reconciled) assert.equal(result.no_go, undefined);
      else {
        assert.match(result.no_go!, /G2/);
        assert.equal(tracker.hasMissingUsage(), true);
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
