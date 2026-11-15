import { afterEach, beforeEach, describe, it } from 'node:test';
import assert = require('node:assert/strict');
import { buildExecution, ensureSubagentProfile, invokeVibeNativeAgent, JournalRecord, validateG1, validateG2 } from '../src/agent';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const question = 'Where is PostgreSQL startup implemented?';
const rootUsage = { input_tokens: 120, output_tokens: 30, cached_input_tokens: 20, total_tokens: 150 };
const childUsage = { input_tokens: 200, output_tokens: 50, cached_input_tokens: 40, total_tokens: 250 };

function completion(sessionId: string, usage: unknown, parts: unknown[] = []) {
  return { sessionId, type: 'action_result', payload: { result: {
    type: 'completion_succeeded', action_id: `${sessionId}-completion`, result: { usage, parts },
  } } };
}

function nativeEvidence() {
  return {
    stdout: JSON.stringify([{ role: 'assistant', content: [{ type: 'text', text: 'Startup is in src/backend/tcop/postgres.c.' }] }]),
    exportData: {
      session_id: 'root', vibe_version: '3.1.2', outcome: 'finished', exit_code: 0,
      config: { active_model: 'root-model', default_agent: 'auto-approve' }, usage: { ...rootUsage }, steps: 1,
      subagents: [{ session_id: 'child', parent_session_id: 'root', root_session_id: 'root',
        agent_name: 'postgres-research', agent_type: 'explore', spawn_action_id: 'spawn-action',
        spawn_call_id: 'spawn-call', model: 'child-model', status: 'idle', steps: 1,
        usage: { ...childUsage }, journal_dir: 'subagents/child/session' }],
    },
    metaData: { session_id: 'root' },
    journalRecords: [
      completion('root', { ...rootUsage }, [{ type: 'tool_call', id: 'spawn-call', name: 'agents.spawn',
        arguments_json: JSON.stringify({ name: 'postgres-research', config_name: 'explore', message: question }) }]),
      completion('child', { ...childUsage }, [{ type: 'tool_call', id: 'read-call', name: 'grep', arguments_json: '{}' }]),
    ],
    question, executionId: 'local-id', spawnElapsedMs: 5,
  };
}

describe('native research evidence through buildExecution and gates', () => {
  it('accepts an observed native spawn linked to an executed research child', () => {
    const execution = buildExecution(nativeEvidence());
    assert.equal(validateG1(execution), true);
    assert.equal(execution.agent.name, 'postgres-research');
    assert.equal(execution.agent.model, 'child-model');
    assert.equal(execution.subagent, 'explore');
  });

  it('adds the separately exported root and child usage exactly once', () => {
    const execution = buildExecution(nativeEvidence());
    assert.deepEqual(execution.tokens, { input: 320, output: 80, total: 400 });
    assert.equal(validateG2(execution), true);
  });

  it('rejects positive child totals that disagree with its per-call journal', () => {
    const evidence = nativeEvidence();
    evidence.exportData.subagents[0].usage.input_tokens = 201;
    evidence.exportData.subagents[0].usage.total_tokens = 251;
    assert.equal(validateG2(buildExecution(evidence)), false);
  });

  it('keeps an absent cache counter missing even when the export reports zero', () => {
    const evidence = nativeEvidence();
    evidence.exportData.subagents[0].usage.cached_input_tokens = 0;
    evidence.journalRecords[1].payload.result.result.usage = { input_tokens: 200, output_tokens: 50, total_tokens: 250 };
    const execution = buildExecution(evidence);
    assert.equal(validateG2(execution), false);
    assert.equal(execution.perCallUsage[1].cachedInputTokens, null);
    assert.equal(execution.perCallUsage[1].usageMissing, true);
  });

  it('fails closed on a failed LLM attempt whose usage is unknown', () => {
    const evidence = nativeEvidence();
    evidence.journalRecords.push({ sessionId: 'root', type: 'action_result', payload: { result: {
      type: 'completion_failed', action_id: 'retry-action', result: { usage: undefined, parts: [] },
    } } });
    assert.equal(validateG2(buildExecution(evidence)), false);
  });

  it('recognizes a spawn executed through run_typescript from the native runtime journal', () => {
    const evidence = nativeEvidence();
    evidence.journalRecords[0].payload.result.result.parts = [{ type: 'tool_call', id: 'program-call', name: 'run_typescript', arguments_json: '{}' }];
    const journalRecords: JournalRecord[] = [...evidence.journalRecords, {
      sessionId: 'root', type: 'action_intent', payload: {
        action_id: 'spawn-action', kind: 'tool', request: {
          type: 'runtime_builtin_tool_call', action_id: 'spawn-action', turn_id: 'root-turn',
          call_id: 'spawn-call', parent_call_id: 'program-call', call: {
            type: 'runtime_builtin', name: 'agents.spawn', arguments: {
              name: 'postgres-research', config_name: 'explore', message: question,
            },
          },
        },
      },
    }];
    assert.equal(validateG1(buildExecution({ ...evidence, journalRecords })), true);
  });
});

