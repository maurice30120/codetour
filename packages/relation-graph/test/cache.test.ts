import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYZER_VERSION,
  buildRelationGraph,
  createExtractionCache,
  extractionCacheKey,
  registerPack,
  resetLanguagePacks
} from "../src/index";
import { TS_FIXTURES } from "./helpers/fixtures";

test("extractionCacheKey is keyed by (file, content SHA, language, analyzer version)", () => {
  const file = { path: "a.ts", content: "function a(): void {}\n" };
  const key = extractionCacheKey(file, "typescript");
  assert.equal(key, extractionCacheKey({ ...file }, "typescript"));
  assert.ok(key.includes("a.ts"));
  assert.ok(key.includes("typescript"));
  assert.ok(key.includes(ANALYZER_VERSION));
  // content SHA: different content -> different key
  assert.notEqual(key, extractionCacheKey({ path: "a.ts", content: "function b(): void {}\n" }, "typescript"));
  // language: different language -> different key
  assert.notEqual(key, extractionCacheKey(file, "python"));
  // analyzer version
  assert.notEqual(key, extractionCacheKey(file, "typescript", "0.0.0-other"));
  // path
  assert.notEqual(key, extractionCacheKey({ path: "b.ts", content: file.content }, "typescript"));
});

test("ExtractionCache stores, evicts beyond maxEntries, and clears", () => {
  const cache = createExtractionCache({ maxEntries: 2 });
  const k1 = extractionCacheKey({ path: "1.ts", content: "x" }, "typescript");
  const k2 = extractionCacheKey({ path: "2.ts", content: "x" }, "typescript");
  const k3 = extractionCacheKey({ path: "3.ts", content: "x" }, "typescript");
  cache.set(k1, { nodes: [], calls: [] });
  cache.set(k2, { nodes: [], calls: [] });
  assert.equal(cache.size, 2);
  assert.deepEqual(cache.get(k1), { nodes: [], calls: [] });
  cache.set(k3, { nodes: [], calls: [] });
  assert.equal(cache.size, 2, "oldest entry evicted");
  // get(k1) refreshed k1, so k2 is the least-recently-used and gets evicted.
  assert.equal(cache.get(k2), undefined);
  assert.ok(cache.get(k1));
  cache.clear();
  assert.equal(cache.size, 0);
});

test("the engine caches per-file extraction: a second identical build does not re-analyze", async () => {
  let analyzeCalls = 0;
  registerPack({
    language: "typescript",
    grammarId: "typescript",
    extensions: [".ts"],
    analyze: () => {
      analyzeCalls += 1;
      return { nodes: [], calls: [] };
    }
  });
  try {
    const cache = createExtractionCache();
    const first = await buildRelationGraph(TS_FIXTURES, "typescript", { cache });
    const afterFirst = analyzeCalls;
    assert.equal(afterFirst, TS_FIXTURES.length, "one analyze call per file on cold cache");
    const second = await buildRelationGraph(TS_FIXTURES, "typescript", { cache });
    assert.equal(analyzeCalls, afterFirst, "warm cache must not re-analyze");
    assert.deepEqual(second.nodes, first.nodes);
    assert.equal(cache.size, TS_FIXTURES.length);
    // Changed content invalidates the entry (content SHA is part of the key).
    await buildRelationGraph(
      [{ path: TS_FIXTURES[0].path, content: TS_FIXTURES[0].content + "\n// touched\n" }],
      "typescript",
      { cache }
    );
    assert.equal(analyzeCalls, afterFirst + 1, "changed content re-analyzes");
  } finally {
    resetLanguagePacks();
  }
});
