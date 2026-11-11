/**
 * Demonstration of Symbol Extraction for Targeted Context
 * 
 * This file demonstrates the parsing mechanism working on actual code
 * from this monorepo (TypeScript) and example Python code.
 * 
 * Run with: npx ts-node src/parsing/demo.ts
 */

import {
  extractSymbolsFromTypeScript,
  extractSymbolsFromPython,
  extractSymbols,
  getParserInfo,
} from "./symbol-extractor";

// Sample TypeScript code from this monorepo
const typescriptCode = `
// From packages/mcp-server/src/server.ts
export function createServer(workspaceRoot: string): McpServer {
  const ctx = createContext(workspaceRoot);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } }
  );
  return server;
}

interface TourFile {
  $schema: string;
  title: string;
  description?: string;
  steps: TourStep[];
}

class ValidationError extends Error {
  constructor(message: string, public readonly issues: Issue[]) {
    super(message);
    this.name = "ValidationError";
  }
}
`;

// Sample Python code
const pythonCode = `
# Example Python module
def calculate_total(items: list[float]) -> float:
    """Calculate the total of all items in the list."""
    return sum(items)

class ShoppingCart:
    """A simple shopping cart implementation."""
    
    def __init__(self):
        self.items = []
    
    def add_item(self, item: str, price: float) -> None:
        """Add an item to the cart."""
        self.items.append((item, price))
    
    def get_total(self) -> float:
        """Get the total price of all items."""
        return sum(price for _, price in self.items)

async def fetch_prices() -> list[float]:
    """Fetch prices from an API."""
    return [10.0, 20.0, 30.0]
`;

console.log("=".repeat(80));
console.log("TARGETED CONTEXT: Symbol Extraction Demonstration");
console.log("=".repeat(80));
console.log();

// Show parser info
const parserInfo = getParserInfo();
console.log("Parser Information:");
console.log(`  Mechanism: ${parserInfo.mechanism}`);
console.log(`  Version: ${parserInfo.version}`);
console.log(`  Supported Languages: ${parserInfo.supportedLanguages.join(", ")}`);
console.log(`  Fallback Strategy: ${parserInfo.fallbackStrategy}`);
console.log();

// Extract TypeScript symbols
console.log("-".repeat(80));
console.log("TypeScript Symbol Extraction");
console.log("-".repeat(80));
const tsSymbols = extractSymbolsFromTypeScript(typescriptCode);
console.log(`Extracted ${tsSymbols.length} symbols from TypeScript code:\n`);

const tsSymbolsByKind: Record<string, any[]> = {};
tsSymbols.forEach(symbol => {
  if (!tsSymbolsByKind[symbol.kind]) {
    tsSymbolsByKind[symbol.kind] = [];
  }
  tsSymbolsByKind[symbol.kind].push(symbol);
});

Object.entries(tsSymbolsByKind).forEach(([kind, symbols]) => {
  console.log(`\n${kind.toUpperCase()} (${symbols.length}):`);
  symbols.forEach(symbol => {
    console.log(`  - ${symbol.name} at line ${symbol.location?.startLine}`);
  });
});

console.log();

// Extract Python symbols
console.log("-".repeat(80));
console.log("Python Symbol Extraction");
console.log("-".repeat(80));
const pySymbols = extractSymbolsFromPython(pythonCode);
console.log(`Extracted ${pySymbols.length} symbols from Python code:\n`);

const pySymbolsByKind: Record<string, any[]> = {};
pySymbols.forEach(symbol => {
  if (!pySymbolsByKind[symbol.kind]) {
    pySymbolsByKind[symbol.kind] = [];
  }
  pySymbolsByKind[symbol.kind].push(symbol);
});

Object.entries(pySymbolsByKind).forEach(([kind, symbols]) => {
  console.log(`\n${kind.toUpperCase()} (${symbols.length}):`);
  symbols.forEach(symbol => {
    const modifiers = symbol.modifiers ? ` [${symbol.modifiers.join(", ")}]` : "";
    console.log(`  - ${symbol.name}${modifiers} at line ${symbol.location?.startLine}`);
  });
});

console.log();

// Test graceful degradation
console.log("-".repeat(80));
console.log("Graceful Degradation Test");
console.log("-".repeat(80));

async function testGracefulDegradation() {
  // Test with unsupported language
  const unsupportedSymbols = await extractSymbols("function test() {}", "unsupported");
  console.log(`Unsupported language: ${unsupportedSymbols.length} symbols (expected: 0)`);
  
  // Test with empty code
  const emptySymbols = await extractSymbols("", "typescript");
  console.log(`Empty code: ${emptySymbols.length} symbols (expected: 0)`);
  
  // Test with null/undefined
  const nullSymbols = await extractSymbols("function test() {}", "unknown");
  console.log(`Unknown language: ${nullSymbols.length} symbols (expected: 0)`);
}

testGracefulDegradation().then(() => {
  console.log();
  console.log("=".repeat(80));
  console.log("Demonstration Complete!");
  console.log("=".repeat(80));
  console.log();
  console.log("Recommendation: Use Tree-sitter with WASM for production.");
  console.log("See TREE_SITTER_VS_REPOMAP.md for detailed comparison.");
});
