import {
  analyzeDirectory,
  initTreeSitter,
  parseFileContent,
} from "@codeflow-map/core";
import { encode } from "gpt-tokenizer";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cases } from "./ground-truth.mjs";
import {
  actionableCoverage,
  buildIndex,
  compareToGroundTruth,
  relationsFor,
  renderBaseline,
  renderPayload,
  renderPayloadWithGaps,
} from "./lib/payload.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const wasmDirectory = path.join(here, "grammars");
const backends = {
  ts: { root: path.join(here, "fixture/ts"), include: ["**/*.ts"] },
  py: { root: path.join(here, "fixture/py"), include: ["**/*.py"] },
  repo: {
    root: path.resolve(here, "../src"),
    include: ["**/*.ts"],
    exclude: ["**/node_modules/**", "**/*.test.ts"],
  },
};

const tokens = (text) => encode(text).length;
const shortName = (name) => name.slice(name.lastIndexOf(".") + 1);
const WINDOW = 8;

async function walk(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

function isIncluded(config, full) {
  if (config.include.every((glob) => !full.endsWith(glob.replace("**/*", "")))) {
    return false;
  }
  return !/\.test\.ts$/.test(full);
}

async function loadBackends() {
  const graphs = {};
  const rawCalls = {};
  await initTreeSitter(wasmDirectory);
  for (const [name, config] of Object.entries(backends)) {
    graphs[name] = await analyzeDirectory({
      rootPath: config.root,
      wasmDirectory,
      include: config.include,
      exclude: config.exclude,
    });
    rawCalls[name] = [];
    for (const full of await walk(config.root)) {
      if (!isIncluded(config, full)) continue;
      const relative = path.relative(config.root, full).split(path.sep).join("/");
      const language = full.endsWith(".py") ? "python" : "typescript";
      const parsed = await parseFileContent(
        relative,
        await fs.readFile(full, "utf8"),
        wasmDirectory,
        language,
      );
      for (const call of parsed.calls) {
        rawCalls[name].push({
          callerFilePath: relative,
          calleeName: call.calleeName,
          line: call.line,
        });
      }
    }
  }
  return { graphs, rawCalls };
}

/** Same attribution heuristic as the library: innermost line range wins. */
function innermostNode(nodes, filePath, line) {
  return nodes
    .filter(
      (node) =>
        node.filePath === filePath &&
        line >= node.startLine &&
        line <= node.endLine,
    )
    .sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];
}

/**
 * What an honest resolver could report with the library's existing data:
 * every call site it saw but refused to attribute, with its candidate targets.
 */
function collectGaps(graph, index, relations, rawCalls, symbol) {
  const anchors = relations.anchors;
  const anchorIds = relations.anchorIds;
  const anchorNames = new Set(anchors.map((node) => node.name));
  // `constructor` is a language keyword: no raw call ever carries that name.
  const anchorShortNames = new Set(
    anchors.map((node) => shortName(node.name)).filter((name) => name !== "constructor"),
  );
  const byShortName = new Map();
  for (const node of graph.nodes) {
    const key = shortName(node.name);
    if (!byShortName.has(key)) byShortName.set(key, []);
    byShortName.get(key).push(node.name);
  }
  const resolvedLines = new Set(
    graph.edges.map((edge) => {
      const from = index.nodes.get(edge.from);
      const to = index.nodes.get(edge.to);
      return `${from.filePath}|${edge.line}|${shortName(to.name)}`;
    }),
  );

  const seen = new Set();
  const gaps = [];
  for (const call of rawCalls) {
    if (resolvedLines.has(`${call.callerFilePath}|${call.line}|${call.calleeName}`)) {
      continue;
    }
    const caller = innermostNode(graph.nodes, call.callerFilePath, call.line);
    const fromAnchor = caller ? anchorIds.has(caller.id) : false;
    const candidates = byShortName.get(call.calleeName) ?? [];
    const targetsSymbol = anchorShortNames.has(call.calleeName) && !fromAnchor;
    const leavesSymbol = fromAnchor && candidates.length > 0;
    if (!targetsSymbol && !leavesSymbol) continue;
    const key = `${call.callerFilePath}|${call.line}|${call.calleeName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    gaps.push({
      file: call.callerFilePath,
      line: call.line + 1,
      name: call.calleeName,
      caller: caller ? caller.name : "(top-level)",
      direction: leavesSymbol ? "out" : "in",
      candidates: [...new Set(candidates)],
    });
  }
  return gaps;
}

/** Cost of reading only the lines around each gap pointer, ranges merged. */
async function targetedRead(config, gaps) {
  const byFile = new Map();
  for (const gap of gaps) {
    const start = Math.max(1, gap.line - WINDOW);
    const end = gap.line + WINDOW;
    if (!byFile.has(gap.file)) byFile.set(gap.file, []);
    byFile.get(gap.file).push({ start, end, line: gap.line });
  }
  const parts = [];
  const ranges = [];
  for (const [file, list] of byFile) {
    const content = await fs.readFile(path.join(config.root, file), "utf8");
    const lines = content.split("\n");
    const merged = [];
    for (const range of list.sort((a, b) => a.start - b.start)) {
      const last = merged[merged.length - 1];
      if (last && range.start <= last.end + 1) {
        last.end = Math.max(last.end, range.end);
        last.lines.push(range.line);
      } else {
        merged.push({ start: range.start, end: Math.min(range.end, lines.length), lines: [range.line] });
      }
    }
    for (const range of merged) {
      ranges.push({
        file,
        start: range.start,
        end: range.end,
        lines: range.end - range.start + 1,
        pointers: range.lines,
      });
      parts.push(
        `### ${file}:${range.start}-${range.end} (appel(s) ligne ${range.lines.join(", ")})`,
        lines.slice(range.start - 1, range.end).join("\n"),
        "",
      );
    }
  }
  return { text: parts.join("\n"), ranges };
}

