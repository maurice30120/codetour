import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { analyzeCampaign } from '../report.mjs';

test('missing evidence and legacy fabricated traces cannot produce comparative savings', () => {
  const preregistration = JSON.parse(readFileSync(new URL('../preregistration-manifest.json', import.meta.url)));
  const trace = JSON.parse(readFileSync(new URL('../results_invalidated_fabricated_2026-11-15/runs/358c1e19-7d22-4f97-9aea-4d4097a32db7.json', import.meta.url)));
  for (const input of [{}, { preregistration, traces: [trace], evaluations: [] }]) {
    const report = analyzeCampaign(input);
    assert.equal(report.verdict, 'NO-GO');
    assert.equal(report.metrics, null);
    assert.ok(report.reasons.length > 0);
  }
});

// SYNTHETIC TEST ONLY. These generated receipts emulate an audited collector's
// contract to exercise the public API. They are NOT provider or benchmark evidence.
const canonical = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const hash = value => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
function fixture() {
  const artifacts = {};
  const put = value => { const id = hash(value); artifacts[id] = value; return id; };
  const postgres_sha = '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5';
  const sealed_at = '2026-11-15T00:00:00Z';
  const fixture_hash = put({ kind: 'fixture-audit', repository: 'postgres/postgres', postgres_sha,
    clean: true, read_only: true, same_tree: true, auditor: 'synthetic-fixture-auditor' });
  const native_identity_hash = put({ kind: 'native-vibe-identity', subagent: 'research', mode: 'native',
    version: 'synthetic-test-version', invocation: 'synthetic-test-command', auditor: 'synthetic-native-auditor' });
  const rubric_hash = put({ kind: 'evaluation-rubric', text: 'SYNTHETIC TEST ONLY: verify claims and causal relations against frozen source' });
  const configs = Object.fromEntries(['codetour', 'vibe-native'].map(agent => [agent, {
    model: 'synthetic-model', agent_version: 'synthetic-version', model_params: { temperature: 0, max_tokens: 1000 },
    tooling: agent === 'codetour' ? 'ten-primitives-quickjs' : 'native-research',
    prompt_hash: put({ kind: 'prompt', text: `SYNTHETIC TEST ONLY ${agent}` }),
  }]));
  const tasks = ['R', 'T'].flatMap(series => Array.from({ length: 20 }, (_, i) => ({
    id: `${series}-${i + 1}`, series, rank: i + 1,
    family: `${series}-family-${series === 'R' ? Math.floor(i / 4) : i % 10}`,
    phase: series === 'R' ? 'repetition' : i < 10 ? 'priming' : 'transfer',
  })));
  const gates = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`G${i}`, { status: 'PASS',
    evidence_hash: put({ kind: 'gate-audit', gate: `G${i}`, status: 'PASS', auditor: 'synthetic-auditor',
      checked_at: sealed_at, details: 'SYNTHETIC TEST ONLY gate evidence', attachments: [fixture_hash, native_identity_hash] }),
  }]));
  const preregistration = { spec: '174', status: 'PRE-REGISTERED', preregistration_timestamp: sealed_at,
    fixture: { sha: postgres_sha },
    thresholds: { minimum_gain: { series_R: '20%', series_T: '20%', combined: '20%' },
      quality_degradation: { max_correct_rate_difference: '5_percentage_points', max_additional_critical_false_claims: 0 } },
    reporting: { schema_version: 'spec174-report-input-v1', fixture_hash, native_identity_hash, rubric_hash, configs, tasks, gates } };
  const manifestLock = { locked: true, manifest_sha256: hash(preregistration).slice(7), frozen_at: sealed_at };
  const traces = [];
  const mappings = [];
  const records = [];
  for (const task of tasks) for (const agent of ['codetour', 'vibe-native']) {
    const run_id = `${task.id}-${agent}`;
    const usage = agent === 'codetour'
      ? { input_tokens: 40, output_tokens: 20, cache_read_tokens: 10, cache_write_tokens: 5, input_includes_cache: true }
      : { input_tokens: 35, output_tokens: 15, cache_read_tokens: 5, cache_write_tokens: 0, input_includes_cache: true };
    const roles = agent === 'codetour' ? ['agent'] : ['orchestrator', 'subagent'];
    const bindings = [];
    const calls = roles.map(role => {
      const request_id = `${run_id}-${role}`;
      const receipt = { kind: 'provider-usage', source: 'provider', provider: 'synthetic-provider',
        request_id, model: 'synthetic-model', usage };
      bindings.push({ call_id: request_id, role, phase: 'exploration', receipt_hash: put(receipt) });
      return { call_id: request_id, call_type: 'prompt', input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens, usage_missing: false };
    });
    const session_id = agent === 'codetour' ? `memory-${task.series}` : run_id;
    const result = { raw_response: `SYNTHETIC TEST ONLY answer ${task.id}`, citations: [] };
    const response_hash = put({ kind: 'agent-result', payload: result });
    const native_invocation_hash = agent === 'vibe-native' ? put({ kind: 'native-vibe-invocation',
      identity_hash: native_identity_hash, session_id, request_ids: calls.map(c => c.call_id) }) : undefined;
    const trace = { run_id, series: task.series, question_id: task.id, agent, phase: task.phase,
      postgres_sha, manifest_hash: manifestLock.manifest_sha256, timestamp: '2026-11-15T01:00:00Z', status: 'success',
      model: configs[agent].model, agent_version: configs[agent].agent_version, model_params: configs[agent].model_params,
      prompt_hash: configs[agent].prompt_hash, calls,
      total_tokens: { input: agent === 'codetour' ? 40 : 70, output: agent === 'codetour' ? 20 : 30,
        total: agent === 'codetour' ? 60 : 100, verified: true },
      fixture_verification: { head_sha: postgres_sha, clean_tree: true, verified_at: '2026-11-15T00:59:00Z' },
      result, functions_created: [], functions_reused: [] };
    traces.push(trace);
    put({ kind: 'run-inventory', run_id, complete: true, source: 'real-provider', trace_hash: hash(trace),
      scopes: agent === 'codetour' ? ['agent', 'selection', 'consolidation'] : roles,
      calls: bindings, response_hash, session_id, native_invocation_hash,
      memory: agent === 'codetour' ? { before_hash: hash([]), after_hash: hash([]) } : undefined });
    const evaluation_id = `blind-${records.length}`;
    const judgment = { correct: true, evidence_supported: true, major_missing_relation: false,
      critical_false_claim: false, coverage: 1, failed_claims: [], verified_lines: ['synthetic.c:1'],
      justification: 'SYNTHETIC TEST ONLY semantic judgment' };
    const input_hash = put({ kind: 'blinded-input', evaluation_id, payload: result });
    const judgment_hash = put({ kind: 'blind-judgment', evaluation_id, result: judgment });
    mappings.push({ run_id, evaluation_id, response_hash, input_hash, judgment_hash });
    records.push({ run_id, evaluation_id, result: judgment, evaluated_at: '2026-11-15T02:00:00Z' });
  }
  const audit_hash = put({ kind: 'blind-evaluation-audit', evaluator_id: 'synthetic-independent-evaluator',
    independent_of: ['codetour', 'vibe-native'], blind_to: ['agent', 'rank', 'memory', 'tokens'], rubric_hash, mappings });
  return { preregistration, manifestLock, traces, evaluations: { audit_hash, records }, artifacts };
}

