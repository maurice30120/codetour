/**
 * Symbol Extractor Module for Targeted Context
 * 
 * This module provides multi-language parsing capabilities for extracting code symbols.
 * It currently uses a regex-based approach as a spike implementation.
 * The decision between Tree-sitter and repomap will be documented separately.
 * 
 * Part of Spec #92 - Targeted Context for Tour Generation
 * Ticket #114 - Spike: Tree-sitter vs repomap decision
 */

export interface CodeSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "method" | "variable" | "type" | "enum" | "namespace" | "module";
  location?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  documentation?: string;
  parentName?: string;
  modifiers?: string[];
}

/**
 * Extract symbols from TypeScript code using regex patterns
 * This is a spike implementation to demonstrate the concept
 */
export function extractSymbolsFromTypeScript(code: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  
  // Extract class declarations
  const classRegex = /class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  let match;
  while ((match = classRegex.exec(code)) !== null) {
    const name = match[1];
    const beforeMatch = code.substring(0, match.index);
    const startLine = beforeMatch.split("\n").length;
    const lastNewlineIndex = beforeMatch.lastIndexOf("\n");
    const startColumn = match.index - lastNewlineIndex + match[0].indexOf(name) + 1;
    
    symbols.push({
      name,
      kind: "class",
      location: {
        startLine,
        startColumn,
        endLine: startLine,
        endColumn: startColumn + name.length,
      },
    });
  }
  
  // Extract interface declarations
  const interfaceRegex = /interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  while ((match = interfaceRegex.exec(code)) !== null) {
    const name = match[1];
    const beforeMatch = code.substring(0, match.index);
    const startLine = beforeMatch.split("\n").length;
    const lastNewlineIndex = beforeMatch.lastIndexOf("\n");
    const startColumn = match.index - lastNewlineIndex + match[0].indexOf(name) + 1;
    
    symbols.push({
      name,
      kind: "interface",
      location: {
        startLine,
        startColumn,
        endLine: startLine,
        endColumn: startColumn + name.length,
      },
    });
  }
  
  // Extract type alias declarations
  const typeRegex = /type\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  while ((match = typeRegex.exec(code)) !== null) {
    const name = match[1];
    const beforeMatch = code.substring(0, match.index);
    const startLine = beforeMatch.split("\n").length;
    const lastNewlineIndex = beforeMatch.lastIndexOf("\n");
    const startColumn = match.index - lastNewlineIndex + match[0].indexOf(name) + 1;
    
    symbols.push({
      name,
      kind: "type",
      location: {
        startLine,
        startColumn,
        endLine: startLine,
        endColumn: startColumn + name.length,
      },
    });
  }
  
  // Extract enum declarations
  const enumRegex = /enum\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  while ((match = enumRegex.exec(code)) !== null) {
    const name = match[1];
    const beforeMatch = code.substring(0, match.index);
    const startLine = beforeMatch.split("\n").length;
    const lastNewlineIndex = beforeMatch.lastIndexOf("\n");
    const startColumn = match.index - lastNewlineIndex + match[0].indexOf(name) + 1;
    
    symbols.push({
      name,
      kind: "enum",
      location: {
        startLine,
        startColumn,
        endLine: startLine,
        endColumn: startColumn + name.length,
      },
    });
  }
  
  // Extract function declarations (including method declarations in classes)
  const functionRegex = /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  while ((match = functionRegex.exec(code)) !== null) {
    const name = match[1];
    const beforeMatch = code.substring(0, match.index);
    const startLine = beforeMatch.split("\n").length;
    const lastNewlineIndex = beforeMatch.lastIndexOf("\n");
    const startColumn = match.index - lastNewlineIndex + match[0].indexOf(name) + 1;
    
    // Check if this is a method (has parent class)
    const kind: CodeSymbol["kind"] = isInsideClass(code, match.index) ? "method" : "function";
    
    symbols.push({
      name,
      kind,
      location: {
        startLine,
        startColumn,
        endLine: startLine,
        endColumn: startColumn + name.length,
      },
    });
  }
  
  // Extract arrow function assignments (const/let variable declarations)
  const arrowFunctionRegex = /(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(\([^)]*\)\s*=>|async\s*\([^)]*\)\s*=>)/g;
  while ((match = arrowFunctionRegex.exec(code)) !== null) {
    const name = match[2];
    const beforeMatch = code.substring(0, match.index);
    const startLine = beforeMatch.split("\n").length;
    const lastNewlineIndex = beforeMatch.lastIndexOf("\n");
    const startColumn = match.index - lastNewlineIndex + match[0].indexOf(name) + 1;
    
    symbols.push({
      name,
      kind: "variable",
      modifiers: [match[1]],
      location: {
        startLine,
        startColumn,
        endLine: startLine,
        endColumn: startColumn + name.length,
      },
    });
  }
  
  // Extract namespace declarations
  const namespaceRegex = /namespace\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  while ((match = namespaceRegex.exec(code)) !== null) {
    const name = match[1];
    const beforeMatch = code.substring(0, match.index);
    const startLine = beforeMatch.split("\n").length;
    const lastNewlineIndex = beforeMatch.lastIndexOf("\n");
    const startColumn = match.index - lastNewlineIndex + match[0].indexOf(name) + 1;
    
    symbols.push({
      name,
      kind: "namespace",
      location: {
        startLine,
        startColumn,
        endLine: startLine,
        endColumn: startColumn + name.length,
      },
    });
  }
  
  return symbols;
}

