/** Spec #174 / #182. See REPORTING.md for the collector/auditor trust boundary. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, openSync, writeFileSync, closeSync, unlinkSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENTS = ['codetour', 'vibe-native'];
const SERIES = ['R', 'T'];
const POSTGRES_SHA = '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5';
const canonical = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const digest = value => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
const bytesDigest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const same = (a, b) => canonical(a) === canonical(b);
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const text = value => typeof value === 'string' && value.trim().length > 0;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const normHash = value => typeof value === 'string' ? value.replace(/^sha256:/, '') : '';
const list = value => Array.isArray(value) ? value : [];
const emptyTokens = () => ({ input_uncached: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0 });
function addTokens(a, b) {
  for (const key of Object.keys(a)) {
    a[key] += b[key];
    ensure(integer(a[key]), 'Token sum exceeds safe integer precision');
  }
  return a;
}
function countUsage(usage) {
  ensure(usage && ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'].every(k => integer(usage[k]))
    && typeof usage.input_includes_cache === 'boolean', 'Incomplete provider input/output/cache convention');
  const cache = usage.cache_read_tokens + usage.cache_write_tokens;
  const input = usage.input_tokens + (usage.input_includes_cache ? 0 : cache);
  ensure(!usage.input_includes_cache || cache <= input, 'Cache subsets exceed inclusive provider input');
  const tokens = { input_uncached: input - cache, input, output: usage.output_tokens,
    cache_read: usage.cache_read_tokens, cache_write: usage.cache_write_tokens, total: input + usage.output_tokens };
  ensure(Object.values(tokens).every(integer), 'Invalid or overflowing provider token counts');
  return tokens;
}

function validate(input) {
  const { traces, evaluations, artifacts, manifestLock } = input;
  const manifest = typeof input.preregistration === 'string' ? JSON.parse(input.preregistration) : input.preregistration;
  ensure(manifest?.spec === '174' && manifest.status === 'PRE-REGISTERED', 'Missing spec174 preregistration manifest');
  const manifest_hash = typeof input.preregistration === 'string' ? bytesDigest(input.preregistration) : digest(manifest);
  ensure(manifestLock?.locked === true && normHash(manifestLock.manifest_sha256) === normHash(manifest_hash)
    && date(manifestLock.frozen_at), 'Missing or mismatched exact manifest lock');
  ensure(date(manifest.preregistration_timestamp), 'Invalid preregistration timestamp');
  const frozen = Math.max(Date.parse(manifestLock.frozen_at), Date.parse(manifest.preregistration_timestamp));
  ensure(manifest.fixture?.sha === POSTGRES_SHA, 'Wrong preregistered PostgreSQL SHA');
  const plan = manifest.reporting;
  ensure(plan?.schema_version === 'spec174-report-input-v1', 'Missing sealed reporting provenance and task registration');
  ensure(artifacts && typeof artifacts === 'object' && !Array.isArray(artifacts), 'Missing content-addressed evidence artifacts');
  for (const [hash, artifact] of Object.entries(artifacts)) {
    ensure(digest(artifact) === hash, `Evidence artifact digest mismatch: ${hash}`);
    ensure(!artifact.synthetic && !artifact.simulated && !artifact.mock && !artifact.estimated, 'Synthetic/estimated artifact is not principal evidence');
  }
  const get = (hash, kind) => {
    const value = artifacts[hash];
    ensure(value?.kind === kind, `Missing ${kind} evidence: ${hash ?? '(no hash)'}`);
    return value;
  };
  const fixture = get(plan.fixture_hash, 'fixture-audit');
  ensure(fixture.postgres_sha === POSTGRES_SHA && fixture.repository === 'postgres/postgres'
    && fixture.clean === true && fixture.read_only === true && fixture.same_tree === true && text(fixture.auditor), 'Fixture audit failed');
  const native = get(plan.native_identity_hash, 'native-vibe-identity');
  ensure(native.mode === 'native' && native.subagent === 'research' && text(native.version)
    && text(native.invocation) && text(native.auditor), 'Native Vibe identity not verified');
  get(plan.rubric_hash, 'evaluation-rubric');
  for (let i = 0; i < 6; i++) {
    const name = `G${i}`;
    const gate = plan.gates?.[name];
    ensure(gate?.status === 'PASS', `Gate ${name} not passed`);
    const audit = get(gate.evidence_hash, 'gate-audit');
    ensure(audit.gate === name && audit.status === 'PASS' && text(audit.auditor) && text(audit.details)
      && date(audit.checked_at) && Date.parse(audit.checked_at) <= frozen
      && list(audit.attachments).length > 0 && audit.attachments.every(h => artifacts[h]), `Gate ${name} lacks audit evidence`);
  }
  const thresholds = manifest.thresholds;
  ensure(['series_R', 'series_T', 'combined'].every(k => thresholds?.minimum_gain?.[k] === '20%')
    && thresholds.quality_degradation?.max_correct_rate_difference === '5_percentage_points'
    && thresholds.quality_degradation.max_additional_critical_false_claims === 0, 'Thresholds must be preregistered: 20%, 5pp, zero additional critical false claims');
  for (const agent of AGENTS) {
    const config = plan.configs?.[agent];
    ensure(text(config?.model) && text(config.agent_version) && config.model_params && text(config.tooling), `Missing ${agent} frozen configuration`);
    get(config.prompt_hash, 'prompt');
  }
  const tasks = list(plan.tasks);
  ensure(tasks.length === 40, 'Expected 40 registered tasks (20 R + 20 T); extension requires a separately preregistered analysis');
  for (const series of SERIES) {
    const rows = tasks.filter(t => t.series === series).sort((a, b) => a.rank - b.rank);
    ensure(rows.length === 20 && rows.every((t, i) => t.rank === i + 1 && text(t.id) && text(t.family)), `Missing ranks/families for ${series}`);
    ensure(new Set(rows.map(t => t.id)).size === 20, `Duplicate registered tasks in ${series}`);
    ensure(series === 'R' ? rows.every(t => t.phase === 'repetition')
      : rows.every((t, i) => t.phase === (i < 10 ? 'priming' : 'transfer')), `Invalid ${series} priming/repetition registration`);
  }
  ensure(Array.isArray(traces), 'Missing campaign trace array');
  const main = traces.filter(t => !t.measurement_phase || t.measurement_phase === 'main');
  ensure(traces.every(t => !t.measurement_phase || ['main', 'pilot', 'diagnostic'].includes(t.measurement_phase)), 'Unknown measurement phase');
  ensure(main.length === 80, 'Incomplete real campaign: expected 80 main traces');
  ensure(new Set(traces.map(t => t.run_id)).size === traces.length, 'Duplicate run IDs');
  const inventories = Object.values(artifacts).filter(a => a.kind === 'run-inventory');
  const usedRequests = new Set();
  const paired = new Set();
  const sessions = new Set();
  const rows = [];
  for (const run of main) {
    ensure(text(run.run_id) && AGENTS.includes(run.agent) && SERIES.includes(run.series), 'Invalid run provenance');
    const task = tasks.find(t => t.id === run.question_id && t.series === run.series);
    ensure(task && task.phase === run.phase, `Unregistered question/phase: ${run.run_id}`);
    const pair = `${run.series}:${task.rank}:${run.agent}`;
    ensure(!paired.has(pair), `Duplicate pair: ${pair}`); paired.add(pair);
    ensure(date(run.timestamp) && Date.parse(run.timestamp) >= frozen, `Run predates protocol freeze: ${run.run_id}`);
    ensure(run.postgres_sha === POSTGRES_SHA && normHash(run.manifest_hash) === normHash(manifest_hash), `SHA/manifest mismatch: ${run.run_id}`);
    const verification = run.fixture_verification;
    ensure(verification?.head_sha === POSTGRES_SHA && verification.clean_tree === true && date(verification.verified_at)
      && Date.parse(verification.verified_at) <= Date.parse(run.timestamp), `Per-run fixture verification missing/invalid: ${run.run_id}`);
    const config = plan.configs[run.agent];
    ensure(run.model === config.model && run.agent_version === config.agent_version && same(run.model_params, config.model_params)
      && normHash(run.prompt_hash) === normHash(config.prompt_hash), `Unregistered configuration/prompt difference: ${run.run_id}`);
    ensure(['success', 'error', 'timeout', 'partial'].includes(run.status), `Unknown run status: ${run.run_id}`);
    ensure(run.total_tokens?.verified === true && list(run.calls).length > 0, `Missing verified usage: ${run.run_id}`);
    const matches = inventories.filter(a => a.run_id === run.run_id);
    ensure(matches.length === 1, `Missing/duplicate complete provider inventory: ${run.run_id}`);
    const inv = matches[0];
    ensure(inv.complete === true && inv.source === 'real-provider' && inv.trace_hash === digest(run)
      && text(inv.session_id), `Unverified/fabricated trace inventory: ${run.run_id}`);
    const scopes = run.agent === 'codetour' ? ['agent', 'selection', 'consolidation'] : ['orchestrator', 'subagent'];
    ensure(scopes.every(s => list(inv.scopes).includes(s)), `Incomplete end-to-end provider scopes: ${run.run_id}`);
    ensure(list(inv.calls).length === run.calls.length && new Set(inv.calls.map(c => c.call_id)).size === run.calls.length,
      `Provider call inventory incomplete: ${run.run_id}`);
    const result = get(inv.response_hash, 'agent-result');
    ensure(same(result.payload, run.result), `Raw response digest mismatch: ${run.run_id}`);
    let inputTotal = 0; let outputTotal = 0;
    const tokens = emptyTokens(); const phases = {}; const requests = [];
    for (const call of run.calls) {
      ensure(call.usage_missing === false && integer(call.input_tokens) && integer(call.output_tokens), `Missing/invalid provider usage: ${run.run_id}/${call.call_id}`);
      const binding = inv.calls.find(c => c.call_id === call.call_id);
      ensure(binding && text(binding.phase) && scopes.includes(binding.role), `Unlinked LLM call: ${call.call_id}`);
      const receipt = get(binding.receipt_hash, 'provider-usage');
      ensure(receipt.source === 'provider' && text(receipt.provider) && text(receipt.request_id)
        && receipt.model === run.model && receipt.usage?.input_tokens === call.input_tokens
        && receipt.usage.output_tokens === call.output_tokens, `Provider receipt mismatch: ${call.call_id}`);
      const requestKey = `${receipt.provider}:${receipt.request_id}`;
      ensure(!usedRequests.has(requestKey), `Reused provider request: ${requestKey}`); usedRequests.add(requestKey);
      requests.push(receipt.request_id);
      const usage = countUsage(receipt.usage);
      addTokens(tokens, usage);
      phases[binding.phase] = addTokens(phases[binding.phase] ?? emptyTokens(), usage);
      inputTotal += call.input_tokens; outputTotal += call.output_tokens;
    }
    ensure(run.total_tokens.input === inputTotal && run.total_tokens.output === outputTotal
      && run.total_tokens.total === inputTotal + outputTotal, `Runner token totals disagree with per-call usage: ${run.run_id}`);
    if (run.agent === 'vibe-native') {
      ensure(!sessions.has(inv.session_id), 'Contaminated Vibe session reused'); sessions.add(inv.session_id);
      const invocation = get(inv.native_invocation_hash, 'native-vibe-invocation');
      ensure(invocation.identity_hash === plan.native_identity_hash && invocation.session_id === inv.session_id
        && same(list(invocation.request_ids).toSorted(), requests.toSorted()), `Native invocation does not cover actual calls: ${run.run_id}`);
    }
    rows.push({ run, task, inv, tokens, phases });
  }
  // The full learning trajectory is a dependency, even if a function was not reused.
  for (const series of SERIES) {
    const ordered = rows.filter(r => r.run.agent === 'codetour' && r.task.series === series).sort((a, b) => a.task.rank - b.task.rank);
    ensure(new Set(ordered.map(r => r.inv.session_id)).size === 1, `${series} learning session reset within series`);
    let previous = digest([]);
    for (const row of ordered) {
      ensure(row.inv.memory?.before_hash === previous && text(row.inv.memory.after_hash), `${series} memory lineage is missing/broken`);
      previous = row.inv.memory.after_hash;
    }
  }
  ensure(rows.find(r => r.run.agent === 'codetour' && r.task.series === 'R').inv.session_id
    !== rows.find(r => r.run.agent === 'codetour' && r.task.series === 'T').inv.session_id, 'Memory shared between R and T');
  const audit = get(evaluations?.audit_hash, 'blind-evaluation-audit');
  ensure(text(audit.evaluator_id) && !AGENTS.includes(audit.evaluator_id) && audit.rubric_hash === plan.rubric_hash
    && AGENTS.every(a => list(audit.independent_of).includes(a))
    && ['agent', 'rank', 'memory', 'tokens'].every(k => list(audit.blind_to).includes(k)), 'Evaluator independence/blinding not audited');
  ensure(list(evaluations.records).length === 80 && list(audit.mappings).length === 80, 'Incomplete blind evaluations');
  ensure(new Set(evaluations.records.map(r => r.run_id)).size === 80
    && new Set(evaluations.records.map(r => r.evaluation_id)).size === 80
    && new Set(audit.mappings.map(r => r.run_id)).size === 80, 'Duplicate blind evaluations/mappings');
  for (const row of rows) {
    const evaluation = evaluations.records.find(e => e.run_id === row.run.run_id);
    const mapping = audit.mappings.find(m => m.run_id === row.run.run_id);
    ensure(evaluation && mapping?.evaluation_id === evaluation.evaluation_id && mapping.response_hash === row.inv.response_hash,
      `Missing or wrong blind evaluation mapping: ${row.run.run_id}`);
    const blinded = get(mapping.input_hash, 'blinded-input');
    const judgment = get(mapping.judgment_hash, 'blind-judgment');
    ensure(blinded.evaluation_id === evaluation.evaluation_id && same(blinded.payload, row.run.result)
      && judgment.evaluation_id === evaluation.evaluation_id && same(judgment.result, evaluation.result), 'Blind judgment/input linkage failed');
    ensure(date(evaluation.evaluated_at) && Date.parse(evaluation.evaluated_at) >= Date.parse(row.run.timestamp), 'Evaluation predates response');
    const quality = evaluation.result;
    ensure(['correct', 'evidence_supported', 'major_missing_relation', 'critical_false_claim'].every(k => typeof quality?.[k] === 'boolean')
      && Number.isFinite(quality.coverage) && quality.coverage >= 0 && quality.coverage <= 1
      && Array.isArray(quality.failed_claims) && Array.isArray(quality.verified_lines) && text(quality.justification), 'Incomplete semantic blind judgment');
    row.quality = quality;
    row.correct = row.run.status === 'success' && quality.correct && quality.evidence_supported
      && !quality.major_missing_relation && !quality.critical_false_claim;
  }
  return { rows, plan, manifest_hash, excluded: traces.filter(t => !main.includes(t)).map(t => ({ run_id: t.run_id, phase: t.measurement_phase })) };
}

function aggregate(rows) {
  const tokens = emptyTokens(); const phases = {}; const statuses = {};
  const curve = []; let correct = 0;
  for (const row of rows.toSorted((a, b) => a.task.series.localeCompare(b.task.series) || a.task.rank - b.task.rank)) {
    addTokens(tokens, row.tokens); correct += Number(row.correct);
    for (const [phase, counts] of Object.entries(row.phases)) phases[phase] = addTokens(phases[phase] ?? emptyTokens(), counts);
    statuses[row.run.status] = (statuses[row.run.status] ?? 0) + 1;
    curve.push({ series: row.task.series, rank: row.task.rank, question_id: row.task.id, run_id: row.run.run_id,
      marginal_tokens: row.tokens.total, cumulative_tokens: tokens.total, cumulative_correct: correct,
      tokens_per_correct_tour: correct ? tokens.total / correct : null });
  }
  const n = rows.length;
  return { runs: n, tokens, tokens_per_correct_tour: correct ? tokens.total / correct : null, phases, statuses, curve,
    quality: { correct, correct_rate: correct / n, coverage: rows.reduce((s, r) => s + r.quality.coverage, 0) / n,
      evidence_supported_rate: rows.filter(r => r.quality.evidence_supported).length / n,
      major_missing_relations: rows.filter(r => r.quality.major_missing_relation).length,
      critical_false_claims: rows.filter(r => r.quality.critical_false_claim).length,
      false_relations: rows.reduce((s, r) => s + r.quality.failed_claims.filter(c => c.reason === 'wrong_relation').length, 0) },
    functions: { created: rows.reduce((s, r) => s + list(r.run.functions_created).length, 0),
      reused: rows.reduce((s, r) => s + list(r.run.functions_reused).length, 0),
      replaced: rows.reduce((s, r) => s + list(r.run.functions_replaced).length, 0) } };
}
function compare(rows, combined = false) {
  const codetour = aggregate(rows.filter(r => r.run.agent === 'codetour'));
  const vibe = aggregate(rows.filter(r => r.run.agent === 'vibe-native'));
  const gain = codetour.tokens_per_correct_tour === null || vibe.tokens_per_correct_tour === null || vibe.tokens_per_correct_tour === 0
    ? null : 1 - codetour.tokens_per_correct_tour / vibe.tokens_per_correct_tour;
  const qualityComparable = codetour.quality.correct_rate + 0.05 + 1e-12 >= vibe.quality.correct_rate
    && codetour.quality.critical_false_claims <= vibe.quality.critical_false_claims;
  const crossings = codetour.curve.map((point, i) => point.tokens_per_correct_tour !== null
    && vibe.curve[i].tokens_per_correct_tour !== null && point.tokens_per_correct_tour <= vibe.curve[i].tokens_per_correct_tour);
  const first = crossings.indexOf(true);
  const sustained = crossings.findIndex((hit, i) => hit && crossings.slice(i).every(Boolean));
  return { codetour, 'vibe-native': vibe, relative_reduction: gain, quality_comparable: qualityComparable,
    break_even: combined ? null : { first_rank: first < 0 ? null : first + 1,
      sustained_rank: sustained < 0 ? null : sustained + 1, quality_comparable: qualityComparable,
      basis: 'observed cumulative system tokens per correct Tour; no extrapolation' }, uncertainty: null };
}

function registeredMethod(stats) {
  return stats?.method === 'paired-cluster-bootstrap' && stats.confidence === 0.95
    && integer(stats.resamples) && stats.resamples >= 1000 && stats.resamples <= 100000
    && integer(stats.seed) && stats.seed > 0 && stats.seed <= 0xffffffff
    && stats.unit === 'family-and-memory-lineage'
    && stats.dependence === 'union-of-family-and-nonempty-memory-lineage' && text(stats.justification);
}
function dependencyClusters(rows) {
  const groups = {};
  for (const series of SERIES) {
    const ordered = rows.filter(r => r.task.series === series && r.run.agent === 'codetour').sort((a, b) => a.task.rank - b.task.rank);
    if (!ordered.length) continue;
    const parent = ordered.map((_, i) => i);
    const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    const join = (a, b) => { parent[find(a)] = find(b); };
    for (let i = 0; i < ordered.length; i++) {
      const current = ordered[i];
      for (let j = 0; j < i; j++) {
        const prior = ordered[j];
        if (prior.task.family === current.task.family
          || (text(current.task.dependency_cluster) && prior.task.dependency_cluster === current.task.dependency_cluster)) join(i, j);
      }
      // A nonempty persistent catalogue connects the current and previous run.
      // Transitivity preserves cross-family learning, not just observed reuses.
      if (i > 0 && current.inv.memory.before_hash !== digest([])) join(i, i - 1);
    }
    const clusters = new Map();
    for (let i = 0; i < ordered.length; i++) {
      const root = find(i);
      const cluster = clusters.get(root) ?? [];
      cluster.push(...rows.filter(r => r.task.series === series && r.task.id === ordered[i].task.id));
      clusters.set(root, cluster);
    }
    groups[series] = [...clusters.values()];
  }
  return groups;
}
function bootstrap(rows, stats) {
  const groups = dependencyClusters(rows);
  const counts = Object.fromEntries(Object.entries(groups).map(([s, clusters]) => [s, clusters.length]));
  const base = { method: stats.method, unit: stats.unit, seed: stats.seed, resamples: stats.resamples,
    confidence: stats.confidence, clusters: counts, gain_ci95: null, quality_difference_ci95: null, undefined_resamples: 0 };
  if (Object.values(counts).some(n => n < 2)) return { ...base, reason: 'Insufficient independent dependency clusters; one learning trajectory is not replication' };
  let state = stats.seed;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const gains = []; const qualities = [];
  for (let b = 0; b < stats.resamples; b++) {
    const totals = { codetour: { tokens: 0, correct: 0, n: 0 }, 'vibe-native': { tokens: 0, correct: 0, n: 0 } };
    for (const clusters of Object.values(groups)) for (let draw = 0; draw < clusters.length; draw++) {
      for (const row of clusters[Math.floor(random() * clusters.length)]) {
        const total = totals[row.run.agent];
        total.tokens += row.tokens.total; total.correct += Number(row.correct); total.n++;
      }
    }
    const c = totals.codetour; const v = totals['vibe-native'];
    if (c.correct && v.correct && v.tokens) gains.push(1 - (c.tokens / c.correct) / (v.tokens / v.correct));
    else base.undefined_resamples++;
    qualities.push(c.correct / c.n - v.correct / v.n);
  }
  const interval = values => {
    values.sort((a, b) => a - b);
    const quantile = p => { const x = (values.length - 1) * p; const i = Math.floor(x); return values[i] + (values[Math.ceil(x)] - values[i]) * (x - i); };
    return [quantile(0.025), quantile(0.975)];
  };
  // Do not silently drop zero-correct resamples and report a conditional CI.
  return { ...base, gain_ci95: base.undefined_resamples ? null : interval(gains), quality_difference_ci95: interval(qualities),
    reason: base.undefined_resamples ? 'Some paired resamples have undefined tokens per correct Tour' : null };
}

export function analyzeCampaign(input = {}) {
  const report = { schema_version: 'spec174-report-v1', verdict: 'NO-GO', reasons: [], metrics: null,
    thresholds: { minimum_gain: 0.2, max_quality_degradation: 0.05, max_additional_critical_false_claims: 0 },
    provenance: { input_hash: digest(input) },
    limitations: ['Evidence hashes establish integrity, not provider authenticity: audited collector provenance remains a trust boundary.',
      'Function reuse counts and observed creation costs are descriptive; no savings are attributed to functions.',
      'Latency and money do not determine this verdict. Optional diagnostics and pilots are excluded from principal metrics.'] };
  try {
    const { rows, plan, manifest_hash, excluded } = validate(input);
    report.provenance = { ...report.provenance, manifest_hash, included_run_ids: rows.map(r => r.run.run_id).toSorted(), excluded };
    report.metrics = Object.fromEntries(SERIES.map(s => [s, compare(rows.filter(r => r.task.series === s))]));
    report.metrics.combined = compare(rows, true);
    report.provenance.registered_statistics = plan.statistics ?? null;
    if (!registeredMethod(plan.statistics)) {
      report.verdict = 'INDÉTERMINÉ';
      report.reasons = ['A complete preregistered statistical method is required before inference'];
      return report;
    }
    const decisions = [];
    for (const [series, metrics] of Object.entries(report.metrics)) {
      metrics.uncertainty = bootstrap(series === 'combined' ? rows : rows.filter(r => r.task.series === series), plan.statistics);
      let verdict = 'INDÉTERMINÉ'; let reason;
      if (metrics.relative_reduction === null) reason = 'Zero correct Tours or undefined reference token ratio';
      else if (!metrics.quality_comparable) { verdict = 'INVALIDÉ'; reason = 'Quality exceeds 5pp degradation or additional critical false claims'; }
      else if (metrics.relative_reduction + 1e-12 < 0.2) { verdict = 'INVALIDÉ'; reason = 'Observed tokens per correct Tour reduction is below 20%'; }
      else if (metrics.uncertainty.gain_ci95?.[0] > 0) { verdict = 'VALIDÉ'; reason = 'At least 20% reduction, paired 95% CI strictly above zero, quality criteria satisfied'; }
      else reason = metrics.uncertainty.reason ?? 'Paired 95% gain interval includes zero';
      metrics.verdict = verdict;
      decisions.push(verdict);
      report.reasons.push(`${series}: ${reason}`);
    }
    report.verdict = decisions.includes('INVALIDÉ') ? 'INVALIDÉ' : decisions.every(d => d === 'VALIDÉ') ? 'VALIDÉ' : 'INDÉTERMINÉ';
  } catch (error) {
    report.reasons = [error.message];
  }
  return report;
}

function markdown(report) {
  const cell = v => String(v ?? 'undefined').replaceAll('|', '\\|').replaceAll('\n', ' ');
  const number = v => v === null || v === undefined ? 'undefined' : Number.isInteger(v) ? String(v) : v.toFixed(4);
  const percent = v => v === null ? 'undefined' : `${number(v * 100)}%`;
  const lines = [`# Spec #174 / T08: ${report.verdict}`, '', ...report.reasons.map(r => `- ${cell(r)}`), '',
    'Preset criteria: ≥20% fewer cumulative tokens per correct Tour in R, T and combined; paired 95% gain interval strictly above zero; quality degradation ≤5pp; no additional critical false claims.', '',
    '## Provenance', '', '```json', JSON.stringify(report.provenance, null, 2), '```', '',
    '## Limits', '', ...report.limitations.map(l => `- ${l}`), ''];
  if (!report.metrics) {
    lines.push('Principal metrics withheld: evidence is incomplete or invalid. No savings claim is permitted.', '');
    return lines.join('\n');
  }
  lines.push('## Observed costs and blind quality', '',
    '| Scope | Agent | Runs | Correct | Coverage | Uncached input | Cache read | Cache write | Input incl. cache | Output | Total | Tokens/correct |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [scope, group] of Object.entries(report.metrics)) for (const agent of AGENTS) {
    const m = group[agent];
    lines.push(`| ${scope} | ${agent} | ${m.runs} | ${m.quality.correct} | ${number(m.quality.coverage)} | ${m.tokens.input_uncached} | ${m.tokens.cache_read} | ${m.tokens.cache_write} | ${m.tokens.input} | ${m.tokens.output} | ${m.tokens.total} | ${number(m.tokens_per_correct_tour)} |`);
  }
  lines.push('', '## Decision and uncertainty', '', '| Scope | Reduction | Paired 95% gain interval | Independent clusters | Quality comparable | Verdict |',
    '| --- | ---: | --- | --- | --- | --- |');
  for (const [scope, m] of Object.entries(report.metrics)) {
    lines.push(`| ${scope} | ${percent(m.relative_reduction)} | ${m.uncertainty?.gain_ci95?.map(percent).join(' to ') ?? 'undefined'} | ${cell(JSON.stringify(m.uncertainty?.clusters ?? null))} | ${m.quality_comparable} | ${m.verdict ?? 'INDÉTERMINÉ'} |`);
  }
  for (const series of SERIES) {
    const group = report.metrics[series];
    lines.push('', `## ${series}: observed rank curves`, '',
      `System break-even, cumulative tokens per correct Tour: first rank ${number(group.break_even.first_rank)}, sustained rank ${number(group.break_even.sustained_rank)}; quality comparable: ${group.quality_comparable}. No extrapolation.`, '',
      '| Rank | CodeTour marginal | Vibe marginal | CodeTour cumulative | Vibe cumulative | CodeTour cumulative tokens/correct | Vibe cumulative tokens/correct |',
      '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (let i = 0; i < group.codetour.curve.length; i++) {
      const c = group.codetour.curve[i]; const v = group['vibe-native'].curve[i];
      lines.push(`| ${c.rank} | ${c.marginal_tokens} | ${v.marginal_tokens} | ${c.cumulative_tokens} | ${v.cumulative_tokens} | ${number(c.tokens_per_correct_tour)} | ${number(v.tokens_per_correct_tour)} |`);
    }
    for (const field of ['cumulative_tokens', 'marginal_tokens']) {
      const curves = AGENTS.map(a => group[a].curve.map(p => p[field]));
      lines.push('', `CodeTour is the first line; Vibe is the second. ${field.replaceAll('_', ' ')}:`, '', '```mermaid',
        'xychart-beta', `  x-axis "rank" [${group.codetour.curve.map(p => p.rank).join(', ')}]`,
        `  y-axis "tokens" 0 --> ${Math.max(1, ...curves.flat())}`,
        ...curves.map(c => `  line [${c.join(', ')}]`), '```');
    }
    lines.push('', 'Observed phase costs, run statuses, semantic quality and function activity (descriptive only):', '', '```json',
      JSON.stringify(Object.fromEntries(AGENTS.map(a => [a, { phases: group[a].phases, statuses: group[a].statuses,
        quality: group[a].quality, functions: group[a].functions }])), null, 2), '```');
  }
  return `${lines.join('\n')}\n`;
}

function cli(argv) {
  const names = ['preregistration', 'manifest-lock', 'traces', 'evaluations', 'artifacts', 'json', 'markdown'];
  const usage = 'node poc/benchmark/report.mjs --preregistration MANIFEST --manifest-lock LOCK --traces FILE_OR_DIR --evaluations FILE --artifacts FILE --json NEW_FILE --markdown NEW_FILE';
  if (argv.length === 1 && argv[0] === '--help') { process.stdout.write(`${usage}\n`); return 0; }
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].slice(2);
    ensure(argv[i].startsWith('--') && names.includes(name) && !options[name] && text(argv[i + 1])
      && !argv[i + 1].startsWith('--'), `Invalid/duplicate CLI option. Usage: ${usage}`);
    options[name] = resolve(argv[i + 1]);
  }
  ensure(names.every(n => options[n]), `All inputs and outputs must be explicit. Usage: ${usage}`);
  ensure(options.json !== options.markdown, 'JSON and Markdown outputs must be distinct new paths');
  const inputPaths = names.slice(0, 5).map(n => options[n]);
  for (const output of [options.json, options.markdown]) ensure(!inputPaths.includes(output), 'Output cannot overwrite an input');
  const files = [];
  const read = path => { const raw = readFileSync(path, 'utf8'); files.push({ path, sha256: bytesDigest(raw) }); return raw; };
  let report;
  try {
    const preregistration = read(options.preregistration);
    const manifestLock = JSON.parse(read(options['manifest-lock']));
    const traces = statSync(options.traces).isDirectory()
      ? readdirSync(options.traces).filter(n => n.endsWith('.json')).sort().map(n => JSON.parse(read(join(options.traces, n))))
      : JSON.parse(read(options.traces));
    const evaluations = JSON.parse(read(options.evaluations));
    const artifacts = JSON.parse(read(options.artifacts));
    report = analyzeCampaign({ preregistration, manifestLock, traces, evaluations, artifacts });
  } catch (error) {
    report = analyzeCampaign();
    report.reasons = [`Input unavailable or malformed: ${error.message}`];
  }
  report.provenance.files = files;
  report.provenance.reproduction = { argv: [process.execPath, fileURLToPath(import.meta.url), ...argv], node: process.version,
    generator_sha256: bytesDigest(readFileSync(fileURLToPath(import.meta.url))) };
  // Exclusive creation protects existing results and any input aliases/symlinks.
  const opened = [];
  try {
    for (const path of [options.json, options.markdown]) opened.push({ path, fd: openSync(path, 'wx') });
    writeFileSync(opened[0].fd, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(opened[1].fd, markdown(report));
  } catch (error) {
    for (const { fd, path } of opened) { closeSync(fd); unlinkSync(path); }
    throw error;
  }
  for (const { fd } of opened) closeSync(fd);
  process.stdout.write(`${report.verdict}: ${options.json}, ${options.markdown}\n`);
  return report.verdict === 'NO-GO' ? 2 : report.verdict === 'INDÉTERMINÉ' ? 3 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = cli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
}