// Re-seal only the synthetic fixture after a scenario changes its registration.
function reseal(data) {
  data.manifestLock.manifest_sha256 = hash(data.preregistration).slice(7);
  for (const trace of data.traces) {
    trace.manifest_hash = data.manifestLock.manifest_sha256;
    rebind(data, trace);
  }
}
function inventory(data, trace) {
  return Object.values(data.artifacts).find(a => a.kind === 'run-inventory' && a.run_id === trace.run_id);
}
function store(data, value) { const id = hash(value); data.artifacts[id] = value; return id; }
function rebind(data, trace, change = () => {}) {
  const old = inventory(data, trace);
  const inv = structuredClone(old);
  change(inv);
  inv.trace_hash = hash(trace);
  delete data.artifacts[hash(old)];
  store(data, inv);
}
function registered(data) {
  data.preregistration.reporting.statistics = { method: 'paired-cluster-bootstrap', confidence: 0.95,
    resamples: 1000, seed: 174, unit: 'family-and-memory-lineage',
    dependence: 'union-of-family-and-nonempty-memory-lineage',
    justification: 'SYNTHETIC TEST ONLY: resample paired intact families and all shared learning dependencies, stratified R/T' };
  reseal(data);
  return data;
}
function judgment(data, trace, change) {
  const record = data.evaluations.records.find(r => r.run_id === trace.run_id);
  record.result = structuredClone(record.result);
  change(record.result);
  const audit = structuredClone(data.artifacts[data.evaluations.audit_hash]);
  const mapping = audit.mappings.find(m => m.run_id === trace.run_id);
  mapping.judgment_hash = store(data, { kind: 'blind-judgment', evaluation_id: record.evaluation_id, result: record.result });
  data.evaluations.audit_hash = store(data, audit);
}
function addCall(data, trace, phase, usage) {
  const call_id = `${trace.run_id}-${phase}`;
  const receipt_hash = store(data, { kind: 'provider-usage', source: 'provider', provider: 'synthetic-provider',
    request_id: call_id, model: trace.model, usage });
  trace.calls.push({ call_id, call_type: phase === 'diagnostics' ? 'correction' : phase === 'creation' ? 'function_try' : 'consolidation',
    input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, usage_missing: false });
  trace.total_tokens.input += usage.input_tokens;
  trace.total_tokens.output += usage.output_tokens;
  trace.total_tokens.total += usage.input_tokens + usage.output_tokens;
  rebind(data, trace, inv => inv.calls.push({ call_id, role: 'agent', phase, receipt_hash }));
}

