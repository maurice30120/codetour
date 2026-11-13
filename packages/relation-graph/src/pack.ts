import type { Parser, Query, Tree } from "web-tree-sitter";
import type {
  AmbiguitySite,
  CallType,
  EdgeKind,
  RelationStatus,
  SourceFile
} from "./types";

/**
 * The pack seam of #150: a language pack is a declarative implementation
 * plugged into the registry (`registerPack`). Tickets #151–#154 ship the real
 * per-language packs (TypeScript, C#, Java, Python) through this interface.
 *
 * A pack analyzes ONE file and returns raw, unresolved facts:
 *  - `nodes`: declarations (members "Type.member", "Type.constructor", …)
 *  - `calls`: raw call sites the ENGINE resolves against the whole local graph
 *    (edges only when provable, ambiguity sites otherwise — never guessed)
 *  - optionally pre-resolved `edges`/`sites` (e.g. interface relations with
 *    heuristic status); edge endpoints are node NAMES, mapped to ids by the engine.
 */

export type CallSyntax = "call" | "new" | "super";

export type ReceiverKind = "none" | "this" | "super" | "member";

export interface RawNode {
  name: string;
  filePath: string;
  /** 1-based. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
}

export interface RawCallSite {
  file: string;
  /** 1-based line of the call site. */
  line: number;
  /** Called name (short, unqualified). */
  name: string;
  syntax: CallSyntax;
  receiver: ReceiverKind;
  /** Full name of the enclosing member ("Type.member"), "" for file scope. */
  caller: string;
}

export interface RawEdge {
  /** Node NAME of the caller. */
  from: string;
  /** Node NAME of the target. */
  to: string;
  line: number;
  kind: EdgeKind;
  callType: CallType;
  status: RelationStatus;
  filePath: string;
}

export interface PackAnalysisResult {
  nodes: RawNode[];
  calls: RawCallSite[];
  edges?: RawEdge[];
  sites?: AmbiguitySite[];
}

export interface PackAnalysisInput {
  file: SourceFile;
  /** Canonical language id (e.g. "typescript"). */
  language: string;
  /** wasm grammar id backing this pack (e.g. "typescript", "c_sharp"). */
  grammarId: string;
  parser: Parser;
  tree: Tree;
  createQuery: (source: string) => Query;
}

export interface LanguagePack {
  /** Canonical language id this pack handles. */
  readonly language: string;
  /** wasm grammar id from tree-sitter-wasms. */
  readonly grammarId: string;
  readonly extensions: readonly string[];
  analyze(input: PackAnalysisInput): PackAnalysisResult | Promise<PackAnalysisResult>;
}
