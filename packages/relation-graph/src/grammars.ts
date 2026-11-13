import * as path from "node:path";
import { createRequire } from "node:module";
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

// Resolved through createRequire so bundlers (webpack VSIX/standalone) do not
// try to inline the .wasm files: in a bundle the asset directory configured
// via configureWasmAssets is used instead, and this branch only runs on the
// plain-node npm channel where tree-sitter-wasms sits in node_modules.
const nodeRequire = createRequire(__filename);

/** Resolve the on-disk path of a prebuilt grammar .wasm. */
export function resolveGrammarPath(grammarId: string, wasmDirectory?: string): string {
  const file = (WASM_FILE as Record<string, string>)[grammarId];
  if (!file) throw new Error(`unknown grammar id: ${grammarId}`);
  const directory = wasmDirectory ?? defaultWasmDirectory;
  if (directory) return path.join(directory, file);
  // tree-sitter-wasms has no "exports" map: the subpath resolves directly.
  return nodeRequire.resolve(`tree-sitter-wasms/out/${file}`);
}

export interface WasmAssetOptions {
  /**
   * Directory holding the prebuilt grammar .wasm files plus the
   * web-tree-sitter runtime `tree-sitter.wasm`, shipped as assets next to a
   * bundled server (VSIX/standalone). Undefined keeps the node_modules
   * resolution of the npm channel.
   */
  wasmDirectory?: string;
}

let defaultWasmDirectory: string | undefined;
let parserInitOptions: { locateFile: (fileName: string, scriptDirectory: string) => string } | undefined;
let parserReady = false;
let parserPromise: Promise<Parser> | null = null;

/**
 * Point the module at a staged .wasm asset directory: both `Parser.init`'s
 * `locateFile` (the runtime wasm) and `resolveGrammarPath` (the grammars).
 * Must be called before the first parse — the runtime wasm location is baked
 * into the Emscripten module at `Parser.init`, so the first configuration
 * wins; later calls are no-ops once the parser is initialized.
 */
export function configureWasmAssets(options: WasmAssetOptions = {}): void {
  if (parserReady) return;
  defaultWasmDirectory = options.wasmDirectory;
  const directory = options.wasmDirectory;
  parserInitOptions = directory
    ? { locateFile: fileName => path.join(directory, fileName) }
    : undefined;
  parserPromise = null;
  languageCache.clear();
}

/** The configured default asset directory, if any. */
export function getConfiguredWasmDirectory(): string | undefined {
  return defaultWasmDirectory;
}

/** The shared Parser, initialized exactly once (loads the web-tree-sitter runtime wasm). */
export function getParser(): Promise<Parser> {
  if (!parserPromise) {
    parserPromise = Parser.init(parserInitOptions).then(() => {
      parserReady = true;
      return new Parser();
    });
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