test('charges failures, creation, corrections and consolidation, preserving a 5pp quality boundary', () => {
  const data = registered(fixture());
  const first = data.traces[0];
  first.status = 'error';
  for (const [phase, input, output] of [['creation', 20, 10], ['diagnostics', 5, 5], ['consolidation', 10, 10]]) {
    addCall(data, first, phase, { input_tokens: input, output_tokens: output,
      cache_read_tokens: 0, cache_write_tokens: 0, input_includes_cache: true });
  }
  const report = analyzeCampaign(data);
  const r = report.metrics.R;
  assert.equal(r.codetour.tokens.total, 1260);
  assert.equal(r.codetour.quality.correct, 19);
  assert.equal(r.codetour.tokens_per_correct_tour, 1260 / 19);
  assert.equal(r.codetour.curve[0].tokens_per_correct_tour, null);
  assert.equal(r.codetour.phases.creation.total, 30);
  assert.equal(r.codetour.phases.diagnostics.total, 10);
  assert.equal(r.codetour.phases.consolidation.total, 20);
  assert.equal(r.quality_comparable, true);
  assert.equal(r.break_even.first_rank, 4);
  assert.equal(r.break_even.sustained_rank, 4);
});

test('adds exclusive cache usage and does not trust the runner total as the primary token metric', () => {
  const data = fixture();
  addCall(data, data.traces[0], 'retry', { input_tokens: 10, output_tokens: 5,
    cache_read_tokens: 3, cache_write_tokens: 2, input_includes_cache: false });
  const report = analyzeCampaign(data);
  assert.equal(report.metrics.R.codetour.tokens.total, 1220);
  assert.equal(report.metrics.R.codetour.tokens.input, 815);
  assert.equal(report.metrics.R.codetour.tokens.input_uncached, 510);
});

test('enforces the preset gain, quality, and critical false claim criteria separately for each series', () => {
  for (const scenario of ['low-gain', 'quality', 'critical']) {
    const data = registered(fixture());
    const selected = data.traces.filter(t => t.agent === 'codetour' && t.series === 'T');
    if (scenario === 'low-gain') for (const trace of selected) addCall(data, trace, 'retry', {
      input_tokens: 25, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, input_includes_cache: true,
    });
    if (scenario === 'quality') for (const trace of selected.slice(0, 2)) judgment(data, trace, q => { q.major_missing_relation = true; });
    if (scenario === 'critical') judgment(data, selected[0], q => {
      q.critical_false_claim = true;
      q.failed_claims.push({ reason: 'wrong_relation', severity: 'critical', claim: 'SYNTHETIC TEST ONLY false causal relation' });
    });
    const report = analyzeCampaign(data);
    assert.equal(report.verdict, 'INVALIDÉ', scenario);
    assert.equal(report.metrics.R.verdict, 'VALIDÉ', scenario);
    assert.equal(report.metrics.T.verdict, 'INVALIDÉ', scenario);
    if (scenario === 'critical') assert.equal(report.metrics.T.codetour.quality.false_relations, 1);
  }
});

