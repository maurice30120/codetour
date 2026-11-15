import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

export const POSTGRES_SHA = '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5';
export const GATE_SOURCES = { G0: ['packages/exploration-poc', 'packages/exploration-sandbox'], G4: ['poc/benchmark/evaluator'] };
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = content => createHash('sha256').update(content).digest('hex');

export function sourceDigest(root, directories) {
  const digest = createHash('sha256');
  const files = [];
  const visit = relative => {
    const filename = path.join(root, relative);
    if (!fs.existsSync(filename)) return;
    if (fs.lstatSync(filename).isSymbolicLink()) return;
    if (fs.statSync(filename).isDirectory()) {
      for (const name of fs.readdirSync(filename).sort()) {
        if (!['node_modules', 'dist', '.git', 'coverage', '.DS_Store'].includes(name)) visit(path.join(relative, name));
      }
    } else if (/\.(?:ts|mjs|js|json)$/.test(filename)) files.push(relative);
  };
  directories.forEach(visit);
  for (const relative of [...new Set(files)].sort()) digest.update(`${relative.split(path.sep).join('/')}\0`).update(fs.readFileSync(path.join(root, relative))).update('\0');
  return digest.digest('hex');
}

function readJson(filename) {
  try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { return null; }
}

function testEvidence(root, evidenceDir, gate, filename) {
  const evidence = readJson(path.join(evidenceDir, filename));
  const passed = evidence?.passed === true && evidence.exit_code === 0
    && evidence.failed_count === 0 && Number.isSafeInteger(evidence.total_tests) && evidence.total_tests > 0
    && Array.isArray(evidence.commands) && evidence.commands.length > 0
    && JSON.stringify(evidence.source_paths) === JSON.stringify(GATE_SOURCES[gate])
    && validTranscripts(evidence.transcripts, evidenceDir)
    && Number.isFinite(Date.parse(evidence.ran_at))
    && evidence.source_digest === sourceDigest(root, GATE_SOURCES[gate]);
  return { passed, reason: passed ? 'Tests executed against the current source.' : 'Missing, failed or stale test evidence.', evidence_file: path.join(evidenceDir, filename) };
}

