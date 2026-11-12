/**
 * Targeted Context Extractor for Changes Tour
 * 
 * This module extracts code symbols from changed files to provide bounded context
 * to the Tour Generator, reducing the need for open-ended exploration.
 * 
 * Part of Spec #92 - Targeted Context for Tour Generation
 * Ticket #115 - Implement Targeted Context for Changes Tour
 */

import * as path from "path";
import { WorkspaceContext } from "../types";
import { changedFiles, readCommitAnchors, normalizeSlashes } from "../git";
import {
  extractSymbols,
  isLanguageSupported,
  CodeSymbol,
} from "../parsing/symbol-extractor";
import {
  TargetedContext,
  TargetedContextConfig,
  FileContext,
  ContextExtractionResult,
  DEFAULT_TARGETED_CONTEXT_CONFIG,
  SymbolFilterOptions,
} from "./types";
import {
  TokenUsage,
  CostInfo,
} from "../cost-tracking/types";
import { CostTracker } from "../cost-tracking/cost-tracker";
import {
  PaginationOptions,
  PaginatedContextResult,
  PaginatedTargetedContext,
  SymbolPage,
} from "./types";

/**
 * Create a cost tracker for context extraction
 */
function createContextCostTracker(config: TargetedContextConfig): CostTracker {
  return new CostTracker({
    trackInputTokens: config.trackCost,
    trackOutputTokens: config.trackCost,
    trackCacheTokens: config.trackCost,
    trackAICredits: config.trackCost,
    trackDuration: config.trackCost,
    trackToolsCalled: config.trackCost,
  });
}

/**
 * Simple wrapper to adapt CostTracker API for our use case
 */
class ContextCostTracker {
  private tracker: CostTracker;
  private startTime: number = 0;

  constructor(tracker: CostTracker) {
    this.tracker = tracker;
  }

  start(): void {
    this.startTime = Date.now();
    this.tracker.reset();
  }

  stop(): void {
    // No-op for now, we just track duration
  }

  trackInputTokens(count: number): void {
    this.tracker.addInputTokens(count);
  }

  trackOutputTokens(count: number): void {
    this.tracker.addOutputTokens(count);
  }

  getCurrentTokenUsage(): TokenUsage {
    return this.tracker.getTokenUsage();
  }

  getCurrentCost(): CostInfo {
    return this.tracker.buildCostInfo();
  }

  getDurationMs(): number {
    return Date.now() - this.startTime;
  }
}

/**
 * Estimate token count for a string (approximation)
 */
function estimateTokenCount(text: string): number {
  // Rough approximation: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/**
 * Detect language from file path/extension
 */
function detectLanguageFromPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  
  const extensionToLanguage: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".cpp": "cpp",
    ".c": "c",
    ".h": "c",
    ".hpp": "cpp",
    ".rb": "ruby",
    ".php": "php",
  };
  
  return extensionToLanguage[extension] || "typescript"; // Default to TypeScript
}

/**
 * Check if a file should be included based on extension filters
 */
function shouldIncludeFile(filePath: string, config: TargetedContextConfig): boolean {
  const ext = path.extname(filePath).toLowerCase();
  
  // Check exclude patterns first
  for (const excludeExt of config.excludeExtensions) {
    if (filePath.includes(excludeExt)) {
      return false;
    }
  }
  
  // Check include patterns
  return config.includeExtensions.some((includeExt) => 
    ext === includeExt || filePath.endsWith(includeExt)
  );
}

/**
 * Select the changed files to process, applying the configured bounds before
 * reading any content.
 */
function selectChangedFiles(
  files: string[],
  config: TargetedContextConfig
): string[] {
  let selected = files;

  if (config.excludeNodeModules) {
    selected = selected.filter(
      (file) => !file.split(/[\\/]/).includes("node_modules")
    );
  }

  if (config.maxFiles !== undefined && config.maxFiles > 0) {
    selected = selected.slice(0, config.maxFiles);
  }

  return selected;
}

