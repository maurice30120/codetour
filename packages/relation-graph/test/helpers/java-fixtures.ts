import * as fs from "node:fs";
import * as path from "node:path";
import type { SourceFile } from "../../src/index";

/**
 * Loads the Java ground-truth fixture tree (test/fixtures/java) as SourceFile[]
 * for buildRelationGraph. The same files on disk are walked by the measurement
 * harness of ticket #153 (see docs/pack-java-measurements.md), so tests and
 * measurements run on the exact same sources.
 *
 * Paths in the graph are relative to the fixture root, forward-slashed
 * ("services/UserService.java"), like the C# prototype harness.
 */

// Compiled tests run from dist/test/helpers; sources from test/helpers. Accept both.
const CANDIDATE_ROOTS = [
  path.resolve(__dirname, "..", "..", "..", "test", "fixtures", "java"),
  path.resolve(__dirname, "..", "..", "test", "fixtures", "java")
];
const FIXTURE_ROOT = CANDIDATE_ROOTS.find(root => fs.existsSync(root)) ?? CANDIDATE_ROOTS[0];

export const JAVA_FIXTURE_ROOT = FIXTURE_ROOT;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".java")) out.push(full);
  }
  return out.sort();
}

/** All fixture .java files as sources, paths relative to the fixture root. */
export function loadJavaFixtures(): SourceFile[] {
  return walk(FIXTURE_ROOT).map(full => ({
    path: path.relative(FIXTURE_ROOT, full).split(path.sep).join("/"),
    content: fs.readFileSync(full, "utf8")
  }));
}
