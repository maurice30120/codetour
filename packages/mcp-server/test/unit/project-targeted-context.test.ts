import * as assert from "node:assert";
import { test, describe, before, after } from "node:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  extractProjectTargetedContext,
  formatProjectTargetedContextForPrompt,
  getProjectTargetedContextConfig,
  DEFAULT_PROJECT_TARGETED_CONTEXT_CONFIG,
  ProjectTargetedContextConfig,
} from "../../src/targeted-context/project-context-extractor";
import { WorkspaceContext } from "../../src/types";

// Create a temporary test workspace
let tempDir: string;
let workspaceContext: WorkspaceContext;

async function setupTestWorkspace() {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codetour-project-test-"));
  
  // Initialize a git repo
  const { execFile } = await import("child_process");
  await new Promise((resolve, reject) => {
    execFile("git", ["init"], { cwd: tempDir }, (error) => {
      if (error) reject(error);
      else resolve(null);
    });
  });
  
  // Configure git
  await new Promise((resolve, reject) => {
    execFile("git", ["config", "user.email", "test@example.com"], { cwd: tempDir }, (error) => {
      if (error) reject(error);
      else resolve(null);
    });
  });
  
  await new Promise((resolve, reject) => {
    execFile("git", ["config", "user.name", "Test User"], { cwd: tempDir }, (error) => {
      if (error) reject(error);
      else resolve(null);
    });
  });
  
  workspaceContext = {
    root: tempDir,
    realRoot: tempDir,
  };
}

async function createTestFile(relativePath: string, content: string) {
  const fullPath = path.join(tempDir, relativePath);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, content);
}

