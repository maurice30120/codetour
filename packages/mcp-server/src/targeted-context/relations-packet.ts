/**
 * Relations packet seam of ticket #155 (spec #149, ADR 0034).
 *
 * `codetour-mcp` contains no Tree-sitter code of its own: everything below
 * goes through the public API of `codetour-relation-graph` (buildRelationGraph
 * + selectDepth1 + the pack registry). This module:
 *
 *  - wires the module runtime at the MCP seam (`ensureRelationGraphRuntime`:
 *    registerBuiltinPacks() plus configureWasmAssets when the prebuilt .wasm
 *    grammars ship as asset files next to a webpack bundle — VSIX/standalone;
 *    on the npm channel the grammars resolve from node_modules and nothing is
 *    configured);
 *  - produces the depth-1 packet from the SAME scan pass as the symbol
 *    selection (same sources, same extracted symbols as seeds), honoring the
 *    existing pagination by scoping the seeds to the served page;
 *  - merges targeted slices (configurable window, default ±8 lines) around
 *    each ambiguity pointer, per file;
 *  - formats the packet for the served markdown.
 *
 * The packet rides the EXISTING Targeted Context flag (ADR 0033): when the
 * flag is off the extractors return before any of this runs, so the
 * historical pipeline is byte-identical.
 */

import * as fs from "fs";
import * as path from "path";
import {
  buildRelationGraph,
  configureWasmAssets,
  detectLanguageFromPath as detectPackLanguageFromPath,
  registerBuiltinPacks,
  selectDepth1,
  estimateTokens,
  type AmbiguitySite,
  type GraphEdge,
  type GraphLimits,
  type GraphNode,
  type RelationGraph,
  type RelationPacket,
  type RelationStatus,
  type SourceFile,
  type UnsupportedFile,
} from "codetour-relation-graph";
import { CodeSymbol } from "../parsing/symbol-extractor";

/** Default targeted-slice window around an ambiguity pointer (spec #149: ±8). */
export const DEFAULT_RELATIONS_WINDOW = 8;

/** A merged targeted slice: the lines around one or more ambiguity pointers. */
export interface TargetedSlice {
  /** Forward-slash relative path. */
  filePath: string;
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
  /** The slice content (the targeted lines, not the whole file). */
  text: string;
}

/**
 * The relations packet attached to a Targeted Context selection: the depth-1
 * view of the graph plus the explicit unsupported files and the targeted
 * slices, with its token estimate (tracked through the existing CostTracker
 * by the caller, for the #118 benchmark).
 */
export interface RelationsPacket {
  depth: 1;
  status: RelationStatus;
  /** Resolved seed node ids. */
  seeds: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  sites: AmbiguitySite[];
  unsupportedFiles: UnsupportedFile[];
  slices: TargetedSlice[];
  /** The window used for the slices. */
  windowLines: number;
  /** Token estimate of the serialized packet (roughly 4 chars per token). */
  tokens: number;
}

let runtimeEnsured = false;

/**
 * Wire the relation-graph runtime at the MCP seam, once per process:
 * register the built-in packs (#151–#154) and, when the server runs from a
 * webpack bundle (VSIX `dist/mcp-server.js`, standalone `dist/cli.js`), point
 * `Parser.init`'s locateFile and the grammar loader at the staged .wasm asset
 * directory next to the bundle (scripts/prepare-tree-sitter-wasm.js). On the
 * npm channel no asset directory exists and the grammars resolve from
 * node_modules/tree-sitter-wasms, so nothing is configured.
 */
export function ensureRelationGraphRuntime(): void {
  if (runtimeEnsured) return;
  runtimeEnsured = true;
  registerBuiltinPacks();
  const wasmDirectory = findWasmAssetDirectory();
  if (wasmDirectory) {
    configureWasmAssets({ wasmDirectory });
  }
}

/** The staged .wasm asset directory next to the running bundle, if any. */
function findWasmAssetDirectory(): string | undefined {
  const candidates = [
    // Webpack bundle: __dirname is the bundle's directory (dist/), which
    // holds tree-sitter-wasm/ next to it after scripts/prepare-tree-sitter-wasm.js.
    path.resolve(__dirname, "tree-sitter-wasm"),
    // Compiled package layout: dist/src/targeted-context -> dist/tree-sitter-wasm.
    path.resolve(__dirname, "..", "tree-sitter-wasm"),
  ];
  for (const candidate of candidates) {
    try {
      if (
        fs.existsSync(path.join(candidate, "tree-sitter.wasm")) &&
        fs.existsSync(path.join(candidate, "tree-sitter-typescript.wasm"))
      ) {
        return candidate;
      }
    } catch {
      // ignore and try the next candidate
    }
  }
  return undefined;
}