describe('native CLI transport (offline executable fixture)', () => {
  it('requests native explore using the installed protocol and retains both journals', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'vibe-transport-'));
    try {
      const evidence = nativeEvidence();
      Object.assign(evidence.exportData.config, { providers: [{ api_key: 'offline-secret-never-real' }] });
      const fixture = path.join(base, 'fixture');
      mkdirSync(fixture);
      writeFileSync(path.join(fixture, 'run.json'), JSON.stringify(evidence));
      const command = path.join(base, 'vibe-fixture');
      writeFileSync(command, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('3.1.2'); process.exit(0); }
const flag = name => args[args.indexOf(name) + 1];
assert.match(flag('-p'), /agents\\.spawn/);
assert.match(flag('-p'), /config_name/);
assert.match(flag('-p'), /"config_name":"research"/);
assert.equal(flag('--max-tokens'), '12000');
assert.equal(flag('--time-limit'), '15');
assert.equal((args.filter(value => value === '--enabled-tool' + 's')).length, 0);
assert.equal(args.includes('--system-prompt-file'), false);
const run = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'run.json'), 'utf8'));
const output = flag('--output-dir');
for (const [id, dir] of [['root', 'session'], ['child', 'subagents/child/session']]) {
  fs.mkdirSync(path.join(output, dir, 'journal'), { recursive: true });
  fs.writeFileSync(path.join(output, dir, 'meta.json'), JSON.stringify({ session_id: id }));
  fs.writeFileSync(path.join(output, dir, 'journal', 'events.jsonl'), run.journalRecords.filter(r => r.sessionId === id).map(r => JSON.stringify({ type: r.type, payload: r.payload })).join('\\n'));
}
fs.writeFileSync(path.join(output, 'export.json'), JSON.stringify(run.exportData));
process.stdout.write(run.stdout);
`, { mode: 0o700 });
      const config = { vibeCommand: command, workDir: fixture, maxTokens: 12000, timeoutMs: 15000, outputDir: path.join(base, 'evidence'), subagentConfigName: 'research' };
      const execution = await invokeVibeNativeAgent(question, config);
      assert.equal(validateG1(execution), true);
      assert.equal(validateG2(execution), true);
      assert.ok(existsSync(path.join(config.outputDir, 'export.json')));
      assert.ok(existsSync(path.join(config.outputDir, 'subagents/child/session/journal/events.jsonl')));
      assert.deepEqual(JSON.parse(readFileSync(path.join(config.outputDir, 'stdout.json'), 'utf8')), JSON.parse(evidence.stdout));
      assert.doesNotMatch(JSON.stringify(execution), /offline-secret-never-real|"api_key"/);
      assert.doesNotMatch(readFileSync(path.join(config.outputDir, 'export.json'), 'utf8'), /offline-secret-never-real|"api_key"/);
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
});

describe('ensureSubagentProfile (fail-closed deployment)', () => {
  const originalHome = process.env.VIBE_HOME;
  let base: string;
  beforeEach(() => { base = mkdtempSync(path.join(tmpdir(), 'vibe-profile-')); process.env.VIBE_HOME = path.join(base, 'home'); });
  afterEach(() => { rmSync(base, { recursive: true, force: true }); if (originalHome === undefined) delete process.env.VIBE_HOME; else process.env.VIBE_HOME = originalHome; });

  it('deploys a missing profile verbatim and never overwrites a different one', () => {
    const source = path.join(base, 'research.toml');
    const content = 'agent_type = "subagent"\ndescription = "research child"\n';
    writeFileSync(source, content);
    const target = ensureSubagentProfile('research', source);
    assert.ok(existsSync(target));
    assert.equal(readFileSync(target, 'utf8'), content);
    // Drift refusal: an existing, different profile is never replaced.
    writeFileSync(target, 'agent_type = "subagent"\ndescription = "tampered"\n');
    assert.throws(() => ensureSubagentProfile('research', source), /NO-GO.*differs/);
    assert.equal(readFileSync(target, 'utf8'), 'agent_type = "subagent"\ndescription = "tampered"\n');
  });

  it('refuses when the versioned source is missing', () => {
    const source = path.join(base, 'absent.toml');
    assert.throws(() => ensureSubagentProfile('research', source), /does not exist/);
  });
});
