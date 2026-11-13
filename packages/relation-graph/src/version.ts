/**
 * Version of the extraction/analysis logic. Part of the extraction cache key:
 * bump whenever the engine or a pack's extraction behavior changes so stale
 * cache entries are never reused.
 */
export const ANALYZER_VERSION = "0.2.0"; // 0.2.0: ticket #154 ships the Python pack (python extraction behavior changed)
