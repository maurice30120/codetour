import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";

// Import the benchmark runner and types
import { TargetedContextBenchmarkRunner } from "../../src/targeted-context/benchmark-runner";
import { BenchmarkApproach, APPROACH_LABELS, APPROACH_DESCRIPTIONS } from "../../src/targeted-context/benchmark-types";
import { DEFAULT_PROJECT_TARGETED_CONTEXT_CONFIG } from "../../src/targeted-context/project-types";

// Create a temporary directory for testing
let tempDir: string;

test("should create temporary directory", async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codetour-benchmark-"));
  assert.ok(tempDir);
  
  // Create some test files
  await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
  await fs.mkdir(path.join(tempDir, "test"), { recursive: true });
  await fs.writeFile(path.join(tempDir, "src", "index.ts"), "export const foo = 'bar';");
  await fs.writeFile(path.join(tempDir, "src", "utils.ts"), "export function helper() { return 42; }");
  await fs.writeFile(path.join(tempDir, "test", "index.test.ts"), "test('foo', () => {});");
  await fs.writeFile(path.join(tempDir, "package.json"), `{ "name": "test-benchmark" }`);
});

// Test Approach Labels and Descriptions
test("should have labels for all 5 approaches", () => {
  const approaches: BenchmarkApproach[] = ["A", "B", "C", "D", "TE"];
  for (const approach of approaches) {
    assert.ok(APPROACH_LABELS[approach]);
    assert.ok(APPROACH_DESCRIPTIONS[approach]);
  }
});

test("should include TokenEconomizer in approach labels", () => {
  assert.ok(APPROACH_LABELS.TE);
  assert.ok(APPROACH_LABELS.TE.includes("TokenEconomizer"));
});

test("should include TokenEconomizer in approach descriptions", () => {
  assert.ok(APPROACH_DESCRIPTIONS.TE);
  assert.ok(APPROACH_DESCRIPTIONS.TE.includes("Ticket #113"));
});

test("should include all ticket references", () => {
  // Check that all ticket references are present
  assert.ok(APPROACH_DESCRIPTIONS.B.includes("Ticket #115"));
  assert.ok(APPROACH_DESCRIPTIONS.C.includes("Ticket #116"));
  assert.ok(APPROACH_DESCRIPTIONS.D.includes("Ticket #117"));
  assert.ok(APPROACH_DESCRIPTIONS.TE.includes("Ticket #113"));
});

test("should have 5 approaches total", () => {
  const approaches: BenchmarkApproach[] = ["A", "B", "C", "D", "TE"];
  assert.strictEqual(approaches.length, 5);
});

// Test Benchmark Runner
test("should run all 5 approaches", async () => {
  const runner = new TargetedContextBenchmarkRunner({
    workspaceRoot: tempDir,
    iterations: 1,
    warmup: false,
    collectMemory: false,
    baseRef: "main",
    headRef: "feature-branch"
  });

  const report = await runner.run();
  
  const approaches: BenchmarkApproach[] = ["A", "B", "C", "D", "TE"];
  for (const approach of approaches) {
    const result = report.results.find((r: { approach: BenchmarkApproach }) => r.approach === approach);
    assert.ok(result, `Approach ${approach} should be in results`);
    assert.ok(result?.success, `Approach ${approach} should succeed`);
  }
});

test("should have results for each approach", async () => {
  const runner = new TargetedContextBenchmarkRunner({
    workspaceRoot: tempDir,
    iterations: 1,
    warmup: false,
    collectMemory: false,
    baseRef: "main",
    headRef: "feature-branch"
  });

  const report = await runner.run();
  assert.ok(report.results.length >= 5);
});

test("should have summary", async () => {
  const runner = new TargetedContextBenchmarkRunner({
    workspaceRoot: tempDir,
    iterations: 1,
    warmup: false,
    collectMemory: false,
    baseRef: "main",
    headRef: "feature-branch"
  });

  const report = await runner.run();
  assert.ok(report.summary);
  assert.ok(report.summary.overallWinner);
});

