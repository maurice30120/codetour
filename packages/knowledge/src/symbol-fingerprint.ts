import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { KnowledgeSymbolProof, SymbolFingerprintOutcome, SymbolFingerprinter } from './knowledge';

// Type-only dependency: erased at build time, so this module never loads
// knowledge.ts at runtime and the tree-sitter runtime loads lazily on the
// first symbol proof (ADR 0046).
type WtsNode = {
  readonly type: string;
  readonly text: string;
  readonly childCount: number;
  child(index: number): WtsNode | null;
  childForFieldName(name: string): WtsNode | null;
  readonly parent: WtsNode | null;
  readonly startIndex: number;
};
type WtsTree = { rootNode: WtsNode };
type WtsLanguage = { readonly name?: string };
type WtsParser = { parse(input: string): WtsTree; setLanguage(language: WtsLanguage): void };
// web-tree-sitter 0.24 (CJS) exports the Parser class itself: static `init`,
// static `Language`, instances constructable only after init resolved.
type WtsParserClass = {
  new (): WtsParser;
  init(options?: { locateFile?: (file: string) => string }): Promise<void>;
  Language: { load(file: string): Promise<WtsLanguage> };
};

/**
 * Grammar WASM per cited file extension (the shipped `tree-sitter-wasms`
 * set, copied at build time through the dependency itself — deterministic
 * and offline). An extension outside the table is an unsupported language.
 * Symbol resolution and canonical spans are currently implemented for the
 * ECMAScript family; other entries stay fail-closed until their table exists.
 */
const GRAMMAR_WASM: Record<string, string> = {
  '.ts': 'tree-sitter-typescript.wasm',
  '.mts': 'tree-sitter-typescript.wasm',
  '.cts': 'tree-sitter-typescript.wasm',
  '.tsx': 'tree-sitter-tsx.wasm',
  '.js': 'tree-sitter-javascript.wasm',
  '.mjs': 'tree-sitter-javascript.wasm',
  '.cjs': 'tree-sitter-javascript.wasm',
  '.jsx': 'tree-sitter-javascript.wasm',
};

/** Node types whose declarator name identifies a citable symbol. */
const SYMBOL_NODE_TYPES = new Set([
  'class_declaration',
  'function_declaration',
  'generator_function_declaration',
  'method_definition',
  'variable_declarator',
]);

const extensionOf = (file: string): string | undefined => {
  const dot = file.lastIndexOf('.');
  return dot === -1 ? undefined : file.slice(dot).toLowerCase();
};

let runtime: Promise<WtsParserClass> | undefined;
const loadRuntime = (): Promise<WtsParserClass> => (runtime ??= (async () => {
  try {
    const Parser = require(vendorPath('tree-sitter.js')) as WtsParserClass;
    await Parser.init({ locateFile: (file) => vendorPath(basename(file)) });
    return Parser;
  } catch (error) {
    runtime = undefined;
    throw error;
  }
})());

// Vendored runtime and grammars travel inside the package itself (dist/vendor
// is copied with dist/src everywhere the package is staged or packed), so
// resolution never depends on a hoisted or nested node_modules layout.
const vendorPath = (name: string): string => join(__dirname, '..', 'vendor', name);

const languages = new Map<string, Promise<WtsLanguage>>();
const loadLanguage = (wasm: string): Promise<WtsLanguage> => {
  const cached = languages.get(wasm);
  if (cached) return cached;
  const loaded = (async () => {
    const Parser = await loadRuntime();
    return Parser.Language.load(vendorPath(join('grammars', wasm)));
  })();
  languages.set(wasm, loaded);
  loaded.catch(() => languages.delete(wasm));
  return loaded;
};

const declarationNames = (node: WtsNode): string[] => {
  const own = node.childForFieldName('name')?.text.replace(/^['"`]|['"`]$/g, '') ?? '';
  const chain: string[] = [];
  for (let up = node.parent; up !== null; up = up.parent) {
    if (SYMBOL_NODE_TYPES.has(up.type)) {
      const name = up.childForFieldName('name')?.text.replace(/^['"`]|['"`]$/g, '');
      if (name) chain.unshift(name);
    }
  }
  return own ? (chain.length > 0 ? [...chain, own] : [own]) : chain;
};

const hashText = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Canonical span text: every leaf token of the symbol's span except comment
 * nodes, joined by a single space. Identifiers, keywords, operators, control
 * flow and string contents survive; indentation, line breaks, formatting and
 * comments vanish — exactly the spec #233 contract. Deterministic for a given
 * grammar across grammar-independent sources (ADR 0046).
 */
const canonicalSpanText = (node: WtsNode): string => {
  const tokens: string[] = [];
  (function emit(current: WtsNode): void {
    if (current.type === 'comment') return;
    if (current.childCount === 0) { tokens.push(current.text); return; }
    for (let i = 0; i < current.childCount; i++) emit(current.child(i) as WtsNode);
  })(node);
  return tokens.join(' ');
};

const parseFile = async (realFile: string, wasm: string): Promise<WtsTree> => {
  const [language, Parser] = await Promise.all([loadLanguage(wasm), loadRuntime()]);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser.parse(await readFile(realFile, 'utf8'));
};

/**
 * The grammar-backed symbol fingerprinter (spec #233): resolve the qualified
 * name uniquely inside the cited file, hash its canonical span, and refuse
 * ambiguities, absences and unsupported languages without ever inventing a
 * fingerprint. Multiple matches are ambiguous even when byte-equal: the
 * declaration of the cited symbol must be unique to stay resolvable.
 */
export const treeSitterSymbolFingerprinter: SymbolFingerprinter = async (
  _realRoot: string,
  realFile: string,
  proof: KnowledgeSymbolProof,
): Promise<SymbolFingerprintOutcome> => {
  const wasm = GRAMMAR_WASM[extensionOf(realFile) ?? ''];
  if (!wasm) return { status: 'refused', reason: 'unsupported_language' };
  let tree: WtsTree;
  try {
    tree = await parseFile(realFile, wasm);
  } catch {
    // refuser le langage sans diagnostiquer: rien ne fuit, fail-closed
    return { status: 'refused', reason: 'unsupported_language' };
  }
  const wanted = proof.symbol.split('.');
  const candidates: WtsNode[] = [];
  (function walk(node: WtsNode): void {
    if (SYMBOL_NODE_TYPES.has(node.type)) {
      const chain = declarationNames(node);
      if (chain.length === wanted.length && chain.every((name, index) => name === wanted[index])) {
        candidates.push(node);
      }
    }
    if (candidates.length > 1) return; // bounded walk: stop at the first ambiguity proof
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  })(tree.rootNode);
  if (candidates.length === 0) return { status: 'refused', reason: 'symbol_unresolved' };
  if (candidates.length > 1) return { status: 'refused', reason: 'symbol_ambiguous' };
  candidates.sort((a, b) => a.startIndex - b.startIndex);
  return { status: 'ok', sha256: hashText(canonicalSpanText(candidates[0])) };
};

/** Canonicalization marker stored once per catalogue; "span@1" is the stripped-span contract of ADR 0046. */
export const knowledgeCanonicalizer = 'span@1';
