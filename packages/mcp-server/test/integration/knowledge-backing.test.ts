import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { callTool, rmrf, tempDir, withServer, writeFile } from "../helpers/test-utils";

// The insufficient backing signal is advisory and recomputed on the resulting
// evidence of a write, never replayed from the historical contract (spec #232,
// ticket #255). A rewrite can therefore make the warning disappear as well as
// appear; only the appearance was covered by the creation tests.
const KNOWLEDGE_READ = "knowledge_read";
const KNOWLEDGE_SAVE = "knowledge_save";

const catalogueDirectory = (root: string): string =>
  path.join(root, ".tours", ".memory", "knowledge");

interface Warning {
  name: string;
  code: string;
  distinctEvidencePaths?: number;
}

function warningsOf(response: { structured: Record<string, unknown> }): Warning[] {
  return (response.structured.warnings ?? []) as Warning[];
}

test("knowledge_save replace recomputes the insufficient_backing warning from the resulting evidence", async () => {
  const root = tempDir("codetour-knowledge-backing-replace-");
  try {
    writeFile(root, "src/main.ts", "export const start = 1;\n");
    writeFile(root, "src/reader.ts", "export const read = () => 1;\n");
    await withServer(root, async (client) => {
      const revisionOf = async (name: string): Promise<string> =>
        (await callTool(client, KNOWLEDGE_READ, { name })).structured.revision as string;

      // An entry citing one distinct file is published and reported as thin.
      const created = await callTool(client, KNOWLEDGE_SAVE, {
        entries: [
          {
            name: "dispatch_flow",
            description: "How dispatch reaches the reader",
            body: "Thin body.\n",
            evidence: [{ path: "src/main.ts" }],
          },
        ],
      });
      assert.equal(created.isError, false, created.text);
      assert.equal(created.structured.status, "created");
      assert.deepEqual(warningsOf(created), [
        { name: "dispatch_flow", code: "insufficient_backing", distinctEvidencePaths: 1 },
      ]);

      // Rewriting it against two distinct files removes the signal: the
      // warning describes the published contract, not the one it replaced.
      const widened = await callTool(client, KNOWLEDGE_SAVE, {
        mode: "replace",
        entries: [
          {
            name: "dispatch_flow",
            description: "How dispatch reaches the reader",
            body: "Widened body.\n",
            evidence: [{ path: "src/main.ts" }, { path: "src/reader.ts" }],
            expectedRevision: await revisionOf("dispatch_flow"),
          },
        ],
      });
      assert.equal(widened.isError, false, widened.text);
      assert.deepEqual(widened.structured, {
        status: "replaced",
        workspace: ".",
        replaced: ["dispatch_flow"],
        warnings: [],
      });
      assert.doesNotMatch(widened.text, /insufficiently backed/);

      // A rewrite back to a single distinct path reports it again: the signal
      // follows the resulting evidence in both directions.
      const narrowed = await callTool(client, KNOWLEDGE_SAVE, {
        mode: "replace",
        entries: [
          {
            name: "dispatch_flow",
            description: "How dispatch reaches the reader",
            body: "Narrowed body.\n",
            evidence: [{ path: "src/main.ts" }, { path: "src/main.ts" }],
            expectedRevision: await revisionOf("dispatch_flow"),
          },
        ],
      });
      assert.equal(narrowed.isError, false, narrowed.text);
      assert.equal(narrowed.structured.status, "replaced");
      assert.deepEqual(warningsOf(narrowed), [
        { name: "dispatch_flow", code: "insufficient_backing", distinctEvidencePaths: 1 },
      ]);
      assert.match(narrowed.text, /insufficiently backed/);
      // The advisory signal never echoes a body, a cited path or a hash.
      assert.doesNotMatch(
        `${created.text}\n${widened.text}\n${narrowed.text}`,
        /Thin body|Widened body|Narrowed body|sha256|[0-9a-f]{64}/
      );
      assert.ok(!narrowed.text.includes("src/reader.ts"));
      assert.deepEqual(fs.readdirSync(catalogueDirectory(root)).sort(), ["dispatch_flow.md"]);
    });
  } finally {
    rmrf(root);
  }
});
