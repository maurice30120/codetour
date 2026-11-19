import { test } from "node:test";
import * as assert from "node:assert";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { callTool, rmrf, tempDir, withServer, writeFile } from "../helpers/test-utils";

// The Knowledge tools are exercised through the public MCP stdio seam against
// a third-party workspace (a temporary directory outside the repository): no
// API key, no Research Harness, no separate server. The tests pin observable
// protocol behaviour — names, structured statuses, reasons — never internals.

const KNOWLEDGE_LIST = "knowledge_list";
const KNOWLEDGE_READ = "knowledge_read";
const KNOWLEDGE_SAVE = "knowledge_save";

const sha256 = (text: string): string =>
  crypto.createHash("sha256").update(text).digest("hex");

const catalogueDirectory = (root: string): string =>
  path.join(root, ".tours", ".memory", "knowledge");

interface EntryFixture {
  description?: string;
  body: string;
  evidence?: Array<{ path: string; sha256?: string }>;
  symbol?: boolean;
}

// Write one Knowledge entry in the documented catalogue grammar. Fixtures are
// hand-authored on purpose: the tests must not reuse the server's serializer.
function writeEntry(root: string, name: string, fixture: EntryFixture): void {
  const catalogue = catalogueDirectory(root);
  fs.mkdirSync(catalogue, { recursive: true });
  const lines = [
    "---",
    `name: ${name}`,
    `description: ${fixture.description ?? `Description of ${name}`}`,
    "evidence:",
  ];
  if (fixture.symbol) {
    lines.push("  - type: symbol");
  } else {
    for (const proof of fixture.evidence ?? []) {
      lines.push(
        "  - type: file",
        `    path: ${proof.path}`,
        `    sha256: ${proof.sha256 ?? "0".repeat(64)}`
      );
    }
  }
  lines.push("---", fixture.body);
  fs.writeFileSync(path.join(catalogue, `${name}.md`), lines.join("\n"));
}

function writeWorkspaceFile(root: string, relativePath: string, content: string): string {
  writeFile(root, relativePath, content);
  return sha256(content);
}

function textOf(response: { text: string; structured: Record<string, unknown> }): string {
  return `${response.text}\n${JSON.stringify(response.structured)}`;
}

