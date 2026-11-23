import { test } from "node:test";
import * as assert from "node:assert";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { callTool, rmrf, tempDir, withServer, writeFile } from "../helpers/test-utils";
import { readRunState } from "../../src/run-log";

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
  symbolProof?: { path: string; symbol: string; sha256?: string };
  dependencies?: Array<{ name: string; sha256: string }>;
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
  if (fixture.symbolProof) {
    lines.push(
      "  - type: symbol",
      `    path: ${fixture.symbolProof.path}`,
      `    symbol: ${fixture.symbolProof.symbol}`,
      `    sha256: ${fixture.symbolProof.sha256 ?? "0".repeat(64)}`
    );
  } else {
    for (const proof of fixture.evidence ?? []) {
      lines.push(
        "  - type: file",
        `    path: ${proof.path}`,
        `    sha256: ${proof.sha256 ?? "0".repeat(64)}`
      );
    }
  }
  if (fixture.dependencies && fixture.dependencies.length > 0) {
    lines.push("dependencies:");
    for (const dependency of fixture.dependencies) {
      lines.push(`  - name: ${dependency.name}`, `    sha256: ${dependency.sha256}`);
    }
  }
  lines.push("---", fixture.body);
  fs.writeFileSync(entryFile(root, name), lines.join("\n"));
}

/** Path of one catalogue entry, so a dependency pin can hash her exact bytes. */
function entryFile(root: string, name: string): string {
  return path.join(catalogueDirectory(root), `${name}.md`);
}

/** The Knowledge Revision of a written fixture: the SHA-256 of its whole file. */
function revisionOf(file: string): string {
  return sha256(fs.readFileSync(file, "utf8"));
}

/**
 * One composed entry over two atomic daughters, every pin computed from the
 * bytes actually written. A test moves exactly one daughter's cited code
 * without touching her Markdown.
 */
function writeComposedFixture(root: string): void {
  const dispatchCode = writeWorkspaceFile(root, "src/dispatch.ts", "export const dispatch = 1;\n");
  const renderCode = writeWorkspaceFile(root, "src/render.ts", "export const render = 2;\n");
  const authCode = writeWorkspaceFile(root, "src/auth.ts", "export const auth = 4;\n");
  writeEntry(root, "dispatch_flow", {
    description: "How a tool call dispatches",
    body: "DAUGHTER SECRET one\n",
    evidence: [{ path: "src/dispatch.ts", sha256: dispatchCode }],
  });
  writeEntry(root, "auth_flow", {
    description: "How a session is authenticated",
    body: "DAUGHTER SECRET two\n",
    evidence: [{ path: "src/auth.ts", sha256: authCode }],
  });
  writeEntry(root, "composed_flow", {
    description: "How dispatch interacts with authentication",
    body: "MOTHER BODY\n",
    evidence: [
      { path: "src/dispatch.ts", sha256: dispatchCode },
      { path: "src/render.ts", sha256: renderCode },
    ],
    dependencies: [
      { name: "dispatch_flow", sha256: revisionOf(entryFile(root, "dispatch_flow")) },
      { name: "auth_flow", sha256: revisionOf(entryFile(root, "auth_flow")) },
    ],
  });
}

function writeWorkspaceFile(root: string, relativePath: string, content: string): string {
  writeFile(root, relativePath, content);
  return sha256(content);
}

function textOf(response: { text: string; structured: Record<string, unknown> }): string {
  return `${response.text}\n${JSON.stringify(response.structured)}`;
}

// The revision token is opaque: a shape assertion pins that a row carries one,
// never its value.
function rowsWithoutRevisions(rows: unknown): Array<Record<string, unknown>> {
  return (rows as Array<Record<string, unknown>>).map((row) => {
    const { revision, ...rest } = row;
    assert.equal(typeof revision, "string", `${String(rest.name)} must carry a revision`);
    return rest;
  });
}