/**
 * Check if a position is inside a class declaration
 */
function isInsideClass(code: string, position: number): boolean {
  const before = code.substring(0, position);
  const lastClass = before.lastIndexOf("class");
  const lastClosingBrace = before.lastIndexOf("}");
  
  if (lastClass === -1) return false;
  if (lastClosingBrace === -1) return true;
  
  return lastClass > lastClosingBrace;
}

/**
 * Extract symbols from Python code using regex patterns
 */
export function extractSymbolsFromPython(code: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = code.split("\n");
  
  // Extract class definitions
  const classRegex = /class\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm;
  let match;
  while ((match = classRegex.exec(code)) !== null) {
    const name = match[1];
    const beforeMatch = code.substring(0, match.index);
    const startLine = beforeMatch.split("\n").length + 1;
    const lastNewlineIndex = beforeMatch.lastIndexOf("\n");
    const startColumn = match.index - lastNewlineIndex + match[0].indexOf(name) + 1;
    
    symbols.push({
      name,
      kind: "class",
      location: {
        startLine,
        startColumn,
        endLine: startLine,
        endColumn: startColumn + name.length,
      },
    });
  }
  
  // Extract async function definitions first (to avoid duplicates with regular def)
  const asyncFunctionRegex = /\basync\s+def\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
  while ((match = asyncFunctionRegex.exec(code)) !== null) {
    const name = match[1];
    const beforeMatch = code.substring(0, match.index);
    const startLine = beforeMatch.split("\n").length + 1;
    const lastNewlineIndex = beforeMatch.lastIndexOf("\n");
    const lineText = beforeMatch.substring(lastNewlineIndex + 1);
    const startColumn = lineText.length - lineText.trimStart().length + match[0].indexOf("async") + 6 + 1;
    
    // Check indentation
    const indentation = lineText.length - lineText.trimStart().length;
    const kind: CodeSymbol["kind"] = indentation > 0 ? "method" : "function";
    
    symbols.push({
      name,
      kind,
      modifiers: ["async"],
      location: {
        startLine,
        startColumn,
        endLine: startLine,
        endColumn: startColumn + name.length,
      },
    });
  }
  
  // Extract function definitions (skip if already captured by async regex)
  // Match def that is NOT preceded by async
  const functionRegex = /\b(?!async\s)def\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
  while ((match = functionRegex.exec(code)) !== null) {
    const name = match[1];
    const beforeMatch = code.substring(0, match.index);
    const startLine = beforeMatch.split("\n").length + 1;
    const lastNewlineIndex = beforeMatch.lastIndexOf("\n");
    const lineText = beforeMatch.substring(lastNewlineIndex + 1);
    const startColumn = lineText.length - lineText.trimStart().length + match[0].indexOf("def") + 4 + 1;
    
    // Check if this is a method by looking at the line's indentation
    const indentation = lineText.length - lineText.trimStart().length;
    const kind: CodeSymbol["kind"] = indentation > 0 ? "method" : "function";
    
    symbols.push({
      name,
      kind,
      location: {
        startLine,
        startColumn,
        endLine: startLine,
        endColumn: startColumn + name.length,
      },
    });
  }
  
  // Extract module-level variable assignments
  const variableRegex = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*.+/gm;
  while ((match = variableRegex.exec(code)) !== null) {
    const name = match[1];
    const beforeMatch = code.substring(0, match.index);
    const startLine = beforeMatch.split("\n").length + 1;
    const lastNewlineIndex = beforeMatch.lastIndexOf("\n");
    const lineText = code.substring(lastNewlineIndex + 1, match.index + match[0].length);
    const startColumn = lineText.length - lineText.trimStart().length + 1;
    
    // Only include if it's at module level (no indentation or very little)
    const line = lines[startLine - 1];
    if (!line.trimStart().startsWith("def") && !line.trimStart().startsWith("class")) {
      symbols.push({
        name,
        kind: "variable",
        location: {
          startLine,
          startColumn,
          endLine: startLine,
          endColumn: startColumn + name.length,
        },
      });
    }
  }
  
  return symbols;
}

/**
 * Extract symbols from Java code using regex patterns
 */