test('zero correct Tours stays undefined, including all failed-run tokens', () => {
  const data = registered(fixture());
  for (const trace of data.traces.filter(t => t.agent === 'codetour')) {
    trace.status = 'timeout'; rebind(data, trace);
  }
  const report = analyzeCampaign(data);
  assert.equal(report.verdict, 'INDÉTERMINÉ');
  assert.equal(report.metrics.combined.codetour.tokens.total, 2400);
  assert.equal(report.metrics.combined.codetour.tokens_per_correct_tour, null);
  assert.equal(report.metrics.combined.relative_reduction, null);
  assert.equal(report.metrics.R.break_even.first_rank, null);
  assert.equal(report.metrics.R.uncertainty.undefined_resamples, 1000);
});

test('all provenance, pairing, blind evaluation and usage failures block principal calculations', () => {
  const cases = {
    'missing run': d => d.traces.pop(),
    'missing evaluation': d => d.evaluations.records.pop(),
    'duplicated run': d => { d.traces[1] = d.traces[0]; },
    'gate unpassed': d => { d.preregistration.reporting.gates.G1.status = 'FAIL'; reseal(d); },
    'artifact tampered': d => { d.artifacts[d.preregistration.reporting.fixture_hash].clean = false; },
    'wrong manifest': d => { d.traces[0].manifest_hash = 'bad'; },
    'wrong prompt': d => { d.traces[0].prompt_hash = 'bad'; rebind(d, d.traces[0]); },
    'fixture unverified': d => { delete d.traces[0].fixture_verification; rebind(d, d.traces[0]); },
    'missing usage on failure': d => { d.traces[0].status = 'error'; d.traces[0].calls[0].usage_missing = true; rebind(d, d.traces[0]); },
    'unverified totals': d => { d.traces[0].total_tokens.verified = false; rebind(d, d.traces[0]); },
    'falsified totals': d => { d.traces[0].total_tokens.total = 1; rebind(d, d.traces[0]); },
    'negative counts': d => { d.traces[0].calls[0].input_tokens = -1; rebind(d, d.traces[0]); },
    'orchestrator omitted': d => rebind(d, d.traces[1], inv => { inv.scopes = ['subagent']; }),
    'headless substituted': d => rebind(d, d.traces[1], inv => {
      inv.native_invocation_hash = store(d, { kind: 'headless-invocation' });
    }),
    'session contaminated': d => rebind(d, d.traces[3], inv => { inv.session_id = inventory(d, d.traces[1]).session_id; }),
    'memory reset in series': d => rebind(d, d.traces[2], inv => { inv.session_id = 'different'; }),
    'broken memory lineage': d => rebind(d, d.traces[2], inv => { inv.memory.before_hash = 'unobserved'; }),
    'not independent evaluator': d => {
      const audit = structuredClone(d.artifacts[d.evaluations.audit_hash]); audit.independent_of = [];
      d.evaluations.audit_hash = store(d, audit);
    },
    'wrong evaluation response': d => {
      const audit = structuredClone(d.artifacts[d.evaluations.audit_hash]); audit.mappings[0].response_hash = 'bad';
      d.evaluations.audit_hash = store(d, audit);
    },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const data = fixture(); mutate(data);
    const report = analyzeCampaign(data);
    assert.equal(report.verdict, 'NO-GO', name);
    assert.equal(report.metrics, null, name);
  }
});

test('uses preregistered paired family bootstrap and preserves shared learning dependencies', () => {
  const independent = registered(fixture());
  const report = analyzeCampaign(independent);
  assert.equal(report.verdict, 'VALIDÉ');
  assert.deepEqual(report.metrics.R.uncertainty.gain_ci95, [0.4, 0.4]);
  assert.equal(report.metrics.R.uncertainty.clusters.R, 5);
  assert.equal(report.metrics.T.uncertainty.clusters.T, 10);
  assert.deepEqual(analyzeCampaign(independent), report);

  const dependent = registered(fixture());
  const state = store(dependent, ['SYNTHETIC TEST ONLY learned function']);
  for (const trace of dependent.traces.filter(t => t.agent === 'codetour')) {
    rebind(dependent, trace, inv => {
      inv.memory.before_hash = trace.question_id.endsWith('-1') ? hash([]) : state;
      inv.memory.after_hash = state;
    });
  }
  const uncertain = analyzeCampaign(dependent);
  assert.equal(uncertain.verdict, 'INDÉTERMINÉ');
  assert.equal(uncertain.metrics.R.uncertainty.gain_ci95, null);
  assert.equal(uncertain.metrics.R.uncertainty.clusters.R, 1);
  assert.match(uncertain.reasons.join(' '), /independent.*cluster/i);
});

