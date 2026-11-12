/**
 * Project Tour Targeted Context Extractor
 * 
 * This module extracts code symbols from the entire workspace to provide bounded context
 * to the Tour Generator for Project Tours, reducing the need for open-ended exploration.
 * 
 * Part of Spec #92 - Targeted Context for Tour Generation
 * Ticket #117 - Implement Targeted Context for Project Tour
 */

import * as path from "path";
import * as fs from "fs/promises";
import { WorkspaceContext } from "../types";
import {
  extractSymbols,
  isLanguageSupported,
  CodeSymbol,
} from "../parsing/symbol-extractor";
import {
  ProjectTargetedContext,
  ProjectTargetedContextConfig,
  ProjectFileContext,
  ProjectContextExtractionResult,
  DEFAULT_PROJECT_TARGETED_CONTEXT_CONFIG,
  ProjectSymbolFilterOptions,
} from "./project-types";
import {
  TokenUsage,
  CostInfo,
} from "../cost-tracking/types";
import { CostTracker } from "../cost-tracking/cost-tracker";

/**
 * Create a cost tracker for project context extraction
 */
function createProjectCostTracker(config: ProjectTargetedContextConfig): CostTracker {
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
 * Simple wrapper to adapt CostTracker API for project context use case
 */
class ProjectContextCostTracker {
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
function isInsideNodeModules(filePath: string): boolean {
  return filePath.split(/[\\/]/).includes("node_modules");
}

function shouldIncludeFile(filePath: string, config: ProjectTargetedContextConfig): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);
  
  // Always exclude node_modules if configured
  if (config.excludeNodeModules && isInsideNodeModules(filePath)) {
    return false;
  }
  
  // Check exclude patterns first
  for (const excludeExt of config.excludeExtensions) {
    if (basename.includes(excludeExt) || filePath.includes(excludeExt)) {
      return false;
    }
  }
  
  // Check include patterns
  return config.includeExtensions.some((includeExt) => 
    ext === includeExt || filePath.endsWith(includeExt)
  );
}

/**
 * Check if a directory should be scanned
 */
function shouldScanDirectory(
  workspaceRoot: string,
  dirPath: string,
  config: ProjectTargetedContextConfig
): boolean {
  const relativePath = path.relative(workspaceRoot, dirPath);
  
  // Always exclude node_modules
  if (config.excludeNodeModules && isInsideNodeModules(relativePath)) {
    return false;
  }
  
  // If rootDirectories is specified, only scan those
  if (config.rootDirectories.length > 0) {
    // The workspace root itself must always be scanned: it holds the
    // configured root directories, so stopping here would find nothing.
    if (relativePath === "") {
      return true;
    }
    
    return config.rootDirectories.some(rootDir => {
      const normalized = rootDir.replace(/[\\/]+$/, "");
      return (
        relativePath === normalized ||
        relativePath.startsWith(normalized + path.sep)
      );
    });
  }
  
  // Otherwise scan all directories
  return true;
}

/**
 * Filter symbols based on options
 */
function filterSymbols(
  symbols: CodeSymbol[],
  options?: ProjectSymbolFilterOptions
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
    
    // Filter by exported status (simple heuristic: name starts with uppercase for TypeScript)
    if (options.exportedOnly) {
      // This is a simplification; proper detection would require AST parsing
      // For now, we'll include all symbols when exportedOnly is true
      // as the regex extractor doesn't capture export modifiers
    }
    
    return true;
  });
}

/**
 * Extract context from a single file for Project Tour
 */