/**
 * Filter symbols based on options
 */
function filterSymbols(
  symbols: CodeSymbol[],
  options?: SymbolFilterOptions
): CodeSymbol[] {
  if (!options) return symbols;
  
  return symbols.filter((symbol) => {
    // Filter by kind
    if (options.kinds && !options.kinds.includes(symbol.kind)) {
      return false;
    }
    
    // Filter by line range
    if (symbol.location) {
      if (options.minLine !== undefined && symbol.location.startLine < options.minLine) {
        return false;
      }
      if (options.maxLine !== undefined && symbol.location.startLine > options.maxLine) {
        return false;
      }
    }
    
    // Filter by name pattern
    if (options.namePattern && symbol.name) {
      if (!options.namePattern.test(symbol.name)) {
        return false;
      }
    }
    
    return true;
  });
}

/**
 * Extract context from a single file
 */
async function extractFileContext(
  filePath: string,
  content: string,
  config: TargetedContextConfig,
  costTracker: ContextCostTracker
): Promise<FileContext | null> {
  // Track input tokens (file content)
  const inputTokens = estimateTokenCount(content);
  costTracker.trackInputTokens(inputTokens);
  
  // Check if file should be included
  if (!shouldIncludeFile(filePath, config)) {
    return null;
  }
  
  // Check if language is supported
  const language = detectLanguageFromPath(filePath);
  if (!isLanguageSupported(language)) {
    return null;
  }
  
  // Extract symbols (async)
  const symbols = await extractSymbols(content, language);
  
  // Filter symbols
  const filteredSymbols = filterSymbols(symbols);
  
  // Limit symbols
  const limitedSymbols = filteredSymbols.slice(0, config.maxSymbols);
  
  // Track output tokens (symbols data)
  const outputTokens = estimateTokenCount(
    JSON.stringify({ symbols: limitedSymbols })
  );
  costTracker.trackOutputTokens(outputTokens);
  
  return {
    filePath: normalizeSlashes(filePath),
    symbols: limitedSymbols,
    content: config.includeDocumentation ? content : undefined,
    tokenUsage: costTracker.getCurrentTokenUsage(),
    cost: costTracker.getCurrentCost(),
  };
}

/**
 * Extract targeted context from changed files between two commits
 */
export async function extractTargetedContext(
  ctx: WorkspaceContext,
  baseRef: string,
  headRef: string,
  config: Partial<TargetedContextConfig> = {}
): Promise<ContextExtractionResult> {
  const startTime = Date.now();
  const mergedConfig: TargetedContextConfig = {
    ...DEFAULT_TARGETED_CONTEXT_CONFIG,
    ...config,
  };
  
  // If Targeted Context is disabled, return minimal result
  if (!mergedConfig.enabled) {
    return {
      success: true,
      context: {
        enabled: false,
        baseRef,
        headRef,
        files: [],
        totalSymbols: 0,
        totalTokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheTokens: 0,
          totalTokens: 0,
          timestamp: new Date().toISOString(),
        },
        totalCost: {},
        generatedAt: new Date().toISOString(),
        durationMs: 0,
      },
      warnings: ["Targeted Context is disabled. Set enabled: true to use it."],
    };
  }
  
  const warnings: string[] = [];
  const fileContexts: FileContext[] = [];
  
  // Create cost tracker
  const baseTracker = createContextCostTracker(mergedConfig);
  const costTracker = new ContextCostTracker(baseTracker);
  costTracker.start();
  
  try {
    // Get changed files
    const files = selectChangedFiles(
      await changedFiles(ctx, baseRef, headRef),
      mergedConfig
    );
    
    if (files.length === 0) {
      warnings.push("No changed files found between base and head refs.");
      costTracker.stop();
      
      return {
        success: true,
        context: {
          enabled: true,
          baseRef,
          headRef,
          files: [],
          totalSymbols: 0,
          totalTokenUsage: costTracker.getCurrentTokenUsage(),
          totalCost: costTracker.getCurrentCost(),
          generatedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        },
        warnings,
      };
    }
    
    // Read file contents from commit anchors
    const commitAnchors = await readCommitAnchors(ctx, headRef, files);
    
    // Process each changed file
    for (const file of files) {
      const anchor = commitAnchors.get(normalizeSlashes(file));
      
      if (!anchor || !anchor.contents) {
        warnings.push(`Skipping ${file}: no content available`);
        continue;
      }
      
      const fileContext = await extractFileContext(
        file,
        anchor.contents,
        mergedConfig,
        costTracker
      );
      
      if (fileContext) {
        fileContexts.push(fileContext);
      }
    }
    
    // Calculate totals
    const totalSymbols = fileContexts.reduce(
      (sum, fc) => sum + fc.symbols.length,
      0
    );
    
    costTracker.stop();
    
    const context: TargetedContext = {
      enabled: true,
      baseRef,
      headRef,
      files: fileContexts,
      totalSymbols,
      totalTokenUsage: costTracker.getCurrentTokenUsage(),
      totalCost: costTracker.getCurrentCost(),
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
    
    return {
      success: true,
      context,
      warnings,
    };
  } catch (error) {
    costTracker.stop();
    
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      warnings,
    };
  }
}

