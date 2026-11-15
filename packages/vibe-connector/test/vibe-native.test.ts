/**
 * Tests for the REAL-invocation-only Vibe native research-agent connector.
 *
 * NO SENTINEL IS FABRICATED HERE. The parsing/validation logic is exercised
 * against fixtures whose shape was captured from real `vibe` CLI runs
 * (export.json + session/meta.json + session/journal/*.jsonl). The failure
 * paths are the NO-GO controls: an unavailable CLI must reject explicitly
 * (never fall back to a simulated result), and positive export-level totals
 * WITHOUT per-call usage telemetry MUST fail G2 (this is the regression the
 * old code could not catch because validateG2 returned a literal true).
 *
 * The live sentinel (real CLI, real credentials) is NOT part of the default
 * suite: run scripts/sentinel-execution.ts manually during re-validation, or
 * set VIBE_CONNECTOR_LIVE=1 to include the gated test below.
 */

import { describe, it } from 'node:test';
import assert = require('node:assert/strict');
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  buildExecution,
  defaultWorkDir,
  detectVibeAvailability,
  extractPerCallUsageAndTools,
  extractResponseFromOutput,
  invokeVibeNativeAgent,
  readJournalRecords,
  validateG1,
  validateG2,
  VibeUnavailableError,
} from '../src/agent';
import { VibeExecution } from '../src/types';

// ---------------------------------------------------------------------------
// Fixtures whose shape matches REAL vibe CLI outputs (vibe 3.1.2 smoke runs):
// export.json { outcome, session_id, usage, config.active_model,
// vibe_version, started_at, ended_at, ... }, session/meta.json, and
// session/journal/*.jsonl with action_result records.
// ---------------------------------------------------------------------------

interface UsageFixture {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
  total_tokens: number;
}

interface FixtureOptions {
  sessionId?: string | null;
  vibeVersion?: string | null;
  activeModel?: string | null;
  defaultAgent?: string | null;
  usage?: UsageFixture | null;
  /** One entry per LLM call: a usage object, or null for a call WITHOUT usage counters. */
  perCallUsage?: Array<UsageFixture | null>;
  toolCalls?: Array<{ name: string; argumentsJson?: string }>;
  subagent?: string;
  startedAt?: string;
  endedAt?: string;
  /** Append a truncated trailing JSONL line (partially flushed record). */
  partialTrailingLine?: boolean;
  assistantResponse?: string;
}

interface FixtureRun {
  outputDir: string;
  stdout: string;
  exportData: Record<string, unknown>;
  metaData: Record<string, unknown>;
  cleanup: () => void;
}

function journalRecord(usage: UsageFixture | null, toolCalls: Array<{ name: string; argumentsJson?: string }>): string {
  const parts = toolCalls.map(call => ({ type: 'tool_call', name: call.name, arguments_json: call.argumentsJson ?? '' }));
  const inner: Record<string, unknown> = { finish_reason: 'stop', parts };
  if (usage) inner.usage = usage;
  return JSON.stringify({
    type: 'action_result',
    payload: { result: { type: 'completion_succeeded', result: inner } },
  });
}