function pageWithoutRevisions(page: Record<string, unknown>): Record<string, unknown> {
  return {
    ...page,
    entries: rowsWithoutRevisions(page.entries),
    invalid: rowsWithoutRevisions(page.invalid),
  };
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
        invalid: [],
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
        symbolProof: { path: "src/main.ts", symbol: "start", sha256: "f".repeat(64) },
      });

      const listed = await callTool(client, KNOWLEDGE_LIST, {});
      assert.equal(listed.isError, false, listed.text);
      // Discovery verifies (ADR 0043): only verified contracts are listed as
      // entries; the stale and unsupported entries are reported under invalid
      // with their reason, so nobody can mistake them for servable metadata.
      assert.deepEqual(pageWithoutRevisions(listed.structured), {
        status: "ok",
        workspace: ".",
        entries: [
          { name: "dispatch_flow", description: "How tool calls dispatch" },
        ],
        invalid: [
          { name: "stale_flow", reason: "file_hash_mismatch" },
          { name: "symbol_flow", reason: "symbol_hash_mismatch" },
        ],
        total: 1,
        offset: 0,
        limit: 50,
        truncated: false,
      });
      // Discovery leaks no body, no cited path and no evidence hash. The
      // revision is a hex token by contract, so the check names the source
      // hashes it must never echo instead of refusing every hex string.
      const listedSurface = textOf(listed);
      assert.doesNotMatch(listedSurface, /SECRET BODY|sha256|src\/main\.ts/);
      for (const evidenceHash of [digest, "f".repeat(64), "0".repeat(64)]) {
        assert.ok(!listedSurface.includes(evidenceHash), "no evidence hash may reach discovery");
      }

      const filtered = await callTool(client, KNOWLEDGE_LIST, { query: "DISPATCH" });
      assert.deepEqual(
        rowsWithoutRevisions(filtered.structured.entries),
        [{ name: "dispatch_flow", description: "How tool calls dispatch" }],
        "the query is a literal case-insensitive substring filter"
      );
      assert.deepEqual(rowsWithoutRevisions(filtered.structured.invalid), [
        { name: "stale_flow", reason: "file_hash_mismatch" },
        { name: "symbol_flow", reason: "symbol_hash_mismatch" },
      ]);
      // The invalid report is independent of the query: the whole broken set
      // stays visible for fixing.
      assert.deepEqual(rowsWithoutRevisions(filtered.structured.invalid), [
        { name: "stale_flow", reason: "file_hash_mismatch" },
        { name: "symbol_flow", reason: "symbol_hash_mismatch" },
      ]);

      const noMatch = await callTool(client, KNOWLEDGE_LIST, { query: "absent-topic" });
      assert.equal(noMatch.isError, false);
      assert.deepEqual(noMatch.structured.entries, []);
      assert.equal(noMatch.structured.total, 0);
      assert.deepEqual(rowsWithoutRevisions(noMatch.structured.invalid), [
        { name: "stale_flow", reason: "file_hash_mismatch" },
        { name: "symbol_flow", reason: "symbol_hash_mismatch" },
      ]);
      assert.deepEqual(rowsWithoutRevisions(noMatch.structured.invalid), [
        { name: "stale_flow", reason: "file_hash_mismatch" },
        { name: "symbol_flow", reason: "symbol_hash_mismatch" },
      ]);

      // The last page is complete: `truncated` describes what remains after
      // the page, not the page's length compared with the whole catalogue.
      const page = await callTool(client, KNOWLEDGE_LIST, { limit: 1, offset: 1 });
      assert.deepEqual(pageWithoutRevisions(page.structured), {
        status: "ok",
        workspace: ".",
        entries: [],
        invalid: [
          { name: "stale_flow", reason: "file_hash_mismatch" },
          { name: "symbol_flow", reason: "symbol_hash_mismatch" },
        ],
        total: 1,
        offset: 1,
        limit: 1,
        truncated: false,
      });

      const middle = await callTool(client, KNOWLEDGE_LIST, { limit: 1, offset: 0 });
      assert.deepEqual(pageWithoutRevisions(middle.structured), {
        status: "ok",
        workspace: ".",
        entries: [{ name: "dispatch_flow", description: "How tool calls dispatch" }],
        invalid: [
          { name: "stale_flow", reason: "file_hash_mismatch" },
          { name: "symbol_flow", reason: "symbol_hash_mismatch" },
        ],
        total: 1,
        offset: 0,
        limit: 1,
        truncated: false,
      });

      const wrongLimit = await callTool(client, KNOWLEDGE_LIST, { limit: 0 });
      assert.equal(wrongLimit.isError, true);
      assert.equal(wrongLimit.structured.code, "INVALID_ARGUMENTS");
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_read returns the revision at root level for a valid and for a refused entry", async () => {
  const root = tempDir("codetour-knowledge-revision-read-");
  try {
    const digest = writeWorkspaceFile(root, "src/main.ts", "export const start = 1;\n");
    const entry = (declared: string, body: string) =>
      writeEntry(root, "dispatch_flow", {
        description: "How tool calls dispatch",
        body,
        evidence: [{ path: "src/main.ts", sha256: declared }],
      });
    entry(digest, "SECRET BODY one\n");
    await withServer(root, async (client) => {
      const valid = await callTool(client, KNOWLEDGE_READ, { name: "dispatch_flow" });
      assert.equal(valid.structured.status, "valid");
      const revision = valid.structured.revision;
      assert.equal(typeof revision, "string");
      assert.ok((revision as string).length > 0);
      // Opaque: never a source hash, never the body.
      assert.notEqual(revision, digest);
      assert.doesNotMatch(JSON.stringify(valid.structured.revision), /SECRET BODY|src\/main\.ts/);
      // Stable while the entry file is unchanged.
      const repeated = await callTool(client, KNOWLEDGE_READ, { name: "dispatch_flow" });
      assert.equal(repeated.structured.revision, revision);
      // A one-byte change moves the revision, and the refusal keeps it: a
      // repair write can address an entry whose contract already fails.
      entry("f".repeat(64), "SECRET BODY two\n");
      const refused = await callTool(client, KNOWLEDGE_READ, { name: "dispatch_flow" });
      assert.equal(refused.structured.status, "invalid");
      assert.equal(refused.structured.reason, "file_hash_mismatch");
      assert.equal(typeof refused.structured.revision, "string");
      assert.notEqual(refused.structured.revision, revision);
      assert.doesNotMatch(textOf(refused), /SECRET BODY|src\/main\.ts|f{64}/);
      // No entry file, no revision: absence stays content-free.
      const absent = await callTool(client, KNOWLEDGE_READ, { name: "never_written" });
      assert.equal(absent.structured.status, "absent");
      assert.equal(absent.structured.revision, undefined);
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
      assert.equal(typeof response.structured.revision, "string");
      const { revision, ...shape } = response.structured;
      assert.deepEqual(shape, {
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
      symbolProof: { path: "src/main.ts", symbol: "start", sha256: "f".repeat(64) },
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
        ["symbol_flow", "symbol_hash_mismatch"],
        ["escape_flow", "symlink_escape"],
        ["outside_flow", "path_outside_workspace"],
      ];
      for (const [name, reason] of cases) {
        const response = await callTool(client, KNOWLEDGE_READ, { name });
        assert.equal(response.isError, false, `${name}: ${response.text}`);
        const { revision, ...shape } = response.structured;
        assert.equal(typeof revision, "string", `${name} carries the revision of its entry file`);
        assert.deepEqual(shape, {
          status: "invalid",
          workspace: ".",
          name,
          reason,
        });
        const surface = textOf(response);
        assert.doesNotMatch(surface, /SECRET BODY/, `${name} must never return the body`);
        // The revision is a hex token by contract: the evidence hashes of this
        // fixture are named instead of refusing every hex string.
        assert.doesNotMatch(surface, /sha256/, `${name} must not leak a hash`);
        for (const evidenceHash of ["f".repeat(64), sha256("anything"), sha256("export const leak = 9;\n")]) {
          assert.ok(!surface.includes(evidenceHash), `${name} must not leak an evidence hash`);
        }
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

test("knowledge_read serves a valid composed entry and never a daughter body", async () => {
  const root = tempDir("codetour-knowledge-composed-");
  try {
    writeComposedFixture(root);
    await withServer(root, async (client) => {
      const response = await callTool(client, KNOWLEDGE_READ, { name: "composed_flow" });
      assert.equal(response.isError, false, response.text);
      const { revision, ...shape } = response.structured;
      assert.equal(typeof revision, "string");
      // The composed body, her own two proofs, and nothing of her daughters.
      assert.deepEqual(shape, {
        status: "valid",
        workspace: ".",
        name: "composed_flow",
        description: "How dispatch interacts with authentication",
        body: "MOTHER BODY\n",
        evidence: [
          { path: "src/dispatch.ts", sha256: sha256("export const dispatch = 1;\n") },
          { path: "src/render.ts", sha256: sha256("export const render = 2;\n") },
        ],
      });
      const surface = textOf(response);
      assert.doesNotMatch(surface, /DAUGHTER SECRET/);
      // A daughter's pin is a revision of HER file: it is never echoed here.
      for (const daughter of ["dispatch_flow", "auth_flow"]) {
        assert.ok(
          !surface.includes(revisionOf(entryFile(root, daughter))),
          "a daughter revision must not be surfaced"
        );
      }
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_read refuses a composed entry whose daughter broke and names her in via", async () => {
  const root = tempDir("codetour-knowledge-composed-refuse-");
  try {
    writeComposedFixture(root);
    await withServer(root, async (client) => {
      // The daughter's Markdown is untouched; the code she cites moved.
      writeFile(root, "src/auth.ts", "export const auth = 44;\n");
      const refused = await callTool(client, KNOWLEDGE_READ, { name: "composed_flow" });
      assert.equal(refused.isError, false, refused.text);
      const { revision, ...shape } = refused.structured;
      assert.equal(typeof revision, "string", "the mother's own file was readable");
      // The reason describes the dependency step and `via` names the KO
      // daughter of that level; her own reason stays hers.
      assert.deepEqual(shape, {
        status: "invalid",
        workspace: ".",
        name: "composed_flow",
        reason: "dependency_invalid",
        via: "auth_flow",
      });
      const surface = textOf(refused);
      assert.doesNotMatch(surface, /MOTHER BODY|DAUGHTER SECRET/);
      assert.ok(!surface.includes("file_hash_mismatch"), "the daughter's own reason is not her mother's");
      // Reading the daughter says what is actually wrong with her, with no via.
      const daughter = await callTool(client, KNOWLEDGE_READ, { name: "auth_flow" });
      assert.equal(daughter.structured.reason, "file_hash_mismatch");
      assert.equal(daughter.structured.via, undefined);
      // The transitional refusal of the contract ticket is gone: the byte that
      // was restored restores the composed read itself.
      writeFile(root, "src/auth.ts", "export const auth = 4;\n");
      const restored = await callTool(client, KNOWLEDGE_READ, { name: "composed_flow" });
      assert.equal(restored.structured.status, "valid", restored.text);
      assert.equal(restored.structured.body, "MOTHER BODY\n");
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
        warnings: [
          { name: "saved_flow", code: "insufficient_backing", distinctEvidencePaths: 1 },
          { name: "second_flow", code: "insufficient_backing", distinctEvidencePaths: 1 },
        ],
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

test("knowledge_save flags insufficiently backed entries instead of publishing them silently", async () => {
  const root = tempDir("codetour-knowledge-backing-");
  try {
    writeFile(root, "src/main.ts", "export const start = 1;\n");
    writeFile(root, "src/reader.ts", "export const read = () => 1;\n");
    await withServer(root, async (client) => {
      const created = await callTool(client, KNOWLEDGE_SAVE, {
        entries: [
          {
            name: "well_backed_flow",
            description: "Two distinct cited files back the entry",
            body: "Reference body.\n",
            evidence: [{ path: "src/main.ts" }, { path: "src/reader.ts" }],
          },
          {
            name: "single_path_flow",
            description: "Cites one distinct file only",
            body: "Reference body.\n",
            evidence: [{ path: "src/main.ts" }, { path: "src/main.ts" }],
          },
        ],
      });
      assert.equal(created.isError, false, created.text);
      assert.deepEqual(created.structured, {
        status: "created",
        workspace: ".",
        created: ["well_backed_flow", "single_path_flow"],
        warnings: [
          { name: "single_path_flow", code: "insufficient_backing", distinctEvidencePaths: 1 },
        ],
      });
      // The flag names the published entry loudly: no cited path and no hash
      // value is ever echoed by a publication result.
      assert.match(created.text, /insufficiently backed/);
      assert.match(created.text, /single_path_flow/);
      assert.doesNotMatch(textOf(created), /sha256|[0-9a-f]{64}/);
      assert.ok(!textOf(created).includes("src/main.ts"));
      assert.ok(!textOf(created).includes("src/reader.ts"));
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_save reports symbol fallback separately from insufficient backing", async () => {
  const root = tempDir("codetour-knowledge-fallback-");
  try {
    writeFile(root, "src/main.rb", "def dispatch; 1; end\n");
    writeFile(root, "src/other.ts", "export const other = 1;\n");
    await withServer(root, async client => {
      const created = await callTool(client, KNOWLEDGE_SAVE, {
        entries: [{
          name: "ruby_flow", description: "Ruby dispatch", body: "Reference body.\n",
          evidence: [{ type: "symbol", path: "src/main.rb", symbol: "dispatch" }, { path: "src/other.ts" }],
        }],
      });
      assert.equal(created.structured.status, "created");
      assert.deepEqual(created.structured.warnings, [
        { name: "ruby_flow", code: "symbol_proof_fallback", path: "src/main.rb", reason: "unsupported_language" },
      ]);
      assert.match(created.text, /ruby_flow fell back to a file proof \(unsupported_language\)/);
      assert.doesNotMatch(created.text, /insufficiently backed|src\/main\.rb|[0-9a-f]{64}/);
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge tools refuse an unparseable symbol on read and report creation fallback", async () => {
  const root = tempDir("codetour-knowledge-syntax-");
  try {
    writeFile(root, "main.ts", "export function dispatch() { return 1; }\n");
    await withServer(root, async client => {
      const entry = (name: string) => ({ name, description: "Dispatch", body: "SECRET BODY", evidence: [{ type: "symbol", path: "main.ts", symbol: "dispatch" }] });
      const saved = await callTool(client, KNOWLEDGE_SAVE, { entries: [entry("good")] });
      assert.equal(saved.structured.status, "created");
      writeFile(root, "main.ts", "export function dispatch() { const x = ; return 1; }\n");
      const read = await callTool(client, KNOWLEDGE_READ, { name: "good" });
      assert.equal(read.structured.reason, "symbol_unparseable");
      // An invalid entry still exposes the revision of its file bytes (spec
      // #232) so a repair can be conditioned on it; nothing else leaves.
      const revision = read.structured.revision as string;
      assert.equal(typeof revision, "string");
      assert.doesNotMatch(
        textOf(read).split(revision).join(""),
        /SECRET BODY|main\.ts|[0-9a-f]{64}/
      );
      const fallback = await callTool(client, KNOWLEDGE_SAVE, { entries: [entry("fallback")] });
      assert.equal(fallback.structured.status, "created");
      assert.match(fallback.text, /fallback fell back to a file proof \(symbol_unparseable\)/);
      assert.match(fs.readFileSync(path.join(catalogueDirectory(root), "fallback.md"), "utf8"), /origin: symbol_fallback/);
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_save and knowledge_read accept a hyphenated Knowledge name", async () => {
  const root = tempDir("codetour-knowledge-hyphen-");
  try {
    writeFile(root, "src/main.ts", "export const start = 1;\n");
    await withServer(root, async client => {
      const saved = await callTool(client, KNOWLEDGE_SAVE, {
        entries: [{ name: "lecture-verifiee", description: "Verified flow", body: "Reference body.\n", evidence: [{ path: "src/main.ts" }] }],
      });
      assert.equal(saved.structured.status, "created");
      const list = await callTool(client, KNOWLEDGE_LIST, {});
      assert.deepEqual(rowsWithoutRevisions(list.structured.entries), [{ name: "lecture-verifiee", description: "Verified flow" }]);
      const read = await callTool(client, KNOWLEDGE_READ, { name: "lecture-verifiee" });
      assert.equal(read.structured.status, "valid");
      assert.equal(read.structured.body, "Reference body.\n");
      const refused = await callTool(client, KNOWLEDGE_READ, { name: "../outside" });
      assert.equal(refused.structured.status, "invalid");
      assert.equal(refused.structured.body, undefined);
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_save treats a blank runId as no run instead of rejecting it", async () => {
  const root = tempDir("codetour-knowledge-blank-run-");
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, KNOWLEDGE_SAVE, { entries: [], runId: "" });
      assert.equal(response.isError, false, response.text);
      assert.equal((response.structured as { status: string }).status, "completed_zero");
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
          "get_generation_prompt",
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

test("knowledge_list exposes an opaque revision for verified entries and invalid rows alike", async () => {
  const root = tempDir("codetour-knowledge-revision-list-");
  try {
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
    type Row = { name: string; revision?: string };
    await withServer(root, async (client) => {
      const listed = await callTool(client, KNOWLEDGE_LIST, {});
      assert.equal(listed.isError, false, listed.text);
      const verified = (listed.structured.entries as Row[]).find((row) => row.name === "dispatch_flow");
      const broken = (listed.structured.invalid as Row[]).find((row) => row.name === "stale_flow");
      assert.ok(verified && broken);
      for (const row of [verified, broken]) {
        assert.equal(typeof row.revision, "string", `${row.name} must carry a revision`);
        assert.ok((row.revision as string).length > 0);
      }
      // Opaque: the token is neither a source hash nor a body, and discovery
      // still leaks no cited path.
      assert.notEqual(verified.revision, digest);
      assert.notEqual(broken.revision, digest);
      assert.doesNotMatch(JSON.stringify(listed.structured), /SECRET BODY|src\/main\.ts/);
      // Stable while the entry file is unchanged.
      const again = await callTool(client, KNOWLEDGE_LIST, {});
      assert.equal(
        (again.structured.entries as Row[]).find((row) => row.name === "dispatch_flow")?.revision,
        verified.revision
      );
      // A one-byte change moves the revision of an entry whose contract is
      // already failing, so a repair write can be conditioned on it.
      writeEntry(root, "stale_flow", {
        description: "Cites a changed file",
        body: "SECRET BODY stale, one byte more\n",
        evidence: [{ path: "src/main.ts" }],
      });
      const moved = await callTool(client, KNOWLEDGE_LIST, {});
      assert.notEqual(
        (moved.structured.invalid as Row[]).find((row) => row.name === "stale_flow")?.revision,
        broken.revision
      );
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_list surfaces invalid catalogue entries for fixing", async () => {
  const root = tempDir("codetour-knowledge-invalid-");
  try {
    const digest = writeWorkspaceFile(root, "src/main.ts", "export const start = 1;\n");
    writeEntry(root, "dispatch_flow", {
      description: "How tool calls dispatch",
      body: "Verified body.\n",
      evidence: [{ path: "src/main.ts", sha256: digest }],
    });
    writeEntry(root, "stale_flow", {
      description: "Cites a changed file",
      body: "STALE BODY\n",
      evidence: [{ path: "src/main.ts" }],
    });
    writeEntry(root, "symbol_flow", {
      description: "Uses an unsupported proof",
      body: "SYMBOL BODY\n",
      symbolProof: { path: "src/main.ts", symbol: "start", sha256: "f".repeat(64) },
    });
    // A name that contradicts its file stem is a static refusal, not an
    // invisible entry: the stem is reported so the fix points at the file.
    fs.writeFileSync(
      path.join(catalogueDirectory(root), "other_name.md"),
      ["---", "name: dispatch_flow", "description: Declared name differs", "evidence:", "  - type: file", "    path: src/main.ts", "---", "Body.\n"].join("\n")
    );

    await withServer(root, async (client) => {
      const listed = await callTool(client, KNOWLEDGE_LIST, {});
      assert.equal(listed.isError, false, listed.text);
      assert.deepEqual(pageWithoutRevisions(listed.structured), {
        status: "ok",
        workspace: ".",
        entries: [
          { name: "dispatch_flow", description: "How tool calls dispatch" },
        ],
        invalid: [
          { name: "other_name", reason: "malformed_contract" },
          { name: "stale_flow", reason: "file_hash_mismatch" },
          { name: "symbol_flow", reason: "symbol_hash_mismatch" },
        ],
        total: 1,
        offset: 0,
        limit: 50,
        truncated: false,
      });
      assert.match(listed.text, /failed validation/i);
      assert.match(listed.text, /3 catalogue entries failed validation/i);
      assert.match(listed.text, /listed under invalid with their reason/i);
      assert.match(listed.text, /fix the cited contract or remove the entry/i);
      // An invalid row carries its revision, and still no body, cited path or
      // evidence hash.
      const listedSurface = textOf(listed);
      assert.doesNotMatch(listedSurface, /SECRET BODY|sha256|src\/main\.ts/);
      for (const evidenceHash of [digest, "f".repeat(64)]) {
        assert.ok(!listedSurface.includes(evidenceHash), "no evidence hash may reach discovery");
      }
    });
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
    // A broken contract is reported, never hidden: the projection must name
    // it with its reason so the agent fixes it instead of ignoring it.
    writeEntry(root, "stale_flow", {
      description: "Cites a changed file",
      body: "PROMPT STALE BODY\n",
      evidence: [{ path: "src/main.ts" }],
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
      // Discovery verifies (ADR 0043): the projection claims exactly what
      // verification proves — the evidence contract matches, nothing more.
      assert.match(text, /Every listed entry is verified/i);
      assert.match(text, /never a body/i);
      assert.match(text, /knowledge_read/);
      assert.ok(!text.includes("Prompt body."), "the catalogue projection never carries a body");
      // The broken contract is named with its reason, and its body stays
      // unread: the projection reports, it does not serve content.
      assert.ok(text.includes("Catalogue entries that failed validation"));
      assert.ok(text.includes("`stale_flow` — file_hash_mismatch"));
      assert.ok(!text.includes("PROMPT STALE BODY"), "the invalid report never carries a body");
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

test("prompts/get carries every entry revision so a write mode needs no extra call", async () => {
  const root = tempDir("codetour-knowledge-prompt-revision-");
  try {
    const digest = writeWorkspaceFile(root, "src/main.ts", "export const start = 1;\n");
    writeEntry(root, "dispatch_flow", {
      description: "How tool calls dispatch",
      body: "Prompt body.\n",
      evidence: [{ path: "src/main.ts", sha256: digest }],
    });
    writeEntry(root, "stale_flow", {
      description: "Cites a changed file",
      body: "PROMPT STALE BODY\n",
      evidence: [{ path: "src/main.ts" }],
    });
    await withServer(root, async (client) => {
      const listed = await callTool(client, KNOWLEDGE_LIST, {});
      type Row = { name: string; revision?: string };
      const verified = (listed.structured.entries as Row[]).find((row) => row.name === "dispatch_flow");
      const broken = (listed.structured.invalid as Row[]).find((row) => row.name === "stale_flow");
      assert.ok(verified?.revision && broken?.revision);
      const prompt = await client.getPrompt({
        name: "generate_project_tour",
        arguments: { request: "Give me a tour of this project." },
      });
      const text = promptText(prompt.messages);
      // The projection carries the same tokens discovery returns: one call is
      // enough to choose a mode, including for an entry that cannot be read.
      assert.ok(text.includes(verified.revision as string), "the verified entry revision is projected");
      assert.ok(text.includes(broken.revision as string), "the invalid row revision is projected");
      assert.match(text, /revision/i);
      assert.match(text, /compare-and-swap/i);
      assert.ok(!text.includes("Prompt body."), "the projection still never carries a body");
      assert.ok(!text.includes("PROMPT STALE BODY"), "the invalid row still never carries a body");
    });
  } finally {
    rmrf(root);
  }
});

// Choosing the consolidation mode (spec #232, ticket #257). The three modes
// exist since #255 and #256; the served method must teach which one applies,
// in the contract's own vocabulary. Each test reads the prompt the real MCP
// server composes: no internals and no test-only seam.
test("prompts/get teaches the four consolidation cases with the contract's mode names", async () => {
  const root = tempDir("codetour-knowledge-mode-cases-");
  try {
    await withServer(root, async (client) => {
      const prompt = await client.getPrompt({
        name: "generate_project_tour",
        arguments: { request: "Give me a tour of this project." },
      });
      const text = promptText(prompt.messages);
      // The mode names of the contract, backticked: never a synonym, and
      // distinct from the `create_project_tour` tool and the `created` status.
      for (const mode of ["create", "append", "replace"]) {
        assert.ok(text.includes(`\`${mode}\``), `the method must name the \`${mode}\` mode`);
      }
      // 1. A subject the catalogue does not have: create.
      assert.match(text, /`create` for a subject the catalogue does not have/);
      // 2. Compatible additional information on an entry that still verifies,
      //    short and circumscribed: append.
      assert.match(text, /`append` for compatible additional information/);
      assert.match(text, /short and circumscribed/);
      // 3. Invalid entry, contradicted claim, needed restructuring or a risky
      //    addition: replace.
      assert.match(text, /`replace`, carrying that entry's revision, when an existing entry is invalid/);
      assert.match(text, /needs restructuring/);
      assert.match(text, /likely to contradict the existing body/);
      // 4. Nothing durable or an unresolved doubt: no fabricated entry.
      assert.match(text, /nothing durable/);
      assert.match(text, /never a fabricated Knowledge entry/);
    });
  } finally {
    rmrf(root);
  }
});

test("prompts/get orders a restart from the current code and no re-read of an invalid body", async () => {
  const root = tempDir("codetour-knowledge-mode-restart-");
  try {
    await withServer(root, async (client) => {
      const prompt = await client.getPrompt({
        name: "generate_project_tour",
        arguments: { request: "Give me a tour of this project." },
      });
      const text = promptText(prompt.messages);
      // A replacement is prepared from the code that was just read, not from
      // the entry being replaced: an invalid body never enters the context.
      assert.match(text, /restart from the current code/);
      assert.match(text, /rewrites the whole entry/i);
      assert.match(text, /never re-read an invalid body/);
    });
  } finally {
    rmrf(root);
  }
});

test("prompts/get states that the mode guidance is no proof of semantic consistency", async () => {
  const root = tempDir("codetour-knowledge-mode-semantics-");
  try {
    await withServer(root, async (client) => {
      const prompt = await client.getPrompt({
        name: "generate_project_tour",
        arguments: { request: "Give me a tour of this project." },
      });
      const text = promptText(prompt.messages);
      // A fingerprint proves unchanged bytes, never the truth of the text, and
      // no natural-language contradiction is detected by the server.
      assert.match(text, /not a proof of semantic consistency/);
      assert.match(text, /SHA-256 fingerprint proves that the cited bytes are unchanged/);
      assert.match(text, /never that the text is true/);
      assert.match(text, /detects no contradiction written in natural language/);
    });
  } finally {
    rmrf(root);
  }
});

test("the mode guidance adds no second consolidation pass and no second orchestrator", async () => {
  const root = tempDir("codetour-knowledge-mode-single-pass-");
  try {
    await withServer(root, async (client) => {
      const prompt = await client.getPrompt({
        name: "generate_project_tour",
        arguments: { request: "Give me a tour of this project." },
      });
      const text = promptText(prompt.messages);
      // The consolidation stays one assessment in the single-continuation
      // design: the mode rule adds a choice, not a loop or a second agent.
      assert.match(text, /one consolidation assessment/);
      assert.match(text, /no second consolidation pass/);
      assert.doesNotMatch(
        text,
        /second (?:agent|model|orchestrator)|another (?:agent|model)\b|retry loop|loop until/i
      );
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

test("knowledge_save replaces an existing entry against the revision that was read", async () => {
  const root = tempDir("codetour-knowledge-replace-");
  try {
    writeFile(root, "src/main.ts", "export const start = 1;\n");
    writeFile(root, "src/reader.ts", "export const read = () => 1;\n");
    await withServer(root, async (client) => {
      const created = await callTool(client, KNOWLEDGE_SAVE, {
        entries: [
          {
            name: "dispatch_flow",
            description: "Initial description",
            body: "OLD BODY never served.\n",
            evidence: [{ path: "src/main.ts" }],
          },
        ],
      });
      assert.equal(created.structured.status, "created", created.text);
      const read = await callTool(client, KNOWLEDGE_READ, { name: "dispatch_flow" });
      const revision = read.structured.revision;

      const replaced = await callTool(client, KNOWLEDGE_SAVE, {
        mode: "replace",
        entries: [
          {
            name: "dispatch_flow",
            description: "How dispatch reaches the reader",
            body: "## Dispatch\n\nNEW BODY.\n",
            evidence: [{ path: "src/main.ts" }, { path: "src/reader.ts" }],
            expectedRevision: revision,
          },
        ],
      });
      assert.equal(replaced.isError, false, replaced.text);
      assert.deepEqual(replaced.structured, {
        status: "replaced",
        workspace: ".",
        replaced: ["dispatch_flow"],
        warnings: [],
      });
      // Neither the old nor the new body is echoed by the publication result.
      assert.doesNotMatch(textOf(replaced), /OLD BODY|NEW BODY|sha256|[0-9a-f]{64}/);

      // The entry is now the whole new contract, and it carries a new revision.
      const after = await callTool(client, KNOWLEDGE_READ, { name: "dispatch_flow" });
      assert.equal(after.structured.status, "valid");
      assert.equal(after.structured.body, "## Dispatch\n\nNEW BODY.\n");
      assert.notEqual(after.structured.revision, revision);
      const source = fs.readFileSync(
        path.join(catalogueDirectory(root), "dispatch_flow.md"),
        "utf8"
      );
      assert.match(
        source,
        /^---\nname: dispatch_flow\ndescription: How dispatch reaches the reader\nevidence:\n/
      );
      assert.match(source, /---\n## Dispatch\n\nNEW BODY\.\n$/);
      assert.deepEqual(
        fs.readdirSync(catalogueDirectory(root)).sort(),
        ["dispatch_flow.md"],
        "no staging file and no lock file survive the publication"
      );
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_save replace refuses a stale revision, an unknown name and a client-supplied origin", async () => {
  const root = tempDir("codetour-knowledge-replace-refuse-");
  const runId = "run-replace-refuse-0001";
  try {
    const digest = writeWorkspaceFile(root, "src/main.ts", "export const start = 1;\n");
    writeEntry(root, "dispatch_flow", {
      description: "Cites a changed file",
      body: "STALE SECRET BODY\n",
      evidence: [{ path: "src/main.ts" }],
    });
    writeEntry(root, "valid_flow", {
      description: "Verified entry",
      body: "Verified body.\n",
      evidence: [{ path: "src/main.ts", sha256: digest }],
    });
    const brokenPath = path.join(catalogueDirectory(root), "dispatch_flow.md");
    const before = fs.readFileSync(brokenPath);
    await withServer(root, async (client) => {
      const listed = await callTool(client, KNOWLEDGE_LIST, {});
      type Row = { name: string; revision?: string };
      const broken = (listed.structured.invalid as Row[]).find((row) => row.name === "dispatch_flow");
      const verified = (listed.structured.entries as Row[]).find((row) => row.name === "valid_flow");
      assert.ok(broken?.revision && verified?.revision);

      const stale = await callTool(client, KNOWLEDGE_SAVE, {
        runId,
        mode: "replace",
        entries: [
          {
            name: "dispatch_flow",
            description: "Repair attempt with a token that is no longer the file's",
            body: "Repaired body.\n",
            evidence: [{ path: "src/main.ts" }],
            expectedRevision: verified.revision,
          },
        ],
      });
      assert.equal(stale.isError, true, stale.text);
      assert.deepEqual(stale.structured.conflicts, [
        { name: "dispatch_flow", reason: "revision_conflict" },
      ]);
      // A stale revision is a failed consolidation, never a success, and the
      // file keeps the bytes the caller did not see.
      assert.equal((stale.structured.consolidation as { status: string }).status, "failed");
      assert.equal((stale.structured.consolidation as { outcome: string }).outcome, "conflict");
      assert.match(stale.text, /revision/i);
      assert.doesNotMatch(textOf(stale), /STALE SECRET BODY/);
      assert.deepEqual(fs.readFileSync(brokenPath), before);

      const absent = await callTool(client, KNOWLEDGE_SAVE, {
        runId,
        mode: "replace",
        entries: [
          {
            name: "never_written",
            description: "replace is not an upsert",
            body: "Body.\n",
            evidence: [{ path: "src/main.ts" }],
            expectedRevision: verified.revision,
          },
        ],
      });
      assert.equal(absent.isError, true, absent.text);
      assert.deepEqual(absent.structured.rejected, [
        { name: "never_written", reason: "unknown_entry" },
      ]);
      assert.equal((absent.structured.consolidation as { outcome: string }).outcome, "invalid");
      assert.equal(fs.existsSync(path.join(catalogueDirectory(root), "never_written.md")), false);

      // `origin` is engine-only: a caller cannot decorate a file proof with a
      // fallback it never suffered.
      const faked = await callTool(client, KNOWLEDGE_SAVE, {
        entries: [
          {
            name: "faked_fallback",
            description: "Declares an engine trace",
            body: "Body.\n",
            evidence: [{ path: "src/main.ts", origin: "symbol_fallback" }],
          },
        ],
      });
      assert.equal(faked.isError, true, faked.text);
      assert.deepEqual(faked.structured.rejected, [
        { name: "faked_fallback", reason: "malformed_evidence" },
      ]);

      const unknownMode = await callTool(client, KNOWLEDGE_SAVE, {
        mode: "upsert",
        entries: [
          {
            name: "any_flow",
            description: "Unknown mode",
            body: "Body.\n",
            evidence: [{ path: "src/main.ts" }],
          },
        ],
      });
      assert.equal(unknownMode.isError, true, unknownMode.text);
      assert.deepEqual(unknownMode.structured.rejected, [{ reason: "unknown_mode" }]);

      // The invalid entry stays repairable with its own revision, and the
      // repaired entry reads valid again.
      const repair = await callTool(client, KNOWLEDGE_SAVE, {
        runId,
        mode: "replace",
        entries: [
          {
            name: "dispatch_flow",
            description: "Repaired from the current code",
            body: "Repaired body.\n",
            evidence: [{ path: "src/main.ts" }],
            expectedRevision: broken.revision,
          },
        ],
      });
      assert.equal(repair.isError, false, repair.text);
      assert.equal(repair.structured.status, "replaced");
      const read = await callTool(client, KNOWLEDGE_READ, { name: "dispatch_flow" });
      assert.equal(read.structured.status, "valid");
      assert.equal(read.structured.body, "Repaired body.\n");
    });
  } finally {
    rmrf(root);
  }
});

// The Consolidation Closure accumulates facts across the save calls of one
// run: a replaced name lands in `changed[]`, distinct from `created[]`, and
// the merge precedence never depends on the order of the calls.
test("a replace closure records changed names, distinct from created ones, and merges order-independently", async () => {
  const root = tempDir("codetour-knowledge-replace-closure-");
  try {
    const digest = writeWorkspaceFile(root, "src/main.ts", "export const start = 1;\n");
    const seed = (name: string, body: string): void =>
      writeEntry(root, name, {
        description: `Seeded ${name}`,
        body,
        evidence: [{ path: "src/main.ts", sha256: digest }],
      });
    const replaceArgs = (name: string, revision: string, body: string) => ({
      mode: "replace",
      entries: [
        {
          name,
          description: `Rewritten ${name}`,
          body,
          evidence: [{ path: "src/main.ts" }],
          expectedRevision: revision,
        },
      ],
    });
    const stateOf = (runId: string) => readRunState(fs.realpathSync(root), runId);

    await withServer(root, async (client) => {
      const revisionOf = async (name: string): Promise<string> =>
        (await callTool(client, KNOWLEDGE_READ, { name })).structured.revision as string;

      // A run that only rewrites records `replaced` and `changed`.
      const replaceOnlyRun = "run-replace-only-0001";
      seed("seeded_flow", "Seed body.\n");
      const replaced = await callTool(client, KNOWLEDGE_SAVE, {
        runId: replaceOnlyRun,
        ...replaceArgs("seeded_flow", await revisionOf("seeded_flow"), "Rewritten body.\n"),
      });
      assert.equal(replaced.isError, false, replaced.text);
      assert.equal(replaced.structured.status, "replaced");
      const replacedClosure = replaced.structured.consolidation as {
        status: string;
        created?: string[];
        changed: string[];
        outcome: string;
      };
      assert.equal(replacedClosure.status, "replaced");
      assert.equal(replacedClosure.outcome, "replaced");
      assert.deepEqual(replacedClosure.changed, ["seeded_flow"]);
      assert.equal(replacedClosure.created, undefined);
      const replacedState = await stateOf(replaceOnlyRun);
      assert.equal(replacedState?.consolidation?.status, "replaced");
      assert.deepEqual(replacedState?.consolidation?.changed, ["seeded_flow"]);

      // create then replace, and replace then create: the same Run State.
      for (const order of ["create-first", "replace-first"] as const) {
        const runId = `run-replace-${order}`;
        const createdName = `created_flow_${order.replace("-", "_")}`;
        seed("seeded_flow", "Seed body.\n");
        const replacement = () =>
          callTool(client, KNOWLEDGE_SAVE, {
            runId,
            ...replaceArgs("seeded_flow", replaceCache, "Rewritten body.\n"),
          });
        const creation = () =>
          callTool(client, KNOWLEDGE_SAVE, {
            runId,
            entries: [
              {
                name: createdName,
                description: "Created by this run",
                body: "Created body.\n",
                evidence: [{ path: "src/main.ts" }],
              },
            ],
          });
        const replaceCache = await revisionOf("seeded_flow");
        const first = order === "create-first" ? await creation() : await replacement();
        const second = order === "create-first" ? await replacement() : await creation();
        assert.equal(first.isError, false, first.text);
        assert.equal(second.isError, false, second.text);
        const closure = second.structured.consolidation as {
          status: string;
          created: string[];
          changed: string[];
          outcome: string;
        };
        assert.equal(closure.status, "created", `${order}: a creation outranks a rewrite`);
        assert.deepEqual(closure.created, [createdName], order);
        assert.deepEqual(closure.changed, ["seeded_flow"], order);
        assert.equal(closure.outcome, "created", order);
        const state = await stateOf(runId);
        assert.deepEqual(state?.consolidation, closure);
      }

      // A later explicit zero never erases a rewrite that happened.
      const zeroAfterRun = "run-replace-then-zero";
      seed("seeded_flow", "Seed body.\n");
      await callTool(client, KNOWLEDGE_SAVE, {
        runId: zeroAfterRun,
        ...replaceArgs("seeded_flow", await revisionOf("seeded_flow"), "Rewritten body.\n"),
      });
      const zero = await callTool(client, KNOWLEDGE_SAVE, { runId: zeroAfterRun, entries: [] });
      assert.equal(zero.isError, false, zero.text);
      const zeroClosure = zero.structured.consolidation as { status: string; changed: string[] };
      assert.equal(zeroClosure.status, "replaced");
      assert.deepEqual(zeroClosure.changed, ["seeded_flow"]);
    });
  } finally {
    rmrf(root);
  }
});

// Enriching an entry without rewriting its body (spec #232, ticket #256). The
// observation is the returned vocabulary, the exact bytes on disk and the
// closure the Run State keeps.
test("knowledge_save appends one section without rewriting the historical body", async () => {
  const root = tempDir("codetour-knowledge-append-");
  try {
    writeFile(root, "src/main.ts", "export const start = 1;\n");
    writeFile(root, "src/reader.ts", "export const read = () => 1;\n");
    const historicalBody = "## Dispatch\n\nHISTORICAL BODY kept verbatim.\n";
    await withServer(root, async (client) => {
      const created = await callTool(client, KNOWLEDGE_SAVE, {
        entries: [
          {
            name: "dispatch_flow",
            description: "How dispatch reaches the reader",
            body: historicalBody,
            evidence: [{ path: "src/main.ts" }],
          },
        ],
      });
      assert.equal(created.structured.status, "created", created.text);
      const revision = (await callTool(client, KNOWLEDGE_READ, { name: "dispatch_flow" }))
        .structured.revision;

      const appended = await callTool(client, KNOWLEDGE_SAVE, {
        mode: "append",
        entries: [
          {
            name: "dispatch_flow",
            addition: "## Exceptions\n\nNew section.\n",
            evidence: [{ path: "src/reader.ts" }],
            expectedRevision: revision,
          },
        ],
      });
      assert.equal(appended.isError, false, appended.text);
      assert.deepEqual(appended.structured, {
        status: "appended",
        workspace: ".",
        appended: ["dispatch_flow"],
        warnings: [],
      });
      // The addition is not echoed by the publication result.
      assert.doesNotMatch(textOf(appended), /New section|HISTORICAL BODY|sha256|[0-9a-f]{64}/);

      // The body on disk is the historical body, one blank line and the
      // verbatim addition: the read grammar stays the only grammar.
      const after = await callTool(client, KNOWLEDGE_READ, { name: "dispatch_flow" });
      assert.equal(after.structured.status, "valid");
      assert.equal(after.structured.body, `${historicalBody}\n## Exceptions\n\nNew section.\n`);
      assert.ok(
        (after.structured.body as string).startsWith(historicalBody),
        "the historical body is an exact prefix of the appended one"
      );
      assert.deepEqual(
        (after.structured.evidence as Array<{ path: string }>).map((proof) => proof.path),
        ["src/main.ts", "src/reader.ts"]
      );
      assert.equal(after.structured.description, "How dispatch reaches the reader");
      assert.notEqual(after.structured.revision, revision);
      const source = fs.readFileSync(
        path.join(catalogueDirectory(root), "dispatch_flow.md"),
        "utf8"
      );
      assert.match(source, /\n---\n## Dispatch\n\nHISTORICAL BODY kept verbatim\.\n\n## Exceptions\n\nNew section\.\n$/);
      assert.deepEqual(
        fs.readdirSync(catalogueDirectory(root)).sort(),
        ["dispatch_flow.md"],
        "no staging file and no lock file survive the append"
      );
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_save reports a literal no-op append as no_change and closes the run at zero", async () => {
  const root = tempDir("codetour-knowledge-append-nochange-");
  const runId = "run-append-nochange-01";
  try {
    const digest = writeWorkspaceFile(root, "src/main.ts", "export const start = 1;\n");
    writeEntry(root, "dispatch_flow", {
      description: "Verified entry",
      body: "Historical body.\n",
      evidence: [{ path: "src/main.ts", sha256: digest }],
    });
    const entryFile = path.join(catalogueDirectory(root), "dispatch_flow.md");
    const before = fs.readFileSync(entryFile);
    await withServer(root, async (client) => {
      const revision = (await callTool(client, KNOWLEDGE_READ, { name: "dispatch_flow" }))
        .structured.revision;
      const noChange = await callTool(client, KNOWLEDGE_SAVE, {
        runId,
        mode: "append",
        entries: [
          { name: "dispatch_flow", addition: "  \n", evidence: [], expectedRevision: revision },
        ],
      });
      assert.equal(noChange.isError, false, noChange.text);
      assert.equal(noChange.structured.status, "no_change");
      // A completed consolidation with nothing to persist is not an omission:
      // the run is closed at zero, while the tool result stays distinct.
      const closure = noChange.structured.consolidation as { status: string; outcome: string };
      assert.equal(closure.status, "completed_zero");
      assert.equal(closure.outcome, "no_change");
      assert.deepEqual(fs.readFileSync(entryFile), before);
      const state = await readRunState(fs.realpathSync(root), runId);
      assert.equal(state?.consolidation?.status, "completed_zero");

      // An addition already present as an exact suffix adds nothing either.
      const suffix = await callTool(client, KNOWLEDGE_SAVE, {
        mode: "append",
        entries: [
          {
            name: "dispatch_flow",
            addition: "Historical body.\n",
            evidence: [{ path: "src/main.ts" }],
            expectedRevision: revision,
          },
        ],
      });
      assert.equal(suffix.structured.status, "no_change");
      assert.deepEqual(fs.readFileSync(entryFile), before);
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_save append refuses a stale historical entry and orients to replace", async () => {
  const root = tempDir("codetour-knowledge-append-stale-");
  const runId = "run-append-stale-0001";
  try {
    writeFile(root, "src/main.ts", "export const start = 1;\n");
    writeFile(root, "src/reader.ts", "export const read = () => 1;\n");
    const catalogue = catalogueDirectory(root);
    fs.mkdirSync(catalogue, { recursive: true });
    const staleSource = [
      "---",
      "name: stale_flow",
      "description: Cites bytes that moved",
      "evidence:",
      "  - type: file",
      "    path: src/main.ts",
      `    sha256: ${"f".repeat(64)}`,
      "---",
      "STALE SECRET BODY\n",
    ].join("\n");
    const entryFile = path.join(catalogue, "stale_flow.md");
    fs.writeFileSync(entryFile, staleSource);
    const before = fs.readFileSync(entryFile);
    await withServer(root, async (client) => {
      const listed = await callTool(client, KNOWLEDGE_LIST, {});
      type Row = { name: string; revision?: string };
      const broken = (listed.structured.invalid as Row[]).find((row) => row.name === "stale_flow");
      assert.ok(broken?.revision);

      const refused = await callTool(client, KNOWLEDGE_SAVE, {
        runId,
        mode: "append",
        entries: [
          {
            name: "stale_flow",
            addition: "## More\n",
            evidence: [{ path: "src/reader.ts" }],
            expectedRevision: broken.revision,
          },
        ],
      });
      assert.equal(refused.isError, true, refused.text);
      assert.deepEqual(refused.structured.rejected, [
        { name: "stale_flow", reason: "stale_evidence" },
      ]);
      // The corrective action is stated: an append cannot repair a false base.
      assert.match(refused.text, /replace/);
      assert.doesNotMatch(textOf(refused), /STALE SECRET BODY/);
      assert.equal((refused.structured.consolidation as { outcome: string }).outcome, "invalid");
      assert.deepEqual(fs.readFileSync(entryFile), before);
    });
  } finally {
    rmrf(root);
  }
});

test("knowledge_save append refuses a stale revision, a blank-revision call and a multi-entry append", async () => {
  const root = tempDir("codetour-knowledge-append-refuse-");
  try {
    const digest = writeWorkspaceFile(root, "src/main.ts", "export const start = 1;\n");
    writeEntry(root, "dispatch_flow", {
      description: "Verified entry",
      body: "Historical body.\n",
      evidence: [{ path: "src/main.ts", sha256: digest }],
    });
    const entryFile = path.join(catalogueDirectory(root), "dispatch_flow.md");
    const before = fs.readFileSync(entryFile);
    await withServer(root, async (client) => {
      const revision = (await callTool(client, KNOWLEDGE_READ, { name: "dispatch_flow" }))
        .structured.revision;
      const appendEntry = (revisionValue: unknown) => ({
        name: "dispatch_flow",
        addition: "## More\n",
        evidence: [{ path: "src/main.ts" }],
        expectedRevision: revisionValue,
      });

      const absent = await callTool(client, KNOWLEDGE_SAVE, {
        mode: "append",
        entries: [{ name: "dispatch_flow", addition: "## More\n", evidence: [{ path: "src/main.ts" }] }],
      });
      assert.equal(absent.isError, true, absent.text);
      assert.deepEqual(absent.structured.conflicts, [
        { name: "dispatch_flow", reason: "revision_conflict" },
      ]);

      const stale = await callTool(client, KNOWLEDGE_SAVE, {
        mode: "append",
        entries: [appendEntry("a".repeat(64))],
      });
      assert.equal(stale.isError, true, stale.text);
      assert.deepEqual(stale.structured.conflicts, [
        { name: "dispatch_flow", reason: "revision_conflict" },
      ]);
      assert.match(stale.text, /revision/i);
      assert.deepEqual(fs.readFileSync(entryFile), before);

      // A carriage return in the addition would corrupt the file.
      const carriage = await callTool(client, KNOWLEDGE_SAVE, {
        mode: "append",
        entries: [{ ...appendEntry(revision), addition: "## More\r\n\r\nText.\r\n" }],
      });
      assert.equal(carriage.isError, true, carriage.text);
      assert.deepEqual(carriage.structured.rejected, [
        { name: "dispatch_flow", reason: "invalid_body" },
      ]);
      assert.deepEqual(fs.readFileSync(entryFile), before);

      // The documented `entries` array is kept, but an append is one entry.
      const many = await callTool(client, KNOWLEDGE_SAVE, {
        mode: "append",
        entries: [appendEntry(revision), { ...appendEntry(revision), name: "other_flow" }],
      });
      assert.equal(many.isError, true, many.text);
      assert.deepEqual(many.structured.rejected, [{ reason: "mode_requires_single_entry" }]);
      assert.deepEqual(fs.readFileSync(entryFile), before);

      // An unknown mode is still refused, never treated as create.
      const unknown = await callTool(client, KNOWLEDGE_SAVE, {
        mode: "upsert",
        entries: [appendEntry(revision)],
      });
      assert.equal(unknown.isError, true, unknown.text);
      assert.deepEqual(unknown.structured.rejected, [{ reason: "unknown_mode" }]);
      assert.deepEqual(fs.readFileSync(entryFile), before);
    });
  } finally {
    rmrf(root);
  }
});

// The closure accumulates appended names in `changed[]`, distinct from
// `created[]`, and the merge precedence never depends on the call order.
test("an append closure records changed names and outranks an explicit zero", async () => {
  const root = tempDir("codetour-knowledge-append-closure-");
  try {
    const mainDigest = writeWorkspaceFile(root, "src/main.ts", "export const start = 1;\n");
    writeFile(root, "src/reader.ts", "export const read = () => 1;\n");
    const stateOf = (runId: string) => readRunState(fs.realpathSync(root), runId);
    const seed = (): void =>
      writeEntry(root, "seeded_flow", {
        description: "Seeded entry",
        body: "Seed body.\n",
        evidence: [{ path: "src/main.ts", sha256: mainDigest }],
      });

    await withServer(root, async (client) => {
      const revisionOf = async (name: string): Promise<string> =>
        (await callTool(client, KNOWLEDGE_READ, { name })).structured.revision as string;
      const creation = (runId: string, name: string) =>
        callTool(client, KNOWLEDGE_SAVE, {
          runId,
          entries: [
            {
              name,
              description: "Created by this run",
              body: "Created body.\n",
              evidence: [{ path: "src/main.ts" }, { path: "src/reader.ts" }],
            },
          ],
        });
      const appendArgs = (revision: string) => ({
        mode: "append",
        entries: [
          {
            name: "seeded_flow",
            addition: "## Appended\n\nAppended body.\n",
            evidence: [{ path: "src/main.ts" }],
            expectedRevision: revision,
          },
        ],
      });

      // A run that only appends records `appended` and `changed`.
      const appendOnlyRun = "run-append-only-0001";
      seed();
      const appended = await callTool(client, KNOWLEDGE_SAVE, {
        runId: appendOnlyRun,
        ...appendArgs(await revisionOf("seeded_flow")),
      });
      assert.equal(appended.isError, false, appended.text);
      assert.equal(appended.structured.status, "appended");
      const appendClosure = appended.structured.consolidation as {
        status: string;
        created?: string[];
        changed: string[];
        outcome: string;
      };
      assert.equal(appendClosure.status, "appended");
      assert.equal(appendClosure.outcome, "appended");
      assert.deepEqual(appendClosure.changed, ["seeded_flow"]);
      assert.equal(appendClosure.created, undefined);
      assert.deepEqual((await stateOf(appendOnlyRun))?.consolidation, appendClosure);

      // create then append, and append then create: the same Run State, and a
      // creation always outranks an append.
      for (const order of ["create-first", "append-first"] as const) {
        const runId = `run-append-${order}`;
        const createdName = `created_flow_${order.replace("-", "_")}`;
        seed();
        const appendCall = () =>
          callTool(client, KNOWLEDGE_SAVE, {
            runId,
            ...appendArgs(appendRevision),
          });
        const createCall = () => creation(runId, createdName);
        const appendRevision = await revisionOf("seeded_flow");
        const first = order === "create-first" ? await createCall() : await appendCall();
        const second = order === "create-first" ? await appendCall() : await createCall();
        assert.equal(first.isError, false, first.text);
        assert.equal(second.isError, false, second.text);
        const closure = second.structured.consolidation as {
          status: string;
          created: string[];
          changed: string[];
          outcome: string;
        };
        assert.equal(closure.status, "created", `${order}: a creation outranks an append`);
        assert.deepEqual(closure.created, [createdName], order);
        assert.deepEqual(closure.changed, ["seeded_flow"], order);
        assert.equal(closure.outcome, "created", order);
        assert.deepEqual((await stateOf(runId))?.consolidation, closure);
      }

      // An append and a rewrite share one rank, so the Run State resolves the
      // tie the same way whichever call came first: a fixed winner, never the
      // call order.
      for (const order of ["append-first", "replace-first"] as const) {
        const runId = `run-append-tie-${order}`;
        seed();
        writeEntry(root, "other_flow", {
          description: "Second seeded entry",
          body: "Other seed body.\n",
          evidence: [{ path: "src/main.ts", sha256: mainDigest }],
        });
        const seedRevision = await revisionOf("seeded_flow");
        const otherRevision = await revisionOf("other_flow");
        const appendStep = () =>
          callTool(client, KNOWLEDGE_SAVE, { runId, ...appendArgs(seedRevision) });
        const replaceStep = () =>
          callTool(client, KNOWLEDGE_SAVE, {
            runId,
            mode: "replace",
            entries: [
              {
                name: "other_flow",
                description: "Rewritten by this run",
                body: "Rewritten body.\n",
                evidence: [{ path: "src/main.ts" }],
                expectedRevision: otherRevision,
              },
            ],
          });
        const first = order === "append-first" ? await appendStep() : await replaceStep();
        const second = order === "append-first" ? await replaceStep() : await appendStep();
        assert.equal(first.isError, false, first.text);
        assert.equal(second.isError, false, second.text);
        const closure = second.structured.consolidation as {
          status: string;
          changed: string[];
        };
        assert.equal(closure.status, "replaced", `${order}: the tie resolves the same way`);
        assert.deepEqual([...closure.changed].sort(), ["other_flow", "seeded_flow"], order);
        assert.deepEqual((await stateOf(runId))?.consolidation, closure);
      }

      // A later explicit zero never erases an append that happened.
      const zeroAfterRun = "run-append-then-zero";
      seed();
      await callTool(client, KNOWLEDGE_SAVE, {
        runId: zeroAfterRun,
        ...appendArgs(await revisionOf("seeded_flow")),
      });
      const zero = await callTool(client, KNOWLEDGE_SAVE, { runId: zeroAfterRun, entries: [] });
      assert.equal(zero.isError, false, zero.text);
      const zeroClosure = zero.structured.consolidation as { status: string; changed: string[] };
      assert.equal(zeroClosure.status, "appended");
      assert.deepEqual(zeroClosure.changed, ["seeded_flow"]);
    });
  } finally {
    rmrf(root);
  }
});

// Ticket #257 asks for a real Copilot run producing one create, one append and
// one replace. A real Copilot session is unavailable in this harness, so the
// run is simulated at the MCP seam: the three operations under one runId,
// observed through the Consolidation Closure the Run State keeps.
test("one run performing create, append and replace closes created with both name lists", async () => {
  const root = tempDir("codetour-knowledge-three-modes-");
  const runId = "run-three-modes-0001";
  try {
    const digest = writeWorkspaceFile(root, "src/main.ts", "export const start = 1;\n");
    writeFile(root, "src/reader.ts", "export const read = () => 1;\n");
    const seed = (name: string, body: string): void =>
      writeEntry(root, name, {
        description: `Seeded ${name}`,
        body,
        evidence: [{ path: "src/main.ts", sha256: digest }],
      });
    await withServer(root, async (client) => {
      const revisionOf = async (name: string): Promise<string> =>
        (await callTool(client, KNOWLEDGE_READ, { name })).structured.revision as string;

      // create: a subject the catalogue does not have.
      const created = await callTool(client, KNOWLEDGE_SAVE, {
        runId,
        entries: [
          {
            name: "created_flow",
            description: "Created by this run",
            body: "Created body.\n",
            evidence: [{ path: "src/main.ts" }],
          },
        ],
      });
      assert.equal(created.structured.status, "created", created.text);

      // append: a short compatible addition to an entry that still verifies.
      seed("appended_flow", "Historical body.\n");
      const appended = await callTool(client, KNOWLEDGE_SAVE, {
        runId,
        mode: "append",
        entries: [
          {
            name: "appended_flow",
            addition: "## Appended\n\nAppended body.\n",
            evidence: [{ path: "src/reader.ts" }],
            expectedRevision: await revisionOf("appended_flow"),
          },
        ],
      });
      assert.equal(appended.structured.status, "appended", appended.text);

      // replace: an existing entry rewritten in full from the current code.
      seed("replaced_flow", "Stale body.\n");
      const replaced = await callTool(client, KNOWLEDGE_SAVE, {
        runId,
        mode: "replace",
        entries: [
          {
            name: "replaced_flow",
            description: "Rewritten from the current code",
            body: "Rewritten body.\n",
            evidence: [{ path: "src/main.ts" }, { path: "src/reader.ts" }],
            expectedRevision: await revisionOf("replaced_flow"),
          },
        ],
      });
      assert.equal(replaced.structured.status, "replaced", replaced.text);

      // One run, three modes: a creation outranks the modifications, and the
      // two name lists stay distinct.
      const closure = replaced.structured.consolidation as {
        status: string;
        created: string[];
        changed: string[];
        outcome: string;
      };
      assert.equal(closure.status, "created");
      assert.equal(closure.outcome, "created");
      assert.deepEqual(closure.created, ["created_flow"]);
      assert.deepEqual([...closure.changed].sort(), ["appended_flow", "replaced_flow"]);
      assert.deepEqual((await readRunState(fs.realpathSync(root), runId))?.consolidation, closure);

      // The three publications are what the closure says they are.
      const appendedRead = await callTool(client, KNOWLEDGE_READ, { name: "appended_flow" });
      assert.equal(appendedRead.structured.body, "Historical body.\n\n## Appended\n\nAppended body.\n");
      const rewritten = await callTool(client, KNOWLEDGE_READ, { name: "replaced_flow" });
      assert.equal(rewritten.structured.body, "Rewritten body.\n");
      assert.equal(rewritten.structured.description, "Rewritten from the current code");
    });
  } finally {
    rmrf(root);
  }
});
