#!/usr/bin/env node

/**
 * Targeted Context benchmark.
 *
 * Measures the text actually served to the Tour Generator for the Changes Tour
 * (approach C) and the Project Tour (approach D), converts it to estimated
 * tokens, and writes a JSON and Markdown report.
 *
 * The figures are estimates (~4 characters per token). They are not billing
 * data. Run it after `npm run build` in packages/mcp-server:
 *
 *   node scripts/benchmark-targeted-context.cjs
 *   node scripts/benchmark-targeted-context.cjs --base origin/main --head HEAD
 *   node scripts/benchmark-targeted-context.cjs --check   # fail above target
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repositoryRoot = path.resolve(__dirname, "..");
const distRoot = path.join(
  repositoryRoot,
  "packages",
  "mcp-server",
  "dist",
  "src",
  "targeted-context"
);

function loadBenchmarkModules() {
  if (!fs.existsSync(path.join(distRoot, "context-extractor.js"))) {
    throw new Error(
      "The MCP server is not built. Run: npm --prefix packages/mcp-server run build"
    );
  }

  return {
    ...require(path.join(distRoot, "context-extractor.js")),
    ...require(path.join(distRoot, "project-context-extractor.js")),
    ...require(path.join(distRoot, "hybrid-config.js")),
    ...require(path.join(distRoot, "benchmark-report.js")),
    ...require(path.join(distRoot, "token-estimate.js")),
  };
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function parseArgs(argv) {
  const options = {
    workspace: repositoryRoot,
    base: undefined,
    head: "HEAD",
    out: undefined,
    check: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--workspace":
        options.workspace = path.resolve(argv[++i]);
        break;
      case "--base":
        options.base = argv[++i];
        break;
      case "--head":
        options.head = argv[++i];
        break;
      case "--out":
        options.out = path.resolve(argv[++i]);
        break;
      case "--check":
        options.check = true;
        break;
      case "--help":
      case "-h":
        console.log(
          [
            "Usage: node scripts/benchmark-targeted-context.cjs [options]",
            "",
            "  --workspace <path>  Repository to measure (default: this repository)",
            "  --base <ref>        Base ref for the Changes Tour (default: merge-base with origin/main)",
            "  --head <ref>        Head ref for the Changes Tour (default: HEAD)",
            "  --out <dir>         Report directory (default: <workspace>/benchmark-reports)",
            "  --check             Exit non-zero when a spec target is exceeded",
          ].join("\n")
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

/** Spec targets, in estimated tokens. */
const TARGETS = {
  changesFullContext: 150_000,
  projectFullContext: 400_000,
};

function defaultBase(workspace) {
  try {
    return git(["merge-base", "origin/main", "HEAD"], workspace);
  } catch {
    return git(["rev-parse", "HEAD~1"], workspace);
  }
}

function measurement(scenario, tourType, text, extra) {
  return {
    scenario,
    tourType,
    estimatedTokens: extra.estimateTokens(text),
    characters: text.length,
    symbols: extra.symbols,
    files: extra.files,
    pages: extra.pages,
    durationMs: extra.durationMs,
    ...(extra.targetTokens === undefined
      ? {}
      : { targetTokens: extra.targetTokens }),
    warnings: extra.warnings,
  };
}

function repositoryName(workspace) {
  try {
    const remote = git(["config", "--get", "remote.origin.url"], workspace);
    const match = remote.match(/([^/:]+?)(?:\.git)?$/);
    if (match) {
      return match[1];
    }
  } catch {
    // No remote configured: fall back to the directory name.
  }

  return path.basename(workspace);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const benchmark = loadBenchmarkModules();

  const workspace = options.workspace;
  const headRef = options.head;
  const baseRef = options.base ?? defaultBase(workspace);

  const context = { root: workspace, realRoot: workspace };

  const changes = await benchmark.extractPaginatedTargetedContext(
    context,
    baseRef,
    headRef,
    { page: 1 },
    benchmark.APPROACH_C_CONFIG
  );

  if (!changes.success || !changes.context) {
    throw new Error(`Changes Tour extraction failed: ${changes.error ?? "unknown error"}`);
  }

  const pageContext = changes.paginatedContext;
  const pageText =
    pageContext && pageContext.pages.length > 0
      ? benchmark.formatPaginatedContextForPrompt(pageContext)
      : "";
  const pageSymbols = pageContext
    ? pageContext.pages.reduce((sum, page) => sum + page.symbols.length, 0)
    : 0;

  const fullChangesText = benchmark.formatTargetedContextForPrompt(changes.context);

  const project = await benchmark.extractProjectTargetedContext(
    context,
    benchmark.APPROACH_D_CONFIG
  );

  if (!project.success || !project.context) {
    throw new Error(`Project Tour extraction failed: ${project.error ?? "unknown error"}`);
  }

  const fullProjectText = benchmark.formatProjectTargetedContextForPrompt(
    project.context
  );

  const results = [
    measurement("changes-first-page", "changes", pageText, {
      estimateTokens: benchmark.estimateTokenCount,
      symbols: pageSymbols,
      files: pageContext ? pageContext.pages.length : 0,
      pages: pageContext ? pageContext.pagination.totalPages : 0,
      durationMs: changes.context.durationMs,
      warnings: changes.warnings ?? [],
    }),
    measurement("changes-full-context", "changes", fullChangesText, {
      estimateTokens: benchmark.estimateTokenCount,
      symbols: changes.context.totalSymbols,
      files: changes.context.files.length,
      pages: pageContext ? pageContext.pagination.totalPages : 0,
      durationMs: changes.context.durationMs,
      targetTokens: TARGETS.changesFullContext,
      warnings: changes.warnings ?? [],
    }),
    measurement("project-full-context", "project", fullProjectText, {
      estimateTokens: benchmark.estimateTokenCount,
      symbols: project.context.totalSymbols,
      files: project.context.totalFiles,
      pages: 0,
      durationMs: project.context.durationMs,
      targetTokens: TARGETS.projectFullContext,
      warnings: project.warnings ?? [],
    }),
  ];

  const report = {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    environment: {
      repository: repositoryName(workspace),
      workspaceRoot: workspace,
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"], workspace),
      sha: git(["rev-parse", "HEAD"], workspace),
      baseRef,
      headRef,
    },
    configurations: {
      changes: benchmark.APPROACH_C_CONFIG,
      project: benchmark.APPROACH_D_CONFIG,
    },
    results,
  };

  const outDir = options.out ?? path.join(workspace, "benchmark-reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = report.environment.sha.slice(0, 7);
  const jsonPath = path.join(outDir, `targeted-context-${stamp}.json`);
  const markdownPath = path.join(outDir, `targeted-context-${stamp}.md`);

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    markdownPath,
    benchmark.formatBenchmarkMarkdown(report),
    "utf8"
  );

  for (const result of results) {
    const verdict = benchmark.evaluateTarget(result);
    console.log(
      `${result.scenario}: ~${result.estimatedTokens} est. tokens ` +
        `(${result.symbols} symbols, ${result.files} files) — ${verdict}`
    );
  }
  console.log(`\nJSON: ${jsonPath}`);
  console.log(`Markdown: ${markdownPath}`);

  if (
    options.check &&
    results.some((result) => benchmark.evaluateTarget(result) === "over-target")
  ) {
    console.error("\nAt least one spec target is exceeded.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Benchmark failed: ${error.message}`);
  process.exit(1);
});
