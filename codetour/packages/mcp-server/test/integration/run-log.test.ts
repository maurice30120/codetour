import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import { callTool, rmrf, tempDir, withServer, writeFile } from "../helpers/test-utils";
import { readRunState } from "../../src/run-log";
const RUN_ID = "run-1234567890abcdef";
test("prompts/get states the run identity, or that it is optional when absent", async () => {
  const root = tempDir("codetour-run-prompt-");
  try {
    await withServer(root, async (client) => {
      const withRun = await client.getPrompt({
        name: "generate_project_tour",
        arguments: { request: "Explique le flux.", runId: RUN_ID }
      });
      const text = withRun.messages.map((message) => {
        const content = message.content as { text?: string };
        return typeof message.content === "string" ? message.content : content.text ?? "";
      }).join("\n");
      assert.ok(text.includes(`Run identity: \`${RUN_ID}\``));
      assert.doesNotMatch(text, /knowledge|consolidat/i);
      const withoutRun = await client.getPrompt({
        name: "generate_project_tour",
        arguments: { request: "Explique le flux." }
      });
      const plain = withoutRun.messages.map((message) => {
        const content = message.content as { text?: string };
        return typeof message.content === "string" ? message.content : content.text ?? "";
      }).join("\n");
      assert.ok(plain.includes("## Run identity (optional)"));
      assert.ok(plain.includes("omit runId"));
      assert.ok(!plain.includes(`Run identity: \``));
    });
  } finally {
    rmrf(root);
  }
});

test("create_project_tour records the Tour under the run identity", async () => {
  const root = tempDir("codetour-run-create-");
  try {
    writeFile(root, "hello.txt", "hello\n");
    await withServer(root, async (client) => {
      const created = await callTool(client, "create_project_tour", {
        runId: RUN_ID,
        steps: [{ file: "hello.txt", description: "Anchored step." }]
      });
      assert.equal(created.isError, false, created.text);
      assert.match(created.text, /Created Project Tour "Project Overview" at \.tours\/project\.tour/);
      assert.equal(created.structured.runId, RUN_ID);
      assert.equal(created.structured.runRecorded, true, created.text);
      const state = await readRunState(fs.realpathSync(root), RUN_ID);
      assert.ok(state);
      assert.equal(state.tourCreated, true);
      assert.equal(state.tourPath, ".tours/project.tour");
      assert.equal(state.tourTitle, "Project Overview");
    });
  } finally {
    rmrf(root);
  }
});

test("a malformed runId is refused without writing a run log", async () => {
  const root = tempDir("codetour-run-invalid-");
  try {
    await withServer(root, async (client) => {
      const created = await callTool(client, "create_project_tour", {
        runId: "../../escape",
        steps: [{ description: "No locator." }]
      });
      assert.equal(created.isError, true);
      assert.match(created.text, /runId/);
    });
  } finally {
    rmrf(root);
  }
});

