/**
 * Type definitions for the 10 workspace primitives (from ticket 01)
 * Used by TypeScript validation in ticket 04
 */

// ============================================================================
// Source Location Types
// ============================================================================

interface SourceLocation {
  file: string;
  line: number;
}

interface LineResult {
  line: number;
  text: string;
}

// ============================================================================
// Primitive Type Definitions
// ============================================================================

/**
 * listFiles - List all files in the workspace
 * @param maxFiles - Maximum number of files to return (default: 500)
 * @returns Array of file paths
 */
declare function listFiles(maxFiles?: number): string[];

/**
 * Alias for listFiles
 */
declare function list(maxFiles?: number): string[];

/**
 * searchText - Search for text in workspace files
 * @param query - Text to search for
 * @returns Array of search results with file, line, and text
 */
declare function searchText(query: string): Array<SourceLocation & { text: string }>;

/**
 * Alias for searchText
 */
declare function search(query: string): Array<SourceLocation & { text: string }>;

/**
 * searchIdentifiers - Search for exact identifier matches
 * @param identifier - Identifier to search for
 * @returns Array of search results
 */
declare function searchIdentifiers(identifier: string): Array<SourceLocation & { text: string }>;

/**
 * readLines - Read specific lines from a file
 * @param file - File path
 * @param startLine - Starting line number (1-indexed)
 * @param endLine - Ending line number (1-indexed)
 * @returns Array of line results
 */
declare function readLines(file: string, startLine: number, endLine: number): Array<LineResult>;

/**
 * Alias for readLines
 */
declare function read(file: string, startLine: number, endLine: number): Array<LineResult>;

/**
 * readAround - Read context around a specific line
 * @param file - File path
 * @param line - Center line number (1-indexed)
 * @param contextLines - Number of context lines before and after (default: 5, max: 20)
 * @returns Array of line results
 */
declare function readAround(file: string, line: number, contextLines?: number): Array<LineResult>;

/**
 * listSymbols - List symbols in the workspace
 * @returns Array of symbol information
 */
declare function listSymbols(): Array<SourceLocation & { name: string; kind: string }>;

/**
 * findDefinitions - Find definitions of a symbol
 * @param symbol - Symbol name to search for
 * @returns Array of definition information
 */
declare function findDefinitions(symbol: string): Array<SourceLocation & { text: string; kind: string }>;

/**
 * findReferences - Find references to a symbol
 * @param symbol - Symbol name to search for
 * @returns Array of reference information
 */
declare function findReferences(symbol: string): Array<SourceLocation & { text: string; kind?: string }>;

/**
 * getImports - Get imports from a file
 * @param filePath - File path to analyze
 * @returns Array of import information
 */
declare function getImports(filePath: string): Array<SourceLocation & { text: string }>;

/**
 * getGitDiff - Get git diff between revisions
 * @param revision1 - First revision (commit, branch, tag)
 * @param revision2 - Second revision (default: HEAD)
 * @returns Diff text
 */
declare function getGitDiff(revision1: string, revision2?: string): string;

/**
 * git - Get current git information
 * @param timeout - Timeout in milliseconds
 * @returns Git information string
 */
declare function git(timeout?: number): string;

// ============================================================================
// Parameter Types for TypeScript Functions
// ============================================================================

interface SearchParams {
  query: string;
}

interface ReadParams {
  file: string;
  startLine?: number;
  endLine?: number;
}

interface ReadAroundParams {
  file: string;
  line: number;
  contextLines?: number;
}

interface SymbolParams {
  symbol: string;
}

interface FilePathParams {
  filePath: string;
}

interface GitDiffParams {
  revision1: string;
  revision2?: string;
}

// ============================================================================
// Exported Types
// ============================================================================

type PrimitiveFunction = 
  | typeof listFiles
  | typeof list
  | typeof searchText
  | typeof search
  | typeof searchIdentifiers
  | typeof readLines
  | typeof read
  | typeof readAround
  | typeof listSymbols
  | typeof findDefinitions
  | typeof findReferences
  | typeof getImports
  | typeof getGitDiff
  | typeof git;

export {
  SourceLocation,
  LineResult,
  SearchParams,
  ReadParams,
  ReadAroundParams,
  SymbolParams,
  FilePathParams,
  GitDiffParams,
  PrimitiveFunction
};