/** Simulate the cheap-but-dumb baseline: grep the name, read every file hit. */
async function buildBaseline(config, grepToken, maxFiles = 8) {
  const pattern = new RegExp(`\\b${grepToken}\\b`);
  const hits = [];
  const matching = [];
  for (const full of await walk(config.root)) {
    if (!isIncluded(config, full)) continue;
    const content = await fs.readFile(full, "utf8");
    const lines = content.split("\n");
    let matched = false;
    lines.forEach((text, index) => {
      if (pattern.test(text)) {
        matched = true;
        hits.push({
          file: path.relative(config.root, full),
          line: index + 1,
          text: text.slice(0, 160),
        });
      }
    });
    if (matched) {
      matching.push({
        path: path.relative(config.root, full),
        lines: lines.length,
        content,
      });
    }
  }
  const kept = matching.slice(0, maxFiles);
  return {
    hits,
    files: kept,
    truncated: matching.length - kept.length,
    text: renderBaseline({ symbol: grepToken, hits, files: kept }),
  };
}

const { graphs, rawCalls } = await loadBackends();
const results = [];

for (const testCase of cases) {
  const graph = graphs[testCase.backend];
  const index = buildIndex(graph);
  const relations = relationsFor(index, testCase.symbol);
  const comparison = compareToGroundTruth(relations, testCase.expected, testCase.symbol);
  const gaps = collectGaps(graph, index, relations, rawCalls[testCase.backend], testCase.symbol);
  const payload = renderPayload({
    symbol: testCase.symbol,
    file: testCase.file,
    relations,
  });
  const payloadWithGaps = renderPayloadWithGaps({
    symbol: testCase.symbol,
    file: testCase.file,
    relations,
    gaps,
  });
  const coverage = actionableCoverage(comparison.rows, gaps, testCase.symbol);
  const baseline = await buildBaseline(backends[testCase.backend], testCase.grepToken);
  const reads = await targetedRead(backends[testCase.backend], gaps);
  const payloadTokens = tokens(payload);
  const payloadGapTokens = tokens(payloadWithGaps);
  const baselineTokens = tokens(baseline.text);
  const targetedTokens = tokens(reads.text);

  results.push({
    id: testCase.id,
    label: testCase.label,
    question: testCase.question,
    symbol: testCase.symbol,
    file: testCase.file,
    grepToken: testCase.grepToken,
    payload,
    payloadTokens,
    payloadWithGaps,
    payloadGapTokens,
    gaps,
    targetedText: reads.text,
    targetedRanges: reads.ranges,
    targetedTokens,
    honestTokens: payloadGapTokens + targetedTokens,
    baselineText: baseline.text,
    baselineTokens,
    baselineHits: baseline.hits.length,
    baselineFiles: baseline.files.map((file) => ({ path: file.path, lines: file.lines })),
    baselineTruncated: baseline.truncated,
    apparentSavingPct: Math.round((1 - payloadTokens / baselineTokens) * 1000) / 10,
    found: comparison.found,
    total: comparison.total,
    recallPct: Math.round(comparison.recall * 1000) / 10,
    falsePositives: comparison.falsePositives,
    rows: coverage.rows,
    incoming: coverage.incoming,
    outgoing: coverage.outgoing,
    scan: {
      files: graph.scannedFiles,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      durationMs: graph.durationMs,
    },
  });

  console.log(
    `${testCase.id.padEnd(28)} payload ${String(payloadTokens).padStart(5)} | +honnête ${String(payloadGapTokens).padStart(5)} | ciblé ${String(targetedTokens).padStart(5)} | baseline ${String(baselineTokens).padStart(6)} | IN ${coverage.incoming.actionable}/${coverage.incoming.total} OUT ${coverage.outgoing.actionable}/${coverage.outgoing.total} | gaps ${gaps.length}`,
  );
}

const data = {
  generatedAt: new Date().toISOString(),
  tokenizer: "gpt-tokenizer (pure JS, cl100k-compatible)",
  library: "@codeflow-map/core 1.0.3",
  graphs: Object.fromEntries(
    Object.entries(graphs).map(([name, graph]) => [
      name,
      {
        files: graph.scannedFiles,
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        durationMs: graph.durationMs,
      },
    ]),
  ),
  cases: results,
};

await fs.writeFile(path.join(here, "data.json"), JSON.stringify(data, null, 2));
console.log(`\nwrote data.json (${results.length} cases)`);
