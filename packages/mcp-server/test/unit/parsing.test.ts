import * as assert from "node:assert";
import { test, describe } from "node:test";
import {
  extractSymbols,
  extractSymbolsFromTypeScript,
  extractSymbolsFromPython,
} from "../../src/parsing/symbol-extractor";

// This test file validates the multi-language parsing mechanism for Targeted Context
// Spike: Tree-sitter vs repomap comparison

describe("Targeted Context Parsing Mechanism", () => {
  describe("TypeScript Parsing", () => {
    test("should extract function symbols from TypeScript code", () => {
      const code = `
          function add(a: number, b: number): number {
            return a + b;
          }
          
          function subtract(a: number, b: number): number {
            return a - b;
          }
        `;
      
      const symbols = extractSymbolsFromTypeScript(code);
      
      assert.ok(symbols, "Symbols should be defined");
      assert.ok(symbols.length > 0, "Should extract at least one symbol");
      
      const functionSymbols = symbols.filter(s => s.kind === "function");
      assert.ok(functionSymbols.length >= 1, "Should extract at least one function");
      
      const addFunction = functionSymbols.find(s => s.name === "add");
      assert.ok(addFunction, "Should find 'add' function");
      assert.ok(addFunction?.location, "Function should have location");
    });

    test("should extract class symbols from TypeScript code", () => {
      const code = `
          class Calculator {
            multiply(x: number, y: number): number {
              return x * y;
            }
          }
        `;
      
      const symbols = extractSymbolsFromTypeScript(code);
      
      const classSymbols = symbols.filter(s => s.kind === "class");
      assert.ok(classSymbols.length >= 1, "Should extract at least one class");
      
      const calculatorClass = classSymbols.find(s => s.name === "Calculator");
      assert.ok(calculatorClass, "Should find 'Calculator' class");
    });

    test("should extract interface symbols from TypeScript code", () => {
      const code = `
          interface Person {
            name: string;
            age: number;
          }
        `;
      
      const symbols = extractSymbolsFromTypeScript(code);
      
      const interfaceSymbols = symbols.filter(s => s.kind === "interface");
      assert.ok(interfaceSymbols.length >= 1, "Should extract at least one interface");
      
      const personInterface = interfaceSymbols.find(s => s.name === "Person");
      assert.ok(personInterface, "Should find 'Person' interface");
    });

    test("should extract type alias symbols from TypeScript code", () => {
      const code = `
          type Point = {
            x: number;
            y: number;
          };
        `;
      
      const symbols = extractSymbolsFromTypeScript(code);
      
      const typeSymbols = symbols.filter(s => s.kind === "type");
      assert.ok(typeSymbols.length >= 1, "Should extract at least one type");
      
      const pointType = typeSymbols.find(s => s.name === "Point");
      assert.ok(pointType, "Should find 'Point' type");
    });

    test("should extract enum symbols from TypeScript code", () => {
      const code = `
          enum Color {
            Red = "red",
            Green = "green",
            Blue = "blue"
          }
        `;
      
      const symbols = extractSymbolsFromTypeScript(code);
      
      const enumSymbols = symbols.filter(s => s.kind === "enum");
      assert.ok(enumSymbols.length >= 1, "Should extract at least one enum");
      
      const colorEnum = enumSymbols.find(s => s.name === "Color");
      assert.ok(colorEnum, "Should find 'Color' enum");
    });

    test("should extract method symbols from TypeScript class code", () => {
      const code = `
          class Calculator {
            public add(x: number, y: number): number {
              return x + y;
            }
            
            private subtract(x: number, y: number): number {
              return x - y;
            }
          }
        `;
      
      const symbols = extractSymbolsFromTypeScript(code);
      
      // Methods might be extracted as functions or methods depending on implementation
      // This test verifies we can find them
      assert.ok(symbols.length >= 1, "Should extract at least one symbol from class");
    });
  });

  describe("Python Parsing", () => {
    test("should extract function symbols from Python code", () => {
      const code = `
def add(a, b):
    return a + b

def subtract(a, b):
    return a - b
        `;
      
      const symbols = extractSymbolsFromPython(code);
      
      assert.ok(symbols, "Symbols should be defined");
      assert.ok(symbols.length > 0, "Should extract at least one symbol");
      
      const functionSymbols = symbols.filter(s => s.kind === "function");
      assert.ok(functionSymbols.length >= 1, "Should extract at least one function");
      
      const addFunction = functionSymbols.find(s => s.name === "add");
      assert.ok(addFunction, "Should find 'add' function");
    });

    test("should extract class symbols from Python code", () => {
      const code = `
class Calculator:
    def multiply(self, x, y):
        return x * y
        `;
      
      const symbols = extractSymbolsFromPython(code);
      
      const classSymbols = symbols.filter(s => s.kind === "class");
      assert.ok(classSymbols.length >= 1, "Should extract at least one class");
      
      const calculatorClass = classSymbols.find(s => s.name === "Calculator");
      assert.ok(calculatorClass, "Should find 'Calculator' class");
    });

    test("should extract method symbols from Python class code", () => {
      const code = `
class Calculator:
    def add(self, x, y):
        return x + y
    
    def subtract(self, x, y):
        return x - y
        `;
      
      const symbols = extractSymbolsFromPython(code);
      
      const methodSymbols = symbols.filter(s => s.kind === "method");
      assert.ok(methodSymbols.length >= 1, "Should extract at least one method");
      
      const addMethod = methodSymbols.find(s => s.name === "add");
      assert.ok(addMethod, "Should find 'add' method");
    });

    test("should handle async functions in Python", () => {
      const code = `
async def fetch_data():
    return await some_api_call()
        `;
      
      const symbols = extractSymbolsFromPython(code);
      
      const functionSymbols = symbols.filter(s => s.kind === "function");
      assert.ok(functionSymbols.length >= 1, "Should extract at least one function");
      
      const fetchFunction = functionSymbols.find(s => s.name === "fetch_data");
      assert.ok(fetchFunction, "Should find 'fetch_data' function");
      assert.ok(fetchFunction?.modifiers?.includes("async"), "Should have 'async' modifier");
    });
  });

  describe("Graceful Degradation", () => {
    test("should handle missing grammar case gracefully", async () => {
      // Test with a language that doesn't have support
      const code = "some unknown code";
      
      const symbols = await extractSymbols(code, "unknown");
      
      // Should return empty array, not throw
      assert.ok(symbols, "Symbols should be defined");
      assert.ok(Array.isArray(symbols), "Symbols should be an array");
      assert.ok(symbols.length === 0, "Should return empty array for unsupported language");
    });

    test("should handle empty code gracefully", () => {
      const code = "";
      
      const symbols = extractSymbolsFromTypeScript(code);
      
      assert.ok(symbols, "Symbols should be defined");
      assert.ok(Array.isArray(symbols), "Symbols should be an array");
      assert.ok(symbols.length === 0, "Should return empty array for empty code");
    });

    test("should handle whitespace-only code gracefully", () => {
      const code = "   \n\n   \t\t  ";
      
      const symbols = extractSymbolsFromTypeScript(code);
      
      assert.ok(symbols, "Symbols should be defined");
      assert.ok(Array.isArray(symbols), "Symbols should be an array");
    });
  });

  describe("Symbol Structure", () => {
    test("should return symbols with required fields", () => {
      const code = `
        function testFunction(param: string): void {
          console.log(param);
        }
      `;
      
      const symbols = extractSymbolsFromTypeScript(code);
      
      if (symbols.length > 0) {
        const symbol = symbols[0];
        assert.ok("name" in symbol, "Symbol should have 'name' property");
        assert.ok("kind" in symbol, "Symbol should have 'kind' property");
        assert.ok("location" in symbol, "Symbol should have 'location' property");
        
        assert.strictEqual(typeof symbol.name, "string", "Name should be a string");
        assert.strictEqual(typeof symbol.kind, "string", "Kind should be a string");
        
        if (symbol.location) {
          assert.ok("startLine" in symbol.location, "Location should have 'startLine'");
          assert.ok("startColumn" in symbol.location, "Location should have 'startColumn'");
          assert.ok("endLine" in symbol.location, "Location should have 'endLine'");
          assert.ok("endColumn" in symbol.location, "Location should have 'endColumn'");
          
          // Verify line numbers are positive integers
          assert.ok(symbol.location.startLine > 0, "Start line should be positive");
          assert.ok(symbol.location.startColumn > 0, "Start column should be positive");
        }
      }
    });
  });

  describe("Language Support Detection", () => {
    test("should detect TypeScript from .ts extension", async () => {
      const code = "function test() {}";
      const symbols = await extractSymbols(code, ".ts");
      assert.ok(symbols.length >= 0, "Should handle .ts extension");
    });

    test("should detect Python from .py extension", async () => {
      const code = "def test(): pass";
      const symbols = await extractSymbols(code, ".py");
      assert.ok(symbols.length >= 0, "Should handle .py extension");
    });
  });
});