function buildFixtureRun(options: FixtureOptions = {}): FixtureRun {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'vibe-fixture-'));
  mkdirSync(path.join(outputDir, 'session', 'journal'), { recursive: true });

  const sessionId = options.sessionId === null ? undefined : (options.sessionId ?? 'sess-real-1234');
  const startedAt = options.startedAt ?? '2026-11-15T10:00:00.000Z';
  const endedAt = options.endedAt ?? '2026-11-15T10:00:02.000Z';

  const exportConfig: Record<string, unknown> = {};
  if (options.activeModel !== null) exportConfig.active_model = options.activeModel ?? 'mistral-medium-3.5';
  if (options.defaultAgent !== null) exportConfig.default_agent = options.defaultAgent ?? 'explore';
  exportConfig.routed_model_config = { temperature: 0.2, max_output_tokens: 4096, thinking: 'enabled_default' };
  exportConfig.tools = {};

  const exportData: Record<string, unknown> = {
    outcome: 'finished',
    stop_reason: null,
    exit_code: 0,
    vibe_version: options.vibeVersion === null ? undefined : (options.vibeVersion ?? '3.1.2'),
    started_at: startedAt,
    ended_at: endedAt,
    cost_usd: 0.0042,
    steps: 3,
    limits: { turns: options.perCallUsage?.length ?? 2 },
  };
  if (sessionId !== undefined) exportData.session_id = sessionId;
  if (options.usage !== null) {
    exportData.usage = options.usage ?? { input_tokens: 250, output_tokens: 80, cached_input_tokens: 0, total_tokens: 330 };
  }
  exportData.config = exportConfig;

  writeFileSync(path.join(outputDir, 'export.json'), JSON.stringify(exportData), 'utf-8');
  writeFileSync(
    path.join(outputDir, 'session', 'meta.json'),
    JSON.stringify({ session_id: sessionId ?? 'sess-meta-5678', start_time: startedAt, end_time: endedAt }),
    'utf-8'
  );

  const calls = options.perCallUsage ?? [{ input_tokens: 120, output_tokens: 40, cached_input_tokens: 0, total_tokens: 160 }, { input_tokens: 130, output_tokens: 40, cached_input_tokens: 0, total_tokens: 170 }];
  const firstCallTools = options.toolCalls ?? [{ name: 'read_file', argumentsJson: '{"path":"README.md"}' }];
  const lines = [
    journalRecord(calls[0] ?? null, firstCallTools),
    ...calls.slice(1).map(usage => journalRecord(usage, [])),
  ];
  if (options.partialTrailingLine) lines.push('{"type":"action_result","payload":{"result":{"type":"comp'); // partially flushed
  writeFileSync(path.join(outputDir, 'session', 'journal', 'session.jsonl'), lines.join('\n') + '\n', 'utf-8');

  const responseText = options.assistantResponse ?? 'Final structured answer sourced from the repository.';
  const stdout = JSON.stringify([
    { role: 'user', content: [{ type: 'text', text: 'Question?' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Intermediate step.' }] },
    { role: 'assistant', content: [{ type: 'text', text: responseText }] },
  ]);

  return {
    outputDir,
    stdout,
    exportData,
    metaData: { session_id: sessionId, start_time: startedAt, end_time: endedAt },
    cleanup: () => rmSync(outputDir, { recursive: true, force: true }),
  };
}

function buildExecutionFromFixture(fixture: FixtureRun, spawnElapsedMs = 999999): VibeExecution {
  return buildExecution({
    stdout: fixture.stdout,
    exportData: fixture.exportData,
    metaData: fixture.metaData,
    journalRecords: readJournalRecords(fixture.outputDir),
    question: 'What does the main entry point do?',
    executionId: 'unit0001',
    spawnElapsedMs,
  });
}

// ---------------------------------------------------------------------------
// Response extraction (from the real `--output json` stdout projection)
// ---------------------------------------------------------------------------

describe('extractResponseFromOutput', () => {
  it('extracts the assistant text from a JSON-array stdout projection', () => {
    const fixture = buildFixtureRun();
    try {
      assert.equal(extractResponseFromOutput(fixture.stdout), 'Intermediate step.\nFinal structured answer sourced from the repository.');
    } finally { fixture.cleanup(); }
  });

  it('extracts assistant text from a JSONL stdout projection', () => {
    const jsonl = [
      JSON.stringify({ role: 'user', content: [{ type: 'text', text: 'Question?' }] }),
      JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'Answer A' }] }),
    ].join('\n');
    assert.equal(extractResponseFromOutput(jsonl), 'Answer A');
  });

  it('returns an empty string for empty output (never a placeholder)', () => {
    assert.equal(extractResponseFromOutput(''), '');
    assert.equal(extractResponseFromOutput('   \n  '), '');
  });
});

// ---------------------------------------------------------------------------
// Journal parsing: per-call usage + real tool calls
// ---------------------------------------------------------------------------

describe('extractPerCallUsageAndTools', () => {
  it('parses per-call usage, dedupes tool names, and detects the subagent from task calls', () => {
    const fixture = buildFixtureRun({
      toolCalls: [
        { name: 'read_file', argumentsJson: '{"path":"README.md"}' },
        { name: 'task', argumentsJson: '{"subagent":"research-agent","question":"Explore postgres"}' },
        { name: 'read_file', argumentsJson: '{"path":"pg.tex"}' },
      ],
    });
    try {
      const records = readJournalRecords(fixture.outputDir);
      assert.equal(records.length, 2);
      const { perCallUsage, toolsUsed, subagent, completionsMissingUsage } = extractPerCallUsageAndTools(records);
      assert.equal(perCallUsage.length, 2);
      assert.equal(perCallUsage[0].usageMissing, false);
      assert.equal(perCallUsage[0].inputTokens, 120);
      assert.equal(perCallUsage[1].totalTokens, 170);
      assert.deepEqual(toolsUsed, ['read_file', 'task']);
      assert.equal(subagent, 'research-agent');
      assert.equal(completionsMissingUsage, 0);
    } finally { fixture.cleanup(); }
  });

  it('counts LLM calls without usage counters as usageMissing (G2 must see the gap)', () => {
    const fixture = buildFixtureRun({ perCallUsage: [{ input_tokens: 120, output_tokens: 40, total_tokens: 160 }, null] });
    try {
      const { perCallUsage, completionsMissingUsage } = extractPerCallUsageAndTools(readJournalRecords(fixture.outputDir));
      assert.equal(perCallUsage.length, 2);
      assert.equal(perCallUsage[1].usageMissing, true);
      assert.equal(perCallUsage[1].inputTokens, null);
      assert.equal(completionsMissingUsage, 1);
    } finally { fixture.cleanup(); }
  });

  it('ignores partially flushed journal lines without throwing (the usage gap stays visible)', () => {
    const fixture = buildFixtureRun({ partialTrailingLine: true });
    try {
      const records = readJournalRecords(fixture.outputDir);
      assert.equal(records.length, 2); // 2 complete action_result records; partial line skipped
      const { perCallUsage, completionsMissingUsage } = extractPerCallUsageAndTools(records);
      assert.equal(perCallUsage.length, 2);
      assert.equal(completionsMissingUsage, 0);
    } finally { fixture.cleanup(); }
  });
});

