import * as assert from "node:assert";
import { test } from "node:test";
import { extractTypeScriptSymbols } from "../src/index";

// The #155 contract seam: codetour-mcp's `extractSymbols(code, language)`
// delegates to `extractTypeScriptSymbols` and maps the result onto the
// historical `CodeSymbol` shape, whose `location` carries 1-based line AND
// column fields. These tests pin the ExtractedSymbol fields that mapping
// relies on: enums (the #114 regex spike surfaced them) and columns.

test("extractTypeScriptSymbols surfaces enum declarations (the #114 contract)", async () => {
  const symbols = await extractTypeScriptSymbols({
    path: "colors.ts",
    content: 'enum Color {\n  Red = "red",\n  Blue = "blue"\n}\n'
  });
  const enums = symbols.filter(s => s.kind === "enum");
  assert.equal(enums.length, 1);
  assert.equal(enums[0].name, "Color");
  assert.equal(enums[0].startLine, 1);
});

test("extractTypeScriptSymbols reports 1-based start/end columns", async () => {
  const symbols = await extractTypeScriptSymbols({
    path: "fn.ts",
    content: "export function add(a: number, b: number): number {\n  return a + b;\n}\n"
  });
  const add = symbols.find(s => s.name === "add" && s.kind === "function");
  assert.ok(add, "expected the add function");
  assert.equal(add.startLine, 1);
  // "export function add..." — the declaration starts at column 8 (1-based)
  // and ends after the closing "}" on line 3, i.e. column 2 (1-based, past-end).
  assert.equal(add.startColumn, 8);
  assert.equal(add.endLine, 3);
  assert.equal(add.endColumn, 2);
});
