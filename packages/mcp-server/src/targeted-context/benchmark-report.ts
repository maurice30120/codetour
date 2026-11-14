/**
 * Targeted Context benchmark report.
 *
 * The benchmark measures the text actually served to the Tour Generator and
 * converts it to estimated tokens. It never records a billing figure: the
 * estimate is four characters per token.
 */

import { TargetedContextConfig } from "./types";
import { ProjectTargetedContextConfig } from "./project-types";

export type BenchmarkScenario =
  | "changes-first-page"
  | "changes-full-context"
  | "project-full-context";

export type TargetVerdict = "within-target" | "over-target" | "no-target";

export interface BenchmarkEnvironment {
  repository: string;
  workspaceRoot: string;
  branch: string;
  sha: string;
  baseRef: string;
  headRef: string;
}

export interface BenchmarkMeasurement {
  scenario: BenchmarkScenario;
  tourType: "changes" | "project";
  /** Estimated tokens in the text the agent receives. */
  estimatedTokens: number;
  characters: number;
  symbols: number;
  files: number;
  pages: number;
  durationMs: number;
  /** Spec target in estimated tokens, when the spec sets one. */
  targetTokens?: number;
  warnings: string[];
}

export interface BenchmarkReport {
  version: string;
  generatedAt: string;
  environment: BenchmarkEnvironment;
  configurations: {
    changes: TargetedContextConfig;
    project: ProjectTargetedContextConfig;
  };
  results: BenchmarkMeasurement[];
}

/**
 * Compare a measurement with the target published in the spec.
 */
export function evaluateTarget(
  measurement: BenchmarkMeasurement
): TargetVerdict {
  if (measurement.targetTokens === undefined) {
    return "no-target";
  }

  return measurement.estimatedTokens <= measurement.targetTokens
    ? "within-target"
    : "over-target";
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * Render the report as Markdown. Deterministic for a given report.
 */
export function formatBenchmarkMarkdown(report: BenchmarkReport): string {
  const lines: string[] = [
    "# Targeted Context Benchmark",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "> Token figures are **estimates** (~4 characters per token) of the text actually served to the",
    "> Tour Generator. They are not billing data: no API or AI Credit measurement is involved.",
    "",
    "## Environment",
    "",
    "| Property | Value |",
    "| --- | --- |",
    `| Repository | ${report.environment.repository} |`,
    `| Branch | ${report.environment.branch} |`,
    `| Commit | ${report.environment.sha} |`,
    `| Base ref | ${report.environment.baseRef} |`,
    `| Head ref | ${report.environment.headRef} |`,
    `| Workspace | ${report.environment.workspaceRoot} |`,
    "",
    "## Results",
    "",
    "| Scenario | Tour | Estimated tokens | Target | Verdict | Symbols | Files | Pages | Duration |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const result of report.results) {
    const target =
      result.targetTokens === undefined
        ? "—"
        : `< ${formatNumber(result.targetTokens)}`;
    lines.push(
      `| ${result.scenario} | ${result.tourType} | ${formatNumber(
        result.estimatedTokens
      )} | ${target} | ${evaluateTarget(result)} | ${formatNumber(
        result.symbols
      )} | ${formatNumber(result.files)} | ${formatNumber(
        result.pages
      )} | ${formatNumber(result.durationMs)} ms |`
    );
  }

  lines.push("", "## Configuration", "");

  lines.push(
    "**Changes Tour (approach C)**",
    "",
    "```json",
    JSON.stringify(report.configurations.changes, null, 2),
    "```",
    "",
    "**Project Tour (approach D)**",
    "",
    "```json",
    JSON.stringify(report.configurations.project, null, 2),
    "```",
    ""
  );

  const warnings = report.results.flatMap((result) =>
    result.warnings.map((warning) => `- ${result.scenario}: ${warning}`)
  );

  lines.push("## Warnings", "");
  lines.push(
    warnings.length > 0 ? warnings.join("\n") : "No truncation or exclusion was reported.",
    ""
  );

  lines.push(
    "## Scope",
    "",
    "- One repository, one commit pair: the result is reproducible, not a general claim.",
    "- `changes-full-context` is the whole bounded context; `changes-first-page` is what one",
    "  paginated read serves by default.",
    "- The spec targets are checked against the full contexts (the cost of reading everything),",
    "  which is the conservative comparison.",
    ""
  );

  return lines.join("\n");
}
