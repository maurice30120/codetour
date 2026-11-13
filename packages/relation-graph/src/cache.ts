import { createHash } from "node:crypto";
import type { PackAnalysisResult } from "./pack";
import { normalizeLanguage } from "./languages";
import { ANALYZER_VERSION } from "./version";

/** SHA-256 of a source content (hex). */
export function contentSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Extraction cache key: (file path, content SHA, language, analyzer version).
 * A content change, language change or analyzer upgrade invalidates the entry.
 */
export function extractionCacheKey(
  file: { path: string; content: string },
  language: string,
  analyzerVersion: string = ANALYZER_VERSION
): string {
  const normalized = normalizeLanguage(language) ?? language.trim().toLowerCase();
  return [file.path, contentSha256(file.content), normalized, analyzerVersion].join(":");
}

export interface ExtractionCache {
  get(key: string): PackAnalysisResult | undefined;
  set(key: string, value: PackAnalysisResult): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  readonly size: number;
}

/**
 * In-memory extraction cache with a maxEntries bound (oldest entries evicted
 * first). The engine accepts any ExtractionCache, so hosts can plug a
 * persistent one later.
 */
export function createExtractionCache(options?: { maxEntries?: number }): ExtractionCache {
  const maxEntries = Math.max(1, options?.maxEntries ?? 256);
  const map = new Map<string, PackAnalysisResult>();
  return {
    get(key) {
      const value = map.get(key);
      if (value !== undefined) {
        // Refresh recency.
        map.delete(key);
        map.set(key, value);
      }
      return value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      while (map.size > maxEntries) {
        const oldest = map.keys().next();
        if (oldest.done) break;
        map.delete(oldest.value);
      }
    },
    has(key) {
      return map.has(key);
    },
    delete(key) {
      return map.delete(key);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    }
  };
}
