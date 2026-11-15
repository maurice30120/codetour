/**
 * Real fixture verification for benchmark runs — Spec #174 remediation.
 *
 * The PostgreSQL "fixture" is a git clone of postgres/postgres pinned at the
 * pre-registered commit. Verification replicates the documented G3 protocol
 * (see poc/benchmark/verify-fixture.sh):
 *   1. `git rev-parse HEAD` === expected SHA,
 *   2. working tree is clean (untracked-only is tolerated, exactly like the
 *      documented script: `git status --porcelain | grep -v '^??'`).
 *
 * It MUST be executed BEFORE EVERY SINGLE RUN (per run, not per campaign) and
 * its observed evidence recorded in each run trace. A failing verification
 * FAILS THE RUN — the runner never proceeds on a mutated or wrong fixture,
 * and never fabricates a passing check.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface FixtureVerification {
  /** True only when every check passed against the REAL fixture on disk. */
  ok: boolean;
  errors: string[];
  /** Observed `git rev-parse HEAD` of the fixture clone (null when unavailable). */
  observedSha: string | null;
  /** True when the working tree is clean (untracked-only allowed), null when unavailable. */
  cleanTree: boolean | null;
  /** Real timestamp of the verification (ISO-8601, Date-based). */
  verifiedAt: string;
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 15000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args.join(' ')} failed: ${error.message}${stderr ? ` — ${stderr.trim()}` : ''}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Verify the fixture clone: HEAD commit equals the pre-registered SHA and the
 * working tree is clean. Executed before every run by the execution manager.
 */
export async function verifyFixture(fixturePath: string, expectedSha: string): Promise<FixtureVerification> {
  const verification: FixtureVerification = {
    ok: false,
    errors: [],
    observedSha: null,
    cleanTree: null,
    verifiedAt: new Date().toISOString(),
  };
  const resolved = path.resolve(fixturePath);

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    verification.errors.push(`Fixture directory does not exist: ${resolved}`);
    return verification;
  }

  let head = '';
  try {
    head = await git(resolved, ['rev-parse', 'HEAD']);
    verification.observedSha = head || null;
  } catch (error) {
    verification.errors.push(`Cannot read fixture HEAD: ${(error as Error).message}`);
  }

  try {
    const status = await git(resolved, ['status', '--porcelain']);
    const dirtyEntries = status.split('\n').filter(line => line.trim() !== '' && !line.startsWith('??'));
    verification.cleanTree = dirtyEntries.length === 0;
    if (dirtyEntries.length > 0) {
      verification.errors.push(`Fixture working tree is dirty (${dirtyEntries.length} tracked modification(s), e.g. ${dirtyEntries.slice(0, 3).join(' | ')})`);
    }
  } catch (error) {
    verification.errors.push(`Cannot check fixture working tree: ${(error as Error).message}`);
  }

  if (verification.observedSha && verification.observedSha !== expectedSha) {
    verification.errors.push(`Fixture HEAD mismatch: expected ${expectedSha}, observed ${verification.observedSha}`);
  }

  verification.ok = verification.errors.length === 0 && verification.observedSha !== null && verification.cleanTree === true;
  return verification;
}
