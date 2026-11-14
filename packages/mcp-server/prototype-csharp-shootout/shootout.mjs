// PROTOTYPE — strategy shootout on C# fixtures (throwaway).
//
// The question: which context mechanism gives a valid Tour for the fewest
// tokens? S1 (grep + whole-file reads) vs S2 (C# rule pack payload + explicit
// ambiguity lines + targeted slices). S3 (LSP) is appended by shootout.mjs
// whenever lsp-result.json (produced by lsp-csharp.mjs) is present.
//
// Reuses the pure payload logic of the first prototype unchanged.

import { encode } from "gpt-tokenizer";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph } from "./lib/rules/csharp.mjs";
import { cases } from "./ground-truth.mjs";
import {
  actionableCoverage,
  buildIndex,
  compareToGroundTruth,
  relationsFor,
  renderBaseline,
  renderPayloadWithGaps,
} from "../prototype-codeflow-graph/lib/payload.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, "fixture/csharp");
const wasmPath = path.join(here, "grammars/tree-sitter-c_sharp.wasm");
const WINDOW = 8;

const tokens = (text) => encode(text).length;
const shortName = (name) => name.slice(name.lastIndexOf(".") + 1);

async function walk(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "obj" || entry.name === "bin") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

/** S1 — the agent without a graph: grep the token, read every hit file. */
async function buildBaseline(grepToken, maxFiles = 8) {
  const pattern = new RegExp(`\\b${grepToken}\\b`);
  const hits = [];
  const matching = [];
  for (const full of await walk(fixtureRoot)) {
    if (!full.endsWith(".cs")) continue;
    const content = await fs.readFile(full, "utf8");
    const lines = content.split("\n");
    let matched = false;
    lines.forEach((text, index) => {
      if (pattern.test(text)) {
        matched = true;
        hits.push({
          file: path.relative(fixtureRoot, full),
          line: index + 1,
          text: text.slice(0, 160),
        });
      }
    });
    if (matched) matching.push({ path: path.relative(fixtureRoot, full), lines: lines.length, content });
  }
  const kept = matching.slice(0, maxFiles);
  return {
    hits,
    files: kept,
    truncated: matching.length - kept.length,
    text: renderBaseline({ symbol: grepToken, hits, files: kept }),
  };
}

