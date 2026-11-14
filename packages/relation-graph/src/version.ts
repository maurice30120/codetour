/**
 * Version of the extraction/analysis logic. Part of the extraction cache key:
 * bump whenever the engine or a pack's extraction behavior changes so stale
 * cache entries are never reused.
 */
export const ANALYZER_VERSION = "0.3.0"; // 0.3.0: tickets #151–#154 ship the TypeScript/TSX, C#, Java and Python packs as built-in registry defaults (extraction behavior changed for all supported languages)