function validTranscripts(transcripts, evidenceDir) {
  if (!Array.isArray(transcripts) || transcripts.length === 0) return false;
  try {
    const logs = transcripts.map(transcript => {
      if (typeof transcript.path !== 'string') throw new Error('Missing transcript path.');
      const filename = path.resolve(evidenceDir, transcript.path);
      if (!filename.startsWith(`${path.resolve(evidenceDir)}${path.sep}`)) throw new Error('Transcript outside evidence directory.');
      const bytes = fs.readFileSync(filename);
      if (sha256(bytes) !== transcript.sha256) throw new Error('Transcript digest mismatch.');
      return bytes.toString('utf8');
    });
    const noFailures = logs.every(log => !/(?:#|ℹ) fail [1-9]\d*|Tests:.*[1-9]\d* failed/.test(log));
    return noFailures && logs.some(log => /(?:#|ℹ) tests [1-9]\d*|Tests:.*[1-9]\d* passed/.test(log));
  } catch { return false; }
}

function fixtureGate(fixturePath) {
  const git = args => spawnSync('git', ['-C', fixturePath, ...args], { encoding: 'utf8', timeout: 15000 });
  const head = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain', '--untracked-files=all']);
  const observedSha = head.status === 0 ? head.stdout.trim() : null;
  const clean = status.status === 0 && status.stdout.trim() === '';
  return { passed: observedSha === POSTGRES_SHA && clean, observed_sha: observedSha, clean_tree: clean, reason: observedSha !== POSTGRES_SHA ? 'Fixture missing or wrong PostgreSQL revision.' : clean ? 'Pinned fixture verified on disk.' : 'Fixture working tree is dirty.' };
}

function sentinelGates(root, evidenceDir) {
  const manifest = readJson(path.join(evidenceDir, 'sentinel.json'));
  const execution = manifest?.execution;
  let authentic = false;
  let metered = false;
  let reason = 'Missing raw native-subagent sentinel evidence.';
  if (execution) {
    try {
      const require = createRequire(import.meta.url);
      const connector = require(path.join(root, 'packages/vibe-connector/dist/src/agent.js'));
      authentic = execution.agent?.agentType === 'subagent' && typeof execution.subagent === 'string'
        && /research|explore/i.test(execution.subagent) && connector.validateG1(execution);
      metered = authentic && connector.validateG2(execution);
      reason = authentic ? 'Native research execution verified from raw sentinel evidence.' : 'Sentinel does not prove native research invocation.';
    } catch (error) { reason = `Sentinel verification unavailable: ${error.message}`; }
  }
  return { G1: { passed: authentic, reason }, G2: { passed: metered, reason: metered ? 'Complete provider usage reconciled by connector.' : 'Missing or incomplete root/subagent per-call usage.' } };
}

function hasUnresolved(value) {
  if (typeof value === 'string') return /TBD|placeholder|to_be_determined/i.test(value);
  if (Array.isArray(value)) return value.some(hasUnresolved);
  return value && typeof value === 'object' ? Object.values(value).some(hasUnresolved) : false;
}

function manifestGate(root, manifestFile, lockFile) {
  const manifest = readJson(manifestFile);
  const lock = readJson(lockFile);
  const required = ['models', 'parameters', 'thresholds', 'evaluation', 'questions', 'expected_answers', 'prompts'];
  const errors = [];
  if (!manifest || required.some(key => !manifest[key]) || hasUnresolved(manifest)) errors.push('Manifest missing, incomplete or still contains unresolved configuration.');
  if (!lock?.locked || !Number.isFinite(Date.parse(lock.frozen_at))) errors.push('No frozen pre-registration lock.');
  if (manifest && lock && lock.manifest_sha256 !== sha256(fs.readFileSync(manifestFile))) errors.push('Manifest digest does not match the frozen lock.');
  for (const key of ['questions', 'expected_answers']) {
    const binding = manifest?.[key];
    if (!binding?.file || !binding.hash) { errors.push(`Missing ${key} content binding.`); continue; }
    const filename = path.resolve(root, binding.file);
    if (!filename.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(filename) || `sha256:${sha256(fs.readFileSync(filename))}` !== binding.hash) errors.push(`${key} content differs from pre-registration.`);
  }
  return { passed: errors.length === 0, reason: errors.join(' ') || 'Frozen protocol and question/reference content verified.' };
}

export async function inspectPreflight({ root = defaultRoot, fixturePath, manifestFile, lockFile, evidenceDir, env = process.env } = {}) {
  const benchmark = path.join(root, 'poc/benchmark');
  const evidence = evidenceDir ?? path.join(benchmark, 'gate-evidence');
  const sentinel = sentinelGates(root, evidence);
  const gates = {
    G0: testEvidence(root, evidence, 'G0', 'g0-conformance.json'), G1: sentinel.G1, G2: sentinel.G2,
    G3: fixtureGate(fixturePath ?? path.join(benchmark, 'postgres')),
    G4: testEvidence(root, evidence, 'G4', 'g4-evaluator.json'),
    G5: manifestGate(root, manifestFile ?? path.join(benchmark, 'preregistration-manifest.json'), lockFile ?? path.join(benchmark, 'manifest-lock.json')),
  };
  const blockers = Object.entries(gates).filter(([, gate]) => !gate.passed).map(([gate, result]) => `${gate}: ${result.reason}`);
  if (!env.MISTRAL_API_KEY?.trim()) blockers.push('CodeTour provider unavailable: MISTRAL_API_KEY is not configured.');
  return { spec: 174, checked_at: new Date().toISOString(), verdict: blockers.length ? 'NO-GO' : 'READY', campaign_started: false, gates, blockers };
}

export async function preflightCli(argv = process.argv.slice(2)) {
  const options = {};
  let output;
  for (let index = 0; index < argv.length; index++) {
    const key = { '--root': 'root', '--fixture': 'fixturePath', '--manifest': 'manifestFile', '--lock': 'lockFile', '--evidence': 'evidenceDir', '--output': 'output' }[argv[index]];
    if (!key || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`Unknown or incomplete option: ${argv[index]}`);
    const value = path.resolve(argv[++index]);
    if (key === 'output') output = value; else options[key] = value;
  }
  const report = await inspectPreflight(options);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, text); }
  process.stdout.write(text);
  return report.verdict === 'READY' ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  preflightCli().then(code => { process.exitCode = code; }).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
}