/** Ambiguity lines scoped to a symbol: adapted from analyze.mjs of the first prototype. */
function collectGaps(graph, relations) {
  const anchors = relations.anchors;
  const anchorIds = relations.anchorIds;
  const anchorShortNames = new Set(
    anchors.map((node) => shortName(node.name)).filter((name) => name !== "constructor"),
  );
  const byShortName = new Map();
  for (const node of graph.nodes) {
    const key = shortName(node.name);
    if (!byShortName.has(key)) byShortName.set(key, []);
    byShortName.get(key).push(node.name);
  }
  const gaps = [];
  const seen = new Set();
  for (const site of graph.unresolved) {
    const candidates = byShortName.get(site.name) ?? [];
    if (candidates.length === 0) continue;
    const caller = graph.nodes
      .filter(
        (node) =>
          node.filePath === site.file &&
          site.line >= node.startLine &&
          site.line <= node.endLine,
      )
      .sort((a, b) => b.startLine - a.startLine)[0];
    const callerName = caller?.name ?? "(top-level)";
    const callerIsAnchor = caller ? anchorIds.has(caller.id) : false;
    const targetsSymbol = anchorShortNames.has(site.name) && !callerIsAnchor;
    const leavesSymbol = callerIsAnchor;
    if (!targetsSymbol && !leavesSymbol) continue;
    const key = `${site.file}|${site.line}|${site.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    gaps.push({
      file: site.file,
      line: site.line + 1,
      name: site.name,
      caller: callerName,
      direction: leavesSymbol ? "out" : "in",
      candidates: [...new Set(candidates)],
    });
  }
  return gaps;
}

/** Cost of reading only the lines around each ambiguity pointer. */
async function targetedRead(gaps) {
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
    const content = await fs.readFile(path.join(fixtureRoot, file), "utf8");
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

/** File that contains a caller (used to score what S1's full reads can discover). */
function callerFile(index, callerName) {
  const direct = index.nodes.get(callerName);
  if (direct) return direct.filePath;
  const owner = callerName.slice(0, callerName.lastIndexOf("."));
  const ownerNode = [...index.nodes.values()].find((node) => node.id?.startsWith(`${owner}.`));
  return ownerNode?.filePath ?? null;
}

const build = await buildGraph(fixtureRoot, wasmPath);
const graph = build.graph;
console.log(
  `graph: ${graph.scannedFiles} fichiers, ${graph.nodes.length} noeuds, ${graph.edges.length} arêtes, ${graph.unresolved.length} sites non résolus, ${graph.durationMs} ms`,
);

let lsp = null;
try {
  lsp = JSON.parse(await fs.readFile(path.join(here, "lsp-result.json"), "utf8"));
  console.log(`lsp-result.json: ${lsp.server} (${lsp.projects.length || "n/a"} projet(s))`);
} catch {
  console.log("lsp-result.json: absent — S3 non mesuré (lancer `node lsp-csharp.mjs`)");
}

const results = [];
for (const testCase of cases) {
  const index = buildIndex(graph);
  const relations = relationsFor(index, testCase.symbol);
  const comparison = compareToGroundTruth(relations, testCase.expected, testCase.symbol);
  const gaps = collectGaps(graph, relations);
  const coverage = actionableCoverage(comparison.rows, gaps, testCase.symbol);

  // S2 — rule pack payload + ambiguity lines + targeted slices
  const payloadWithGaps = renderPayloadWithGaps({
    symbol: testCase.symbol,
    file: testCase.file,
    relations,
    gaps,
  });
  const reads = await targetedRead(gaps);
  const s2PayloadTokens = tokens(payloadWithGaps);
  const s2TargetedTokens = tokens(reads.text);

  // S1 — grep + whole-file reads
  const baseline = await buildBaseline(testCase.grepToken);
  const baselineTokens = tokens(baseline.text);
  const baselineFiles = new Set(baseline.files.map((file) => file.path));
  const baseLinesRead = baseline.files.reduce((acc, file) => acc + file.lines, 0);
  const s1Coverage = { in: { total: coverage.incoming.total, actionable: 0 }, out: { total: coverage.outgoing.total, actionable: 0 } };
  for (const row of coverage.rows) {
    const file = callerFile(index, row.from) ?? callerFile(index, row.to);
    if (!file) continue;
    if (baselineFiles.has(file)) s1Coverage[row.direction].actionable += 1;
  }

  const caseResult = {
    id: testCase.id,
    label: testCase.label,
    symbol: testCase.symbol,
    question: testCase.question,
    graph: { nodes: graph.nodes.length, edges: graph.edges.length, unresolved: graph.unresolved.length, durationMs: graph.durationMs },
    s1: {
      strategy: "grep + lecture complète des fichiers touchés",
      tokens: baselineTokens,
      grepHits: baseline.hits.length,
      files: baseline.files.map((file) => ({ path: file.path, lines: file.lines })),
      linesRead: baseLinesRead,
      truncatedFiles: baseline.truncated,
      incoming: s1Coverage.in,
      outgoing: s1Coverage.out,
    },
    s2: {
      strategy: "pack de règles Tree-sitter + ambiguïtés + tranches ciblées",
      payloadTokens: s2PayloadTokens,
      targetedTokens: s2TargetedTokens,
      tokens: s2PayloadTokens + s2TargetedTokens,
      targetedRanges: reads.ranges,
      gaps,
      incoming: coverage.incoming,
      outgoing: coverage.outgoing,
    },
    payloadText: payloadWithGaps,
    baselineText: baseline.text,
    rows: coverage.rows,
    found: comparison.found,
    total: comparison.total,
    recallPct: Math.round(comparison.recall * 1000) / 10,
    falsePositives: comparison.falsePositives,
  };

  if (lsp) {
    const entry = (lsp.cases ?? []).find((entry) => entry.id === testCase.id);
    caseResult.s3 = entry ? { ...entry, strategy: "LSP (csharp-ls) : relations résolues + tranches ciblées" } : null;
  }

  results.push(caseResult);

  console.log(`\n## ${testCase.label} (${testCase.question})`);
  console.log(`S1   ${String(baselineTokens).padStart(6)} tokens | IN ${s1Coverage.in.actionable}/${s1Coverage.in.total} | ${baseline.files.length} fichiers, ${baseLinesRead} lignes`);
  console.log(`S2   ${String(s2PayloadTokens + s2TargetedTokens).padStart(6)} tokens (payload ${s2PayloadTokens} + tranches ${s2TargetedTokens}) | IN ${coverage.incoming.actionable}/${coverage.incoming.total} | OUT ${coverage.outgoing.actionable}/${coverage.outgoing.total} | gaps ${gaps.length}`);
  if (caseResult.s3) {
    console.log(`S3   ${String(caseResult.s3.tokens).padStart(6)} tokens | IN ${caseResult.s3.incomingCovered}/${coverage.incoming.total}`);
  }
  for (const row of coverage.rows) {
    const pointed = gaps.some(
      (gap) => gap.caller === row.from && gap.name === shortName(row.to),
    );
    console.log(
      `  ${row.found ? "v" : pointed ? "?" : "x"} ${row.direction === "in" ? "IN " : "OUT"} ${row.from} -> ${row.to} (${row.certainty})`,
    );
  }
}

const data = {
  generatedAt: new Date().toISOString(),
  tokenizer: "gpt-tokenizer (cl100k-compatible)",
  rulePack: "Tree-sitter C# (web-tree-sitter) — prototype",
  fixture: "fixture/csharp (net10.0)",
  window: WINDOW,
  scan: { files: graph.scannedFiles, nodes: graph.nodes.length, edges: graph.edges.length, unresolved: graph.unresolved.length, durationMs: graph.durationMs },
  cases: results,
};

await fs.writeFile(path.join(here, "data.json"), JSON.stringify(data, null, 2));
console.log(`\nwrote data.json (${results.length} cas)`);