/**
 * Format targeted context as a string for inclusion in prompts
 */
export function formatTargetedContextForPrompt(context: TargetedContext): string {
  if (!context.enabled || context.files.length === 0) {
    return "";
  }
  
  const parts: string[] = [
    `## Targeted Context (${context.totalSymbols} symbols from ${context.files.length} files)`,
    "",
    "The following code symbols have been identified in the changed files:",
    "",
  ];
  
  for (const fileContext of context.files) {
    if (fileContext.symbols.length === 0) continue;
    
    parts.push(`### ${fileContext.filePath} (${fileContext.symbols.length} symbols)`);
    parts.push("");
    
    for (const symbol of fileContext.symbols) {
      const location = symbol.location
        ? ` at line ${symbol.location.startLine}`
        : "";
      const documentation = symbol.documentation
        ? ` - ${symbol.documentation}`
        : "";
      parts.push(`- **${symbol.kind}**: \`${symbol.name}\`${location}${documentation}`);
    }
    
    parts.push("");
  }
  
  parts.push(`---\n\n`);
  
  return parts.join("\n");
}

/**
 * Format paginated targeted context as a string for inclusion in prompts
 * Supports progressive exploration (ticket #116)
 */
export function formatPaginatedContextForPrompt(
  context: PaginatedTargetedContext
): string {
  if (!context.enabled || context.pages.length === 0) {
    return "";
  }
  
  const pagination = context.pagination;
  const parts: string[] = [
    `## Targeted Context (Page ${pagination.page}/${pagination.totalPages}, ${context.totalSymbols} total symbols)`,
    "",
    "The following code symbols have been identified in the changed files:",
    "",
  ];
  
  // Calculate total symbols in this page
  const pageSymbolCount = context.pages.reduce(
    (sum, page) => sum + page.symbols.length,
    0
  );
  
  parts.push(`*Showing ${pageSymbolCount} symbols on this page.*`);
  parts.push("");
  
  for (const page of context.pages) {
    if (page.symbols.length === 0) continue;
    
    parts.push(`### ${page.filePath} (${page.symbols.length}/${page.totalFileSymbols} symbols)`);
    parts.push("");
    
    for (const symbol of page.symbols) {
      const location = symbol.location
        ? ` at line ${symbol.location.startLine}`
        : "";
      const documentation = symbol.documentation
        ? ` - ${symbol.documentation}`
        : "";
      parts.push(`- **${symbol.kind}**: \`${symbol.name}\`${location}${documentation}`);
    }
    
    parts.push("");
  }
  
  if (pagination.hasMore) {
    parts.push(
      `*There are more symbols available. Use page=${pagination.page + 1} to see the next page.*`
    );
    parts.push("");
  }
  
  parts.push(`---\n\n`);
  
  return parts.join("\n");
}