test("should have pairwise comparisons", async () => {
  const runner = new TargetedContextBenchmarkRunner({
    workspaceRoot: tempDir,
    iterations: 1,
    warmup: false,
    collectMemory: false,
    baseRef: "main",
    headRef: "feature-branch"
  });

  const report = await runner.run();
  assert.ok(report.comparisons);
  assert.ok(report.comparisons.length >= 0);
});

// Test Individual Approaches
test("should run Approach A (Baseline)", async () => {
  const runner = new TargetedContextBenchmarkRunner({
    workspaceRoot: tempDir,
    iterations: 1,
    warmup: false,
    collectMemory: false,
    baseRef: "main",
    headRef: "feature-branch"
  });

  const report = await runner.run();
  const approachA = report.results.find((r: { approach: BenchmarkApproach }) => r.approach === "A");
  assert.ok(approachA);
  assert.ok(approachA?.success);
});

test("should run Approach B (Changes Tour)", async () => {
  const runner = new TargetedContextBenchmarkRunner({
    workspaceRoot: tempDir,
    iterations: 1,
    warmup: false,
    collectMemory: false,
    baseRef: "main",
    headRef: "feature-branch"
  });

  const report = await runner.run();
  const approachB = report.results.find((r: { approach: BenchmarkApproach }) => r.approach === "B");
  assert.ok(approachB);
  assert.ok(approachB?.success);
});

test("should run Approach C (Progressive)", async () => {
  const runner = new TargetedContextBenchmarkRunner({
    workspaceRoot: tempDir,
    iterations: 1,
    warmup: false,
    collectMemory: false,
    baseRef: "main",
    headRef: "feature-branch"
  });

  const report = await runner.run();
  const approachC = report.results.find((r: { approach: BenchmarkApproach }) => r.approach === "C");
  assert.ok(approachC);
  assert.ok(approachC?.success);
});

test("should run Approach D (Project Tour)", async () => {
  const runner = new TargetedContextBenchmarkRunner({
    workspaceRoot: tempDir,
    iterations: 1,
    warmup: false,
    collectMemory: false,
    baseRef: "main",
    headRef: "feature-branch"
  });

  const report = await runner.run();
  const approachD = report.results.find((r: { approach: BenchmarkApproach }) => r.approach === "D");
  assert.ok(approachD);
  assert.ok(approachD?.success);
});

test("should run Approach TE (TokenEconomizer)", async () => {
  const runner = new TargetedContextBenchmarkRunner({
    workspaceRoot: tempDir,
    iterations: 1,
    warmup: false,
    collectMemory: false,
    baseRef: "main",
    headRef: "feature-branch"
  });

  const report = await runner.run();
  const approachTE = report.results.find((r: { approach: BenchmarkApproach }) => r.approach === "TE");
  assert.ok(approachTE);
  assert.ok(approachTE?.success);
});

// Test Report Generation
test("should generate JSON report", async () => {
  const runner = new TargetedContextBenchmarkRunner({
    workspaceRoot: tempDir,
    iterations: 1,
    warmup: false,
    collectMemory: false,
    baseRef: "main",
    headRef: "feature-branch"
  });

  const report = await runner.run();
  const jsonReport = JSON.stringify(report);
  assert.ok(jsonReport);
  const parsed = JSON.parse(jsonReport);
  assert.ok(parsed.results);
  assert.ok(parsed.summary);
});

test("should generate Markdown report", async () => {
  const runner = new TargetedContextBenchmarkRunner({
    workspaceRoot: tempDir,
    iterations: 1,
    warmup: false,
    collectMemory: false,
    baseRef: "main",
    headRef: "feature-branch"
  });

  const report = await runner.run();
  const mdReport = runner.generateMarkdownReport(report);
  
  assert.ok(mdReport);
  assert.ok(mdReport.includes("# Targeted Context vs TokenEconomizer Benchmark"));
  assert.ok(mdReport.includes("Spec #92"));
  assert.ok(mdReport.includes("Approach TE"));
  assert.ok(mdReport.includes("TokenEconomizer"));
});

