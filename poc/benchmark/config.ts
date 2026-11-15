import path from 'node:path';
import { findRepoRoot } from './runner/src/agents/codetour';
import type { RunnerConfig } from './runner/src/index';

export const BENCHMARK_ROOT = path.join(findRepoRoot(__dirname) ?? path.resolve(__dirname, '../..'), 'poc', 'benchmark');
export const MANIFEST_LOCK_PATH = path.join(BENCHMARK_ROOT, 'manifest-lock.json');
export const CAMPAIGN_CONFIG: RunnerConfig = {
  questionsFile: path.join(BENCHMARK_ROOT, 'postgres-questions.json'),
  manifestFile: path.join(BENCHMARK_ROOT, 'preregistration-manifest.json'),
  manifestLockFile: MANIFEST_LOCK_PATH,
  postgresPath: process.env.CODETOUR_FIXTURE_PATH ?? path.join(BENCHMARK_ROOT, 'postgres'),
  outputDir: path.join(BENCHMARK_ROOT, 'results'),
  gateEvidenceDir: path.join(BENCHMARK_ROOT, 'gate-evidence'),
  timeoutMs: 300000,
  codetour: { model: process.env.MISTRAL_MODEL ?? 'mistral-small-latest', maxTokens: 16384, temperature: 0 },
  vibe: { model: process.env.VIBE_MODEL ?? 'mistral-medium-3.5', maxTokens: 16384, temperature: 0 },
  retryPolicy: { maxRetries: 0, retryDelay: 0 },
  runPilot: false,
};

export const PILOT_CONFIG: RunnerConfig = {
  ...CAMPAIGN_CONFIG,
  questionsFile: path.join(BENCHMARK_ROOT, 'pilot-questions.json'),
  outputDir: path.join(BENCHMARK_ROOT, 'results', 'pilot'),
};