async function extractFileContext(
  filePath: string,
  content: string,
  config: ProjectTargetedContextConfig,
  costTracker: ProjectContextCostTracker,
  language: string
): Promise<ProjectFileContext | null> {
  // Track input tokens (file content)
  const inputTokens = estimateTokenCount(content);
  costTracker.trackInputTokens(inputTokens);
  
  // Check if file should be included
  if (!shouldIncludeFile(filePath, config)) {
    return null;
  }
  
  // Check if language is supported
  if (!isLanguageSupported(language)) {
    return null;
  }
  
  // Extract symbols (async)
  const symbols = await extractSymbols(content, language);
  
  // Filter symbols
  const filteredSymbols = filterSymbols(symbols);
  
  // Limit symbols per file
  const limitedSymbols = filteredSymbols.slice(0, config.maxSymbolsPerFile);
  
  // Track output tokens (symbols data)
  const outputTokens = estimateTokenCount(
    JSON.stringify({ symbols: limitedSymbols })
  );
  costTracker.trackOutputTokens(outputTokens);
  
  // Get file stats
  const stats = await fs.stat(filePath);
  
  return {
    filePath: filePath.replace(/^\//, ''), // Remove leading slash
    symbols: limitedSymbols,
    content: config.includeDocumentation ? content : undefined,
    tokenUsage: costTracker.getCurrentTokenUsage(),
    cost: costTracker.getCurrentCost(),
    fileSize: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

/**
 * Recursively scan directories for files
 */
async function scanWorkspaceFiles(
  workspaceRoot: string,
  dirPath: string,
  config: ProjectTargetedContextConfig,
  allFiles: string[] = []
): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      // Skip if we've reached the file limit
      if (config.maxFiles > 0 && allFiles.length >= config.maxFiles) {
        break;
      }
      
      if (entry.isDirectory()) {
        // Check if we should scan this directory
        if (shouldScanDirectory(workspaceRoot, fullPath, config)) {
          await scanWorkspaceFiles(workspaceRoot, fullPath, config, allFiles);
        }
      } else if (entry.isFile()) {
        // Check if we should include this file
        if (shouldIncludeFile(fullPath, config)) {
          allFiles.push(fullPath);
        }
      }
    }
    
    return allFiles;
  } catch (error) {
    // Silently skip directories we can't read
    return allFiles;
  }
}

/**
 * Extract targeted context from the entire workspace for Project Tour
 */
