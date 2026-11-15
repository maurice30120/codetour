import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

export interface ArtifactHash { path: string; sha256: string }
export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
export function hashFile(file: string): ArtifactHash {
  return { path: path.resolve(file), sha256: sha256(fs.readFileSync(file)) };
}
export function verifyArtifacts(artifacts: unknown, baseDir: string): artifacts is ArtifactHash[] {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return false;
  try {
    return artifacts.every(a => typeof a.path === 'string' && typeof a.sha256 === 'string' &&
      sha256(fs.readFileSync(path.resolve(baseDir, a.path))) === a.sha256.replace(/^sha256:/, ''));
  } catch { return false; }
}
export function sourceFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? ['node_modules', 'dist', '.git'].includes(entry.name) ? [] : sourceFiles(file) : /\.(?:ts|mjs|js|json)$/.test(file) ? [file] : [];
  });
}

/** Shared with the offline gate producer; hash relative paths and exact bytes. */
export function computeSourceDigest(repoRoot: string, paths: string[]): string {
  const files = [...new Set(paths.flatMap(p => {
    const full = path.resolve(repoRoot, p);
    return fs.statSync(full).isDirectory() ? sourceFiles(full) : [full];
  }))].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(repoRoot, file).split(path.sep).join('/'));
    hash.update('\0'); hash.update(fs.readFileSync(file)); hash.update('\0');
  }
  return hash.digest('hex');
}

export function validateTestEvidence(evidence: Record<string, unknown> | null, repoRoot: string, evidenceDir: string): boolean {
  if (!evidence || evidence.passed !== true || evidence.exit_code !== 0 || evidence.failed_count !== 0 ||
    typeof evidence.total_tests !== 'number' || evidence.total_tests < 1 || typeof evidence.command !== 'string' ||
    !Array.isArray(evidence.source_paths) || typeof evidence.source_digest !== 'string' || !Array.isArray(evidence.transcripts)) return false;
  try {
    if (computeSourceDigest(repoRoot, evidence.source_paths as string[]) !== evidence.source_digest) return false;
    if (!verifyArtifacts(evidence.transcripts, evidenceDir)) return false;
    const outputs = (evidence.transcripts as ArtifactHash[]).map(a => fs.readFileSync(path.resolve(evidenceDir, a.path), 'utf8'));
    // Accept node:test (TAP 'tests N' / '# fail 0') and Jest ('Tests: N passed'
    // — Jest prints a failure count only when it is non-zero) transcripts.
    return outputs.some(output => /(?:#|ℹ) tests [1-9]\d*/.test(output) || /Tests: [1-9]\d* passed/.test(output)) &&
      outputs.every(output => !/(?:#|ℹ) fail [1-9]\d*/.test(output) && !/Tests:.*[1-9]\d* failed/.test(output)) &&
      outputs.some(output => /(?:#|ℹ) fail 0\b/.test(output) || /Tests: [1-9]\d* passed/.test(output));
  } catch { return false; }
}