// ---------------------------------------------------------------------------
// Execution building: identity from REAL output only
// ---------------------------------------------------------------------------

describe('buildExecution', () => {
  it('builds execution identity from real export.json/manifest data', () => {
    const fixture = buildFixtureRun();
    try {
      const execution = buildExecutionFromFixture(fixture);
      assert.equal(execution.id, 'sess-real-1234');
      assert.equal(execution.agent.version, '3.1.2');
      assert.equal(execution.agent.model, 'mistral-medium-3.5');
      assert.equal(execution.agent.name, 'explore'); // real default_agent from export, NOT renamed
      assert.equal(execution.agent.agentType, 'direct');
      assert.deepEqual(execution.tokens, { input: 250, output: 80, total: 330 });
      assert.equal(execution.durationMs, 2000); // from started_at/ended_at, not the spawn-elapsed fallback
      assert.equal(execution.timestamp, '2026-11-15T10:00:00.000Z');
      assert.equal(execution.agent.modelConfig.temperature, 0.2);
      assert.equal(execution.agent.modelConfig.maxTokens, 4096);
      assert.equal(execution.outcome, 'finished');
      assert.ok(execution.response.includes('Final structured answer'));
    } finally { fixture.cleanup(); }
  });

  it('names the agent from the OBSERVED subagent in the journal task call — never renamed', () => {
    const fixture = buildFixtureRun({
      toolCalls: [{ name: 'task', argumentsJson: '{"subagent":"research-agent","question":"Explore"}' }],
      defaultAgent: 'claude-code',
    });
    try {
      const execution = buildExecutionFromFixture(fixture);
      assert.equal(execution.agent.name, 'research-agent');
      assert.equal(execution.agent.agentType, 'subagent');
      assert.equal(execution.subagent, 'research-agent');
      assert.notEqual(execution.agent.name, 'vibe-cli'); // the old rig renamed agents to 'vibe-cli'
    } finally { fixture.cleanup(); }
  });

  it('uses the real spawn duration only when the export carries no timestamps', () => {
    const fixture = buildFixtureRun({
      startedAt: 'not-a-date',
      endedAt: 'not-a-date',
    });
    try {
      const execution = buildExecutionFromFixture(fixture, 54321);
      assert.equal(execution.durationMs, 54321);
    } finally { fixture.cleanup(); }
  });

  it('throws when export.json carries no vibe_version (no default fallback)', () => {
    const fixture = buildFixtureRun({ vibeVersion: null });
    try {
      assert.throws(() => buildExecutionFromFixture(fixture), /vibe_version/);
    } finally { fixture.cleanup(); }
  });

  it('throws when export.json carries no active_model (no default fallback)', () => {
    const fixture = buildFixtureRun({ activeModel: null });
    try {
      assert.throws(() => buildExecutionFromFixture(fixture), /active_model/);
    } finally { fixture.cleanup(); }
  });
});

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

describe('validateG1 (Authentic Vibe)', () => {
  it('passes on a real-shaped execution', () => {
    const fixture = buildFixtureRun();
    try {
      assert.equal(validateG1(buildExecutionFromFixture(fixture)), true);
    } finally { fixture.cleanup(); }
  });

  it('fails when the export carries no real session id', () => {
    const fixture = buildFixtureRun({ sessionId: null });
    try {
      assert.equal(validateG1(buildExecutionFromFixture(fixture)), false);
    } finally { fixture.cleanup(); }
  });

  it('fails when no tool usage was extracted from the execution', () => {
    const fixture = buildFixtureRun({ perCallUsage: [{ input_tokens: 10, output_tokens: 5, total_tokens: 15 }], toolCalls: [] });
    try {
      assert.equal(validateG1(buildExecutionFromFixture(fixture)), false);
    } finally { fixture.cleanup(); }
  });
});