test("knowledge_list reports metadata only and treats an absent catalogue as empty", async () => {
  const root = tempDir("codetour-knowledge-list-");
  try {
    await withServer(root, async (client) => {
      const absent = await callTool(client, KNOWLEDGE_LIST, {});
      assert.equal(absent.isError, false, absent.text);
      assert.deepEqual(absent.structured, {
        status: "empty",
        workspace: ".",
        entries: [],
        total: 0,
        offset: 0,
        limit: 50,
        truncated: false,
      });

      const digest = writeWorkspaceFile(root, "src/main.ts", "export const start = 1;\n");
      writeEntry(root, "dispatch_flow", {
        description: "How tool calls dispatch",
        body: "SECRET BODY dispatch\n",
        evidence: [{ path: "src/main.ts", sha256: digest }],
      });
      writeEntry(root, "stale_flow", {
        description: "Cites a changed file",
        body: "SECRET BODY stale\n",
        evidence: [{ path: "src/main.ts" }],
      });
      writeEntry(root, "symbol_flow", {
        description: "Uses an unsupported proof",
        body: "SECRET BODY symbol\n",
        symbol: true,
      });

      const listed = await callTool(client, KNOWLEDGE_LIST, {});
      assert.equal(listed.isError, false, listed.text);
      assert.deepEqual(listed.structured, {
        status: "ok",
        workspace: ".",
        entries: [
          { name: "dispatch_flow", description: "How tool calls dispatch" },
          { name: "stale_flow", description: "Cites a changed file" },
        ],
        total: 2,
        offset: 0,
        limit: 50,
        truncated: false,
      });
      assert.doesNotMatch(textOf(listed), /SECRET BODY|sha256|[0-9a-f]{64}/);

      const filtered = await callTool(client, KNOWLEDGE_LIST, { query: "DISPATCH" });
      assert.deepEqual(
        filtered.structured.entries,
        [{ name: "dispatch_flow", description: "How tool calls dispatch" }],
        "the query is a literal case-insensitive substring filter"
      );

      const noMatch = await callTool(client, KNOWLEDGE_LIST, { query: "absent-topic" });
      assert.equal(noMatch.isError, false);
      assert.deepEqual(noMatch.structured.entries, []);
      assert.equal(noMatch.structured.total, 0);

      // The last page is complete: `truncated` describes what remains after
      // the page, not the page's length compared with the whole catalogue.
      const page = await callTool(client, KNOWLEDGE_LIST, { limit: 1, offset: 1 });
      assert.deepEqual(page.structured, {
        status: "ok",
        workspace: ".",
        entries: [{ name: "stale_flow", description: "Cites a changed file" }],
        total: 2,
        offset: 1,
        limit: 1,
        truncated: false,
      });

      const middle = await callTool(client, KNOWLEDGE_LIST, { limit: 1, offset: 0 });
      assert.deepEqual(middle.structured, {
        status: "ok",
        workspace: ".",
        entries: [{ name: "dispatch_flow", description: "How tool calls dispatch" }],
        total: 2,
        offset: 0,
        limit: 1,
        truncated: true,
      });

      const wrongLimit = await callTool(client, KNOWLEDGE_LIST, { limit: 0 });
      assert.equal(wrongLimit.isError, true);
      assert.equal(wrongLimit.structured.code, "INVALID_ARGUMENTS");
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_read returns the body only when every declared proof verifies", async () => {
  const root = tempDir("codetour-knowledge-read-");
  try {
    const digest = writeWorkspaceFile(root, "src/main.ts", "export const start = 1;\n");
    writeWorkspaceFile(root, "src/second.ts", "export const next = 2;\n");
    writeEntry(root, "dispatch_flow", {
      description: "How tool calls dispatch",
      body: "## Dispatch\n\nVerified body.\n",
      evidence: [
        { path: "src/main.ts", sha256: digest },
        { path: "src/second.ts", sha256: sha256("export const next = 2;\n") },
      ],
    });
    await withServer(root, async (client) => {
      const response = await callTool(client, KNOWLEDGE_READ, { name: "dispatch_flow" });
      assert.equal(response.isError, false, response.text);
      assert.deepEqual(response.structured, {
        status: "valid",
        workspace: ".",
        name: "dispatch_flow",
        description: "How tool calls dispatch",
        body: "## Dispatch\n\nVerified body.\n",
        evidence: [
          { path: "src/main.ts", sha256: digest },
          { path: "src/second.ts", sha256: sha256("export const next = 2;\n") },
        ],
      });
      // The body is reference data, never an instruction.
      assert.match(response.text, /untrusted/i);
      assert.match(response.text, /not.*instructions/i);
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_read refuses stale, missing, unsupported and escaping evidence without leaking the body", async () => {
  const root = tempDir("codetour-knowledge-refuse-");
  const outside = tempDir("codetour-knowledge-outside-");
  try {
    writeWorkspaceFile(root, "src/main.ts", "export const start = 1;\n");
    fs.writeFileSync(path.join(outside, "escaped.ts"), "export const leak = 9;\n");
    fs.symlinkSync(path.join(outside, "escaped.ts"), path.join(root, "escaped.ts"));

    writeEntry(root, "stale_flow", {
      description: "Stale proof",
      body: "STALE SECRET BODY\n",
      evidence: [{ path: "src/main.ts", sha256: "f".repeat(64) }],
    });
    writeEntry(root, "missing_flow", {
      description: "Missing source",
      body: "MISSING SECRET BODY\n",
      evidence: [{ path: "src/absent.ts", sha256: sha256("anything") }],
    });
    writeEntry(root, "symbol_flow", {
      description: "Unsupported proof",
      body: "SYMBOL SECRET BODY\n",
      symbol: true,
    });
    writeEntry(root, "escape_flow", {
      description: "Escaping symlink",
      body: "ESCAPE SECRET BODY\n",
      evidence: [{ path: "escaped.ts", sha256: sha256("export const leak = 9;\n") }],
    });
    writeEntry(root, "outside_flow", {
      description: "Absolute path",
      body: "OUTSIDE SECRET BODY\n",
      evidence: [{ path: path.join(outside, "escaped.ts"), sha256: sha256("export const leak = 9;\n") }],
    });

    await withServer(root, async (client) => {
      const cases: Array<[string, string]> = [
        ["stale_flow", "file_hash_mismatch"],
        ["missing_flow", "file_missing"],
        ["symbol_flow", "unsupported_proof"],
        ["escape_flow", "symlink_escape"],
        ["outside_flow", "path_outside_workspace"],
      ];
      for (const [name, reason] of cases) {
        const response = await callTool(client, KNOWLEDGE_READ, { name });
        assert.equal(response.isError, false, `${name}: ${response.text}`);
        assert.deepEqual(response.structured, {
          status: "invalid",
          workspace: ".",
          name,
          reason,
        });
        const surface = textOf(response);
        assert.doesNotMatch(surface, /SECRET BODY/, `${name} must never return the body`);
        assert.doesNotMatch(surface, /sha256|[0-9a-f]{64}/, `${name} must not leak a hash`);
        assert.ok(!surface.includes("src/main.ts"), `${name} must not leak a cited path`);
        assert.ok(!surface.includes(outside), `${name} must not leak an outside path`);
      }
    });
  } finally {
    rmrf(root);
    rmrf(outside);
  }
});

test("knowledge_read reports an unknown entry as an explicit absence", async () => {
  const root = tempDir("codetour-knowledge-absent-");
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, KNOWLEDGE_READ, { name: "never_written" });
      assert.equal(response.isError, false, response.text);
      assert.deepEqual(response.structured, {
        status: "absent",
        workspace: ".",
        name: "never_written",
      });
      assert.doesNotMatch(response.text, /body/i);
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_save creates entries, reports conflicts, and never overwrites an existing name", async () => {
  const root = tempDir("codetour-knowledge-save-");
  try {
    writeFile(root, "src/main.ts", "export const start = 1;\n");
    await withServer(root, async (client) => {
      const created = await callTool(client, KNOWLEDGE_SAVE, {
        entries: [
          {
            name: "saved_flow",
            description: "Saved through the MCP server",
            body: "## Saved\n\nCreated by knowledge_save.\n",
            evidence: [{ path: "src/main.ts" }],
          },
          {
            name: "second_flow",
            description: "Second entry of the same proposal",
            body: "Second body.\n",
            evidence: [{ path: "src/main.ts" }],
          },
        ],
      });
      assert.equal(created.isError, false, created.text);
      assert.deepEqual(created.structured, {
        status: "created",
        workspace: ".",
        created: ["saved_flow", "second_flow"],
      });
      // No body, hash or cited path is echoed by a publication result.
      assert.doesNotMatch(textOf(created), /Created by knowledge_save|sha256|[0-9a-f]{64}/);

      // The same session rediscovers the metadata and rereads a body.
      const listed = await callTool(client, KNOWLEDGE_LIST, {});
      assert.equal(listed.isError, false, listed.text);
      assert.deepEqual(
        (listed.structured.entries as Array<{ name: string }>).map((entry) => entry.name),
        ["saved_flow", "second_flow"]
      );
      const read = await callTool(client, KNOWLEDGE_READ, { name: "saved_flow" });
      assert.equal(read.isError, false, read.text);
      assert.equal(read.structured.status, "valid");
      assert.equal(read.structured.body, "## Saved\n\nCreated by knowledge_save.\n");

      // A second proposal with an existing name is a conflict; the existing
      // entry keeps its bytes and the other entry is not published.
      const conflict = await callTool(client, KNOWLEDGE_SAVE, {
        entries: [
          {
            name: "saved_flow",
            description: "Replacement attempt",
            body: "REPLACEMENT BODY\n",
            evidence: [{ path: "src/main.ts" }],
          },
          {
            name: "late_flow",
            description: "Must not be published",
            body: "LATE BODY\n",
            evidence: [{ path: "src/main.ts" }],
          },
        ],
      });
      assert.equal(conflict.isError, true, conflict.text);
      assert.deepEqual(conflict.structured, {
        status: "conflict",
        workspace: ".",
        conflicts: [{ name: "saved_flow", reason: "name_conflict" }],
      });
      const preserved = await callTool(client, KNOWLEDGE_READ, { name: "saved_flow" });
      assert.equal(preserved.structured.body, "## Saved\n\nCreated by knowledge_save.\n");
      const late = await callTool(client, KNOWLEDGE_READ, { name: "late_flow" });
      assert.equal(late.structured.status, "absent");
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_save reports an explicit zero-entry proposal as completed_zero", async () => {
  const root = tempDir("codetour-knowledge-zero-");
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, KNOWLEDGE_SAVE, { entries: [] });
      assert.equal(response.isError, false, response.text);
      assert.deepEqual(response.structured, {
        status: "completed_zero",
        workspace: ".",
        created: [],
      });
      assert.match(response.text, /not a forgotten consolidation/i);
      assert.equal(fs.existsSync(catalogueDirectory(root)), false);
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_save refuses invalid proposals and writes nothing", async () => {
  const root = tempDir("codetour-knowledge-invalid-");
  try {
    writeFile(root, "src/main.ts", "export const start = 1;\n");
    await withServer(root, async (client) => {
      const noEvidence = await callTool(client, KNOWLEDGE_SAVE, {
        entries: [
          {
            name: "invalid_flow",
            description: "No evidence",
            body: "INVALID BODY\n",
            evidence: [],
          },
        ],
      });
      assert.equal(noEvidence.isError, true, noEvidence.text);
      assert.deepEqual(noEvidence.structured, {
        status: "invalid",
        workspace: ".",
        rejected: [{ name: "invalid_flow", reason: "missing_evidence" }],
      });
      assert.doesNotMatch(textOf(noEvidence), /INVALID BODY/);
      assert.equal(fs.existsSync(catalogueDirectory(root)), false);

      const malformed = await callTool(client, KNOWLEDGE_SAVE, { entries: "nope" });
      assert.equal(malformed.isError, true);
      assert.equal(malformed.structured.code, "INVALID_ARGUMENTS");

      const listed = await callTool(client, KNOWLEDGE_LIST, {});
      assert.deepEqual(listed.structured.entries, []);
      assert.equal(listed.structured.status, "empty");
    });
  } finally {
    rmrf(root);
  }
});

test("the Knowledge tools honour a workspacePath relative to the configured root", async () => {
  const root = tempDir("codetour-knowledge-workspace-");
  const outside = tempDir("codetour-knowledge-workspace-outside-");
  try {
    writeFile(root, "project/src/main.ts", "export const scoped = 1;\n");
    fs.mkdirSync(path.join(outside, "src"), { recursive: true });
    fs.writeFileSync(path.join(outside, "src", "main.ts"), "export const outside = 1;\n");
    await withServer(root, async (client) => {
      const created = await callTool(client, KNOWLEDGE_SAVE, {
        workspacePath: "project",
        entries: [
          {
            name: "scoped_flow",
            description: "Scoped to a subdirectory",
            body: "Scoped body.\n",
            evidence: [{ path: "src/main.ts" }],
          },
        ],
      });
      assert.equal(created.isError, false, created.text);
      assert.equal(created.structured.workspace, "project");
      assert.ok(fs.existsSync(
        path.join(root, "project", ".tours", ".memory", "knowledge", "scoped_flow.md")
      ));
      assert.equal(fs.existsSync(catalogueDirectory(root)), false);

      const scopedList = await callTool(client, KNOWLEDGE_LIST, { workspacePath: "project" });
      assert.deepEqual(scopedList.structured.workspace, "project");
      assert.equal((scopedList.structured.entries as unknown[]).length, 1);
      const defaultList = await callTool(client, KNOWLEDGE_LIST, {});
      assert.equal(defaultList.structured.status, "empty");

      for (const workspacePath of ["../outside", "missing", 42]) {
        const refused = await callTool(client, KNOWLEDGE_LIST, { workspacePath });
        assert.equal(refused.isError, true, String(workspacePath));
        assert.equal(refused.structured.code, "INVALID_ARGUMENTS");
        assert.ok(
          (refused.structured.issues as Array<{ path: string }>).some(
            (issue) => issue.path === "workspacePath"
          )
        );
      }
      assert.equal(fs.existsSync(path.join(outside, ".tours")), false);
    });
  } finally {
    rmrf(root);
    rmrf(outside);
  }
});

test("the Knowledge tools work without any API key or Research Harness", async () => {
  const root = tempDir("codetour-knowledge-offline-");
  try {
    writeFile(root, "src/main.ts", "export const offline = 1;\n");
    await withServer(
      root,
      async (client) => {
        const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
        assert.deepEqual(tools, [
          "create_changes_tour",
          "create_project_tour",
          "knowledge_close_run",
          "knowledge_list",
          "knowledge_read",
          "knowledge_save",
        ]);
        assert.ok(!tools.some((name) => /memory|research|harness/i.test(name)));
        const created = await callTool(client, KNOWLEDGE_SAVE, {
          entries: [
            {
              name: "offline_flow",
              description: "Works offline",
              body: "Offline body.\n",
              evidence: [{ path: "src/main.ts" }],
            },
          ],
        });
        assert.equal(created.isError, false, created.text);
        const read = await callTool(client, KNOWLEDGE_READ, { name: "offline_flow" });
        assert.equal(read.structured.status, "valid");
      },
      {
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        MISTRAL_API_KEY: "",
        GEMINI_API_KEY: "",
        CODETOUR_RESEARCH_API_KEY: "",
      }
    );
  } finally {
    rmrf(root);
  }
});

// prompts/get is the wrapper surface: the original request, then the catalogue
// projection, then the decomposition method. A client that never calls it gets
// the tool descriptions only.
function promptText(messages: Array<{ content: unknown }>): string {
  return messages
    .map((message) => {
      const content = message.content;
      if (typeof content === "string") return content;
      if (content && typeof content === "object" && "text" in content) {
        const text = (content as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("\n");
}

test("prompts/get carries the original request and the catalogue before the decomposition method", async () => {
  const root = tempDir("codetour-knowledge-prompt-");
  try {
    const digest = writeWorkspaceFile(root, "src/main.ts", "export const start = 1;\n");
    writeEntry(root, "dispatch_flow", {
      description: "How tool calls dispatch",
      body: "Prompt body.\n",
      evidence: [{ path: "src/main.ts", sha256: digest }],
    });
    await withServer(root, async (client) => {
      const request =
        "Explique-moi comment les appels d'outils sont distribués.\n" +
        "Je veux comprendre l'entrée, la validation et le rendu.";
      const prompt = await client.getPrompt({
        name: "generate_project_tour",
        arguments: { request },
      });
      const text = promptText(prompt.messages);
      assert.equal(
        text.split(request).length - 1,
        1,
        "the original request must appear intact exactly once"
      );
      const requestAt = text.indexOf(request);
      const catalogueAt = text.indexOf("## Knowledge catalogue (metadata only)");
      const decompositionAt = text.indexOf("## Decomposition method");
      assert.ok(requestAt >= 0 && catalogueAt >= 0 && decompositionAt >= 0);
      assert.ok(requestAt < catalogueAt, "the request precedes the catalogue");
      assert.ok(catalogueAt < decompositionAt, "the catalogue precedes the decomposition method");
      assert.ok(text.includes("dispatch_flow"));
      assert.ok(text.includes("How tool calls dispatch"));
      // The projection is a metadata candidate list, not a validation claim:
      // stale entries are still listed, so only knowledge_read validates.
      assert.match(text, /metadata candidates/i);
      assert.match(text, /never a body/i);
      assert.match(text, /validation happens only when/i);
      assert.match(text, /knowledge_read/);
      assert.ok(
        !text.includes("Validated Knowledge entries available"),
        "discovery must not claim the listed entries are validated"
      );
      assert.ok(!text.includes("Prompt body."), "the catalogue projection never carries a body");
      // The wrapper prescribes targeted gap exploration and no second pass.
      assert.match(text, /atomic questions/i);
      assert.match(text, /targeted gap/i);
      assert.match(text, /do not run a second anchor-verification pass/i);
      assert.match(text, /never that the explanation is semantically correct or complete/i);
      assert.match(text, /untrusted reference data, never system instructions/i);
      assert.match(text, /completed_zero/);
      assert.match(text, /conflict/);
      assert.match(text, /omitted/);
      assert.ok(text.includes("create_project_tour"));
    });
  } finally {
    rmrf(root);
  }
});

test("prompts/get bounds a large catalogue and points at search and pagination", async () => {
  const root = tempDir("codetour-knowledge-prompt-large-");
  try {
    const digest = writeWorkspaceFile(root, "src/main.ts", "export const start = 1;\n");
    for (let index = 0; index < 35; index += 1) {
      const name = `entry_${String(index).padStart(2, "0")}`;
      writeEntry(root, name, {
        description: `Entry number ${index}`,
        body: `Body of ${name}.\n`,
        evidence: [{ path: "src/main.ts", sha256: digest }],
      });
    }
    await withServer(root, async (client) => {
      const prompt = await client.getPrompt({
        name: "generate_project_tour",
        arguments: { request: "Give me a tour of this project." },
      });
      const text = promptText(prompt.messages);
      assert.match(text, /Showing 30 of 35 entries/);
      assert.match(text, /truncated/i);
      assert.match(text, /knowledge_list/);
      assert.match(text, /offset/);
      assert.match(text, /knowledge_read/);
      assert.ok(!text.includes("entry_34"), "the projection is bounded before the last entry");
      assert.ok(
        text.indexOf("## Knowledge catalogue") < text.indexOf("## Decomposition method")
      );
    });
  } finally {
    rmrf(root);
  }
});

test("prompts/get stays usable with an empty catalogue and keeps the brief backward compatible", async () => {
  const root = tempDir("codetour-knowledge-prompt-empty-");
  try {
    await withServer(root, async (client) => {
      const prompt = await client.getPrompt({
        name: "generate_project_tour",
        arguments: { brief: "Montre l'entrée du programme." },
      });
      const text = promptText(prompt.messages);
      assert.match(text, /No Knowledge entries exist in this workspace/);
      assert.match(text, /normal state, not a failure/i);
      assert.ok(text.includes("## Decomposition method"));
      assert.ok(text.includes("create_project_tour"));
      assert.ok(text.includes("Montre l'entrée du programme."));
      assert.ok(text.includes("## Tour orientation from the user"));
      assert.ok(
        text.indexOf("## Knowledge catalogue") < text.indexOf("## Decomposition method")
      );
    });
  } finally {
    rmrf(root);
  }
});

test("the Knowledge tools do not regress Tour creation, prompts or resources", async () => {
  const root = tempDir("codetour-knowledge-regression-");
  try {
    writeFile(root, "hello.txt", "hello\n");
    writeEntry(root, "existing_flow", { description: "Existing", body: "Body.\n" });
    await withServer(root, async (client) => {
      const created = await callTool(client, "create_project_tour", {
        steps: [{ file: "hello.txt", description: "Anchored step." }],
      });
      assert.equal(created.isError, false, created.text);
      assert.equal(created.structured.status, "created");
      assert.ok(fs.existsSync(path.join(root, ".tours", "project.tour")));

      const prompts = (await client.listPrompts()).prompts.map((prompt) => prompt.name);
      assert.ok(prompts.includes("generate_project_tour"));
      assert.ok(prompts.includes("generate_changes_tour"));
      const resources = (await client.listResources()).resources.map((resource) => resource.uri);
      assert.ok(resources.includes("codetour://generate/project-tour"));
      assert.ok(resources.includes("codetour://review/critical-instructions"));
    });
  } finally {
    rmrf(root);
  }
});
