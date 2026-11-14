/**
 * Language registry vocabulary of #150: the five grammars shipped as prebuilt
 * .wasm by tree-sitter-wasms, with alias normalization and extension mapping.
 * Any other language is "unsupported" — never a silently empty graph.
 */

/** Canonical language ids with a registered pack in this module. */
export const SUPPORTED_LANGUAGE_IDS = [
  "typescript",
  "tsx",
  "java",
  "csharp",
  "python"
] as const;

export type SupportedLanguageId = (typeof SUPPORTED_LANGUAGE_IDS)[number];

/** wasm grammar id (tree-sitter-wasms/out/tree-sitter-<id>.wasm) per language. */
export const GRAMMAR_BY_LANGUAGE: Record<SupportedLanguageId, string> = {
  typescript: "typescript",
  tsx: "tsx",
  java: "java",
  csharp: "c_sharp",
  python: "python"
};

const LANGUAGE_ALIASES: Record<string, SupportedLanguageId> = {
  typescript: "typescript",
  ts: "typescript",
  tsx: "tsx",
  typescriptreact: "tsx",
  java: "java",
  python: "python",
  py: "python",
  csharp: "csharp",
  "c#": "csharp",
  cs: "csharp",
  c_sharp: "csharp"
};

const EXTENSION_BY_LANGUAGE: Record<SupportedLanguageId, readonly string[]> = {
  typescript: [".ts", ".mts", ".cts"],
  tsx: [".tsx"],
  java: [".java"],
  csharp: [".cs"],
  python: [".py", ".pyi"]
};

/** Normalize a language name/alias ("C#", "ts", "py"…) to a canonical id, or undefined. */
export function normalizeLanguage(language: string): SupportedLanguageId | undefined {
  return LANGUAGE_ALIASES[language.trim().toLowerCase()];
}

/** Detect the language of a file path from its extension, or undefined. */
export function detectLanguageFromPath(filePath: string): SupportedLanguageId | undefined {
  const lower = filePath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return undefined;
  const ext = lower.slice(dot);
  for (const language of SUPPORTED_LANGUAGE_IDS) {
    if (EXTENSION_BY_LANGUAGE[language].includes(ext)) return language;
  }
  return undefined;
}

/** wasm grammar id for a canonical language id, or undefined. */
export function grammarForLanguage(language: string): string | undefined {
  const id = normalizeLanguage(language);
  return id ? GRAMMAR_BY_LANGUAGE[id] : undefined;
}

export function extensionsForLanguage(language: string): readonly string[] {
  const id = normalizeLanguage(language);
  return id ? EXTENSION_BY_LANGUAGE[id] : [];
}

/**
 * Last dot-segment of a possibly qualified name ("A.B.c" -> "c"), with
 * generic arguments stripped ("Repo<T>" -> "Repo") and trimmed — the shared
 * short-name helper of the packs and the engine.
 */
export function lastSegment(text: string): string {
  const base = text.split(".").pop() ?? text;
  return base.replace(/<[^>]*>/g, "").trim();
}
