/**
 * Targeted Context types for Changes Tour
 * Part of spec #92, ticket #115 and #116
 */

import { CodeSymbol } from "../parsing/symbol-extractor";
import { TokenUsage, CostInfo } from "../cost-tracking/types";

/**
 * Configuration for Targeted Context feature
 */
export interface TargetedContextConfig {
  /**
   * Enable/disable Targeted Context (default: false - off by default)
   */
  enabled: boolean;
  /**
   * Maximum number of symbols to include in context
   */
  maxSymbols: number;
  /**
   * Maximum depth of symbol hierarchy to traverse
   */
  maxDepth: number;
  /**
   * File extensions to include for symbol extraction
   */
  includeExtensions: string[];
  /**
   * File extensions to exclude from symbol extraction
   */
  excludeExtensions: string[];
  /**
   * Whether to include symbol documentation in context
   */
  includeDocumentation: boolean;
  /**
   * Whether to track cost metrics for context generation
   */
  trackCost: boolean;
}

/**
 * Default configuration for Targeted Context
 */
export const DEFAULT_TARGETED_CONTEXT_CONFIG: TargetedContextConfig = {
  enabled: false, // Off by default as per spec
  maxSymbols: 1000,
  maxDepth: 10,
  includeExtensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".rs", ".cpp", ".h", ".hpp"],
  excludeExtensions: [".test.", ".spec.", ".d.ts"],
  includeDocumentation: true,
  trackCost: true,
};

/**
 * Context information for a single file
 */
export interface FileContext {
  /**
   * Relative path to the file
   */
  filePath: string;
  /**
   * List of symbols extracted from the file
   */
  symbols: CodeSymbol[];
  /**
   * File content (optional, for context)
   */
  content?: string;
  /**
   * Token usage for this file's context generation
   */
  tokenUsage?: TokenUsage;
  /**
   * Cost information for this file's context generation
   */
  cost?: CostInfo;
}

/**
 * Targeted context for a Changes Tour
 */
export interface TargetedContext {
  /**
   * Whether Targeted Context is enabled for this tour
   */
  enabled: boolean;
  /**
   * Base reference (commit SHA)
   */
  baseRef: string;
  /**
   * Head reference (commit SHA)
   */
  headRef: string;
  /**
   * List of changed files with their context
   */
  files: FileContext[];
  /**
   * Total symbols across all files
   */
  totalSymbols: number;
  /**
   * Total token usage for context generation
   */
  totalTokenUsage: TokenUsage;
  /**
   * Total cost for context generation
   */
  totalCost: CostInfo;
  /**
   * Timestamp when context was generated
   */
  generatedAt: string;
  /**
   * Duration of context generation in milliseconds
   */
  durationMs: number;
}

/**
 * Symbol filter options for context extraction
 */
export interface SymbolFilterOptions {
  /**
   * Symbol kinds to include
   */
  kinds?: ("function" | "class" | "interface" | "method" | "variable" | "type" | "enum" | "namespace" | "module")[];
  /**
   * Minimum line number to include
   */
  minLine?: number;
  /**
   * Maximum line number to include
   */
  maxLine?: number;
  /**
   * Regex pattern to match symbol names
   */
  namePattern?: RegExp;
}

/**
 * Result of extracting context from changed files
 */
export interface ContextExtractionResult {
  /**
   * Whether extraction was successful
   */
  success: boolean;
  /**
   * The extracted context
   */
  context?: TargetedContext;
  /**
   * Error message if extraction failed
   */
  error?: string;
  /**
   * Warnings during extraction
   */
  warnings: string[];
}

/**
 * Pagination options for progressive context exploration
 * Part of spec #92, ticket #116
 */
export interface PaginationOptions {
  /**
   * Page number to retrieve (1-based, default: 1)
   */
  page?: number;
  /**
   * Number of items per page (default: 100)
   */
  pageSize?: number;
  /**
   * Optional cursor for pagination (used for token-based pagination)
   */
  cursor?: string;
}

/**
 * Paginated result for context exploration
 */
export interface PaginatedContextResult<T> {
  /**
   * The items for this page
   */
  items: T[];
  /**
   * Current page number (1-based)
   */
  page: number;
  /**
   * Number of items per page
   */
  pageSize: number;
  /**
   * Total number of items available
   */
  totalItems: number;
  /**
   * Total number of pages
   */
  totalPages: number;
  /**
   * Whether there are more items available
   */
  hasMore: boolean;
  /**
   * Optional cursor for the next page
   */
  nextCursor?: string;
  /**
   * Optional cursor for the previous page
   */
  prevCursor?: string;
}

/**
 * Symbol page for progressive exploration
 */
export interface SymbolPage {
  /**
   * File path
   */
  filePath: string;
  /**
   * Symbols on this page
   */
  symbols: CodeSymbol[];
  /**
   * Total symbols in this file
   */
  totalFileSymbols: number;
}

/**
 * Paginated Targeted Context for progressive exploration
 */
export interface PaginatedTargetedContext extends Omit<TargetedContext, 'files'> {
  /**
   * Paginated file contexts
   */
  pages: SymbolPage[];
  /**
   * Pagination metadata
   */
  pagination: Omit<PaginatedContextResult<SymbolPage>, 'items'>;
}
