/**
 * ImmutableLogger tests: single POSTGRES_SHA source, token aggregation,
 * NO-GO controls (per-run fixture evidence, provider-side usage), atomic
 * immutable saves.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'node:crypto';

import { POSTGRES_SHA, ImmutableLogger, sumCallTokens, RunTrace } from '../src/storage/logger';
import { POSTGRES_SHA as INDEX_POSTGRES_SHA } from '../src/index';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function baseTrace(overrides: Partial<RunTrace> = {}): Partial<RunTrace> {
  const now = new Date().toISOString();
  return {
    run_id: `run-test-${randomUUID()}`,
    timestamp: now,
    agent: 'codetour',
    question_id: 'R-PG-01',
    series: 'R',
    phase: 'repetition',
    repeat_index: 0,
    postgres_sha: POSTGRES_SHA,
    calls: [{
      call_id: 'call-1',
      call_type: 'prompt',
      input_tokens: 100,
      output_tokens: 40,
      usage_missing: false,
    }],
    total_tokens: { input: 100, output: 40, total: 140, verified: true },
    fixture_verification: {
      head_sha: POSTGRES_SHA,
      clean_tree: true,
      verified_at: now,
    },
    status: 'success',
    ...overrides,
  };
}

describe('storage/logger', () => {
  it('single-sources POSTGRES_SHA (same value in logger and index re-export)', () => {
    assert.equal(POSTGRES_SHA, INDEX_POSTGRES_SHA);
    assert.match(POSTGRES_SHA, /^[0-9a-f]{40}$/);
  });

  it('sumCallTokens aggregates provider usage and flags verified=false when usage is missing', () => {
    const totals = sumCallTokens([
      { call_id: 'a', call_type: 'prompt', input_tokens: 10, output_tokens: 5, usage_missing: false },
      { call_id: 'b', call_type: 'tool', input_tokens: 3, output_tokens: 2, usage_missing: false },
    ]);
    assert.deepEqual({ input: totals.input, output: totals.output, total: totals.total }, { input: 13, output: 7, total: 20 });
    assert.equal(totals.verified, true);

    const missing = sumCallTokens([
      { call_id: 'a', call_type: 'prompt', input_tokens: 0, output_tokens: 0, usage_missing: true },
    ]);
    assert.equal(missing.verified, false);
  });

  describe('NO-GO controls', () => {
    let logger: ImmutableLogger;
    let dir: string;

    beforeEach(() => {
      dir = tmpDir('logger-nogo-');
      logger = new ImmutableLogger({ outputDir: dir, resultsDir: path.join(dir, 'runs'), immutable: false });
    });

    it('passes a fully-evidenced real trace', () => {
      const result = logger.validateNoGoControls(baseTrace());
      assert.equal(result.passed, true, result.errors.join('; '));
    });

    it('refuses a trace whose calls lack provider usage counters', () => {
      const trace = baseTrace({
        calls: [{ call_id: 'call-1', call_type: 'prompt', input_tokens: 0, output_tokens: 0, usage_missing: true }],
        total_tokens: { input: 0, output: 0, total: 0, verified: false },
      });
      const result = logger.validateNoGoControls(trace);
      assert.equal(result.passed, false);
      assert.ok(result.errors.some(e => e.toLowerCase().includes('usage missing')), result.errors.join('; '));
    });

    it('refuses a trace without per-run fixture verification evidence', () => {
      const trace = baseTrace();
      delete trace.fixture_verification;
      const result = logger.validateNoGoControls(trace);
      assert.equal(result.passed, false);
      assert.ok(result.errors.some(e => e.includes('Fixture not verified for this run')), result.errors.join('; '));
    });

    it('refuses a trace whose fixture evidence contradicts the pre-registered SHA', () => {
      const trace = baseTrace({
        fixture_verification: { head_sha: '0'.repeat(40), clean_tree: true, verified_at: new Date().toISOString() },
      });
      const result = logger.validateNoGoControls(trace);
      assert.equal(result.passed, false);
      assert.ok(result.errors.some(e => e.includes('observed a different HEAD')), result.errors.join('; '));
    });

    it('refuses a trace recorded on a dirty fixture tree', () => {
      const trace = baseTrace({
        fixture_verification: { head_sha: POSTGRES_SHA, clean_tree: false, verified_at: new Date().toISOString() },
      });
      const result = logger.validateNoGoControls(trace);
      assert.equal(result.passed, false);
      assert.ok(result.errors.some(e => e.includes('working tree was not clean')), result.errors.join('; '));
    });

    it('refuses a wrong or missing postgres_sha', () => {
      const wrong = baseTrace({ postgres_sha: '7'.repeat(40) });
      assert.equal(logger.validateNoGoControls(wrong).passed, false);

      const absent = baseTrace();
      delete absent.postgres_sha;
      assert.equal(logger.validateNoGoControls(absent).passed, false);
    });
  });

  describe('saveRun (atomic + immutable)', () => {
    let dir: string;
    let logger: ImmutableLogger;

    beforeEach(() => {
      dir = tmpDir('logger-save-');
      logger = new ImmutableLogger({ outputDir: dir, resultsDir: path.join(dir, 'runs'), immutable: true });
    });

    it('persists the trace read-only (0o444) and reloads it identically', () => {
      const trace = baseTrace() as RunTrace;
      const savedPath = logger.saveRun(trace);
      const stats = fs.statSync(savedPath);
      assert.equal(stats.mode & 0o777, 0o444);
      assert.ok(savedPath.endsWith('.json'));

      const reloaded = logger.loadRun(trace.run_id);
      assert.ok(reloaded);
      assert.equal(reloaded!.run_id, trace.run_id);
      assert.equal(reloaded!.total_tokens.total, 140);
    });

    it('writes nothing when NO-GO controls fail', () => {
      const bad = baseTrace({ agent: 'not-an-agent' }) as RunTrace;
      assert.throws(() => logger.saveRun(bad), /NO-GO controls failed/);
      const runIds = logger.listRunIds();
      assert.equal(runIds.filter(id => id.startsWith('run-test-')).length, 0);
    });
  });
});
