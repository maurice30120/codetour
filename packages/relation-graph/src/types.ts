/**
 * Graph contract of spec #149 / ticket #150 — identical to the validated
 * prototypes so measured token costs transfer to production:
 *
 *   node   = { id, name: "Type.member", filePath, startLine, endLine }
 *   edge   = { from, to, line, kind: "call" | "new" | "super",
 *              callType: "direct" | "interface" | "super" | "new" }
 *   site   = { file, line, name, caller, candidates[] }   // ambiguity "?"
 *   status = "resolved" | "heuristic" | "ambiguous" | "unresolved" | "unsupported"
 *
 * Lines are 1-based. A class is represented by its members plus a synthetic
 * "Type.constructor" node (class usage is an edge toward it); there is no bare
 * class node. Edges additionally carry `status` and `filePath` so every
 * asserted relation has file:line evidence and a status (spec #149 stories 4/7).
 */

export type RelationStatus =
  | "resolved"
  | "heuristic"
  | "ambiguous"
  | "unresolved"
  | "unsupported";

export type EdgeKind = "call" | "new" | "super";

export type CallType = "direct" | "interface" | "super" | "new";

export interface GraphNode {
  id: string;
  /** "Type.member", "Type.constructor", a bare function name, or the file path for file-scope relations. */
  name: string;
  filePath: string;
  /** 1-based. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
}

export interface GraphEdge {
  /** Node id of the caller. */
  from: string;
  /** Node id of the target. */
  to: string;
  /** 1-based line of the relation site. */
  line: number;
  kind: EdgeKind;
  callType: CallType;
  status: RelationStatus;
  /** File of the relation site (with `line`, the file:line evidence). */
  filePath: string;
}

export interface AmbiguitySite {
  file: string;
  /** 1-based line of the "?" pointer. */
  line: number;
  /** Called name that could not be attributed statically. */
  name: string;
  /** Name of the enclosing member ("Type.member"), or the file path for file scope. */
  caller: string;
  /** Candidate node names indexed on the local graph; empty when unresolved. */
  candidates: string[];
  status: "ambiguous" | "unresolved";
}

/** One input source: content is provided by the caller, the engine never reads the disk. */
export interface SourceFile {
  path: string;
  content: string;
  /** Optional per-file language override (normalized like the `language` argument). */
  language?: string;
}

export interface GraphLimits {
  maxNodes: number;
  maxEdges: number;
  maxTokens: number;
}

export const DEFAULT_LIMITS: GraphLimits = {
  maxNodes: 500,
  maxEdges: 2000,
  maxTokens: 8000
};

export interface TruncationFlags {
  nodes: boolean;
  edges: boolean;
  tokens: boolean;
}

export interface UnsupportedFile {
  path: string;
  language: string;
}

export interface RelationGraph {
  /** Normalized language of the build. */
  language: string;
  /** False when no pack exists for any input language: status is then "unsupported". */
  supported: boolean;
  /**
   * "unsupported" when no pack could analyze any source (never a silent empty
   * graph); "resolved" when the graph was built.
   */
  status: RelationStatus;
  nodes: GraphNode[];
  edges: GraphEdge[];
  sites: AmbiguitySite[];
  /** Outgoing index: node id -> edges leaving it (each edge appears exactly once). */
  outgoing: Record<string, GraphEdge[]>;
  /** Incoming index: node id -> edges entering it. */
  incoming: Record<string, GraphEdge[]>;
  /** Files skipped because their language has no registered pack. */
  unsupportedFiles: UnsupportedFile[];
  limits: GraphLimits;
  truncated: TruncationFlags;
  analyzerVersion: string;
}

/** Result of a depth-1 BFS around seed symbols (the relations packet of #149). */
export interface RelationPacket {
  /** Resolved seed node ids. */
  seeds: string[];
  depth: 1;
  status: RelationStatus;
  nodes: GraphNode[];
  edges: GraphEdge[];
  sites: AmbiguitySite[];
  outgoing: Record<string, GraphEdge[]>;
  incoming: Record<string, GraphEdge[]>;
  limits: GraphLimits;
  truncated: TruncationFlags;
}
