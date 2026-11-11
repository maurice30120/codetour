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
    const files = await changedFiles(ctx, baseRef, headRef);
    
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
} from "./types";