async function cleanupTestWorkspace() {
  if (tempDir) {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

// Test suite for Project Tour Targeted Context

describe("Targeted Context for Project Tour", () => {
  before(async () => {
    await setupTestWorkspace();
  });

  after(async () => {
    await cleanupTestWorkspace();
  });

  describe("Configuration", () => {
    test("should return default config with enabled=false", () => {
      const config = getProjectTargetedContextConfig();
      
      assert.equal(config.enabled, false, "Default config should have enabled=false");
      assert.equal(config.maxSymbolsPerFile, DEFAULT_PROJECT_TARGETED_CONTEXT_CONFIG.maxSymbolsPerFile);
      assert.equal(config.maxFiles, DEFAULT_PROJECT_TARGETED_CONTEXT_CONFIG.maxFiles);
      assert.equal(config.maxDepth, DEFAULT_PROJECT_TARGETED_CONTEXT_CONFIG.maxDepth);
    });

    test("should override default config with provided values", () => {
      const overrides: Partial<ProjectTargetedContextConfig> = {
        enabled: true,
        maxSymbolsPerFile: 100,
        maxFiles: 20,
      };
      
      const config = getProjectTargetedContextConfig(overrides);
      
      assert.equal(config.enabled, true, "Should override enabled");
      assert.equal(config.maxSymbolsPerFile, 100, "Should override maxSymbolsPerFile");
      assert.equal(config.maxFiles, 20, "Should override maxFiles");
      assert.equal(config.maxDepth, DEFAULT_PROJECT_TARGETED_CONTEXT_CONFIG.maxDepth, "Should keep default maxDepth");
    });
  });

  describe("Context Extraction (Disabled)", () => {
    test("should return empty context when disabled", async () => {
      // Create some test files
      await createTestFile("src/index.ts", "export function hello() { return 'world'; }");
      await createTestFile("src/math.ts", "export function add(a: number, b: number): number { return a + b; }");
      
      const result = await extractProjectTargetedContext(
        workspaceContext,
        { enabled: false }
      );
      
      assert.ok(result.success, "Should succeed even when disabled");
      assert.ok(result.context, "Should have context");
      assert.equal(result.context!.enabled, false, "Context should be disabled");
      assert.equal(result.context!.files.length, 0, "Should have no files");
      assert.equal(result.context!.totalSymbols, 0, "Should have no symbols");
      assert.equal(result.context!.totalFiles, 0, "Should have no files scanned");
      assert.ok(result.warnings.length > 0, "Should have warning about being disabled");
    });
  });

  describe("Context Extraction (Enabled)", () => {
    test("should extract symbols from TypeScript files", async () => {
      // Create test structure
      await createTestFile("src/utils.ts", `
        export function formatDate(date: Date): string {
          return date.toISOString();
        }
        
        export class DateFormatter {
          static format(date: Date): string {
            return date.toLocaleDateString();
          }
        }
        
        export interface DateOptions {
          locale: string;
          format: string;
        }
      `);
      
      const result = await extractProjectTargetedContext(
        workspaceContext,
        {
          enabled: true,
          rootDirectories: ["src"],
        }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.context, "Should have context");
      assert.equal(result.context!.enabled, true, "Context should be enabled");
      assert.ok(result.context!.files.length > 0, "Should have files");
      
      const utilsFile = result.context!.files.find(f => f.filePath.includes("utils.ts"));
      assert.ok(utilsFile, "Should have utils.ts file context");
      assert.ok(utilsFile!.symbols.length > 0, "Should have symbols from utils.ts");
      
      // Check for various symbol kinds
      const functionSymbols = utilsFile!.symbols.filter(s => s.kind === "function");
      const classSymbols = utilsFile!.symbols.filter(s => s.kind === "class");
      const interfaceSymbols = utilsFile!.symbols.filter(s => s.kind === "interface");
      
      assert.ok(functionSymbols.length > 0, "Should have function symbols");
      assert.ok(classSymbols.length > 0, "Should have class symbols");
      assert.ok(interfaceSymbols.length > 0, "Should have interface symbols");
    });

    test("should extract symbols from multiple directories", async () => {
      // Create files in multiple directories
      await createTestFile("src/math.ts", "export function add(a: number, b: number): number { return a + b; }");
      await createTestFile("src/string.ts", "export function concat(a: string, b: string): string { return a + b; }");
      await createTestFile("lib/utils.ts", "export function helper(): void {}");
      
      const result = await extractProjectTargetedContext(
        workspaceContext,
        {
          enabled: true,
          rootDirectories: ["src", "lib"],
        }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.context, "Should have context");
      assert.ok(result.context!.files.length >= 3, `Should have at least 3 files, got ${result.context!.files.length}`);
      
      const totalSymbols = result.context!.totalSymbols;
      assert.ok(totalSymbols >= 3, `Should have at least 3 symbols, got ${totalSymbols}`);
    });

    test("should skip excluded file patterns", async () => {
      // Create test files
      await createTestFile("src/main.ts", "export function main() {}");
      await createTestFile("src/main.test.ts", "test('main', () => {});");
      await createTestFile("src/main.spec.ts", "describe('main', () => {});");
      
      const result = await extractProjectTargetedContext(
        workspaceContext,
        {
          enabled: true,
          rootDirectories: ["src"],
          excludeExtensions: [".test.ts", ".spec.ts"],
        }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.context, "Should have context");
      
      // Should only have main.ts, not test files
      const testFiles = result.context!.files.filter(f => 
        f.filePath.includes(".test.ts") || f.filePath.includes(".spec.ts")
      );
      assert.equal(testFiles.length, 0, "Should not include test files");
      
      const mainFile = result.context!.files.find(f => f.filePath.includes("main.ts") && !f.filePath.includes(".test") && !f.filePath.includes(".spec"));
      assert.ok(mainFile, "Should have main.ts file");
    });

    test("should skip node_modules by default", async () => {
      // Create a node_modules directory with files
      await createTestFile("node_modules/lodash/index.js", "export function debounce() {}");
      await createTestFile("src/index.ts", "export function hello() {}");
      
      const result = await extractProjectTargetedContext(
        workspaceContext,
        {
          enabled: true,
          rootDirectories: [], // Scan entire workspace
        }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.context, "Should have context");
      
      // Should not include node_modules files
      const nodeModulesFiles = result.context!.files.filter(f => 
        f.filePath.includes("node_modules")
      );
      assert.equal(nodeModulesFiles.length, 0, "Should not include node_modules files by default");
    });

    test("should limit symbols per file", async () => {
      // Create a file with many symbols
      const manySymbolsCode = Array.from({ length: 100 }, (_, i) =>
        `export function func${i}() {}`
      ).join("\n");
      
      await createTestFile("src/many.ts", manySymbolsCode);
      
      const result = await extractProjectTargetedContext(
        workspaceContext,
        {
          enabled: true,
          rootDirectories: ["src"],
          maxSymbolsPerFile: 10, // Limit to 10 symbols
        }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.context, "Should have context");
      
      const manyFile = result.context!.files.find(f => f.filePath.includes("many.ts"));
      assert.ok(manyFile, "Should have many.ts file");
      assert.ok(manyFile!.symbols.length <= 10, `Should have at most 10 symbols, got ${manyFile!.symbols.length}`);
    });

    test("should limit total files", async () => {
      // Create many files
      for (let i = 0; i < 20; i++) {
        await createTestFile(`src/file${i}.ts`, `export function func${i}() {}`);
      }
      
      const result = await extractProjectTargetedContext(
        workspaceContext,
        {
          enabled: true,
          rootDirectories: ["src"],
          maxFiles: 5, // Limit to 5 files
        }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.context, "Should have context");
      
      assert.ok(result.context!.files.length <= 5, `Should have at most 5 files, got ${result.context!.files.length}`);
    });

    test("should detect multiple languages", async () => {
      // Create files in different languages
      await createTestFile("src/index.ts", "export function hello(): string { return 'world'; }");
      await createTestFile("src/main.py", "def main():\n    print('hello')");
      await createTestFile("lib/Util.java", "public class Util { public static void helper() {} }");
      
      const result = await extractProjectTargetedContext(
        workspaceContext,
        {
          enabled: true,
          rootDirectories: ["src", "lib"],
        }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.context, "Should have context");
      
      const languages = result.context!.languages;
      assert.ok(languages.length >= 2, `Should detect multiple languages, got: ${languages.join(", ")}`);
    });

    test("should track token usage when enabled", async () => {
      // Create test files
      await createTestFile("src/token.ts", "export function process() { return 'processed'; }");
      
      const result = await extractProjectTargetedContext(
        workspaceContext,
        {
          enabled: true,
          rootDirectories: ["src"],
          trackCost: true,
        }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.context, "Should have context");
      assert.ok(result.context!.totalTokenUsage, "Should have token usage");
      assert.ok(result.context!.totalTokenUsage.inputTokens >= 0, "Should have non-negative input tokens");
      assert.ok(result.context!.totalTokenUsage.outputTokens >= 0, "Should have non-negative output tokens");
    });

    test("should generate summary statistics", async () => {
      // Create test files
      await createTestFile("src/math.ts", "export function add(a: number, b: number): number { return a + b; }");
      await createTestFile("src/string.ts", "export function concat(a: string, b: string): string { return a + b; }");
      
      const result = await extractProjectTargetedContext(
        workspaceContext,
        {
          enabled: true,
          rootDirectories: ["src"],
        }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.context, "Should have context");
      
      const summary = result.context!.summary;
      assert.ok(summary.byLanguage, "Should have byLanguage summary");
      assert.ok(summary.largestFiles, "Should have largestFiles summary");
      assert.ok(summary.mostSymbolicFiles, "Should have mostSymbolicFiles summary");
    });

    test("should handle empty workspace gracefully", async () => {
      // Create an empty directory
      await fs.promises.mkdir(path.join(tempDir, "empty"), { recursive: true });
      
      const result = await extractProjectTargetedContext(
        workspaceContext,
        {
          enabled: true,
          rootDirectories: ["empty"],
        }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.context, "Should have context");
      assert.equal(result.context!.files.length, 0, "Should have no files");
      assert.ok(result.warnings.length > 0, "Should have warning about no files");
    });
  });

  describe("Context Formatting", () => {
    test("should format context for prompt when enabled", async () => {
      // Create test files
      await createTestFile("src/format.ts", "export function format() { return 'formatted'; }");
      
      const result = await extractProjectTargetedContext(
        workspaceContext,
        {
          enabled: true,
          rootDirectories: ["src"],
        }
      );
      
      assert.ok(result.context, "Should have context");
      
      const formatted = formatProjectTargetedContextForPrompt(result.context);
      
      assert.ok(formatted, "Should have formatted output");
      assert.ok(formatted.includes("Targeted Context"), "Should include header");
      assert.ok(formatted.includes("symbols"), "Should mention symbols");
      assert.ok(formatted.includes("Languages"), "Should include languages section");
    });

    test("should return empty string when context is disabled", () => {
      const disabledContext = {
        enabled: false,
        workspaceRoot: "/test",
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
      };
      
      const formatted = formatProjectTargetedContextForPrompt(disabledContext);
      assert.equal(formatted, "", "Should return empty string when disabled");
    });

    test("should return empty string when no files", () => {
      const emptyContext = {
        enabled: true,
        workspaceRoot: "/test",
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
      };
      
      const formatted = formatProjectTargetedContextForPrompt(emptyContext);
      assert.equal(formatted, "", "Should return empty string when no files");
    });
  });

  describe("Error Handling", () => {
    test("should handle invalid workspace gracefully", async () => {
      const invalidContext: WorkspaceContext = {
        root: "/nonexistent/path",
        realRoot: "/nonexistent/path",
      };
      
      const result = await extractProjectTargetedContext(
        invalidContext,
        { enabled: true }
      );
      
      // Should still succeed but with empty results or warnings
      assert.ok(result.success, "Should handle invalid workspace");
    });
  });
});
