import * as path from "node:path";
import { Language, Parser } from "web-tree-sitter";

/**
 * In-process grammar loading (ADR 0034): prebuilt .wasm grammars from the
 * `tree-sitter-wasms` distribution, loaded through `web-tree-sitter` in the
 * Node process. No JVM/.NET/Python runtime, no native module, no network call.
 *
 * ABI note (measured): tree-sitter-wasms@0.1.13 grammars are ABI 13–14 and
 * only load with web-tree-sitter 0.25.x — hence the ~0.25.10 pin. 0.26/0.27
 * reject them.
 */

export const GRAMMAR_IDS = ["c_sharp", "java", "typescript", "tsx", "python"] as const;

export type GrammarId = (typeof GRAMMAR_IDS)[number];

const WASM_FILE: Record<GrammarId, string> = {
  c_sharp: "tree-sitter-c_sharp.wasm",
  java: "tree-sitter-java.wasm",
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  python: "tree-sitter-python.wasm"
};

/** Resolve the on-disk path of a prebuilt grammar .wasm. */
export function resolveGrammarPath(grammarId: string, wasmDirectory?: string): string {
  const file = (WASM_FILE as Record<string, string>)[grammarId];
  if (!file) throw new Error(`unknown grammar id: ${grammarId}`);
  if (wasmDirectory) return path.join(wasmDirectory, file);
  // tree-sitter-wasms has no "exports" map: the subpath resolves directly.
  return require.resolve(`tree-sitter-wasms/out/${file}`);
}

let parserPromise: Promise<Parser> | null = null;

/** The shared Parser, initialized exactly once (loads the web-tree-sitter runtime wasm). */
export function getParser(): Promise<Parser> {
  if (!parserPromise) {
    parserPromise = Parser.init().then(() => new Parser());
  }
  return parserPromise;
}

const languageCache = new Map<string, Promise<Language>>();

/** Load (and cache) a prebuilt grammar. */
export function loadGrammar(grammarId: string, wasmDirectory?: string): Promise<Language> {
  const key = wasmDirectory ? `${wasmDirectory}/${grammarId}` : grammarId;
  let pending = languageCache.get(key);
  if (!pending) {
    pending = getParser().then(() => Language.load(resolveGrammarPath(grammarId, wasmDirectory)));
    languageCache.set(key, pending);
  }
  return pending;
}
