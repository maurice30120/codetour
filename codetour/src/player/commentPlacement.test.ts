import { test } from "node:test";
import * as assert from "node:assert";
import { getCommentLineAbove } from "./commentPlacement";

function document(lines: string[], languageId = "csharp") {
  return { languageId, lineCount: lines.length, lineAt: (line: number) => ({ text: lines[line] }) };
}

test("places the widget after line 31, before the method's attribute at line 32", () => {
  const lines = Array.from({ length: 34 }, () => "");
  lines[29] = "    => Ok(await service.GetDeviceModelsAsync());";
  lines[31] = '    [HttpGet("attribut/{attributName}")]';
  lines[32] = "    public async Task<IActionResult> GetCustomAttribute(string attributName)";
  assert.equal(getCommentLineAbove(32, document(lines)) + 1, 31);
});

test("keeps consecutive C# attributes together above the method", () => {
  const source = document(["", "[Authorize]", '[HttpGet("items")] // Route', "public IActionResult Get() => Ok();"]);
  assert.equal(getCommentLineAbove(3, source), 0);
});

test("ordinary anchors and selection starts place the widget on the preceding line", () => {
  assert.equal(getCommentLineAbove(2, document(["class Example {", "", "void Run() {}"])), 1);
  assert.equal(getCommentLineAbove(2, document(["intro", "[value]", "function run() {}"], "javascript")), 1);
});

test("top-of-file anchors and out-of-bounds anchors stay within the document", () => {
  const source = document(["first", "second", "third"]);
  assert.equal(getCommentLineAbove(0, source), 0);
  assert.equal(getCommentLineAbove(-1, source), 0);
  assert.equal(getCommentLineAbove(99, source), 1);
});
