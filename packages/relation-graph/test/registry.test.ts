import test from "node:test";
import assert from "node:assert/strict";
import {
  detectLanguageFromPath,
  getPack,
  isLanguageSupported,
  listSupportedLanguages,
  normalizeLanguage,
  registerPack,
  resetLanguagePacks,
  ANALYZER_VERSION
} from "../src/index";

test("normalizeLanguage maps aliases to canonical language ids", () => {
  assert.equal(normalizeLanguage("typescript"), "typescript");
  assert.equal(normalizeLanguage("ts"), "typescript");
  assert.equal(normalizeLanguage("tsx"), "tsx");
  assert.equal(normalizeLanguage("TypeScript"), "typescript");
  assert.equal(normalizeLanguage("java"), "java");
  assert.equal(normalizeLanguage("python"), "python");
  assert.equal(normalizeLanguage("py"), "python");
  assert.equal(normalizeLanguage("c#"), "csharp");
  assert.equal(normalizeLanguage("C#"), "csharp");
  assert.equal(normalizeLanguage("csharp"), "csharp");
  assert.equal(normalizeLanguage("cs"), "csharp");
  assert.equal(normalizeLanguage("go"), undefined);
  assert.equal(normalizeLanguage(""), undefined);
});

test("detectLanguageFromPath maps file extensions to languages", () => {
  assert.equal(detectLanguageFromPath("src/app.ts"), "typescript");
  assert.equal(detectLanguageFromPath("src/app.mts"), "typescript");
  assert.equal(detectLanguageFromPath("src/view.tsx"), "tsx");
  assert.equal(detectLanguageFromPath("src/Main.java"), "java");
  assert.equal(detectLanguageFromPath("src/Program.cs"), "csharp");
  assert.equal(detectLanguageFromPath("src/mod.py"), "python");
  assert.equal(detectLanguageFromPath("README.md"), undefined);
  assert.equal(detectLanguageFromPath("noext"), undefined);
});

test("the registry ships the five grammars of #150 as supported languages", () => {
  const languages = listSupportedLanguages();
  for (const language of ["typescript", "tsx", "java", "csharp", "python"]) {
    assert.ok(languages.includes(language), `missing ${language}`);
    assert.ok(isLanguageSupported(language), `${language} should be supported`);
    assert.ok(getPack(language), `pack for ${language} should be registered`);
  }
  assert.ok(!isLanguageSupported("go"));
  assert.equal(getPack("go"), undefined);
});

test("a pack is a declarative implementation plugged into the registry (#151-#154 seam)", () => {
  const custom = {
    language: "typescript",
    grammarId: "typescript",
    extensions: [".ts"],
    analyze: () => ({ nodes: [], calls: [] })
  };
  registerPack(custom);
  assert.equal(getPack("typescript"), custom);
  resetLanguagePacks();
  assert.notEqual(getPack("typescript"), custom);
  assert.ok(getPack("typescript"), "default pack restored after reset");
});

test("ANALYZER_VERSION is a non-empty string used in cache keys", () => {
  assert.equal(typeof ANALYZER_VERSION, "string");
  assert.ok(ANALYZER_VERSION.length > 0);
});