/**
 * Seed node names ("Type.member" or bare name) for extracted symbols. Class
 * seeds also pull the synthetic "Type.constructor" node so class usages
 * (instantiation sites) appear in the packet (spec #149 story 3).
 */
export function relationsSeedsFromSymbols(symbols: CodeSymbol[]): string[] {
  const seeds: string[] = [];
  const push = (name: string): void => {
    if (name && !seeds.includes(name)) seeds.push(name);
  };
  for (const symbol of symbols) {
    const fullName = symbol.parentName ? `${symbol.parentName}.${symbol.name}` : symbol.name;
    push(fullName);
    if (symbol.kind === "class") push(`${symbol.name}.constructor`);
  }
  return seeds;
}

/** Per-file language for the graph: pack language, JS through the TS grammar, else the raw id (=> unsupported). */
function sourceLanguage(filePath: string): string {
  const packLanguage = detectPackLanguageFromPath(filePath);
  if (packLanguage) return packLanguage;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".js" || ext === ".jsx") return "typescript";
  // Unknown to the packs: keep the extension-derived id so buildRelationGraph
  // reports the file explicitly as unsupported (never a silent empty graph).
  return ext.replace(/^\./, "") || "unknown";
}

/**
 * The graph-level language label: the dominant per-file language of the
 * selection (ties resolve to the first-seen language, so the label is
 * deterministic). Per-file languages drive the analysis; this label only
 * reports what the graph covers — it must not claim "typescript" for a
 * Java-only selection.
 */
