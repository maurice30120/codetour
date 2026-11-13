/**
 * Parsing Module for Targeted Context
 * 
 * This module provides multi-language parsing capabilities for extracting code symbols.
 * It supports TypeScript, Python, and other languages.
 * 
 * Part of Spec #92 - Targeted Context for Tour Generation
 * Ticket #114 - Spike: Tree-sitter vs repomap decision
 */

export {
  CodeSymbol,
  extractSymbols,
  extractSymbolsFromTypeScript,
  extractSymbolsFromPython,
  extractSymbolsFromJava,
  extractSymbolsFromFile,
  isLanguageSupported,
  getParserInfo,
  ParserInfo,
} from "./symbol-extractor";
