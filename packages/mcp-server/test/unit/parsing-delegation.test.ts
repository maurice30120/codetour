import * as assert from "node:assert";
import { test, describe } from "node:test";
import * as fs from "fs";
import * as path from "path";
import { extractSymbols, isLanguageSupported } from "../../src/parsing/symbol-extractor";

// Ticket #155 (spec #149, ADR 0034): the #114 regex spike is replaced for
// TypeScript by the tree-sitter pack of codetour-relation-graph —
// `extractSymbols(code, language)` delegates to `extractTypeScriptSymbols`
// while preserving its own contract: `Promise<CodeSymbol[]>`, 1-based
// locations with line AND column fields, the historical kind vocabulary.

describe("extractSymbols delegates TypeScript to the relation-graph pack (#155)", () => {
  test("classes, methods, functions, enums and type aliases keep the CodeSymbol contract", async () => {
    const code = [
      "export enum Color {",
      "  Red = 'red',",
      "  Blue = 'blue'",
      "}",
      "export type Point = { x: number; y: number };",
      "export class Calculator {",
      "  add(x: number, y: number): number {",
      "    return x + y;",
      "  }",
      "}",
      "export function main(): void {",
      "  const calc = new Calculator();",
      "  calc.add(1, 2);",
      "}",
    ].join("\n");

    const symbols = await extractSymbols(code, "typescript");
    assert.ok(Array.isArray(symbols) && symbols.length > 0);

    for (const symbol of symbols) {
      // The historical shape, field by field.
      assert.equal(typeof symbol.name, "string");
      assert.ok(symbol.name.length > 0);
      assert.ok(
        ["function", "class", "interface", "method", "variable", "type", "enum", "namespace", "module"].includes(
          symbol.kind
        ),
        `historical kind vocabulary: ${symbol.kind}`
      );
      assert.ok(symbol.location, "every symbol carries a location");
      assert.ok(symbol.location!.startLine >= 1, "1-based startLine");
      assert.ok(symbol.location!.startColumn >= 1, "1-based startColumn");
      assert.ok(symbol.location!.endLine >= symbol.location!.startLine, "endLine >= startLine");
      assert.ok(symbol.location!.endColumn >= 1, "1-based endColumn");
    }

    const color = symbols.find(s => s.name === "Color");
    assert.ok(color && color.kind === "enum", "enums survive the delegation (the spike surfaced them)");

    const point = symbols.find(s => s.name === "Point");
    assert.ok(point && point.kind === "type", "type aliases map to kind \"type\"");

    const calc = symbols.find(s => s.name === "Calculator");
    assert.ok(calc && calc.kind === "class");

    const add = symbols.find(s => s.name === "add");
    assert.ok(add, "the method is extracted");
    assert.equal(add!.kind, "method");
    assert.equal(add!.parentName, "Calculator", "members keep their parent type");
    assert.equal(add!.location!.startLine, 7);

    const main = symbols.find(s => s.name === "main");
    assert.ok(main && main.kind === "function");
  });

  test("javascript routes through the TypeScript grammar as before", async () => {
    const symbols = await extractSymbols("function greet() { return 'hi'; }", "javascript");
    const greet = symbols.find(s => s.name === "greet");
    assert.ok(greet && greet.kind === "function");
  });

  test("unsupported languages still degrade to an empty array (contract unchanged)", async () => {
    const symbols = await extractSymbols("whatever", "cobol");
    assert.deepEqual(symbols, []);
    assert.equal(isLanguageSupported("cobol"), false);
    assert.equal(isLanguageSupported("typescript"), true);
  });

  test("non-regression on this repository: extractSymbols finds the server seam in server.ts", async () => {
    // dist/test/unit -> packages/mcp-server, then src/server.ts.
    const serverPath = path.resolve(__dirname, "..", "..", "..", "src", "server.ts");
    const code = fs.readFileSync(serverPath, "utf8");
    const symbols = await extractSymbols(code, "typescript");
    const createServer = symbols.find(s => s.name === "createServer" && s.kind === "function");
    assert.ok(createServer, "createServer is still extracted from src/server.ts");
    assert.ok(createServer!.location!.startLine > 500, "its 1-based line points into the file");
    // The tree-sitter pass sees far more declarations than a spot check: the
    // contract is about shape and positions, not an exact symbol count.
    assert.ok(symbols.length > 20, `a real file yields many symbols (${symbols.length})`);
  });
});
