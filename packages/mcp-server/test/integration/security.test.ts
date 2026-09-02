import { test } from "node:test";
import * as assert from "node:assert";
import {
  callTool,
  rmrf,
  structuredCode,
  tempDir,
  withServer,
} from "../helpers/test-utils";

const TOUR = "intro.tour";

function validArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fileName: TOUR,
    title: "My Tour",
    steps: [{ description: "Hello." }],
    ...overrides,
  };
}

test("rejects a file: scheme in a step description", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: [{ description: "Open [the file](file:///etc/passwd)." }],
      }));
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
    });
  } finally {
    rmrf(root);
  }
});

test("rejects vscode: and javascript: schemes in a step description", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: [
          { description: "Click [here](vscode://file/x)." },
          { description: "Execute [this](javascript:alert(1))." },
        ],
      }));
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
    });
  } finally {
    rmrf(root);
  }
});

test("rejects a command scheme in a tour description", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: [{ description: "Run [this](command:workbench.action.quit)." }],
      }));
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an active scheme in the tour-level description", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        description: "See [the launch command](command:workbench.action.quit).",
        steps: [{ description: "Fine step." }],
      }));
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      const issues = (response.structured.issues ?? []) as Array<{ path: string }>;
      assert.ok(issues.some((issue) => issue.path === "description"));
    });
  } finally {
    rmrf(root);
  }
});

test("exposes exactly one tool named create_tour", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name), ["create_tour"]);
    });
  } finally {
    rmrf(root);
  }
});

test("returns a human-readable message and a structured result", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs());
      assert.equal(response.isError, false);
      assert.ok(response.text.includes(`.tours/${TOUR}`));
      assert.equal(response.structured.status, "created");
      assert.equal(response.structured.path, `.tours/${TOUR}`);
      assert.equal(response.structured.stepCount, 1);
      assert.ok(Array.isArray(response.structured.warnings));
    });
  } finally {
    rmrf(root);
  }
});
