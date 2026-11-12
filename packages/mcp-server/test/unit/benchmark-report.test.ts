import { test, describe } from "node:test";
import * as assert from "node:assert/strict";
import {
  BenchmarkMeasurement,
  BenchmarkReport,
  evaluateTarget,
  formatBenchmarkMarkdown,
} from "../../src/targeted-context/benchmark-report";
import { APPROACH_C_CONFIG, APPROACH_D_CONFIG } from "../../src/targeted-context/hybrid-config";

function measurement(
  overrides: Partial<BenchmarkMeasurement> = {}
): BenchmarkMeasurement {
  return {
    scenario: "changes-full-context",
    tourType: "changes",
    estimatedTokens: 1_000,
    characters: 4_000,
    symbols: 10,
    files: 2,
    pages: 1,
    durationMs: 12,
    warnings: [],
    ...overrides,
  };
}

function report(results: BenchmarkMeasurement[]): BenchmarkReport {
  return {
    version: "1.0.0",
    generatedAt: "2026-11-12T10:00:00.000Z",
    environment: {
      repository: "codetour",
      workspaceRoot: "/tmp/codetour",
      branch: "spec-92-integration",
      sha: "abcdef1234567890",
      baseRef: "1111111",
      headRef: "2222222",
    },
    configurations: {
      changes: APPROACH_C_CONFIG,
      project: APPROACH_D_CONFIG,
    },
    results,
  };
}

describe("evaluateTarget", () => {
  test("reports no target when the measurement has none", () => {
    assert.equal(evaluateTarget(measurement()), "no-target");
  });

  test("accepts a measurement at or below the target", () => {
    assert.equal(
      evaluateTarget(measurement({ estimatedTokens: 1_000, targetTokens: 1_000 })),
      "within-target"
    );
  });

  test("flags a measurement above the target", () => {
    assert.equal(
      evaluateTarget(measurement({ estimatedTokens: 1_001, targetTokens: 1_000 })),
      "over-target"
    );
  });
});

describe("formatBenchmarkMarkdown", () => {
  test("labels the token figures as estimates, not billing data", () => {
    const markdown = formatBenchmarkMarkdown(report([measurement()]));
    assert.match(markdown, /estimates/i);
    assert.match(markdown, /not billing data/i);
  });

  test("renders one row per measurement with its verdict", () => {
    const markdown = formatBenchmarkMarkdown(
      report([
        measurement({ scenario: "changes-first-page", estimatedTokens: 500 }),
        measurement({ estimatedTokens: 1_500, targetTokens: 1_000 }),
        measurement({
          scenario: "project-full-context",
          tourType: "project",
          estimatedTokens: 800,
          targetTokens: 1_000,
        }),
      ])
    );

    assert.match(markdown, /changes-first-page \| changes \| 500 \| — \| no-target/);
    assert.match(markdown, /changes-full-context \| changes \| 1,500 \| < 1,000 \| over-target/);
    assert.match(
      markdown,
      /project-full-context \| project \| 800 \| < 1,000 \| within-target/
    );
  });

  test("lists warnings per scenario", () => {
    const markdown = formatBenchmarkMarkdown(
      report([
        measurement({ warnings: ["Stopped at maxFiles: 3 changed file(s) not processed."] }),
      ])
    );

    assert.match(
      markdown,
      /changes-full-context: Stopped at maxFiles: 3 changed file\(s\) not processed\./
    );
  });

  test("states that no truncation was reported when there are no warnings", () => {
    const markdown = formatBenchmarkMarkdown(report([measurement()]));
    assert.match(markdown, /No truncation or exclusion was reported\./);
  });
});
