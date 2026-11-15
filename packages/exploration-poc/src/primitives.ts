/**
 * TypeScript-typed interfaces for the 10 workspace primitives.
 * 
 * All primitives are:
 * - Safe: path checking, size limits, input validation
 * - Tested: comprehensive test coverage
 * - Bounded: pagination limits, result caps
 * - Paginated: support for offset/limit where applicable
 * - Sourced: all results include file, line numbers, and revision info where applicable
 */

// ============================================================================
// Common Types
// ============================================================================

/** Source location information attached to all primitive results */
export interface SourceLocation {
  file: string;
  line: number;
}

/** Paginated result wrapper */
export interface PaginatedResult<T> {
  items: T[];
  offset: number;
  limit: number;
  hasMore: boolean;
  total?: number;
}

/** Search match result with source information */
export interface SearchMatch extends SourceLocation {
  text: string;
  revision?: string; // Git revision if available
}

/** Symbol information */
export interface SymbolInfo extends SourceLocation {
  name: string;
  kind: SymbolKind;
  revision?: string;
}

/** Definition information */
export interface DefinitionInfo extends SourceLocation {
  text: string;
  kind: SymbolKind;
  revision?: string;
}

/** Reference information */
export interface ReferenceInfo extends SourceLocation {
  text: string;
  kind?: SymbolKind;
  revision?: string;
}

/** Import information */
export interface ImportInfo extends SourceLocation {
  text: string;
  path?: string; // Extracted import path
  revision?: string;
}

/** File information */
export interface FileInfo {
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size?: number;
  mtime?: number;
}

/** Git diff line change */
export interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'unchanged';
  lineNumber?: number;
  oldLineNumber?: number;
  content: string;
}

/** Git diff hunks */
export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

/** Git diff result */
export interface GitDiff {
  file: string;
  hunks: DiffHunk[];
  oldRevision: string;
  newRevision: string;
}

/** Symbol kinds */
export type SymbolKind = 
  | 'function'
  | 'class'
  | 'variable'
  | 'constant'
  | 'interface'
  | 'type'
  | 'enum'
  | 'namespace'
  | 'export'
  | 'import'
  | 'method'
  | 'property'
  | 'parameter'
  | 'constructor';

// ============================================================================
// Primitive Interfaces
// ============================================================================

/**
 * listFiles - List files in the workspace
 * 
 * Safety: Path validation, excludes .git and node_modules
 * Bounded: maxFiles limit (default 500)
 * Paginated: Not applicable (returns all matching files)
 * Sourced: file paths only
 */
export interface ListFilesOptions {
  /** Maximum number of files to return (default: 500) */
  maxFiles?: number;
  /** Filter by file extension */
  extension?: string;
  /** Filter by directory prefix */
  prefix?: string;
  /** Include directories (default: false) */
  includeDirectories?: boolean;
}

export interface ListFilesResult {
  files: string[];
  /** True if the file limit was reached */
  truncated: boolean;
}

/**
 * searchText - Search for text in files (ripgrep-like)
 * 
 * Safety: Query validation, path checking
 * Bounded: maxResults limit (default 50)
 * Paginated: offset and limit support
 * Sourced: file, line, text, revision
 */
export interface SearchTextOptions {
  /** Maximum number of results (default: 50) */
  limit?: number;
  /** Starting offset (default: 0) */
  offset?: number;
  /** File path prefix to search within */
  pathPrefix?: string;
  /** Case sensitive search (default: true) */
  caseSensitive?: boolean;
  /** Use regex (default: false) */
  regex?: boolean;
}

export interface SearchTextResult extends PaginatedResult<SearchMatch> {
  /** Query used for the search */
  query: string;
  /** True if file scan limit was reached */
  fileScanLimitReached?: boolean;
}

/**
 * searchIdentifiers - Search for exact identifier matches
 * 
 * Safety: Identifier validation, path checking
 * Bounded: maxResults limit (default 50)
 * Paginated: offset and limit support
 * Sourced: file, line, text, revision
 */
