/**
 * codetour-relation-graph — public seam of the relation-graph module (#150,
 * spec #149, ADR 0034).
 *
 * Pure API: `buildRelationGraph(sources, language) -> RelationGraph` plus the
 * depth-1 BFS packet `selectDepth1`, and the language registry a pack plugs
 * into (`registerPack`). Grammars are prebuilt .wasm loaded in-process via
 * web-tree-sitter; no native runtime, no network call at runtime.
 *
 * `codetour-mcp` consumes only this module's public API and contains no
 * Tree-sitter code of its own.
 */

export { ANALYZER_VERSION } from "./version";
export { estimateTokens, TokenBudget } from "./tokens";
export {
  DEFAULT_LIMITS,
  type AmbiguitySite,
  type CallType,
  type EdgeKind,
  type GraphEdge,
  type GraphLimits,
  type GraphNode,
  type RelationGraph,
  type RelationPacket,
  type RelationStatus,
  type SourceFile,
  type TruncationFlags,
  type UnsupportedFile
} from "./types";
export {
  detectLanguageFromPath,
  extensionsForLanguage,
  grammarForLanguage,
  GRAMMAR_BY_LANGUAGE,
  lastSegment,
  normalizeLanguage,
  SUPPORTED_LANGUAGE_IDS,
  type SupportedLanguageId
} from "./languages";
export {
  configureWasmAssets,
  getConfiguredWasmDirectory,
  getParser,
  GRAMMAR_IDS,
  loadGrammar,
  resolveGrammarPath,
  type GrammarId,
  type WasmAssetOptions
} from "./grammars";
export { packQueryFor, GRAMMAR_SPECS, type GrammarSpec } from "./queries";
export {
  contentSha256,
  createExtractionCache,
  extractionCacheKey,
  type ExtractionCache
} from "./cache";
export type {
  LanguagePack,
  PackAnalysisInput,
  PackAnalysisResult,
  PackTypeInfo,
  RawCallSite,
  RawEdge,
  RawNode,
  CallSyntax,
  ReceiverKind
} from "./pack";
export { createJavaPack, simpleTypeName } from "./java-pack";
export {
  getPack,
  isLanguageSupported,
  listSupportedLanguages,
  registerBuiltinPacks,
  registerPack,
  resetLanguagePacks,
  unregisterPack
} from "./registry";
export { buildRelationGraph, type BuildOptions } from "./engine";
export { selectDepth1 } from "./bfs";
// Per-language packs of #151–#154. They are auto-registered as the registry
// defaults by registerBuiltinPacks() (called on first registry use), so
// buildRelationGraph uses them out of the box; registerPack still plugs a
// custom pack over a default, and resetLanguagePacks() restores the built-ins.
export {
  createTypeScriptPack,
  extractTypeScriptSymbols,
  registerTypeScriptPacks,
  type ExtractedSymbol,
  type ExtractSymbolsOptions,
  type TypeScriptPackLanguage
} from "./pack-typescript";
export { createCSharpPack, csharpPack } from "./packs/csharp";
export { createPythonPack, pythonPack } from "./packs/python";
