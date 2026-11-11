#!/usr/bin/env node

/**
 * Script to run Targeted Context Benchmark (Spec #92, Ticket #118)
 * 
 * This script runs the comprehensive benchmark comparing:
 * A: No Targeted Context (baseline)
 * B: Basic Targeted Context - Changes Tour (Ticket #115)
 * C: Progressive MCP Exploration (Ticket #116)
 * D: Project Tour Targeted Context (Ticket #117)
 * 
 * Usage:
 *   node scripts/run-benchmark.js [options]
 * 
 * Options:
 *   --workspace <path>    Workspace root path (default: current directory)
 *   --iterations <n>     Number of iterations per approach (default: 3)
 *   --output <dir>        Output directory for reports (default: benchmark-reports)
 *   --no-warmup          Skip warmup iteration
 *   --approaches <list>   Comma-separated list of approaches to run (A,B,C,D)
 *   --help               Show this help
 */

import { fileURLToPath } from "url";
import path from "path";
import { TargetedContextBenchmarkRunner } from "../packages/mcp-server/src/targeted-context/benchmark-runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    workspace: process.cwd(),
    iterations: 3,
    output: path.join(process.cwd(), "benchmark-reports"),
    warmup: true,
    approaches: "A,B,C,D",
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case "--workspace":
        options.workspace = args[++i];
        break;
      case "--iterations":
        options.iterations = parseInt(args[++i], 10);
        break;
      case "--output":
        options.output = args[++i];
        break;
      case "--no-warmup":
        options.warmup = false;
        break;
      case "--approaches":
        options.approaches = args[++i];
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        if (arg.startsWith("--")) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  return options;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
CodeTour Targeted Context Benchmark (Spec #92, Ticket #118)

Usage:
  node scripts/run-benchmark.js [options]

Options:
  --workspace <path>    Workspace root path (default: current directory)
  --iterations <n>     Number of iterations per approach (default: 3)
  --output <dir>        Output directory for reports (default: benchmark-reports)
  --no-warmup          Skip warmup iteration
  --approaches <list>   Comma-separated list of approaches to run (A,B,C,D)
  --help               Show this help

Examples:
  # Run benchmark in current directory
  node scripts/run-benchmark.js

  # Run with 5 iterations and custom output
  node scripts/run-benchmark.js --iterations 5 --output my-reports

  # Run only approaches A and D
  node scripts/run-benchmark.js --approaches A,D

  # Skip warmup for faster execution
  node scripts/run-benchmark.js --no-warmup

Approaches:
  A: No Targeted Context (Baseline)
  B: Basic Targeted Context - Changes Tour (Ticket #115)
  C: Progressive MCP Exploration (Ticket #116)
  D: Project Tour Targeted Context (Ticket #117)

This benchmark compares all 4 Targeted Context approaches from Spec #92
and generates comprehensive JSON and Markdown reports.
`);
}

/**
 * Main function
 */
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║   CodeTour Targeted Context Benchmark                         ║");
  console.log("║   Spec #92, Ticket #118                                    ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();

  // Parse approaches
  const approaches = options.approaches.split(",").map(a => a.trim());

  // Create and configure runner
  const runner = new TargetedContextBenchmarkRunner({
    workspaceRoot: options.workspace,
    iterations: options.iterations,
    warmup: options.warmup,
    collectMemory: true,
    approaches: approaches.length > 0 ? approaches : undefined,
    baseRef: "benchmark-base-sha",
    headRef: "benchmark-head-sha"
  });

  try {
    console.log(`⏳ Running benchmark...`);
    console.log(`   Workspace: ${options.workspace}`);
    console.log(`   Iterations: ${options.iterations}`);
    console.log(`   Approaches: ${approaches.join(", ")}`);
    console.log(`   Warmup: ${options.warmup ? "Yes" : "No"}`);
    console.log(`   Output: ${options.output}`);
    console.log();

    // Run benchmark
    const report = await runner.run();

    console.log(`✅ Benchmark completed successfully!`);
    console.log();

    // Display summary
    console.log("📊 Benchmark Summary:");
    console.log(`   Total Benchmarks: ${report.summary.totalBenchmarks}`);
    console.log(`   Successful: ${report.summary.successfulBenchmarks}`);
    console.log(`   Failed: ${report.summary.failedBenchmarks}`);
    console.log();

    console.log("🏆 Best by Metric:");
    console.log(`   Most Symbols: ${report.summary.bestByMetric.mostSymbols}`);
    console.log(`   Fastest: ${report.summary.bestByMetric.fastest}`);
    console.log(`   Lowest Cost: ${report.summary.bestByMetric.lowestCost}`);
    console.log(`   Most Efficient: ${report.summary.bestByMetric.mostEfficient}`);
    console.log();

    if (report.summary.overallWinner) {
      console.log(`🎯 Overall Winner: ${report.summary.overallWinner}`);
      console.log();
    }

    // Export reports
    console.log(`📝 Exporting reports to: ${options.output}`);
    const { jsonPath, mdPath } = await runner.exportReport(report, options.output);
    console.log(`   ✓ JSON Report: ${path.basename(jsonPath)}`);
    console.log(`   ✓ Markdown Report: ${path.basename(mdPath)}`);
    console.log();

    // Display recommendations
    console.log("💡 Recommendations:");
    for (const rec of report.summary.recommendations) {
      console.log(`   - ${rec}`);
    }
    console.log();

    console.log("✅ All done! Reports generated successfully.");
    console.log();

    process.exit(0);
  } catch (error) {
    console.error(`❌ Benchmark failed with error:`);
    console.error(error);
    process.exit(1);
  }
}

// Run main function
main().catch(error => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
