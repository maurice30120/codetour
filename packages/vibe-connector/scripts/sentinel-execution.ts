import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectVibeAvailability, invokeVibeNativeAgent, validateG1, validateG2 } from '../src/agent';
import { VibeExecution } from '../src/types';

const PINNED_REVISION = '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (flag: string): string => {
    const index = args.indexOf(flag);
    if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Usage: sentinel-execution --fixture <path> --output <json>');
    }
    return path.resolve(args[index + 1]);
  };
  const output = value('--output');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const fd = fs.openSync(output, 'wx', 0o600);
  let execution: VibeExecution | null = null;
  const reasons: string[] = [];
  const evidenceDir = `${output}.evidence`;
  const timestamp = new Date().toISOString();
  let fixture: string | null = null;
  let revision: string | null = null;
  const availability = detectVibeAvailability();
  try {
    fixture = value('--fixture');
    if (args.length !== 4 || new Set([args[0], args[2]]).size !== 2) throw new Error('Only --fixture and --output are accepted');
    if (!fs.statSync(fixture).isDirectory()) throw new Error('Fixture must be a directory');
    const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: fixture, encoding: 'utf8' });
    revision = git.status === 0 ? git.stdout.trim() : null;
    if (revision !== PINNED_REVISION) reasons.push(`Fixture revision must be ${PINNED_REVISION}; observed ${revision ?? 'unavailable'}`);
    if (!availability.available) reasons.push('Vibe CLI unavailable');
    if (!process.env.MISTRAL_API_KEY?.trim()) reasons.push('MISTRAL_API_KEY absent; no model call attempted');
    if (!reasons.length) {
      execution = await invokeVibeNativeAgent(
        'Where is the PostgreSQL backend startup entry point? Give the path, function name and supporting line references.',
        { workDir: fixture, outputDir: evidenceDir, maxTurns: 8, maxTokens: 50000, timeoutMs: 180000 }
      );
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
  }
  const g1Passed = execution !== null && validateG1(execution);
  const g2Passed = execution !== null && validateG2(execution);
  if (!g1Passed) reasons.push('G1: native research child execution not proven');
  if (!g2Passed) reasons.push('G2: complete reconciled root and child usage not proven');
  const manifest = {
    status: g1Passed && g2Passed ? 'GO' : 'NO-GO', execution, g1Passed, g2Passed,
    reasons, timestamp, fixture, revision, expectedRevision: PINNED_REVISION, availability,
    evidenceDir: fs.existsSync(evidenceDir) ? evidenceDir : null,
  };
  try { fs.writeFileSync(fd, JSON.stringify(manifest, null, 2) + '\n'); }
  finally { fs.closeSync(fd); }
  console.log(`${manifest.status}: ${output}`);
  process.exitCode = manifest.status === 'GO' ? 0 : 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
