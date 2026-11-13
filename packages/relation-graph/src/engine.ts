import { Query } from "web-tree-sitter";
import { extractionCacheKey, type ExtractionCache } from "./cache";
import { getParser, loadGrammar } from "./grammars";
import { normalizeLanguage } from "./languages";
import type { LanguagePack, PackAnalysisResult, PackTypeInfo, RawCallSite, RawNode } from "./pack";
import { getPack } from "./registry";
import { estimateTokens, TokenBudget } from "./tokens";
import { ANALYZER_VERSION } from "./version";
import {
  DEFAULT_LIMITS,
  type AmbiguitySite,
  type GraphEdge,
  type GraphLimits,
  type GraphNode,
  type RelationGraph,
  type SourceFile,
  type TruncationFlags,
  type UnsupportedFile
} from "./types";

export interface BuildOptions {
  limits?: Partial<GraphLimits>;
  /** Extraction cache keyed by (file, content SHA, language, analyzer version). */
  cache?: ExtractionCache;
  /**
   * Override directory for the prebuilt grammar .wasm files (webpack/VSIX
   * bundles ship them as assets); defaults to node_modules/tree-sitter-wasms.
   */
  wasmDirectory?: string;
}

function shortName(fullName: string): string {
  const dot = fullName.lastIndexOf(".");
  return dot >= 0 ? fullName.slice(dot + 1) : fullName;
}

/**
 * Pure entry point of the module: (sources, language) -> graph.
 *
 * The sources' content is provided by the caller (no disk I/O, no network).
 * Deterministic for a given (sources, language, analyzer version, packs).
 */