export interface SearchIdentifiersOptions {
  /** Maximum number of results (default: 50) */
  limit?: number;
  /** Starting offset (default: 0) */
  offset?: number;
  /** File path prefix to search within */
  pathPrefix?: string;
}

export interface SearchIdentifiersResult extends PaginatedResult<SearchMatch> {
  /** Identifier being searched */
  identifier: string;
  /** True if file scan limit was reached */
  fileScanLimitReached?: boolean;
}

/**
 * readLines - Read specific lines from a file
 * 
 * Safety: Path validation, file size limit, line range validation
 * Bounded: max 100 lines per request
 * Paginated: Use startLine/endLine to page through file
 * Sourced: file, line numbers, text
 */
export interface ReadLinesOptions {
  /** Starting line number (1-indexed, default: 1) */
  startLine?: number;
  /** Ending line number (1-indexed, default: startLine + 99) */
  endLine?: number;
  /** Force fresh read from disk (default: false, uses cache) */
  fresh?: boolean;
}

export interface LineResult {
  line: number;
  text: string;
}

export interface ReadLinesResult {
  file: string;
  startLine: number;
  endLine: number;
  lines: LineResult[];
  /** Total lines in file (if known) */
  totalLines?: number;
  /** File revision if available */
  revision?: string;
}

/**
 * readAround - Read context around a specific line
 * 
 * Safety: Path validation, line number validation, context bounds
 * Bounded: max 20 context lines each direction (configurable)
 * Paginated: Not applicable (single request)
 * Sourced: file, line numbers, text
 */
export interface ReadAroundOptions {
  /** Line number to center on (1-indexed) */
  line: number;
  /** Number of context lines before and after (default: 5, max: 20) */
  contextLines?: number;
}

export interface ReadAroundResult {
  file: string;
  centerLine: number;
  startLine: number;
  endLine: number;
  lines: LineResult[];
  revision?: string;
}

/**
 * listSymbols - List symbols in the workspace
 * 
 * Safety: Path validation, file size limits
 * Bounded: max 100 symbols (configurable)
 * Paginated: offset and limit support
 * Sourced: file, line, name, kind, revision
 */
export interface ListSymbolsOptions {
  /** Maximum number of symbols (default: 100) */
  limit?: number;
  /** Starting offset (default: 0) */
  offset?: number;
  /** File path prefix to search within */
  pathPrefix?: string;
  /** Filter by symbol kind */
  kind?: SymbolKind;
  /** Language for parsing (for Tree-sitter) */
  language?: string;
}

export interface ListSymbolsResult extends PaginatedResult<SymbolInfo> {
  /** True if file scan limit was reached */
  fileScanLimitReached?: boolean;
}

/**
 * findDefinitions - Find definitions of a symbol
 * 
 * Safety: Symbol validation, path checking
 * Bounded: max 20 results (configurable)
 * Paginated: offset and limit support
 * Sourced: file, line, text, kind, revision
 */
export interface FindDefinitionsOptions {
  /** Maximum number of definitions (default: 20) */
  limit?: number;
  /** Starting offset (default: 0) */
  offset?: number;
  /** File path prefix to search within */
  pathPrefix?: string;
}

export interface FindDefinitionsResult extends PaginatedResult<DefinitionInfo> {
  /** Symbol being searched */
  symbol: string;
  /** True if file scan limit was reached */
  fileScanLimitReached?: boolean;
}

/**
 * findReferences - Find references to a symbol
 * 
 * Safety: Symbol validation, path checking
 * Bounded: max 50 results (configurable)
 * Paginated: offset and limit support
 * Sourced: file, line, text, kind, revision
 */
export interface FindReferencesOptions {
  /** Maximum number of references (default: 50) */
  limit?: number;
  /** Starting offset (default: 0) */
  offset?: number;
  /** File path prefix to search within */
  pathPrefix?: string;
  /** Include declaration in references (default: false) */
  includeDeclaration?: boolean;
}

export interface FindReferencesResult extends PaginatedResult<ReferenceInfo> {
  /** Symbol being searched */
  symbol: string;
  /** True if file scan limit was reached */
  fileScanLimitReached?: boolean;
}