export async function extractProjectTargetedContext(
  ctx: WorkspaceContext,
  config: Partial<ProjectTargetedContextConfig> = {}
): Promise<ProjectContextExtractionResult> {
  const startTime = Date.now();
  const mergedConfig: ProjectTargetedContextConfig = {
    ...DEFAULT_PROJECT_TARGETED_CONTEXT_CONFIG,
    ...config,
  };
  
  // If Targeted Context is disabled, return minimal result
  if (!mergedConfig.enabled) {
    return {
      success: true,
      context: {
        enabled: false,
        workspaceRoot: ctx.root,
        files: [],
        totalSymbols: 0,
        totalFiles: 0,
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
        languages: [],
        summary: {
          byLanguage: {},
          largestFiles: [],
          mostSymbolicFiles: [],
        },
      },
      warnings: ["Project Targeted Context is disabled. Set enabled: true to use it."],
    };
  }
  
  const warnings: string[] = [];
  const fileContexts: ProjectFileContext[] = [];
  const languages: Set<string> = new Set();
  const byLanguage: Record<string, { fileCount: number; symbolCount: number }> = {};
  const largestFiles: Array<{ filePath: string; size: number }> = [];
  const mostSymbolicFiles: Array<{ filePath: string; symbolCount: number }> = [];
  
  // Create cost tracker
  const baseTracker = createProjectCostTracker(mergedConfig);
  const costTracker = new ProjectContextCostTracker(baseTracker);
  costTracker.start();
  
  try {
    // Scan workspace for files
    const allFiles = await scanWorkspaceFiles(
      ctx.root,
      ctx.root,
      mergedConfig
    );
    
    if (allFiles.length === 0) {
      warnings.push("No source files found matching the include criteria.");
      costTracker.stop();
      
      return {
        success: true,
        context: {
          enabled: true,
          workspaceRoot: ctx.root,
          files: [],
          totalSymbols: 0,
          totalFiles: 0,
          totalTokenUsage: costTracker.getCurrentTokenUsage(),
          totalCost: costTracker.getCurrentCost(),
          generatedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          languages: [],
          summary: {
            byLanguage: {},
            largestFiles: [],
            mostSymbolicFiles: [],
          },
        },
        warnings,
      };
    }
    
    // Limit files if we have a max
    const filesToProcess = mergedConfig.maxFiles > 0 
      ? allFiles.slice(0, mergedConfig.maxFiles)
      : allFiles;
    
    // Process each file
    for (const filePath of filesToProcess) {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const language = detectLanguageFromPath(filePath);
        
        languages.add(language);
        
        const fileContext = await extractFileContext(
          filePath,
          content,
          mergedConfig,
          costTracker,
          language
        );
        
        if (fileContext) {
          fileContexts.push(fileContext);
          
          // Update language stats
          if (!byLanguage[language]) {
            byLanguage[language] = { fileCount: 0, symbolCount: 0 };
          }
          byLanguage[language].fileCount++;
          byLanguage[language].symbolCount += fileContext.symbols.length;
          
          // Update largest files (by size)
          largestFiles.push({ filePath: fileContext.filePath, size: fileContext.fileSize });
          largestFiles.sort((a, b) => b.size - a.size);
          if (largestFiles.length > 10) largestFiles.pop();
          
          // Update most symbolic files
          mostSymbolicFiles.push({ filePath: fileContext.filePath, symbolCount: fileContext.symbols.length });
          mostSymbolicFiles.sort((a, b) => b.symbolCount - a.symbolCount);
          if (mostSymbolicFiles.length > 10) mostSymbolicFiles.pop();
        }
      } catch (error) {
        warnings.push(`Skipping ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Calculate totals
    const totalSymbols = fileContexts.reduce(
      (sum, fc) => sum + fc.symbols.length,
      0
    );
    
    costTracker.stop();
    
    const context: ProjectTargetedContext = {
      enabled: true,
      workspaceRoot: ctx.root,
      files: fileContexts,
      totalSymbols,
      totalFiles: fileContexts.length,
      totalTokenUsage: costTracker.getCurrentTokenUsage(),
      totalCost: costTracker.getCurrentCost(),
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      languages: Array.from(languages),
      summary: {
        byLanguage,
        largestFiles,
        mostSymbolicFiles,
      },
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
 * Format project targeted context as a string for inclusion in prompts
 */
export function formatProjectTargetedContextForPrompt(context: ProjectTargetedContext): string {
  if (!context.enabled || context.files.length === 0) {
    return "";
  }
  
  const parts: string[] = [
    `## Targeted Context (${context.totalSymbols} symbols from ${context.totalFiles} files)`,
    "",
    "The following code symbols have been identified in the workspace:",
    "",
  ];
  
  // Add summary
  if (context.languages.length > 0) {
    parts.push(`**Languages**: ${context.languages.join(", ")}`);
    parts.push("");
  }
  
  // Add by-language summary
  if (Object.keys(context.summary.byLanguage).length > 0) {
    parts.push("**By Language:**");
    for (const [lang, stats] of Object.entries(context.summary.byLanguage)) {
      parts.push(`- **${lang}**: ${stats.fileCount} files, ${stats.symbolCount} symbols`);
    }
    parts.push("");
  }
  
  // Add largest files
  if (context.summary.largestFiles.length > 0) {
    parts.push("**Largest Files:**");
    for (const { filePath, size } of context.summary.largestFiles.slice(0, 5)) {
      const sizeKb = Math.round(size / 1024);
      parts.push(`- ${filePath} (${sizeKb} KB)`);
    }
    parts.push("");
  }
  
  // Add most symbolic files
  if (context.summary.mostSymbolicFiles.length > 0) {
    parts.push("**Most Symbolic Files:**");
    for (const { filePath, symbolCount } of context.summary.mostSymbolicFiles.slice(0, 5)) {
      parts.push(`- ${filePath} (${symbolCount} symbols)`);
    }
    parts.push("");
  }
  
  parts.push("---");
  parts.push("");
  parts.push("**Key Symbols:**");
  parts.push("");
  
  // Group by file and show symbols
  for (const fileContext of context.files.slice(0, 10)) { // Limit to 10 files in prompt
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
 * Get configuration for Project Targeted Context
 */
export function getProjectTargetedContextConfig(
  overrides?: Partial<ProjectTargetedContextConfig>
): ProjectTargetedContextConfig {
  return {
    ...DEFAULT_PROJECT_TARGETED_CONTEXT_CONFIG,
    ...overrides,
  };
}

// Re-export types for convenience
export {
  DEFAULT_PROJECT_TARGETED_CONTEXT_CONFIG,
  ProjectTargetedContextConfig,
  ProjectTargetedContext,
  ProjectFileContext,
  ProjectContextExtractionResult,
  ProjectSymbolFilterOptions,
} from "./project-types";