test("should include TokenEconomizer in Markdown methodology", async () => {
  const runner = new TargetedContextBenchmarkRunner({
    workspaceRoot: tempDir,
    iterations: 1,
    warmup: false,
    collectMemory: false,
    baseRef: "main",
    headRef: "feature-branch"
  });

  const report = await runner.run();
  const mdReport = runner.generateMarkdownReport(report);
  
  assert.ok(mdReport.includes("TokenEconomizer"));
  assert.ok(mdReport.includes("Two levers"));
});

// Test Configuration
test("should accept custom workspace root", () => {
  const customRunner = new TargetedContextBenchmarkRunner({
    workspaceRoot: "/custom/path"
  });
  assert.ok(customRunner);
});

test("should accept custom iterations", () => {
  const customRunner = new TargetedContextBenchmarkRunner({
    iterations: 5
  });
  assert.ok(customRunner);
});

test("should accept Project Tour config", () => {
  const customRunner = new TargetedContextBenchmarkRunner({
    configD: {
      ...DEFAULT_PROJECT_TARGETED_CONTEXT_CONFIG,
      enabled: true,
      maxFiles: 5
    }
  });
  assert.ok(customRunner);
});

test("should accept TokenEconomizer config", () => {
  const customRunner = new TargetedContextBenchmarkRunner({
    configTE: {
      enabled: true,
      compatible: true,
      settings: {
        toolPrune: "aggressive",
        microSkills: true,
        loopGuard: true
      }
    }
  });
  assert.ok(customRunner);
});

// Test Spec #92 Compliance
test("should include all required approaches from spec #92", async () => {
  const runner = new TargetedContextBenchmarkRunner({
    workspaceRoot: tempDir,
    iterations: 1,
    warmup: false,
    collectMemory: false,
    baseRef: "main",
    headRef: "feature-branch"
  });

  const report = await runner.run();
  
  // Spec #92 requires comparing both levers: Targeted Context and TokenEconomizer
  const hasTargetedContext = report.results.some((r: { approach: BenchmarkApproach }) => ["B", "C", "D"].includes(r.approach));
  const hasTokenEconomizer = report.results.some((r: { approach: BenchmarkApproach }) => r.approach === "TE");
  
  assert.ok(hasTargetedContext, "Should have Targeted Context approaches");
  assert.ok(hasTokenEconomizer, "Should have TokenEconomizer approach");
});

test("should compare TokenEconomizer vs Targeted Context", async () => {
  const runner = new TargetedContextBenchmarkRunner({
    workspaceRoot: tempDir,
    iterations: 1,
    warmup: false,
    collectMemory: false,
    baseRef: "main",
    headRef: "feature-branch"
  });

  const report = await runner.run();
  
  // Should have comparisons between TE and other approaches
  const teComparisons = report.comparisons.filter((c: { approach1: BenchmarkApproach, approach2: BenchmarkApproach }) => 
    c.approach1 === "TE" || c.approach2 === "TE"
  );
  
  assert.ok(teComparisons.length > 0, "Should have TE comparisons");
});

test("should have TE vs TC in pairwise comparisons", async () => {
  const runner = new TargetedContextBenchmarkRunner({
    workspaceRoot: tempDir,
    iterations: 1,
    warmup: false,
    collectMemory: false,
    baseRef: "main",
    headRef: "feature-branch"
  });

  const report = await runner.run();
  
  // Check that TE is compared against TC approaches (B, C, D)
  const tcApproaches: BenchmarkApproach[] = ["B", "C", "D"];
  for (const tcApproach of tcApproaches) {
    const comparison = report.comparisons.find((c: { approach1: BenchmarkApproach, approach2: BenchmarkApproach }) => 
      (c.approach1 === "TE" && c.approach2 === tcApproach) ||
      (c.approach1 === tcApproach && c.approach2 === "TE")
    );
    assert.ok(comparison, `Should have comparison between TE and ${tcApproach}`);
  }
});

// Cleanup
test("should cleanup temporary directory", async () => {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
    assert.ok(true);
  } catch {
    assert.ok(true); // Ignore cleanup errors
  }
});