/**
 * getImports - Get imports from a file
 * 
 * Safety: Path validation, file size limit
 * Bounded: Not paginated (all imports from file)
 * Paginated: Not applicable
 * Sourced: file, line, text, path
 */
export interface GetImportsOptions {
  /** File path to analyze */
  filePath: string;
}

export interface GetImportsResult {
  file: string;
  imports: ImportInfo[];
  revision?: string;
}

/**
 * getGitDiff - Get git diff between revisions
 * 
 * Safety: Revision validation, path checking
 * Bounded: Output size limit
 * Paginated: Not applicable (single diff)
 * Sourced: file, old/new line numbers, content, revisions
 */
export interface GetGitDiffOptions {
  /** First revision (commit, branch, tag) */
  revision1: string;
  /** Second revision (default: HEAD) */
  revision2?: string;
  /** File path to diff (optional, diffs entire repo if not provided) */
  filePath?: string;
  /** Show diff in unified format (default: true) */
  unified?: boolean;
}

export interface GetGitDiffResult {
  /** Old revision */
  oldRevision: string;
  /** New revision */
  newRevision: string;
  /** Files with changes */
  files: GitDiff[];
  /** Raw diff text (if requested) */
  rawDiff?: string;
}

/**
 * stat - Get file status/information
 * 
 * Safety: Path validation
 * Bounded: Not paginated
 * Paginated: Not applicable
 * Sourced: file path, size, modified time
 */
export interface StatOptions {
  /** File path to stat */
  path: string;
}

export interface StatResult {
  /** File path */
  path: string;
  /** File size in bytes */
  size: number;
  /** Modification time (timestamp) */
  mtime: number;
  /** Whether it's a file */
  isFile: boolean;
  /** Whether it's a directory */
  isDirectory: boolean;
  /** File permissions (optional) */
  mode?: number;
}

/**
 * find - Find files by name pattern
 * 
 * Safety: Path validation, pattern validation
 * Bounded: maxResults limit (default 50)
 * Paginated: Not applicable
 * Sourced: file paths
 */
export interface FindOptions {
  /** Name pattern to match (glob-like) */
  pattern: string;
  /** Maximum number of results (default: 50) */
  maxResults?: number;
  /** Directory to search in */
  directory?: string;
}

export interface FindResult {
  /** List of matching file paths */
  files: string[];
  /** True if results were truncated */
  truncated: boolean;
}

/**
 * git_blame - Get git blame for a file
 * 
 * Safety: Path validation, revision validation
 * Bounded: Output size limit
 * Paginated: Not applicable
 * Sourced: file, line numbers, commit info
 */
export interface GitBlameOptions {
  /** File path to blame */
  filePath: string;
  /** Revision to blame (default: HEAD) */
  revision?: string;
  /** Starting line (optional) */
  startLine?: number;
  /** Ending line (optional) */
  endLine?: number;
}

export interface BlameLine {
  /** Line number */
  line: number;
  /** Commit hash */
  commit: string;
  /** Author name */
  author: string;
  /** Author date (timestamp) */
  authorDate: number;
  /** Committer name */
  committer: string;
  /** Committer date (timestamp) */
  committerDate: number;
  /** Summary of the commit */
  summary: string;
  /** The actual line content */
  content: string;
}

export interface GitBlameResult {
  /** File path */
  file: string;
  /** Blame information for each line */
  lines: BlameLine[];
  /** Revision used */
  revision: string;
}

// ============================================================================
// Workspace Interface
// ============================================================================

/**
 * Complete workspace primitive interface
 * All operations are async and return typed results
 */
export interface WorkspacePrimitives {
  /**
   * List all files in the workspace
   * @param options - List files options
   * @returns List of files with truncation indicator
   */
  listFiles(options?: ListFilesOptions): Promise<ListFilesResult>;
  
  /**
   * Alias for listFiles
   */
  list(options?: ListFilesOptions): Promise<ListFilesResult>;
  
  /**
   * Search for text in workspace files
   * @param query - Text to search for
   * @param options - Search options
   * @returns Paginated search results
   */
  searchText(query: string, options?: SearchTextOptions): Promise<SearchTextResult>;
  