test('accounts for actual input/cache once, reports R/T and combined curves, and requires registered inference', () => {
  const report = analyzeCampaign(fixture());
  assert.equal(report.verdict, 'INDÉTERMINÉ');
  assert.deepEqual(report.metrics.R.codetour.tokens, {
    input_uncached: 500, input: 800, output: 400, cache_read: 200, cache_write: 100, total: 1200,
  });
  assert.equal(report.metrics.R['vibe-native'].tokens.total, 2000);
  assert.equal(report.metrics.T.codetour.tokens.total, 1200);
  assert.equal(report.metrics.combined.codetour.tokens_per_correct_tour, 60);
  assert.equal(report.metrics.combined.relative_reduction, 0.4);
  assert.equal(report.metrics.R.codetour.curve[19].cumulative_tokens, 1200);
  assert.equal(report.metrics.R.codetour.curve[0].marginal_tokens, 60);
  assert.equal(report.metrics.R.break_even.first_rank, 1);
  assert.equal(report.metrics.R.codetour.quality.correct_rate, 1);
  assert.match(report.reasons.join(' '), /preregistered.*method/i);
});

test('CLI writes reproducible explicit JSON and Markdown, preserves inputs, and exits NO-GO on absent evidence', () => {
  const dir = mkdtempSync(new URL('../../../.report-test-', import.meta.url));
  try {
    const data = registered(fixture());
    const manifestBytes = `${JSON.stringify(data.preregistration, null, 2)}\n`;
    const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
    data.manifestLock.manifest_sha256 = manifestHash;
    for (const trace of data.traces) { trace.manifest_hash = manifestHash; rebind(data, trace); }
    const files = { preregistration: 'manifest.json', manifestLock: 'lock.json', traces: 'traces.json',
      evaluations: 'evaluations.json', artifacts: 'artifacts.json' };
    for (const [key, name] of Object.entries(files)) writeFileSync(join(dir, name), key === 'preregistration' ? manifestBytes : JSON.stringify(data[key]));
    const argv = [fileURLToPath(new URL('../report.mjs', import.meta.url)), '--preregistration', join(dir, files.preregistration),
      '--manifest-lock', join(dir, files.manifestLock), '--traces', join(dir, files.traces),
      '--evaluations', join(dir, files.evaluations), '--artifacts', join(dir, files.artifacts),
      '--json', join(dir, 'report.json'), '--markdown', join(dir, 'report.md')];
    const result = spawnSync(process.execPath, argv, { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(join(dir, 'report.json')));
    const markdown = readFileSync(join(dir, 'report.md'), 'utf8');
    assert.equal(report.verdict, 'VALIDÉ');
    assert.equal(report.provenance.manifest_hash, `sha256:${manifestHash}`);
    assert.match(markdown, /VALIDÉ/);
    assert.match(markdown, /```mermaid/);
    assert.match(markdown, /1200/);
    assert.match(markdown, /SYNTHETIC|trust boundary|authenticity/i);
    assert.equal(readFileSync(join(dir, 'manifest.json'), 'utf8'), manifestBytes);
    const repeat = spawnSync(process.execPath, argv, { encoding: 'utf8' });
    assert.equal(repeat.status, 2);
    assert.match(repeat.stderr, /exist/i);
    assert.equal(readFileSync(join(dir, 'report.md'), 'utf8'), markdown);
    rmSync(join(dir, 'report.json')); rmSync(join(dir, 'report.md'));
    writeFileSync(join(dir, 'artifacts.json'), '{}');
    const blocked = spawnSync(process.execPath, argv, { encoding: 'utf8' });
    assert.equal(blocked.status, 2);
    assert.equal(JSON.parse(readFileSync(join(dir, 'report.json'))).metrics, null);
    assert.match(readFileSync(join(dir, 'report.md'), 'utf8'), /NO-GO/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
