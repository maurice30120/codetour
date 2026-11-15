import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { GATE_SOURCES, sourceDigest } from './preflight.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function run(root, directory, command, args) {
  const result = spawnSync(command, args, { cwd: path.join(root, directory), encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const tapTests = Number(/# tests (\d+)/.exec(output)?.[1] ?? 0);
  const tapFailed = Number(/# fail (\d+)/.exec(output)?.[1] ?? 0);
  const jestTests = Number(/Tests:.*?(\d+) total/.exec(output)?.[1] ?? 0);
  return { command: `${command} ${args.join(' ')} (${directory})`, exit_code: result.status ?? 1, total_tests: tapTests || jestTests, failed_count: result.status === 0 ? tapFailed : Math.max(1, tapFailed), output, error: result.error?.message };
}

export function verifyTests({ root = defaultRoot, evidenceDir = path.join(root, 'poc/benchmark/gate-evidence') } = {}) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const nodeTests = directory => {
    const files = fs.readdirSync(path.join(root, directory, 'test')).filter(name => /\.test\.(ts|js)$/.test(name)).sort().map(name => `test/${name}`);
    return run(root, directory, process.execPath, ['--test', '--test-reporter=tap', ...files]);
  };
  const groups = {
    G0: [nodeTests('packages/exploration-poc'), nodeTests('packages/exploration-sandbox')],
    G4: [run(root, 'poc/benchmark/evaluator', 'npm', ['run', 'build']), run(root, 'poc/benchmark/evaluator', 'npm', ['test', '--', '--runInBand'])],
  };
  const evidence = {};
  for (const [gate, runs] of Object.entries(groups)) {
    const filename = gate === 'G0' ? 'g0-conformance.json' : 'g4-evaluator.json';
    const tests = runs.reduce((sum, result) => sum + result.total_tests, 0);
    const failures = runs.reduce((sum, result) => sum + result.failed_count, 0);
    const passed = runs.every(result => result.exit_code === 0) && tests > 0 && failures === 0;
    evidence[gate] = { gate, passed, exit_code: passed ? 0 : 1, total_tests: tests, failed_count: failures, command: runs.map(result => result.command).join('\n'), commands: runs.map(result => result.command), source_digest: sourceDigest(root, GATE_SOURCES[gate]), ran_at: new Date().toISOString(), transcripts: runs };
    fs.writeFileSync(path.join(evidenceDir, filename), `${JSON.stringify(evidence[gate], null, 2)}\n`);
  }
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : defaultRoot;
  try {
    const evidence = verifyTests({ root });
    process.stdout.write(`${JSON.stringify(Object.fromEntries(Object.entries(evidence).map(([gate, result]) => [gate, { passed: result.passed, tests: result.total_tests, failures: result.failed_count }])), null, 2)}\n`);
    process.exitCode = Object.values(evidence).every(result => result.passed) ? 0 : 2;
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
}