/**
 * Paginate an array of items
 */
function paginate<T>(
  items: T[],
  options: PaginationOptions = {}
): PaginatedContextResult<T> {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 100;
  const totalItems = items.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const pageItems = items.slice(startIndex, endIndex);
  
  return {
    items: pageItems,
    page,
    pageSize,
    totalItems,
    totalPages,
    hasMore: endIndex < totalItems,
    nextCursor: endIndex < totalItems ? String(endIndex) : undefined,
    prevCursor: startIndex > 0 ? String(Math.max(0, startIndex - pageSize)) : undefined,
  };
}

/**
 * Extract paginated targeted context from changed files
 * Supports progressive exploration by returning context in pages
 * Part of spec #92, ticket #116
 */
export async function extractPaginatedTargetedContext(
  ctx: WorkspaceContext,
  baseRef: string,
  headRef: string,
  pagination: PaginationOptions = {},
  config: Partial<TargetedContextConfig> = {}
): Promise<ContextExtractionResult & { paginatedContext?: PaginatedTargetedContext }> {
  const startTime = Date.now();
  const mergedConfig: TargetedContextConfig = {
    ...DEFAULT_TARGETED_CONTEXT_CONFIG,
    ...config,
  };
  
  // If Targeted Context is disabled, return minimal result
  if (!mergedConfig.enabled) {
    return {
      success: true,
      context: {
        enabled: false,
        baseRef,
        headRef,
        files: [],
        totalSymbols: 0,
        totalTokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheTokens: 0,
          totalTokens: 0,
          timestamp: new Date().toISOString(),
        },
        totalCost: {},
        generatedAt: new Date().toISOString(),
        durationMs: 0,
      },
      warnings: ["Targeted Context is disabled. Set enabled: true to use it."],
    };
  }
  
  const warnings: string[] = [];
  const allFileContexts: { filePath: string; symbols: CodeSymbol[] }[] = [];
  
  // Create cost tracker
  const baseTracker = createContextCostTracker(mergedConfig);
  const costTracker = new ContextCostTracker(baseTracker);
  costTracker.start();
  
  try {
    // Get changed files
    const files = selectChangedFiles(
      await changedFiles(ctx, baseRef, headRef),
      mergedConfig
    );
    
    if (files.length === 0) {
      warnings.push("No changed files found between base and head refs.");
      costTracker.stop();
      
      return {
        success: true,
        context: {
          enabled: true,
          baseRef,
          headRef,
          files: [],
          totalSymbols: 0,
          totalTokenUsage: costTracker.getCurrentTokenUsage(),
          totalCost: costTracker.getCurrentCost(),
          generatedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        },
        warnings,
      };
    }
    
    // Read file contents from commit anchors
    const commitAnchors = await readCommitAnchors(ctx, headRef, files);
    
    // Process each changed file and collect all symbols
    for (const file of files) {
      const anchor = commitAnchors.get(normalizeSlashes(file));
      
      if (!anchor || !anchor.contents) {
        warnings.push(`Skipping ${file}: no content available`);
        continue;
      }
      
      // Track input tokens (file content)
      const inputTokens = estimateTokenCount(anchor.contents);
      costTracker.trackInputTokens(inputTokens);
      
      // Check if file should be included
      if (!shouldIncludeFile(file, mergedConfig)) {
        continue;
      }
      
      // Check if language is supported
      const language = detectLanguageFromPath(file);
      if (!isLanguageSupported(language)) {
        continue;
      }
      
      // Extract symbols (async)
      const symbols = await extractSymbols(anchor.contents, language);
      
      // Filter symbols
      const filteredSymbols = filterSymbols(symbols);
      
      allFileContexts.push({
        filePath: normalizeSlashes(file),
        symbols: filteredSymbols,
      });
    }
    
    // Calculate total symbols
    const totalSymbols = allFileContexts.reduce(
      (sum, fc) => sum + fc.symbols.length,
      0
    );
    
    // Track output tokens (all symbols data)
    const outputTokens = estimateTokenCount(
      JSON.stringify({ fileContexts: allFileContexts })
    );
    costTracker.trackOutputTokens(outputTokens);
    
    costTracker.stop();
    
    // Create full context (for backward compatibility)
    const fullContext: TargetedContext = {
      enabled: true,
      baseRef,
      headRef,
      files: allFileContexts.map((fc) => ({
        filePath: fc.filePath,
        symbols: fc.symbols,
        tokenUsage: costTracker.getCurrentTokenUsage(),
        cost: costTracker.getCurrentCost(),
      })),
      totalSymbols,
      totalTokenUsage: costTracker.getCurrentTokenUsage(),
      totalCost: costTracker.getCurrentCost(),
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
    
    // Create paginated context
    const page = pagination.page ?? 1;
    const pageSize =
      pagination.pageSize ?? mergedConfig.pageSize ?? mergedConfig.maxSymbols;
    
    // Paginate across all files
    const allSymbolsWithFile: { filePath: string; symbol: CodeSymbol }[] = [];
    allFileContexts.forEach((fc) => {
      fc.symbols.forEach((symbol) => {
        allSymbolsWithFile.push({ filePath: fc.filePath, symbol });
      });
    });
    
    const paginated = paginate(allSymbolsWithFile, { page, pageSize });
    
    // Group symbols by file for the pages
    const pages: SymbolPage[] = [];
    const symbolsInPage = paginated.items;
    
    // Create a map of file to its symbols
    const fileSymbolMap = new Map<string, CodeSymbol[]>();
    allFileContexts.forEach((fc) => {
      fileSymbolMap.set(fc.filePath, fc.symbols);
    });
    
    // For each symbol in the page, group by file
    const pageFileMap = new Map<string, CodeSymbol[]>();
    symbolsInPage.forEach((item) => {
      if (!pageFileMap.has(item.filePath)) {
        pageFileMap.set(item.filePath, []);
      }
      pageFileMap.get(item.filePath)!.push(item.symbol);
    });
    
    // Create pages
    pageFileMap.forEach((symbols, filePath) => {
      pages.push({
        filePath,
        symbols,
        totalFileSymbols: fileSymbolMap.get(filePath)?.length ?? 0,
      });
    });
    
    const paginatedContext: PaginatedTargetedContext = {
      enabled: true,
      baseRef,
      headRef,
      pages,
      totalSymbols,
      totalTokenUsage: costTracker.getCurrentTokenUsage(),
      totalCost: costTracker.getCurrentCost(),
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      pagination: {
        page: paginated.page,
        pageSize: paginated.pageSize,
        totalItems: paginated.totalItems,
        totalPages: paginated.totalPages,
        hasMore: paginated.hasMore,
        nextCursor: paginated.nextCursor,
        prevCursor: paginated.prevCursor,
      },
    };
    
    return {
      success: true,
      context: fullContext,
      paginatedContext,
      warnings,
    };
  } catch (error) {
    costTracker.stop();
    
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      warnings,
    };
  }
}

/**
 * Get configuration for Targeted Context
 */
export function getTargetedContextConfig(
  overrides?: Partial<TargetedContextConfig>
): TargetedContextConfig {
  return {
    ...DEFAULT_TARGETED_CONTEXT_CONFIG,
    ...overrides,
  };
}

// Re-export types for convenience
export {
  DEFAULT_TARGETED_CONTEXT_CONFIG,
  TargetedContextConfig,
  TargetedContext,
  FileContext,
  ContextExtractionResult,
  SymbolFilterOptions,
  PaginationOptions,
  PaginatedContextResult,
  PaginatedTargetedContext,
  SymbolPage,
} from "./types";
