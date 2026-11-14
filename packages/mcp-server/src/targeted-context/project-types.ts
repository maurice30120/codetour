/**
 * Targeted Context types for Project Tour
 * Part of spec #92, ticket #117
 */

import { CodeSymbol } from "../parsing/symbol-extractor";
import { TokenUsage, CostInfo } from "../cost-tracking/types";
import type { RelationsPacket } from "./relations-packet";

/**
 * Configuration for Project Tour Targeted Context feature
 */
export interface ProjectTargetedContextConfig {
  /**
   * Enable/disable Targeted Context (default: false - off by default)
   */
  enabled: boolean;
  /**
   * Maximum number of symbols to include in context per file
   */
  maxSymbolsPerFile: number;
  /**
   * Maximum number of files to include in context
   */
  maxFiles: number;
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
  /**
   * Root directories to scan (relative to workspace root)
   * If empty, scans the entire workspace
   */
  rootDirectories: string[];
  /**
   * Whether to include node_modules in scanning
   */
  excludeNodeModules: boolean;
  /**
   * Targeted-slice window (± lines) around each relations ambiguity pointer.
   * Defaults to 8 (spec #149). Only used when `enabled` is true (ADR 0033).
   */
  relationsWindow?: number;
}

/**
 * Default configuration for Project Tour Targeted Context
 */
export const DEFAULT_PROJECT_TARGETED_CONTEXT_CONFIG: ProjectTargetedContextConfig = {
  enabled: false, // Off by default as per spec
  maxSymbolsPerFile: 50,
  maxFiles: 50,
  maxDepth: 10,
  includeExtensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".rs", ".cpp", ".h", ".hpp"],
  excludeExtensions: [".test.", ".spec.", ".d.ts", ".min.js", ".map"],
  includeDocumentation: true,
  trackCost: true,
  rootDirectories: ["src", "lib", "packages", "app", "server", "client", "core"],
  excludeNodeModules: true,
};

/**
 * Context information for a single file in Project Tour
 */
export interface ProjectFileContext {
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
  /**
   * File size in bytes
   */
  fileSize: number;
  /**
   * Last modified timestamp
   */
  modifiedAt?: string;
}

/**
 * Targeted context for a Project Tour
 */
export interface ProjectTargetedContext {
  /**
   * Whether Targeted Context is enabled for this tour
   */
  enabled: boolean;
  /**
   * Workspace root path
   */
  workspaceRoot: string;
  /**
   * List of source files with their context
   */
  files: ProjectFileContext[];
  /**
   * Total symbols across all files
   */
  totalSymbols: number;
  /**
   * Total files scanned
   */
  totalFiles: number;
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
  /**
   * Languages detected in the workspace
   */
  languages: string[];
  /**
   * Summary statistics
   */
  summary: {
    byLanguage: Record<string, { fileCount: number; symbolCount: number }>;
    largestFiles: Array<{ filePath: string; size: number }>;
    mostSymbolicFiles: Array<{ filePath: string; symbolCount: number }>;
  };
  /**
   * Depth-1 relations packet (ticket #155, spec #149), produced from the same
   * workspace scan. Present only when the flag is on; absent (key not set)
   * when `enabled` is false, so the historical shape is unchanged (ADR 0033).
   */
  relations?: RelationsPacket;
}

/**
 * Symbol filter options for project context extraction
 */
export interface ProjectSymbolFilterOptions {
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
  /**
   * Only include exported symbols
   */
  exportedOnly?: boolean;
}

/**
 * Result of extracting context from workspace files
 */
export interface ProjectContextExtractionResult {
  /**
   * Whether extraction was successful
   */
  success: boolean;
  /**
   * The extracted context
   */
  context?: ProjectTargetedContext;
  /**
   * Error message if extraction failed
   */
  error?: string;
  /**
   * Warnings during extraction
   */
  warnings: string[];
}