  /**
   * Alias for searchText
   */
  search(query: string, options?: SearchTextOptions): Promise<SearchTextResult>;
  
  /**
   * Search for exact identifier matches
   * @param identifier - Identifier to search for
   * @param options - Search options
   * @returns Paginated search results
   */
  searchIdentifiers(identifier: string, options?: SearchIdentifiersOptions): Promise<SearchIdentifiersResult>;
  
  /**
   * Read specific lines from a file
   * @param file - File path
   * @param options - Read options
   * @returns Lines with metadata
   */
  readLines(file: string, options?: ReadLinesOptions): Promise<ReadLinesResult>;
  
  /**
   * Alias for readLines
   */
  read(file: string, options?: ReadLinesOptions): Promise<ReadLinesResult>;
  
  /**
   * Read context around a specific line
   * @param file - File path
   * @param options - Read around options
   * @returns Lines around the specified line
   */
  readAround(file: string, options: ReadAroundOptions): Promise<ReadAroundResult>;
  
  /**
   * List symbols in the workspace
   * @param options - List symbols options
   * @returns Paginated symbol results
   */
  listSymbols(options?: ListSymbolsOptions): Promise<ListSymbolsResult>;
  
  /**
   * Find definitions of a symbol
   * @param symbol - Symbol name
   * @param options - Find definitions options
   * @returns Paginated definition results
   */
  findDefinitions(symbol: string, options?: FindDefinitionsOptions): Promise<FindDefinitionsResult>;
  
  /**
   * Find references to a symbol
   * @param symbol - Symbol name
   * @param options - Find references options
   * @returns Paginated reference results
   */
  findReferences(symbol: string, options?: FindReferencesOptions): Promise<FindReferencesResult>;
  
  /**
   * Get imports from a file
   * @param options - Get imports options
   * @returns Import information
   */
  getImports(options: GetImportsOptions): Promise<GetImportsResult>;
  
  /**
   * Get git diff between revisions
   * @param options - Git diff options
   * @returns Diff information
   */
  getGitDiff(options: GetGitDiffOptions): Promise<GetGitDiffResult>;

  /**
   * Get file status/information
   * @param options - Stat options
   * @returns File status information
   */
  stat(options: StatOptions): Promise<StatResult>;

  /**
   * Alias for stat (spec #174 primitive)
   */
  fileStat(options: StatOptions): Promise<StatResult>;

  /**
   * Find files by name pattern
   * @param options - Find options
   * @returns List of matching files
   */
  find(options: FindOptions): Promise<FindResult>;

  /**
   * Get git blame for a file
   * @param options - Git blame options
   * @returns Blame information for each line
   */
  gitBlame(options: GitBlameOptions): Promise<GitBlameResult>;
}

// ============================================================================
// Validation Error Types
// ============================================================================

/** Base validation error */
export class PrimitiveValidationError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'PrimitiveValidationError';
    this.code = code;
  }
}

/** Invalid path error */
export class InvalidPathError extends PrimitiveValidationError {
  constructor(path: string) {
    super(`Invalid path: ${path}`, 'INVALID_PATH');
  }
}

/** Path outside workspace error */
export class PathOutsideWorkspaceError extends PrimitiveValidationError {
  constructor(path: string) {
    super(`Path outside workspace: ${path}`, 'PATH_OUTSIDE_WORKSPACE');
  }
}

/** File too large error */
export class FileTooLargeError extends PrimitiveValidationError {
  constructor(path: string, size: number, maxSize: number) {
    super(`File too large: ${path} (${size} bytes, max ${maxSize})`, 'FILE_TOO_LARGE');
  }
}

/** Invalid range error */
export class InvalidRangeError extends PrimitiveValidationError {
  constructor(message: string) {
    super(message, 'INVALID_RANGE');
  }
}

/** Invalid query error */
export class InvalidQueryError extends PrimitiveValidationError {
  constructor(query: string) {
    super(`Invalid query: ${query}`, 'INVALID_QUERY');
  }
}

/** Rate limit error */
export class RateLimitError extends PrimitiveValidationError {
  constructor(message: string) {
    super(message, 'RATE_LIMIT');
  }
}
