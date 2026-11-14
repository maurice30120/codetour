import { test } from "node:test";
import * as assert from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  commitFile,
  headSha,
  initGitRepo,
  rmrf,
  tempDir,
  withServer,
} from "../helpers/test-utils";
import { TARGETED_CONTEXT_RESOURCE_TEMPLATE } from "../../src/server";
import { PROJECT_TARGETED_CONTEXT_RESOURCE_URI } from "../../src/server";

// The resource seam plays the Tour Generator: read the Targeted Context over
// the served MCP protocol and pin the token-economy contract — the default
// answer is one bounded page, not the whole context.

function changesTourContextUri(baseRef: string, headRef: string): string {
  return TARGETED_CONTEXT_RESOURCE_TEMPLATE.replace("{baseRef}", baseRef).replace(
    "{headRef}",
    headRef
  );
}

async function readResourceText(client: Client, uri: string): Promise<string> {
  const response = await client.readResource({ uri });
  const content = response.contents[0] as { uri?: string; text?: string };
  assert.equal(content.uri, uri);
  return content.text ?? "";
}

// 250 exported functions: more than the 200-symbol default page, less than two
// full pages.
function manyFunctions(): string {
  return Array.from(
    { length: 250 },
    (_, i) => `export function fn${i}() { return ${i}; }`
  ).join("\n");
}

async function fixtureRepo(): Promise<{
  root: string;
  baseRef: string;
  headRef: string;
}> {
  const root = tempDir("codetour-targeted-context-");
  await initGitRepo(root);

  const source = manyFunctions();
  await commitFile(root, "src/many.ts", source, "add many functions");
  const baseRef = await headSha(root);

  await commitFile(
    root,
    "src/many.ts",
    `${source}\nexport const tail = 1;`,
    "add one symbol"
  );
  const headRef = await headSha(root);

  return { root, baseRef, headRef };
}

// ADR 0033: the Targeted Context flag is off by default; the host opts a run
// in deliberately through CODETOUR_TARGETED_CONTEXT=1 (the existing flag, no
// new one). These tests play the flag-on runs.
const FLAG_ON = { CODETOUR_TARGETED_CONTEXT: "1" };

test("flag off (default): the context resources serve the historical empty answer, no packet", async () => {
  const { root, baseRef, headRef } = await fixtureRepo();
  try {
    await withServer(root, async (client) => {
      // No env override: the default of record is off.
      const changesText = await readResourceText(
        client,
        changesTourContextUri(baseRef, headRef)
      );
      assert.equal(
        changesText,
        "# Targeted Context\n\nNo context available.",
        "flag off => the historical empty Changes Tour context"
      );
      assert.ok(!changesText.includes("Relations (depth 1)"), "no relations packet");

      const paginatedText = await readResourceText(
        client,
        `${changesTourContextUri(baseRef, headRef)}?page=1&pageSize=200`
      );
      assert.equal(paginatedText, "# Targeted Context\n\nNo context available.");
      assert.ok(!paginatedText.includes("Relations (depth 1)"), "no relations packet");

      const projectText = await readResourceText(
        client,
        PROJECT_TARGETED_CONTEXT_RESOURCE_URI
      );
      assert.equal(projectText, "# Targeted Context\n\nNo context available.");
      assert.ok(!projectText.includes("Relations (depth 1)"), "no relations packet");
    });
  } finally {
    rmrf(root);
  }
});

test("the default Changes Tour context serves one bounded page (flag on)", async () => {
  const { root, baseRef, headRef } = await fixtureRepo();
  try {
    await withServer(root, async (client) => {
      const text = await readResourceText(
        client,
        changesTourContextUri(baseRef, headRef)
      );

      // One page of 200 symbols out of 251: the agent does not receive
      // everything at once.
      assert.match(text, /Page 1\/2/);
      assert.match(text, /Showing 200 symbols on this page/);
    }, FLAG_ON);
  } finally {
    rmrf(root);
  }
});

test("the paginated Changes Tour context serves the requested page (flag on)", async () => {
  const { root, baseRef, headRef } = await fixtureRepo();
  try {
    await withServer(root, async (client) => {
      const uri = `${changesTourContextUri(baseRef, headRef)}?page=2&pageSize=200`;
      const text = await readResourceText(client, uri);

      assert.match(text, /Page 2\/2/);
      assert.match(text, /Showing 50 symbols on this page/);
    }, FLAG_ON);
  } finally {
    rmrf(root);
  }
});

test("the Project Tour context serves the workspace symbols (flag on)", async () => {
  const root = tempDir("codetour-project-context-");
  try {
    await initGitRepo(root);
    await commitFile(
      root,
      "src/app.ts",
      "export function greet() { return 'hi'; }\nexport const version = 1;",
      "add app"
    );
    await commitFile(
      root,
      "lib/util.ts",
      "export function helper() { return 42; }",
      "add util"
    );

    await withServer(root, async (client) => {
      const text = await readResourceText(
        client,
        PROJECT_TARGETED_CONTEXT_RESOURCE_URI
      );

      assert.match(text, /Targeted Context \(\d+ symbols from \d+ files\)/);
      assert.match(text, /src\/app\.ts/);
      assert.match(text, /greet/);
    }, FLAG_ON);
  } finally {
    rmrf(root);
  }
});