export function extractSymbolsFromJava(code: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  
  // Extract class declarations
  const classRegex = /(public|private|protected|abstract|final|static\s+)*class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  let match;
  while ((match = classRegex.exec(code)) !== null) {
    const name = match[2];
    const beforeMatch = code.substring(0, match.index);
    const startLine = beforeMatch.split("\n").length + 1;
    const lastNewlineIndex = beforeMatch.lastIndexOf("\n");
    const startColumn = match.index - lastNewlineIndex + match[0].indexOf(name) + 1;
    
    const modifiers = match[1]?.trim()?.split(/\s+/)?.filter(Boolean) || [];
    
    symbols.push({
      name,
      kind: "class",
      modifiers: modifiers.length > 0 ? modifiers : undefined,
      location: {
        startLine,
        startColumn,
        endLine: startLine,
        endColumn: startColumn + name.length,
      },
    });
  }
  
  // Extract interface declarations
  const interfaceRegex = /interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  while ((match = interfaceRegex.exec(code)) !== null) {
    const name = match[1];
    const beforeMatch = code.substring(0, match.index);
    const startLine = beforeMatch.split("\n").length + 1;
    const lastNewlineIndex = beforeMatch.lastIndexOf("\n");
    const startColumn = match.index - lastNewlineIndex + match[0].indexOf(name) + 1;
    
    symbols.push({
      name,
      kind: "interface",
      location: {
        startLine,
        startColumn,
        endLine: startLine,
        endColumn: startColumn + name.length,
      },
    });
  }
  
  // Extract enum declarations
  const enumRegex = /enum\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  while ((match = enumRegex.exec(code)) !== null) {
    const name = match[1];
    const beforeMatch = code.substring(0, match.index);
    const startLine = beforeMatch.split("\n").length + 1;
    const lastNewlineIndex = beforeMatch.lastIndexOf("\n");
    const startColumn = match.index - lastNewlineIndex + match[0].indexOf(name) + 1;
    
    symbols.push({
      name,
      kind: "enum",
      location: {
        startLine,
        startColumn,
        endLine: startLine,
        endColumn: startColumn + name.length,
      },
    });
  }
  
  return symbols;
}

/**
 * Extract symbols based on language
 */
export async function extractSymbols(
  code: string,
  language: string
): Promise<CodeSymbol[]> {
  const normalizedLanguage = language.toLowerCase();
  
  // Check if language is supported
  const supportedLanguages = ["typescript", "python", "javascript", "java", "go", "rust", "cpp", "c", "ruby", "php"];
  
  if (!supportedLanguages.includes(normalizedLanguage)) {
    // Graceful degradation: return empty array for unsupported languages
    console.warn(`Language '${language}' is not supported. Available languages: ${supportedLanguages.join(", ")}`);
    return [];
  }
  
  // Route to the appropriate extractor
  switch (normalizedLanguage) {
    case "typescript":
    case "javascript":
      return extractSymbolsFromTypeScript(code);
    case "python":
      return extractSymbolsFromPython(code);
    case "java":
      return extractSymbolsFromJava(code);
    default:
      // For other languages, try TypeScript extractor as fallback
      return extractSymbolsFromTypeScript(code);
  }
}

/**
 * Extract symbols from a file at a given path
 */
export async function extractSymbolsFromFile(
  filePath: string,
  language?: string
): Promise<CodeSymbol[]> {
  const fs = await import("fs/promises");
  const pathModule = await import("path");
  
  const absolutePath = pathModule.resolve(filePath);
  
  try {
    const code = await fs.readFile(absolutePath, "utf-8");
    
    // If language is not provided, try to detect from extension
    const detectedLanguage = language || detectLanguageFromPath(filePath);
    
    return extractSymbols(code, detectedLanguage);
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return [];
  }
}

/**
 * Detect language from file path/extension
 */
function detectLanguageFromPath(filePath: string): string {
  const extension = require("path").extname(filePath).toLowerCase();
  
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
 * Check if a language is supported
 */
export function isLanguageSupported(language: string): boolean {
  const normalizedLanguage = language.toLowerCase();
  const supportedLanguages = ["typescript", "python", "javascript", "java", "go", "rust", "cpp", "c", "ruby", "php"];
  
  return supportedLanguages.includes(normalizedLanguage);
}

/**
 * Get information about the parsing mechanism
 */
export function getParserInfo(): ParserInfo {
  return {
    mechanism: "regex-based-spike",
    version: "1.0.0",
    supportedLanguages: [
      "typescript", "python", "javascript", "java", "go", "rust", "cpp", "c", "ruby", "php"
    ],
    fallbackStrategy: "empty-array",
    lastUpdated: new Date().toISOString(),
    note: "This is a spike implementation using regex patterns. Production implementation should use Tree-sitter or repomap.",
  };
}

export interface ParserInfo {
  mechanism: string;
  version: string;
  supportedLanguages: string[];
  fallbackStrategy: string;
  lastUpdated: string;
  note?: string;
}
