import * as assert from "node:assert";
import { test, describe, before, after } from "node:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  extractTargetedContext,
  extractPaginatedTargetedContext,
  formatTargetedContextForPrompt,
  formatPaginatedContextForPrompt,
  getTargetedContextConfig,
  DEFAULT_TARGETED_CONTEXT_CONFIG,
  TargetedContextConfig,
} from "../../src/targeted-context";
import { WorkspaceContext } from "../../src/types";

// Create a temporary test repository
let tempDir: string;
let workspaceContext: WorkspaceContext;

async function setupTestRepo() {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codetour-test-"));
  
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

async function commitFile(
  relativePath: string,
  message: string,
  options: { allowEmpty?: boolean } = {}
) {
  const { execFile } = await import("child_process");
  
  await new Promise((resolve, reject) => {
    execFile("git", ["add", relativePath], { cwd: tempDir }, (error) => {
      if (error) reject(error);
      else resolve(null);
    });
  });
  
  const commitArgs = ["commit", "-m", message];
  if (options.allowEmpty) {
    commitArgs.push("--allow-empty");
  }
  
  await new Promise((resolve, reject) => {
    execFile("git", commitArgs, { cwd: tempDir }, (error) => {
      if (error) reject(error);
      else resolve(null);
    });
  });
}

async function getHeadSha(): Promise<string> {
  const { execFile } = await import("child_process");
  return new Promise((resolve, reject) => {
    execFile("git", ["rev-parse", "HEAD"], { cwd: tempDir }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

async function cleanupTestRepo() {
  if (tempDir) {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

// Test suite for Targeted Context

describe("Targeted Context for Changes Tour", () => {
  before(async () => {
    await setupTestRepo();
  });

  after(async () => {
    await cleanupTestRepo();
  });

  describe("Configuration", () => {
    test("should return default config with enabled=false", () => {
      const config = getTargetedContextConfig();
      
      assert.equal(config.enabled, false, "Default config should have enabled=false");
      assert.equal(config.maxSymbols, DEFAULT_TARGETED_CONTEXT_CONFIG.maxSymbols);
      assert.equal(config.maxDepth, DEFAULT_TARGETED_CONTEXT_CONFIG.maxDepth);
    });

    test("should override default config with provided values", () => {
      const overrides: Partial<TargetedContextConfig> = {
        enabled: true,
        maxSymbols: 500,
      };
      
      const config = getTargetedContextConfig(overrides);
      
      assert.equal(config.enabled, true, "Should override enabled");
      assert.equal(config.maxSymbols, 500, "Should override maxSymbols");
      assert.equal(config.maxDepth, DEFAULT_TARGETED_CONTEXT_CONFIG.maxDepth, "Should keep default maxDepth");
    });
  });

  describe("Context Extraction (Disabled)", () => {
    test("should return empty context when disabled", async () => {
      // Create initial commit
      await createTestFile("src/index.ts", "// Initial content\nexport function hello() {}\n");
      await commitFile("src/index.ts", "Initial commit");
      
      const baseSha = await getHeadSha();
      
      // Modify file
      await createTestFile("src/index.ts", "// Modified content\nexport function hello() { return 'world'; }\n");
      await commitFile("src/index.ts", "Modified");
      
      const headSha = await getHeadSha();
      
      const result = await extractTargetedContext(
        workspaceContext,
        baseSha,
        headSha,
        { enabled: false }
      );
      
      assert.ok(result.success, "Should succeed even when disabled");
      assert.ok(result.context, "Should have context");
      assert.equal(result.context!.enabled, false, "Context should be disabled");
      assert.equal(result.context!.files.length, 0, "Should have no files");
      assert.equal(result.context!.totalSymbols, 0, "Should have no symbols");
      assert.ok(result.warnings.length > 0, "Should have warning about being disabled");
    });
  });

  describe("Context Extraction (Enabled)", () => {
    test("should extract symbols from changed TypeScript files", async () => {
      // Create initial commit
      await createTestFile("src/math.ts", `
        export function add(a: number, b: number): number {
          return a + b;
        }
        
        export function subtract(a: number, b: number): number {
          return a - b;
        }
      `);
      await commitFile("src/math.ts", "Initial commit");
      
      const baseSha = await getHeadSha();
      
      // Modify file
      await createTestFile("src/math.ts", `
        export function add(a: number, b: number): number {
          return a + b;
        }
        
        export function subtract(a: number, b: number): number {
          return a - b;
        }
        
        export function multiply(a: number, b: number): number {
          return a * b;
        }
      `);
      await commitFile("src/math.ts", "Added multiply function");
      
      const headSha = await getHeadSha();
      
      const result = await extractTargetedContext(
        workspaceContext,
        baseSha,
        headSha,
        { enabled: true }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.context, "Should have context");
      assert.equal(result.context!.enabled, true, "Context should be enabled");
      assert.ok(result.context!.files.length > 0, "Should have files");
      
      const mathFile = result.context!.files.find(f => f.filePath.includes("math.ts"));
      assert.ok(mathFile, "Should have math.ts file context");
      assert.ok(mathFile!.symbols.length > 0, "Should have symbols from math.ts");
      
      // Check for function symbols
      const functionSymbols = mathFile!.symbols.filter(s => s.kind === "function");
      assert.ok(functionSymbols.length > 0, "Should have function symbols");
      
      const addFunction = functionSymbols.find(s => s.name === "add");
      assert.ok(addFunction, "Should find 'add' function");
    });

    test("should extract symbols from multiple changed files", async () => {
      // Create initial commit with multiple files
      await createTestFile("src/math.ts", "export function add(a: number, b: number): number { return a + b; }");
      await createTestFile("src/string.ts", "export function concat(a: string, b: string): string { return a + b; }");
      await commitFile(".", "Initial commit with multiple files");
      
      const baseSha = await getHeadSha();
      
      // Modify both files
      await createTestFile("src/math.ts", "export function add(a: number, b: number): number { return a + b; }\nexport function multiply(a: number, b: number): number { return a * b; }");
      await createTestFile("src/string.ts", "export function concat(a: string, b: string): string { return a + b; }\nexport function toUpper(s: string): string { return s.toUpperCase(); }");
      await commitFile(".", "Added functions to both files");
      
      const headSha = await getHeadSha();
      
      const result = await extractTargetedContext(
        workspaceContext,
        baseSha,
        headSha,
        { enabled: true }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.context, "Should have context");
      assert.equal(result.context!.files.length, 2, "Should have 2 files");
      
      const totalSymbols = result.context!.totalSymbols;
      assert.ok(totalSymbols >= 4, `Should have at least 4 symbols (add, multiply, concat, toUpper), got ${totalSymbols}`);
    });

    test("should skip excluded file patterns", async () => {
      // Create initial commit
      await createTestFile("src/main.ts", "export function main() {}");
      await createTestFile("src/main.test.ts", "test('main', () => {});");
      await commitFile(".", "Initial commit");
      
      const baseSha = await getHeadSha();
      
      // Modify both files
      await createTestFile("src/main.ts", "export function main() { console.log('hello'); }");
      await createTestFile("src/main.test.ts", "test('main', () => { expect(true).toBe(true); });");
      await commitFile(".", "Modified files");
      
      const headSha = await getHeadSha();
      
      const result = await extractTargetedContext(
        workspaceContext,
        baseSha,
        headSha,
        {
          enabled: true,
          excludeExtensions: [".test.ts"],
        }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.context, "Should have context");
      
      // Should only have main.ts, not main.test.ts
      const testFile = result.context!.files.find(f => f.filePath.includes("main.test.ts"));
      assert.ok(!testFile, "Should not include test files");
    });

    test("should limit symbols per file", async () => {
      // Create a file with many symbols
      const manySymbolsCode = Array.from({ length: 50 }, (_, i) =>
        `export function func${i}() {}`
      ).join("\n");
      
      await createTestFile("src/many.ts", manySymbolsCode);
      await commitFile("src/many.ts", "Initial commit");
      
      const baseSha = await getHeadSha();
      
      // Modify to add even more
      const moreSymbolsCode = Array.from({ length: 100 }, (_, i) =>
        `export function func${i}() {}`
      ).join("\n");
      await createTestFile("src/many.ts", moreSymbolsCode);
      await commitFile("src/many.ts", "Added more functions");
      
      const headSha = await getHeadSha();
      
      const result = await extractTargetedContext(
        workspaceContext,
        baseSha,
        headSha,
        {
          enabled: true,
          maxSymbols: 10, // Limit to 10 symbols
        }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.context, "Should have context");
      
      const manyFile = result.context!.files.find(f => f.filePath.includes("many.ts"));
      assert.ok(manyFile, "Should have many.ts file");
      assert.ok(manyFile!.symbols.length <= 10, `Should have at most 10 symbols, got ${manyFile!.symbols.length}`);
    });

    test("should handle empty changes gracefully", async () => {
      // Create initial commit
      await createTestFile("src/index.ts", "export function hello() {}");
      await commitFile("src/index.ts", "Initial commit");
      
      const baseSha = await getHeadSha();
      
      // Create empty commit (no changes)
      await commitFile(".", "Empty commit", { allowEmpty: true });
      
      const headSha = await getHeadSha();
      
      const result = await extractTargetedContext(
        workspaceContext,
        baseSha,
        headSha,
        { enabled: true }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.context, "Should have context");
      assert.equal(result.context!.files.length, 0, "Should have no files");
      assert.ok(result.warnings.length > 0, "Should have warning about no changes");
    });

    test("should track token usage when enabled", async () => {
      // Create initial commit
      await createTestFile("src/token.ts", "export function process() {}");
      await commitFile("src/token.ts", "Initial commit");
      
      const baseSha = await getHeadSha();
      
      // Modify file
      await createTestFile("src/token.ts", "export function process() { return 'processed'; }");
      await commitFile("src/token.ts", "Modified");
      
      const headSha = await getHeadSha();
      
      const result = await extractTargetedContext(
        workspaceContext,
        baseSha,
        headSha,
        {
          enabled: true,
          trackCost: true,
        }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.context, "Should have context");
      assert.ok(result.context!.totalTokenUsage, "Should have token usage");
      assert.ok(result.context!.totalTokenUsage.inputTokens >= 0, "Should have non-negative input tokens");
      assert.ok(result.context!.totalTokenUsage.outputTokens >= 0, "Should have non-negative output tokens");
    });
  });

  describe("Context Formatting", () => {
    test("should format context for prompt when enabled", async () => {
      // Create initial commit
      await createTestFile("src/format.ts", "export function format() {}");
      await commitFile("src/format.ts", "Initial commit");
      
      const baseSha = await getHeadSha();
      
      // Modify file
      await createTestFile("src/format.ts", "export function format() { return 'formatted'; }");
      await commitFile("src/format.ts", "Modified");
      
      const headSha = await getHeadSha();
      
      const result = await extractTargetedContext(
        workspaceContext,
        baseSha,
        headSha,
        { enabled: true }
      );
      
      assert.ok(result.context, "Should have context");
      
      const formatted = formatTargetedContextForPrompt(result.context);
      
      assert.ok(formatted, "Should have formatted output");
      assert.ok(formatted.includes("Targeted Context"), "Should include header");
      assert.ok(formatted.includes("symbols"), "Should mention symbols");
    });

    test("should return empty string when context is disabled", () => {
      const disabledContext = {
        enabled: false,
        baseRef: "abc",
        headRef: "def",
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
      };
      
      const formatted = formatTargetedContextForPrompt(disabledContext);
      assert.equal(formatted, "", "Should return empty string when disabled");
    });

    test("should return empty string when no files", () => {
      const emptyContext = {
        enabled: true,
        baseRef: "abc",
        headRef: "def",
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
      };
      
      const formatted = formatTargetedContextForPrompt(emptyContext);
      assert.equal(formatted, "", "Should return empty string when no files");
    });
  });

  describe("Error Handling", () => {
    test("should handle invalid repository gracefully", async () => {
      const invalidContext: WorkspaceContext = {
        root: "/nonexistent/path",
        realRoot: "/nonexistent/path",
      };
      
      const result = await extractTargetedContext(
        invalidContext,
        "invalid",
        "invalid",
        { enabled: true }
      );
      
      assert.ok(!result.success, "Should fail for invalid repository");
      assert.ok(result.error, "Should have error message");
    });
  });

  // Progressive Exploration Tests (Ticket #116)
  describe("Progressive Exploration (Ticket #116)", () => {
    test("should paginate symbols across multiple pages", async () => {
      // Create initial commit
      await createTestFile("src/utils.ts", `
        // Utility functions
        export function func1() {}
        export function func2() {}
        export function func3() {}
        export function func4() {}
        export function func5() {}
        export function func6() {}
        export function func7() {}
        export function func8() {}
        export function func9() {}
        export function func10() {}
      `);
      await commitFile("src/utils.ts", "Initial commit");
      
      const baseSha = await getHeadSha();
      
      // Modify file - add more functions
      await createTestFile("src/utils.ts", `
        // Utility functions
        export function func1() {}
        export function func2() {}
        export function func3() {}
        export function func4() {}
        export function func5() {}
        export function func6() {}
        export function func7() {}
        export function func8() {}
        export function func9() {}
        export function func10() {}
        export function func11() {}
        export function func12() {}
      `);
      await commitFile("src/utils.ts", "Added more functions");
      
      const headSha = await getHeadSha();
      
      // Request page 1 with pageSize of 5
      const result = await extractPaginatedTargetedContext(
        workspaceContext,
        baseSha,
        headSha,
        { page: 1, pageSize: 5 },
        { enabled: true, maxSymbols: 100 }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.paginatedContext, "Should have paginated context");
      assert.equal(result.paginatedContext!.pagination.page, 1, "Should be on page 1");
      assert.equal(result.paginatedContext!.pagination.pageSize, 5, "Page size should be 5");
      
      // Count symbols in the first page
      const page1SymbolCount = result.paginatedContext!.pages.reduce(
        (sum, p) => sum + p.symbols.length,
        0
      );
      
      assert.ok(page1SymbolCount <= 5, `Page 1 should have at most 5 symbols, got ${page1SymbolCount}`);
    });

    test("should return all symbols when no pagination specified", async () => {
      // Create initial commit
      await createTestFile("src/lib.ts", `
        export function helper1() {}
        export function helper2() {}
      `);
      await commitFile("src/lib.ts", "Initial commit");
      
      const baseSha = await getHeadSha();
      
      // Modify file
      await createTestFile("src/lib.ts", `
        export function helper1() {}
        export function helper2() {}
        export function helper3() {}
      `);
      await commitFile("src/lib.ts", "Added helper");
      
      const headSha = await getHeadSha();
      
      const result = await extractPaginatedTargetedContext(
        workspaceContext,
        baseSha,
        headSha,
        {},
        { enabled: true, maxSymbols: 100 }
      );
      
      assert.ok(result.success, "Should succeed");
      assert.ok(result.paginatedContext, "Should have paginated context");
      assert.equal(result.paginatedContext!.pagination.page, 1, "Default page should be 1");
      assert.ok(result.paginatedContext!.totalSymbols > 0, "Should have symbols");
    });

    test("should handle empty context gracefully", async () => {
      // Create initial commit
      await createTestFile("src/empty.ts", "// Empty file");
      await commitFile("src/empty.ts", "Initial commit");
      
      const baseSha = await getHeadSha();
      
      // No changes
      const headSha = baseSha;
      
      const result = await extractPaginatedTargetedContext(
        workspaceContext,
        baseSha,
        headSha,
        { page: 1, pageSize: 10 },
        { enabled: true }
      );
      
      assert.ok(result.success, "Should succeed with no changes");
      // The extractor returns early with only `context` when there are no
      // changed files; `paginatedContext` is optional by contract.
      assert.equal(result.context!.totalSymbols, 0, "Should have 0 symbols");
      assert.equal(
        result.paginatedContext?.pages.length ?? 0,
        0,
        "Should have 0 pages"
      );
    });

    test("formatPaginatedContextForPrompt should format context with pagination info", async () => {
      const paginatedContext: any = {
        enabled: true,
        baseRef: "abc123",
        headRef: "def456",
        pages: [
          {
            filePath: "src/test.ts",
            symbols: [
              { kind: "function", name: "test1", location: { startLine: 1, endLine: 1 } },
              { kind: "function", name: "test2", location: { startLine: 2, endLine: 2 } },
            ],
            totalFileSymbols: 2,
          },
        ],
        totalSymbols: 2,
        pagination: {
          page: 1,
          pageSize: 10,
          totalItems: 2,
          totalPages: 1,
          hasMore: false,
        },
      };
      
      const formatted = formatPaginatedContextForPrompt(paginatedContext);
      
      assert.ok(formatted.includes("Page 1/1"), "Should include page info");
      assert.ok(formatted.includes("2 total symbols"), "Should include total symbols");
      assert.ok(formatted.includes("test1"), "Should include symbol names");
      assert.ok(formatted.includes("test2"), "Should include symbol names");
    });
  });
});