function dominantLanguage(languages: string[]): string {
  const counts = new Map<string, number>();
  for (const language of languages) {
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  let dominant = "unknown";
  let best = -1;
  for (const [language, count] of counts) {
    if (count > best) {
      dominant = language;
      best = count;
    }
  }
  return dominant;
}

export interface RelationsPacketInput {
  /** The selected sources with their content (the same scan pass as the symbol extraction). */
  sources: { path: string; content: string }[];
  /** Seed node names for THIS packet (page-scoped when paginating). */
  seeds: string[];
  /** Targeted-slice window around each ambiguity pointer; default ±8. */
  windowLines?: number;
  /** Graph limits override (defaults of the relation-graph module apply). */
  limits?: Partial<GraphLimits>;
}

/**
 * Build the depth-1 relations packet for a selection: one graph over all the
 * selected sources (per-file languages), then selectDepth1 around the seeds.
 * Files whose language has no pack land in `unsupportedFiles` — explicit
 * `unsupported`, never a silently empty graph.
 */
export async function buildRelationsPacket(
  input: RelationsPacketInput
): Promise<RelationsPacket> {
  const windowLines = input.windowLines ?? DEFAULT_RELATIONS_WINDOW;
  const sources: SourceFile[] = input.sources.map(source => ({
    path: source.path,
    content: source.content,
    language: sourceLanguage(source.path)
  }));

  const graph: RelationGraph = await buildRelationGraph(
    sources,
    dominantLanguage(sources.map(source => source.language ?? "unknown")),
    { limits: input.limits }
  );
  const packet: RelationPacket = selectDepth1(graph, input.seeds, input.limits);

  const contentsByPath = new Map(input.sources.map(s => [s.path, s.content]));
  const slices = buildSlices(packet.sites, contentsByPath, windowLines);

  const view: RelationsPacket = {
    depth: 1,
    status: packet.status,
    seeds: packet.seeds,
    nodes: packet.nodes,
    edges: packet.edges,
    sites: packet.sites,
    unsupportedFiles: graph.unsupportedFiles,
    slices,
    windowLines,
    tokens: 0
  };
  view.tokens = estimateTokens(JSON.stringify({ ...view, tokens: undefined }));
  return view;
}

/**
 * Build the depth-1 relations packet for a selection (#155), or undefined when
 * no source entered the selection. A packet failure degrades to a warning:
 * the relations are additive, the symbol selection stands.
 */
export async function buildRelationsForSelection(
  sources: { path: string; content: string }[],
  seeds: string[],
  windowLines: number | undefined,
  warnings: string[]
): Promise<RelationsPacket | undefined> {
  if (sources.length === 0) return undefined;
  try {
    return await buildRelationsPacket({
      sources,
      seeds,
      windowLines: windowLines ?? DEFAULT_RELATIONS_WINDOW,
    });
  } catch (error) {
    warnings.push(
      `Relations packet unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}

/**
 * Merge the per-site windows (±windowLines around each ambiguity pointer)
 * into one range per file, clamped to the file length.
 */
function buildSlices(
  sites: AmbiguitySite[],
  contentsByPath: Map<string, string>,
  windowLines: number
): TargetedSlice[] {
  interface Range {
    startLine: number;
    endLine: number;
  }
  const rangesByFile = new Map<string, Range[]>();
  for (const site of sites) {
    const content = contentsByPath.get(site.file);
    if (content === undefined) continue;
    const lineCount = content.split("\n").length;
    const startLine = Math.max(1, site.line - windowLines);
    const endLine = Math.min(lineCount, site.line + windowLines);
    const ranges = rangesByFile.get(site.file) ?? [];
    ranges.push({ startLine, endLine });
    rangesByFile.set(site.file, ranges);
  }

  const slices: TargetedSlice[] = [];
  for (const [filePath, ranges] of rangesByFile) {
    const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine);
    const merged: Range[] = [];
    for (const range of sorted) {
      const last = merged[merged.length - 1];
      if (last && range.startLine <= last.endLine + 1) {
        last.endLine = Math.max(last.endLine, range.endLine);
      } else {
        merged.push({ ...range });
      }
    }
    const content = contentsByPath.get(filePath)!;
    const lines = content.split("\n");
    for (const range of merged) {
      slices.push({
        filePath,
        startLine: range.startLine,
        endLine: range.endLine,
        text: lines.slice(range.startLine - 1, range.endLine).join("\n")
      });
    }
  }
  return slices.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine);
}

/**
 * Render the relations packet as the markdown section appended to the served
 * Targeted Context. Contract clauses (pinned by tests): a "## Relations
 * (depth 1)" heading, one line per edge with `from` -> `to`, kind/callType,
 * status and file:line evidence, "?" lines for ambiguity sites with their
 * candidates, the explicit unsupported files, and the targeted slices.
 */
export function formatRelationsPacketForPrompt(packet: RelationsPacket): string {
  const parts: string[] = [];
  parts.push(`## Relations (depth 1)`);
  parts.push("");
  parts.push(
    `Status: ${packet.status}. ${packet.seeds.length} seed(s), ${packet.nodes.length} node(s), ` +
      `${packet.edges.length} edge(s), ${packet.sites.length} ambiguity site(s), ` +
      `${packet.unsupportedFiles.length} unsupported file(s). ~${packet.tokens} tokens.`
  );
  parts.push("");

  if (
    packet.status === "unsupported" &&
    packet.edges.length === 0 &&
    packet.sites.length === 0 &&
    packet.nodes.length === 0
  ) {
    // Explicit empty packet: never a silently empty section.
    parts.push(
      "No relations could be built: no language pack covers the selected file(s) (unsupported)."
    );
    parts.push("");
  }

  const nameById = new Map(packet.nodes.map(n => [n.id, n.name]));
  if (packet.edges.length > 0) {
    parts.push(`### Edges`);
    parts.push("");
    for (const edge of packet.edges) {
      const from = nameById.get(edge.from) ?? edge.from;
      const to = nameById.get(edge.to) ?? edge.to;
      parts.push(
        `- \`${from}\` -> \`${to}\` (${edge.kind}/${edge.callType}, ${edge.status}) at ${edge.filePath}:${edge.line}`
      );
    }
    parts.push("");
  }

  if (packet.sites.length > 0) {
    parts.push(`### Ambiguity sites (?)`);
    parts.push("");
    for (const site of packet.sites) {
      const candidates = site.candidates.length > 0 ? site.candidates.join(", ") : "none";
      parts.push(
        `- ? \`${site.name}\` at ${site.file}:${site.line} (caller: \`${site.caller}\`, ${site.status}) — candidates: ${candidates}`
      );
    }
    parts.push("");
  }

  if (packet.unsupportedFiles.length > 0) {
    parts.push(`### Unsupported files (no language pack)`);
    parts.push("");
    for (const file of packet.unsupportedFiles) {
      parts.push(`- ${file.path} (${file.language}) — status: unsupported`);
    }
    parts.push("");
  }

  if (packet.slices.length > 0) {
    parts.push(`### Targeted slices (window: ±${packet.windowLines} lines around each pointer)`);
    parts.push("");
    for (const slice of packet.slices) {
      parts.push(`#### ${slice.filePath} lines ${slice.startLine}-${slice.endLine}`);
      parts.push("```");
      parts.push(slice.text);
      parts.push("```");
      parts.push("");
    }
  }

  return parts.join("\n");
}