describe('validateG2 (Total instrumentation — per-call proof required)', () => {
  it('passes when every LLM call in the session carries usage counters', () => {
    const fixture = buildFixtureRun();
    try {
      assert.equal(validateG2(buildExecutionFromFixture(fixture)), true);
    } finally { fixture.cleanup(); }
  });

  it('FAILS with positive export totals when the journal has no per-call usage (the old rig passed here)', () => {
    const fixture = buildFixtureRun({ perCallUsage: [null, null] });
    try {
      const execution = buildExecutionFromFixture(fixture);
      assert.ok(execution.tokens.total > 0); // export totals look healthy...
      assert.equal(validateG2(execution), false); // ...but per-call proof is missing => NO-GO
    } finally { fixture.cleanup(); }
  });

  it('FAILS when even one LLM call in the session lacks usage counters', () => {
    const fixture = buildFixtureRun({ perCallUsage: [{ input_tokens: 120, output_tokens: 40, total_tokens: 160 }, null] });
    try {
      assert.equal(validateG2(buildExecutionFromFixture(fixture)), false);
    } finally { fixture.cleanup(); }
  });

  it('FAILS when export-level totals are zero', () => {
    const fixture = buildFixtureRun({ usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } });
    try {
      assert.equal(validateG2(buildExecutionFromFixture(fixture)), false);
    } finally { fixture.cleanup(); }
  });
});

// ---------------------------------------------------------------------------
// NO-GO controls: real invocation paths fail explicitly
// ---------------------------------------------------------------------------

describe('invokeVibeNativeAgent failure paths', () => {
  it('rejects with VibeUnavailableError (never a simulated result) when the CLI is missing', async () => {
    const fixture = buildFixtureRun();
    try {
      await assert.rejects(
        invokeVibeNativeAgent('Is vibe available?', { vibeCommand: 'definitely-not-vibe-xyz', workDir: fixture.outputDir }),
        VibeUnavailableError
      );
    } finally { fixture.cleanup(); }
  });

  it('rejects with RangeError when the explicit workDir does not exist (no guessed paths)', async () => {
    await assert.rejects(
      invokeVibeNativeAgent('q', { workDir: path.join(tmpdir(), 'not-a-real-workdir-xyz') }),
      RangeError
    );
  });
});

describe('environment detection', () => {
  it('reports unavailable with a real error for a missing CLI', () => {
    const availability = detectVibeAvailability({ vibeCommand: 'definitely-not-vibe-xyz' });
    assert.equal(availability.available, false);
    assert.ok(availability.error && availability.error.length > 0);
    assert.equal(availability.version, undefined); // no default/fabricated version
  });

  it('walks up to the validated fixture poc/benchmark/postgres only when it really exists', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'workdir-fixture-'));
    try {
      const fixtureDir = path.join(base, 'deep', 'nested', 'repo');
      mkdirSync(path.join(fixtureDir, 'poc', 'benchmark', 'postgres'), { recursive: true });
      writeFileSync(path.join(fixtureDir, 'poc', 'benchmark', 'postgres', 'README.md'), 'fixture', 'utf-8');
      assert.equal(defaultWorkDir(path.join(fixtureDir, 'deep', 'nested')), path.join(fixtureDir, 'poc', 'benchmark', 'postgres'));
      assert.equal(defaultWorkDir(base), undefined); // nothing found => undefined, caller must be explicit
    } finally { rmSync(base, { recursive: true, force: true }); }
  });

  it('does not report ambient availability hard-wired (empty dir + missing CLI => still no workdir guess)', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'workdir-empty-'));
    try {
      assert.equal(defaultWorkDir(base), undefined);
      assert.ok(!existsSync(path.join(base, 'poc', 'benchmark', 'postgres')));
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// Gated live sentinel: REAL CLI invocation. Run with VIBE_CONNECTOR_LIVE=1.
// Re-validation on real paths is part of re-pre-registration (R3).
// ---------------------------------------------------------------------------

describe('live sentinel (gated)', { skip: process.env.VIBE_CONNECTOR_LIVE === '1' ? false : 'set VIBE_CONNECTOR_LIVE=1 to run the real-CLI sentinel in-suite' }, () => {
  it('invokes the REAL vibe CLI and passes G1/G2 on real telemetry', async () => {
    const availability = detectVibeAvailability();
    assert.equal(availability.available, true, `Live sentinel requires the real vibe CLI: ${availability.error ?? ''}`);

    const execution = await invokeVibeNativeAgent(
      'What npm package name does this repository declare? Answer in one short sentence.',
      { maxTurns: 4, timeoutMs: 180000 }
    );
    assert.ok(execution.tokens.total > 0);
    assert.ok(execution.perCallUsage.length > 0);
    assert.equal(validateG1(execution), true, 'G1 must hold on a genuine invocation');
    assert.equal(validateG2(execution), true, 'G2 must hold on genuine per-call telemetry');
  });
});