export async function buildRelationGraph(
  sources: SourceFile[],
  language: string,
  options: BuildOptions = {}
): Promise<RelationGraph> {
  const limits: GraphLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const truncated: TruncationFlags = { nodes: false, edges: false, tokens: false };
  const graphLanguage = normalizeLanguage(language) ?? language.trim().toLowerCase();
  const unsupportedFiles: UnsupportedFile[] = [];

  // Phase 0 — effective language per file (per-file override wins).
  const plan = sources.map(source => {
    const raw = source.language ?? language;
    return {
      source,
      language: normalizeLanguage(raw) ?? raw.trim().toLowerCase()
    };
  });
  const analyzable: { source: SourceFile; language: string; pack: LanguagePack }[] = [];
  for (const entry of plan) {
    const pack = getPack(entry.language);
    if (pack) analyzable.push({ ...entry, pack });
    else unsupportedFiles.push({ path: entry.source.path, language: entry.language });
  }

  if (analyzable.length === 0) {
    // Explicit "unsupported" — never a silently empty graph.
    return {
      language: graphLanguage,
      supported: false,
      status: "unsupported",
      nodes: [],
      edges: [],
      sites: [],
      outgoing: {},
      incoming: {},
      unsupportedFiles,
      limits,
      truncated,
      analyzerVersion: ANALYZER_VERSION
    };
  }

  // Phase 1 — per-file raw extraction, cached by (file, content SHA, language, analyzer version).
  const rawPerFile: PackAnalysisResult[] = [];
  for (const { source, language: lang, pack } of analyzable) {
    const key = extractionCacheKey(source, lang);
    let result = options.cache?.get(key);
    if (!result) {
      const parser = await getParser();
      const wasmLanguage = await loadGrammar(pack.grammarId, options.wasmDirectory);
      parser.setLanguage(wasmLanguage);
      const tree = parser.parse(source.content);
      if (!tree) throw new Error(`tree-sitter failed to parse ${source.path}`);
      result = await pack.analyze({
        file: source,
        language: lang,
        grammarId: pack.grammarId,
        parser,
        tree,
        createQuery: source => new Query(wasmLanguage, source)
      });
      options.cache?.set(key, result);
    }
    rawPerFile.push(result);
  }

  // Phase 2 — aggregate nodes (dedup by id) under maxNodes/maxTokens.
  const budget = new TokenBudget(limits.maxTokens, truncated);
  const nodes: GraphNode[] = [];
  const nodeById = new Map<string, GraphNode>();
  const byName = new Map<string, GraphNode[]>();
  const byShortName = new Map<string, GraphNode[]>();
  /** Side index of RawNode.ownerKind (the public node shape of #149 is unchanged). */
  const ownerKindById = new Map<string, string>();

  const addNode = (raw: RawNode): GraphNode | undefined => {
    const id = `${raw.filePath}:${raw.startLine}:${raw.name}`;
    const existing = nodeById.get(id);
    if (existing) return existing;
    if (nodes.length >= limits.maxNodes) {
      truncated.nodes = true;
      return undefined;
    }
    const node: GraphNode = { id, ...raw };
    if (!budget.trySpend(JSON.stringify(node))) return undefined;
    nodes.push(node);
    nodeById.set(id, node);
    if (raw.ownerKind) ownerKindById.set(id, raw.ownerKind);
    pushTo(byName, raw.name, node);
    pushTo(byShortName, shortName(raw.name), node);
    return node;
  };

  for (const result of rawPerFile) {
    for (const rawNode of result.nodes) addNode(rawNode);
  }

  // Type declarations reported by packs (merged across files): they let the
  // engine resolve typed receivers, extends/implements chains and interface
  // ports against the whole local graph. Absent for the generic default pack.
  const typeByName = new Map<string, PackTypeInfo>();
  for (const result of rawPerFile) {
    for (const type of result.types ?? []) {
      if (!typeByName.has(type.name)) typeByName.set(type.name, type);
    }
  }

  /**
   * Find `member` on `typeName` or its explicit ancestors (extends chain, then
   * implemented interfaces). Returns the unique node when provable, plus
   * whether it was found on an interface (=> interface dispatch toward the
   * port, heuristic). Never guesses: nothing found -> undefined.
   */
  const memberOnType = (
    typeName: string,
    member: string,
    seen: Set<string> = new Set()
  ): { node: GraphNode; viaInterface: boolean } | undefined => {
    if (seen.has(typeName)) return undefined;
    seen.add(typeName);
    const info = typeByName.get(typeName);
    const direct = byName.get(`${typeName}.${member}`);
    if (direct && direct.length === 1) {
      return { node: direct[0], viaInterface: info?.kind === "interface" };
    }
    if (info?.extends) {
      const found = memberOnType(info.extends, member, seen);
      if (found) return found;
    }
    for (const iface of info?.implements ?? []) {
      const found = memberOnType(iface, member, seen);
      if (found) return found;
    }
    return undefined;
  };

  const lineCountOf = (content: string): number =>
    content.length === 0 ? 1 : content.split("\n").length;
  const fileScopeNode = new Map<string, GraphNode>();
  const ensureFileScopeNode = (filePath: string, content: string): GraphNode | undefined => {
    const existing = fileScopeNode.get(filePath) ?? nodeById.get(`${filePath}:1:${filePath}`);
    if (existing) return existing;
    return addNode({
      name: filePath,
      filePath,
      startLine: 1,
      endLine: lineCountOf(content)
    });
  };
  const contentByPath = new Map(sources.map(s => [s.path, s.content]));

  const findNodeByName = (name: string, preferredFile?: string): GraphNode | undefined => {
    const candidates = byName.get(name);
    if (!candidates || candidates.length === 0) return undefined;
    return candidates.find(n => n.filePath === preferredFile) ?? candidates[0];
  };

  // Phase 3 — resolve raw call sites against the whole local graph.
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const sites: AmbiguitySite[] = [];
  const siteKeys = new Set<string>();

  const addEdge = (edge: GraphEdge): void => {
    const key = `${edge.from}|${edge.to}|${edge.kind}|${edge.callType}|${edge.filePath}|${edge.line}`;
    if (edgeKeys.has(key)) return;
    if (edges.length >= limits.maxEdges) {
      truncated.edges = true;
      return;
    }
    if (!budget.trySpend(JSON.stringify(edge))) return;
    edgeKeys.add(key);
    edges.push(edge);
  };
  const addSite = (site: AmbiguitySite): void => {
    const key = `${site.file}|${site.line}|${site.name}|${site.caller}`;
    if (siteKeys.has(key)) return;
    if (!budget.trySpend(JSON.stringify(site))) return;
    siteKeys.add(key);
    sites.push(site);
  };

  const callerNodeOf = (call: RawCallSite): GraphNode | undefined => {
    if (call.caller) {
      const node = findNodeByName(call.caller, call.file);
      if (node) return node;
    }
    return ensureFileScopeNode(call.file, contentByPath.get(call.file) ?? "");
  };
  const callerLabel = (call: RawCallSite): string => call.caller || call.file;

  // Interfaces declared by the packs across all sources: relations toward an
  // interface port are asserted with callType "interface" + heuristic status.
  const interfaceNames = new Set<string>();
  for (const result of rawPerFile) {
    for (const name of result.interfaces ?? []) interfaceNames.add(name);
  }

  // Pack-provided edges (from/to are node names) and sites pass through.
  for (const result of rawPerFile) {
    for (const rawEdge of result.edges ?? []) {
      const from = findNodeByName(rawEdge.from, rawEdge.filePath);
      const to = findNodeByName(rawEdge.to, rawEdge.filePath);
      if (!from || !to) {
        addSite({
          file: rawEdge.filePath,
          line: rawEdge.line,
          name: shortName(rawEdge.to),
          caller: rawEdge.from,
          candidates: to ? [to.name] : (byShortName.get(shortName(rawEdge.to)) ?? []).map(n => n.name),
          status: "unresolved"
        });
        continue;
      }
      addEdge({
        from: from.id,
        to: to.id,
        line: rawEdge.line,
        kind: rawEdge.kind,
        callType: rawEdge.callType,
        status: rawEdge.status,
        filePath: rawEdge.filePath
      });
    }
    for (const site of result.sites ?? []) addSite(site);
  }

  // Engine resolution of raw call sites: provable -> edge, otherwise -> site.
  for (const result of rawPerFile) {
    for (const call of result.calls) {
      const callerNode = callerNodeOf(call);
      const isSuper = call.syntax === "super" || call.receiver === "super";
      const effectiveSyntax: RawCallSite["syntax"] = isSuper ? "super" : call.syntax;

      // Pack-proven receiver type (declared types, `var` inference, `using`
      // aliases — e.g. the C# pack of #152): resolve `receiverType.name`
      // against the whole local graph first. Exactly one candidate -> edge;
      // anything else -> ambiguity site, never a guessed edge.
      if (call.receiverType && effectiveSyntax === "call") {
        const typed = byName.get(`${call.receiverType}.${call.name}`) ?? [];
        if (typed.length === 1 && callerNode) {
          const isInterface = ownerKindById.get(typed[0].id) === "interface";
          addEdge({
            from: callerNode.id,
            to: typed[0].id,
            line: call.line,
            kind: "call",
            // Spec #149 story 16: through an interface the relation is asserted
            // toward the port (IRepository.Find) with a heuristic status, never
            // toward an implementation (DatabaseRepository.Find).
            callType: isInterface ? "interface" : "direct",
            status: isInterface ? "heuristic" : "resolved",
            filePath: call.file
          });
        } else {
          const candidates = typed.length > 0 ? typed : byShortName.get(call.name) ?? [];
          addSite({
            file: call.file,
            line: call.line,
            name: call.name,
            caller: callerLabel(call),
            candidates: candidates.map(n => n.name),
            status: candidates.length > 0 ? "ambiguous" : "unresolved"
          });
        }
        continue;
      }

      // A plain call to a name that is a declared class in the local graph is
      // class usage (Python instantiation idiom `X(...)`; harmless in typed
      // languages where calling a class without `new` is invalid anyway).
      const classCtor = effectiveSyntax === "call" && call.receiver === "none"
        ? (byName.get(`${call.name}.constructor`) ?? [])
        : [];
      const asNew = classCtor.length === 1 ? classCtor : undefined;

      let candidates: GraphNode[] = [];
      let thisExact = false;
      let typed: { node: GraphNode; viaInterface: boolean } | undefined;
      if (effectiveSyntax === "new" || asNew) {
        candidates = asNew ?? (byName.get(`${call.name}.constructor`) ?? []);
      } else if (call.receiver === "this" && call.caller.includes(".")) {
        const type = call.caller.slice(0, call.caller.lastIndexOf("."));
        const exact = byName.get(`${type}.${call.name}`) ?? [];
        if (exact.length > 0) {
          candidates = exact;
          thisExact = true;
        } else {
          // Maybe inherited: walk the explicit extends/implements chain when
          // packs reported type declarations; otherwise fall back to same-named
          // members -> ambiguity site, never a guess.
          const inherited = memberOnType(type, call.name);
          if (inherited) {
            candidates = [inherited.node];
            thisExact = true;
            typed = inherited;
          } else {
            candidates = byShortName.get(call.name) ?? [];
          }
        }
      } else if (call.receiver === "super" && call.receiverType) {
        // super.x / super(...) with an explicit extends target.
        candidates =
          byName.get(`${call.receiverType}.${call.name}`) ?? byShortName.get(call.name) ?? [];
      } else if (call.receiver === "member" && call.receiverType) {
        // Receiver whose declared type the pack proved (local/param/field/var).
        const resolved = memberOnType(call.receiverType, call.name);
        if (resolved) {
          candidates = [resolved.node];
          typed = resolved;
        } else {
          candidates = byShortName.get(call.name) ?? [];
        }
      } else {
        candidates = byShortName.get(call.name) ?? [];
      }

      const toSite = (status: "ambiguous" | "unresolved"): void => {
        addSite({
          file: call.file,
          line: call.line,
          name: call.name,
          caller: callerLabel(call),
          candidates: candidates.map(n => n.name),
          status
        });
      };

      // Pack-provided receiver type (#151+): resolve `${receiverType}.${name}`
      // against the whole local graph. Exactly one target -> edge (toward the
      // interface port with heuristic status when the type is an interface);
      // otherwise -> ambiguity site with the same-named candidates. Never a
      // guessed edge.
      if (call.receiverType) {
        const receiverType = call.receiverType;
        const exact = byName.get(`${receiverType}.${call.name}`) ?? [];
        if (exact.length === 1 && callerNode) {
          const isInterface = interfaceNames.has(receiverType);
          const kind: GraphEdge["kind"] =
            effectiveSyntax === "new" ? "new" : effectiveSyntax === "super" ? "super" : "call";
          addEdge({
            from: callerNode.id,
            to: exact[0].id,
            line: call.line,
            kind,
            callType: isInterface
              ? "interface"
              : kind === "super"
                ? "super"
                : kind === "new"
                  ? "new"
                  : "direct",
            status: isInterface ? "heuristic" : "resolved",
            filePath: call.file
          });
        } else {
          const fallback = byShortName.get(call.name) ?? [];
          addSite({
            file: call.file,
            line: call.line,
            name: call.name,
            caller: callerLabel(call),
            candidates: fallback.map(n => n.name),
            status: fallback.length > 0 ? "ambiguous" : "unresolved"
          });
        }
        continue;
      }

      if (candidates.length === 1 && callerNode) {
        if (asNew || effectiveSyntax === "new") {
          addEdge({
            from: callerNode.id,
            to: candidates[0].id,
            line: call.line,
            kind: "new",
            callType: "new",
            status: "resolved",
            filePath: call.file
          });
        } else if (effectiveSyntax === "super") {
          addEdge({
            from: callerNode.id,
            to: candidates[0].id,
            line: call.line,
            kind: "super",
            callType: "super",
            // With an explicit extends target (pack-provided receiverType) the
            // super relation is provable; a bare name-matched super stays heuristic.
            status: call.receiverType ? "resolved" : "heuristic",
            filePath: call.file
          });
        } else if (typed) {
          // Typed receiver (or inherited this.x) proved by the pack: assert the
          // edge. Toward an interface the edge points at the port with a
          // heuristic status (#149 story 16) — never at the implementation.
          addEdge({
            from: callerNode.id,
            to: typed.node.id,
            line: call.line,
            kind: "call",
            callType: typed.viaInterface ? "interface" : "direct",
            status: typed.viaInterface ? "heuristic" : "resolved",
            filePath: call.file
          });
        } else if (call.receiver === "member" || (call.receiver === "this" && !thisExact)) {
          // Receiver type is unknown (or the member is not provably on the
          // enclosing type): never a guessed edge, always a "?" site.
          toSite(candidates.length > 0 ? "ambiguous" : "unresolved");
        } else {
          addEdge({
            from: callerNode.id,
            to: candidates[0].id,
            line: call.line,
            kind: "call",
            callType: "direct",
            status: "resolved",
            filePath: call.file
          });
        }
      } else {
        toSite(candidates.length > 1 ? "ambiguous" : "unresolved");
      }
    }
  }

  // Outgoing/incoming indexes (each edge appears exactly once in each).
  const outgoing: Record<string, GraphEdge[]> = {};
  const incoming: Record<string, GraphEdge[]> = {};
  for (const edge of edges) {
    (outgoing[edge.from] ??= []).push(edge);
    (incoming[edge.to] ??= []).push(edge);
  }

  return {
    language: graphLanguage,
    supported: true,
    status: "resolved",
    nodes,
    edges,
    sites,
    outgoing,
    incoming,
    unsupportedFiles,
    limits,
    truncated,
    analyzerVersion: ANALYZER_VERSION
  };
}

function pushTo<K>(map: Map<K, GraphNode[]>, key: K, node: GraphNode): void {
  const list = map.get(key);
  if (list) list.push(node);
  else map.set(key, [node]);
}

// Re-exported for tests and for hosts that serialize graphs.
export { estimateTokens };
