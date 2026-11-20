import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "dist", "cli.js");
const catalogue = ".tours/.memory/knowledge";

// The packaged CLI's boundary is the seam under test: a temporary workspace
// outside the repository, no model credential and no network configuration.
function credentialFreeEnv() {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME
  };
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/^(TMPDIR|TEMP|TMP|SystemRoot|ComSpec|PATHEXT|USERPROFILE|LOCALAPPDATA|APPDATA|windir)$/i.test(key)) {
      env[key] = value;
    }
  }
  return env;
}

function runCli(args, { cwd, env = {} } = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...credentialFreeEnv(), ...env },
    timeout: 30000
  });
  let json;
  if (result.stdout.trim()) {
    try {
      json = JSON.parse(result.stdout);
    } catch {
      json = undefined;
    }
  }
  return { ...result, json };
}

function workspace(prefix) {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function writeCatalogueEntry(ws, fileName, frontmatter, body) {
  mkdirSync(path.join(ws, catalogue), { recursive: true });
  writeFileSync(path.join(ws, catalogue, fileName), `---\n${frontmatter}\n---\n${body}`);
}

function entry(name, description, proofs, body = "Verified body.\n") {
  const lines = [`name: ${name}`, `description: ${description}`, "evidence:"];
  for (const proof of proofs) {
    lines.push("  - type: file", `    path: ${proof.path}`, `    sha256: ${proof.sha256}`);
  }
  return { frontmatter: lines.join("\n"), body };
}

function seedValidWorkspace(ws, { name = "dispatch_flow", description = "How tool calls dispatch" } = {}) {
  writeFileSync(path.join(ws, "main.ts"), "export const start = 1;\n");
  const content = entry(name, description, [{ path: "main.ts", sha256: sha256("export const start = 1;\n") }]);
  writeCatalogueEntry(ws, `${name}.md`, content.frontmatter, content.body);
}

test("knowledge list reports name and description only from the resolved workspace", () => {
  const ws = workspace("codetour-knowledge-list-");
  try {
    seedValidWorkspace(ws);
    writeFileSync(path.join(ws, "other.ts"), "other\n");
    const second = entry("other_flow", "Second entry", [{ path: "other.ts", sha256: sha256("other\n") }]);
    writeCatalogueEntry(ws, "other_flow.md", second.frontmatter, second.body);

    const result = runCli(["knowledge", "list"], { cwd: ws });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.json, {
      status: "ok",
      workspace: ws,
      entries: [
        { name: "dispatch_flow", description: "How tool calls dispatch" },
        { name: "other_flow", description: "Second entry" }
      ],
      invalid: []
    });
    // Discovery is metadata only: no body, evidence or hash reaches stdout.
    assert.doesNotMatch(result.stdout, /Verified body|sha256|main\.ts/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("knowledge list filters a literal case-insensitive query and reports an empty catalogue as absence", () => {
  const ws = workspace("codetour-knowledge-list-empty-");
  const absent = workspace("codetour-knowledge-list-absent-");
  try {
    seedValidWorkspace(ws);
    const filtered = runCli(["knowledge", "list", "--query", "DISPATCH"], { cwd: ws });
    assert.equal(filtered.status, 0, filtered.stderr);
    assert.deepEqual(filtered.json.entries, [{ name: "dispatch_flow", description: "How tool calls dispatch" }]);

    const unmatched = runCli(["knowledge", "list", "--query", "no-such-entry"], { cwd: ws });
    assert.equal(unmatched.status, 3, unmatched.stderr);
    assert.deepEqual(unmatched.json, { status: "empty", workspace: ws, entries: [], invalid: [] });

    const empty = runCli(["knowledge", "list"], { cwd: absent });
    assert.equal(empty.status, 3, empty.stderr);
    assert.deepEqual(empty.json, { status: "empty", workspace: absent, entries: [], invalid: [] });
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(absent, { recursive: true, force: true });
  }
});

test("an unusable explicit workspace is a usage error with a machine-readable payload", () => {
  const launch = workspace("codetour-knowledge-usage-");
  try {
    const result = runCli(["knowledge", "list", "--workspace", path.join(launch, "missing")], { cwd: launch });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.json.status, "usage");
    assert.equal(typeof result.json.reason, "string");

    const unknownCommand = runCli(["knowledge", "bogus"], { cwd: launch });
    assert.equal(unknownCommand.status, 2, unknownCommand.stderr);
    assert.equal(unknownCommand.json.status, "usage");

    const missingArgument = runCli(["knowledge", "read"], { cwd: launch });
    assert.equal(missingArgument.status, 2, missingArgument.stderr);
    assert.equal(missingArgument.json.status, "usage");

    const unknownOption = runCli(["knowledge", "list", "--bogus"], { cwd: launch });
    assert.equal(unknownOption.status, 2, unknownOption.stderr);
    assert.equal(unknownOption.json.status, "usage");
  } finally {
    rmSync(launch, { recursive: true, force: true });
  }
});

test("knowledge read returns the Markdown body only after every declared proof verifies", () => {
  const ws = workspace("codetour-knowledge-read-");
  try {
    writeFileSync(path.join(ws, "main.ts"), "export const start = 1;\n");
    writeFileSync(path.join(ws, "docs.md"), "cited docs\n");
    const content = entry(
      "dispatch_flow",
      "How tool calls dispatch",
      [
        { path: "main.ts", sha256: sha256("export const start = 1;\n") },
        { path: "docs.md", sha256: sha256("cited docs\n") }
      ],
      "Body line one.\n\nBody line two.\n"
    );
    writeCatalogueEntry(ws, "dispatch_flow.md", content.frontmatter, content.body);

    const result = runCli(["knowledge", "read", "dispatch_flow"], { cwd: ws });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.json, {
      status: "valid",
      workspace: ws,
      name: "dispatch_flow",
      description: "How tool calls dispatch",
      body: "Body line one.\n\nBody line two.\n",
      evidence: [
        { path: "main.ts", sha256: sha256("export const start = 1;\n") },
        { path: "docs.md", sha256: sha256("cited docs\n") }
      ]
    });
    // No credential of any model provider is present in the child's contract.
    for (const key of Object.keys(credentialFreeEnv())) {
      assert.doesNotMatch(key, /API_KEY|TOKEN|SECRET/i);
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("knowledge read refuses malformed, stale, forged, missing, outside, escaping and unsupported proofs without leaking the body", () => {
  const ws = workspace("codetour-knowledge-read-invalid-");
  const outsideRoot = workspace("codetour-knowledge-read-outside-");
  try {
    const cited = "export const start = 1;\n";
    writeFileSync(path.join(ws, "main.ts"), cited);
    writeFileSync(path.join(outsideRoot, "secret.ts"), "outside secret bytes\n");
    symlinkSync(path.join(outsideRoot, "secret.ts"), path.join(ws, "linked.ts"));
    const digest = sha256(cited);
    const secret = "SECRET BODY NEVER LEAVES";

    writeCatalogueEntry(ws, "changed.md", entry("changed", "cites a changed file", [{ path: "main.ts", sha256: sha256("older bytes\n") }]).frontmatter, secret);
    writeCatalogueEntry(ws, "forged.md", entry("forged", "cites a forged hash", [{ path: "main.ts", sha256: "a".repeat(64) }]).frontmatter, secret);
    writeCatalogueEntry(ws, "missing.md", entry("missing", "cites a missing file", [{ path: "gone.ts", sha256: digest }]).frontmatter, secret);
    writeCatalogueEntry(ws, "outside.md", entry("outside", "cites ..", [{ path: "../secret.ts", sha256: digest }]).frontmatter, secret);
    writeCatalogueEntry(ws, "absolute.md", entry("absolute", "cites an absolute path", [{ path: path.join(outsideRoot, "secret.ts"), sha256: digest }]).frontmatter, secret);
    writeCatalogueEntry(ws, "symlink.md", entry("symlink", "cites an escaping link", [{ path: "linked.ts", sha256: digest }]).frontmatter, secret);
    writeCatalogueEntry(ws, "symbolic.md", "name: symbolic\ndescription: declares a symbol proof\nevidence:\n  - type: symbol", secret);
    writeCatalogueEntry(ws, "malformed.md", "name: different_name\ndescription: name does not match\nevidence:\n  - type: file\n    path: main.ts\n    sha256: " + digest, secret);
    writeCatalogueEntry(ws, "empty_body.md", `name: empty_body\ndescription: no body\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${digest}`, "\n");

    const expected = {
      changed: "file_hash_mismatch",
      forged: "file_hash_mismatch",
      missing: "file_missing",
      outside: "path_outside_workspace",
      absolute: "path_outside_workspace",
      symlink: "symlink_escape",
      symbolic: "malformed_contract",
      malformed: "malformed_contract",
      empty_body: "malformed_contract"
    };
    for (const [name, reason] of Object.entries(expected)) {
      const result = runCli(["knowledge", "read", name], { cwd: ws });
      assert.equal(result.status, 4, `${name}: ${result.stdout} ${result.stderr}`);
      assert.deepEqual(result.json, { status: "invalid", workspace: ws, name, reason });
      assert.doesNotMatch(result.stdout, /SECRET BODY|outside secret bytes|\.ts|sha256|[0-9a-f]{64}/);
    }

    // Discovery reports every refused contract without exposing evidence.
    const listed = runCli(["knowledge", "list"], { cwd: ws });
    assert.equal(listed.status, 3, listed.stderr);
    assert.deepEqual(listed.json.entries, []);
    assert.deepEqual(listed.json.invalid, Object.entries(expected)
      .map(([name, reason]) => ({ name, reason }))
      .sort((a, b) => a.name.localeCompare(b.name)));
    assert.doesNotMatch(listed.stdout, /SECRET BODY|outside secret bytes|sha256|[0-9a-f]{64}/);

    const unknown = runCli(["knowledge", "read", "never_written"], { cwd: ws });
    assert.equal(unknown.status, 3, unknown.stderr);
    assert.deepEqual(unknown.json, { status: "absent", workspace: ws, name: "never_written" });
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("an explicit workspace wins from a different launch directory", () => {  const ws = workspace("codetour-knowledge-explicit-");
  const elsewhere = workspace("codetour-knowledge-launch-");
  try {
    seedValidWorkspace(ws);
    // The launch directory holds a decoy catalogue that must not be read.
    writeFileSync(path.join(elsewhere, "decoy.ts"), "decoy\n");
    const decoy = entry("decoy", "Decoy entry", [{ path: "decoy.ts", sha256: sha256("decoy\n") }]);
    writeCatalogueEntry(elsewhere, "decoy.md", decoy.frontmatter, "Decoy body.\n");

    const listed = runCli(["knowledge", "list", "--workspace", ws], { cwd: elsewhere });
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(listed.json.entries, [{ name: "dispatch_flow", description: "How tool calls dispatch" }]);
    assert.equal(listed.json.workspace, ws);

    const read = runCli(["knowledge", "read", "dispatch_flow", "--workspace", ws], { cwd: elsewhere });
    assert.equal(read.status, 0, read.stderr);
    assert.equal(read.json.status, "valid");
    assert.equal(read.json.body, "Verified body.\n");
    // Evidence is computed in the requested workspace, not the launch one.
    assert.deepEqual(read.json.evidence, [{ path: "main.ts", sha256: sha256("export const start = 1;\n") }]);

    // A relative --workspace resolves once against the launch directory.
    const relativeWorkspace = path.relative(elsewhere, ws);
    const relative = runCli(["knowledge", "hash", "main.ts", "--workspace", relativeWorkspace], { cwd: elsewhere });
    assert.equal(relative.status, 0, relative.stderr);
    assert.equal(relative.json.workspace, ws);
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("knowledge hash computes the deterministic evidence digest in the requested workspace", () => {
  const ws = workspace("codetour-knowledge-hash-");
  const elsewhere = workspace("codetour-knowledge-hash-launch-");
  try {
    writeFileSync(path.join(ws, "main.ts"), "cited bytes\n");
    writeFileSync(path.join(elsewhere, "main.ts"), "decoy bytes\n");
    const result = runCli(["knowledge", "hash", "main.ts", "--workspace", ws], { cwd: elsewhere });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.json, {
      status: "ok",
      workspace: ws,
      path: "main.ts",
      sha256: sha256("cited bytes\n")
    });
    // The digest is exactly what a Knowledge proof declares.
    const again = runCli(["knowledge", "hash", "./main.ts"], { cwd: ws });
    assert.equal(again.json.sha256, result.json.sha256);
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("knowledge hash distinguishes absence from invalid paths without leaking resolved locations", () => {
  const ws = workspace("codetour-knowledge-hash-refuse-");
  const outsideRoot = workspace("codetour-knowledge-hash-outside-");
  try {
    writeFileSync(path.join(outsideRoot, "secret.ts"), "outside secret bytes\n");
    writeFileSync(path.join(ws, "inside.ts"), "inside\n");
    mkdirSync(path.join(ws, "dir"));
    symlinkSync(path.join(outsideRoot, "secret.ts"), path.join(ws, "linked.ts"));

    const absent = runCli(["knowledge", "hash", "gone.ts"], { cwd: ws });
    assert.equal(absent.status, 3, absent.stderr);
    assert.deepEqual(absent.json, { status: "absent", workspace: ws, path: "gone.ts", reason: "file_missing" });

    const cases = [
      ["../secret.ts", "path_outside_workspace"],
      [path.join(outsideRoot, "secret.ts"), "path_outside_workspace"],
      ["linked.ts", "symlink_escape"],
      ["dir", "not_a_file"]
    ];
    for (const [target, reason] of cases) {
      const result = runCli(["knowledge", "hash", target], { cwd: ws });
      assert.equal(result.status, 4, `${target}: ${result.stdout} ${result.stderr}`);
      assert.deepEqual(result.json, { status: "invalid", workspace: ws, path: target, reason });
      assert.doesNotMatch(result.stdout, /outside secret bytes|sha256|[0-9a-f]{64}/);
    }

    // An unknown option keeps the family contract: JSON on stdout, exit 2.
    const usage = runCli(["knowledge", "hash", "inside.ts", "--bogus"], { cwd: ws });
    assert.equal(usage.status, 2, usage.stderr);
    assert.equal(usage.json.status, "usage");
    assert.equal(typeof usage.json.reason, "string");
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

function writeProposal(ws, value, fileName = "proposal.json") {
  const file = path.join(ws, fileName);
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}

function catalogueEntries(ws) {
  try {
    return readdirSync(path.join(ws, catalogue)).sort();
  } catch {
    return [];
  }
}

const saveArgs = (ws, proposal) => ["knowledge", "save", "--workspace", ws, "--proposal", proposal];

test("knowledge save publishes a proposal that a second independent invocation discovers and rereads", () => {
  const ws = workspace("codetour-knowledge-save-");
  const launch = workspace("codetour-knowledge-save-launch-");
  try {
    writeFileSync(path.join(ws, "main.ts"), "export const start = 1;\n");
    const body = "## Dispatch flow\n\nBody line one.\n\n- item one\n- item two\n";
    const proposal = writeProposal(ws, {
      entries: [{
        name: "dispatch_flow",
        description: "How tool calls dispatch",
        body,
        evidence: [{ path: "main.ts" }]
      }]
    });

    const saved = runCli(saveArgs(ws, proposal), { cwd: launch });
    assert.equal(saved.status, 0, saved.stderr);
    assert.equal(saved.stderr, "");
    assert.deepEqual(saved.json, {
      status: "saved",
      workspace: ws,
      saved: ["dispatch_flow"],
      warnings: [{ name: "dispatch_flow", code: "insufficient_backing", distinctEvidencePaths: 1 }]
    });
    assert.doesNotMatch(saved.stdout, /body line one|sha256|[0-9a-f]{64}/i);

    // A second, independent invocation rediscovers the entry by metadata only.
    const listed = runCli(["knowledge", "list", "--workspace", ws], { cwd: launch });
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(listed.json.entries, [{ name: "dispatch_flow", description: "How tool calls dispatch" }]);

    // ...and rereads the exact Markdown body behind the computed evidence.
    const read = runCli(["knowledge", "read", "dispatch_flow", "--workspace", ws], { cwd: launch });
    assert.equal(read.status, 0, read.stderr);
    assert.equal(read.json.status, "valid");
    assert.equal(read.json.body, body);
    assert.deepEqual(read.json.evidence, [{ path: "main.ts", sha256: sha256("export const start = 1;\n") }]);

    // No model credential reaches the child process.
    for (const key of Object.keys(credentialFreeEnv())) {
      assert.doesNotMatch(key, /API_KEY|TOKEN|SECRET/i);
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(launch, { recursive: true, force: true });
  }
});

test("knowledge save writes several entries atomically, accepting computed and declared hashes", () => {
  const ws = workspace("codetour-knowledge-save-multi-");
  try {
    writeFileSync(path.join(ws, "main.ts"), "main bytes\n");
    writeFileSync(path.join(ws, "docs.md"), "docs bytes\n");
    const proposal = writeProposal(ws, {
      entries: [
        {
          name: "first_flow",
          description: "computed evidence",
          body: "First body.\n",
          evidence: [{ path: "./main.ts" }]
        },
        {
          name: "second_flow",
          description: "declared evidence",
          body: "Second body.\n",
          evidence: [{ path: "docs.md", sha256: sha256("docs bytes\n").toUpperCase() }]
        }
      ]
    });

    const saved = runCli(saveArgs(ws, proposal), { cwd: ws });
    assert.equal(saved.status, 0, saved.stderr);
    assert.deepEqual(saved.json, {
      status: "saved",
      workspace: ws,
      saved: ["first_flow", "second_flow"],
      warnings: [
        { name: "first_flow", code: "insufficient_backing", distinctEvidencePaths: 1 },
        { name: "second_flow", code: "insufficient_backing", distinctEvidencePaths: 1 }
      ]
    });
    assert.deepEqual(catalogueEntries(ws), ["first_flow.md", "second_flow.md"]);

    const first = runCli(["knowledge", "read", "first_flow"], { cwd: ws });
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(first.json.evidence, [{ path: "main.ts", sha256: sha256("main bytes\n") }]);
    const second = runCli(["knowledge", "read", "second_flow"], { cwd: ws });
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(second.json.evidence, [{ path: "docs.md", sha256: sha256("docs bytes\n") }]);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("an explicit empty proposal is a no-op that creates nothing", () => {
  const ws = workspace("codetour-knowledge-save-noop-");
  try {
    const proposal = writeProposal(ws, { entries: [] });
    const result = runCli(saveArgs(ws, proposal), { cwd: ws });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.json, { status: "no-op", workspace: ws, entries: [] });
    assert.deepEqual(catalogueEntries(ws), []);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("a name conflict preserves the existing entry byte for byte and publishes no sibling", () => {
  const ws = workspace("codetour-knowledge-save-conflict-");
  try {
    writeFileSync(path.join(ws, "main.ts"), "main bytes\n");
    seedValidWorkspace(ws, { name: "dispatch_flow", description: "Original description" });
    const existing = path.join(ws, catalogue, "dispatch_flow.md");
    const before = readFileSync(existing);
    const proposal = writeProposal(ws, {
      entries: [
        { name: "brand_new", description: "new", body: "New body.\n", evidence: [{ path: "main.ts" }] },
        { name: "dispatch_flow", description: "Replacement description", body: "Replacement body.\n", evidence: [{ path: "main.ts" }] }
      ]
    });

    const result = runCli(saveArgs(ws, proposal), { cwd: ws });
    assert.equal(result.status, 4, result.stderr);
    assert.deepEqual(result.json, {
      status: "conflict",
      workspace: ws,
      conflicts: [{ name: "dispatch_flow", reason: "name_conflict" }]
    });
    assert.deepEqual(readFileSync(existing), before);
    // No partial publication and no staging file survives.
    assert.deepEqual(catalogueEntries(ws), ["dispatch_flow.md"]);

    const read = runCli(["knowledge", "read", "dispatch_flow"], { cwd: ws });
    assert.equal(read.status, 0, read.stderr);
    assert.equal(read.json.description, "Original description");
    assert.equal(read.json.body, "Verified body.\n");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("refused evidence publishes nothing and leaves the existing catalogue untouched", () => {
  const ws = workspace("codetour-knowledge-save-invalid-");
  const outside = workspace("codetour-knowledge-save-invalid-outside-");
  try {
    writeFileSync(path.join(ws, "main.ts"), "main bytes\n");
    writeFileSync(path.join(ws, "docs.md"), "docs bytes\n");
    mkdirSync(path.join(ws, "dir"));
    writeFileSync(path.join(outside, "secret.ts"), "outside secret bytes\n");
    symlinkSync(path.join(outside, "secret.ts"), path.join(ws, "linked.ts"));
    seedValidWorkspace(ws, { name: "kept_flow", description: "Kept entry" });
    const kept = path.join(ws, catalogue, "kept_flow.md");
    const before = readFileSync(kept);

    const proposal = writeProposal(ws, {
      entries: [
        { name: "valid_sibling", description: "valid", body: "Body.\n", evidence: [{ path: "main.ts" }] },
        { name: "missing_file", description: "missing", body: "Body.\n", evidence: [{ path: "gone.ts" }] },
        { name: "changed_hash", description: "changed", body: "Body.\n", evidence: [{ path: "main.ts", sha256: sha256("older bytes\n") }] },
        { name: "outside_path", description: "outside", body: "Body.\n", evidence: [{ path: "../secret.ts" }] },
        { name: "absolute_path", description: "absolute", body: "Body.\n", evidence: [{ path: path.join(outside, "secret.ts") }] },
        { name: "escaping_link", description: "link", body: "Body.\n", evidence: [{ path: "linked.ts" }] },
        { name: "directory", description: "directory", body: "Body.\n", evidence: [{ path: "dir" }] },
        { name: "symbolic", description: "symbol", body: "Body.\n", evidence: [{ type: "symbol", path: "main.ts" }] },
        { name: "bad_hash_shape", description: "shape", body: "Body.\n", evidence: [{ path: "main.ts", sha256: "not-a-hash" }] },
        { name: "bad_evidence_item", description: "shape", body: "Body.\n", evidence: ["main.ts"] }
      ]
    });

    const result = runCli(saveArgs(ws, proposal), { cwd: ws });
    assert.equal(result.status, 4, result.stderr);
    assert.deepEqual(result.json, {
      status: "invalid",
      workspace: ws,
      rejected: [
        { name: "missing_file", reason: "file_missing" },
        { name: "changed_hash", reason: "file_hash_mismatch" },
        { name: "outside_path", reason: "path_outside_workspace" },
        { name: "absolute_path", reason: "path_outside_workspace" },
        { name: "escaping_link", reason: "symlink_escape" },
        { name: "directory", reason: "not_a_file" },
        { name: "symbolic", reason: "malformed_evidence" },
        { name: "bad_hash_shape", reason: "malformed_evidence" },
        { name: "bad_evidence_item", reason: "malformed_evidence" }
      ]
    });
    assert.doesNotMatch(result.stdout, /outside secret bytes|main bytes|docs bytes|sha256|[0-9a-f]{64}/i);
    assert.deepEqual(catalogueEntries(ws), ["kept_flow.md"]);
    assert.deepEqual(readFileSync(kept), before);
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("invalid fields, duplicate names and malformed proposals publish nothing", () => {
  const ws = workspace("codetour-knowledge-save-shape-");
  try {
    writeFileSync(path.join(ws, "main.ts"), "main bytes\n");
    const evidence = [{ path: "main.ts" }];
    const runProposal = value => runCli(saveArgs(ws, writeProposal(ws, value)), { cwd: ws });

    let result = runProposal({
      entries: [
        { name: "not an id", description: "d", body: "Body.\n", evidence },
        { name: "blank_description", description: "   ", body: "Body.\n", evidence },
        { name: "multiline_description", description: "one\ntwo", body: "Body.\n", evidence },
        { name: "empty_body", description: "d", body: " \n", evidence },
        { name: "no_evidence", description: "d", body: "Body.\n", evidence: [] },
        { name: "unknown_field", description: "d", body: "Body.\n", evidence, extra: true }
      ]
    });
    assert.equal(result.status, 4, result.stderr);
    assert.deepEqual(result.json.rejected, [
      { name: "not an id", reason: "invalid_name" },
      { name: "blank_description", reason: "invalid_description" },
      { name: "multiline_description", reason: "invalid_description" },
      { name: "empty_body", reason: "invalid_body" },
      { name: "no_evidence", reason: "missing_evidence" },
      { name: "unknown_field", reason: "malformed_entry" }
    ]);

    result = runProposal({
      entries: [
        { name: "same_name", description: "first", body: "First body.\n", evidence },
        { name: "same_name", description: "second", body: "Second body.\n", evidence }
      ]
    });
    assert.equal(result.status, 4, result.stderr);
    assert.deepEqual(result.json.rejected, [{ name: "same_name", reason: "duplicate_name" }]);

    result = runProposal({ entries: "not-an-array" });
    assert.equal(result.status, 4, result.stderr);
    assert.deepEqual(result.json, { status: "invalid", workspace: ws, rejected: [{ reason: "malformed_proposal" }] });

    result = runProposal({ entries: [], extra: true });
    assert.equal(result.status, 4, result.stderr);
    assert.deepEqual(result.json.rejected, [{ reason: "malformed_proposal" }]);

    // Malformed JSON is an invalid contract, not a usage error.
    result = runCli(saveArgs(ws, writeProposal(ws, "{ not json", "broken.json")), { cwd: ws });
    assert.equal(result.status, 4, result.stderr);
    assert.deepEqual(result.json, { status: "invalid", workspace: ws, rejected: [{ reason: "malformed_proposal" }] });

    assert.deepEqual(catalogueEntries(ws), []);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("knowledge save accepts convenience flags and refuses ambiguous or absent input as usage", () => {
  const ws = workspace("codetour-knowledge-save-flags-");
  try {
    writeFileSync(path.join(ws, "main.ts"), "main bytes\n");
    writeFileSync(path.join(ws, "docs.md"), "docs bytes\n");
    writeFileSync(path.join(ws, "body.md"), "# Flag body\n\nMarkdown kept.\n");

    const saved = runCli([
      "knowledge", "save",
      "--name", "flag_flow",
      "--description", "Built from flags",
      "--body-file", "body.md",
      "--evidence", "main.ts",
      "--evidence", "docs.md"
    ], { cwd: ws });
    assert.equal(saved.status, 0, saved.stderr);
    assert.deepEqual(saved.json, {
      status: "saved",
      workspace: ws,
      saved: ["flag_flow"],
      warnings: []
    });

    const read = runCli(["knowledge", "read", "flag_flow"], { cwd: ws });
    assert.equal(read.status, 0, read.stderr);
    assert.equal(read.json.body, "# Flag body\n\nMarkdown kept.\n");
    assert.deepEqual(read.json.evidence.map(proof => proof.path), ["main.ts", "docs.md"]);

    const proposal = writeProposal(ws, { entries: [] });
    const ambiguous = runCli(saveArgs(ws, proposal).concat(["--name", "both"]), { cwd: ws });
    assert.equal(ambiguous.status, 2, ambiguous.stderr);
    assert.equal(ambiguous.json.status, "usage");
    assert.equal(typeof ambiguous.json.reason, "string");

    const bare = runCli(["knowledge", "save"], { cwd: ws });
    assert.equal(bare.status, 2, bare.stderr);
    assert.equal(bare.json.status, "usage");

    const missingFile = runCli(saveArgs(ws, path.join(ws, "absent.json")), { cwd: ws });
    assert.equal(missingFile.status, 2, missingFile.stderr);
    assert.deepEqual(missingFile.json, {
      status: "usage",
      reason: "proposal_unreadable",
      message: "Cannot read proposal: " + path.join(ws, "absent.json")
    });

    const missingBody = runCli([
      "knowledge", "save", "--name", "no_body", "--description", "d",
      "--body-file", "absent.md", "--evidence", "main.ts"
    ], { cwd: ws });
    assert.equal(missingBody.status, 2, missingBody.stderr);
    assert.equal(missingBody.json.status, "usage");
    assert.equal(missingBody.json.reason, "body_unreadable");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("the bundled CLI computes symbol fingerprints itself: no fallback, marker stamped", () => {
  const ws = workspace("codetour-knowledge-cli-symbol-");
  try {
    writeFileSync(path.join(ws, "main.ts"), "export function dispatch(input: string): string {\n  // comment noise\n  return `ok:${input}`;\n}\n");
    const proposal = path.join(ws, "proposal.json");
    writeFileSync(proposal, JSON.stringify({
      entries: [{
        name: "dispatch_flow",
        description: "How dispatch works",
        body: "Body from the bundle.\n",
        evidence: [{ type: "symbol", path: "main.ts", symbol: "dispatch" }]
      }]
    }));
    const result = runCli(["knowledge", "save", "--workspace", ws, "--proposal", proposal], { cwd: ws });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const saved = result.json;
    assert.deepEqual(saved.saved, ["dispatch_flow"]);
    // no symbol_proof_fallback warning: the vendored fingerprinter runs in the bundle
    assert.equal((saved.warnings ?? []).some(warning => warning.code === "symbol_proof_fallback"), false);
    const published = readFileSync(path.join(ws, catalogue, "dispatch_flow.md"), "utf8");
    assert.match(published, /type: symbol/);
    assert.match(published, /symbol: dispatch/);
    assert.match(published, /sha256: [0-9a-f]{64}/);
    const marker = readFileSync(path.join(ws, catalogue, ".canonicalizer"), "utf8").trim();
    assert.equal(marker, "span@1");
    // churn présentationnel : la lecture reste valide
    writeFileSync(path.join(ws, "main.ts"), "// header\nexport function dispatch(input: string): string {\n      /* inner */\n  return `ok:${input}`;\n}\n");
    const read = runCli(["knowledge", "read", "dispatch_flow", "--workspace", ws], { cwd: ws });
    assert.equal(read.status, 0);
    assert.equal(read.json.status, "valid");
    // comportement : refusal sans corps
    writeFileSync(path.join(ws, "main.ts"), "export function dispatch(input: string): string {\n  return `ko:${input}`;\n}\n");
    const stale = runCli(["knowledge", "read", "dispatch_flow", "--workspace", ws], { cwd: ws });
    assert.equal(stale.status, 4);
    assert.equal(stale.json.reason, "symbol_hash_mismatch");
    assert.doesNotMatch(stale.stdout, /Body from the bundle/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("knowledge list separates stale symbol proofs from verified entries without leaking evidence", () => {
  const ws = workspace("codetour-knowledge-list-symbol-");
  try {
    seedValidWorkspace(ws, { name: "valid_flow", description: "Verified entry" });
    writeFileSync(path.join(ws, "symbol.ts"), "export function dispatch() { return 'ok'; }\n");
    const proposal = writeProposal(ws, { entries: [{
      name: "dispatch_flow", description: "Dispatch entry", body: "PRIVATE BODY\n",
      evidence: [{ type: "symbol", path: "symbol.ts", symbol: "dispatch" }]
    }] });
    const saved = runCli(saveArgs(ws, proposal), { cwd: ws });
    assert.equal(saved.status, 0, saved.stderr || saved.stdout);
    writeFileSync(path.join(ws, "symbol.ts"), "export function dispatch() { return 'changed'; }\n");

    const listed = runCli(["knowledge", "list"], { cwd: ws });
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(listed.json.entries, [{ name: "valid_flow", description: "Verified entry" }]);
    assert.deepEqual(listed.json.invalid, [{ name: "dispatch_flow", reason: "symbol_hash_mismatch" }]);
    assert.doesNotMatch(listed.stdout, /PRIVATE BODY|symbol\.ts|[0-9a-f]{64}/);

    const filtered = runCli(["knowledge", "list", "--query", "no-match"], { cwd: ws });
    assert.equal(filtered.status, 3, filtered.stderr);
    assert.deepEqual(filtered.json.entries, []);
    assert.deepEqual(filtered.json.invalid, [{ name: "dispatch_flow", reason: "symbol_hash_mismatch" }]);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("the bundled CLI refuses an unparseable symbol and reports creation fallback", () => {
  const ws = workspace("codetour-knowledge-cli-syntax-");
  try {
    const source = path.join(ws, "main.ts");
    writeFileSync(source, "export function dispatch() { return 1; }\n");
    const proposal = name => writeProposal(ws, { entries: [{
      name, description: "Dispatch", body: "PRIVATE BODY\n",
      evidence: [{ type: "symbol", path: "main.ts", symbol: "dispatch" }]
    }] });
    assert.equal(runCli(saveArgs(ws, proposal("good")), { cwd: ws }).status, 0);
    writeFileSync(source, "export function dispatch() { const x = ; return 1; }\n");
    const read = runCli(["knowledge", "read", "good"], { cwd: ws });
    assert.equal(read.status, 4);
    assert.equal(read.json.reason, "symbol_unparseable");
    assert.doesNotMatch(read.stdout, /PRIVATE BODY/);
    const saved = runCli(saveArgs(ws, proposal("fallback")), { cwd: ws });
    assert.equal(saved.status, 0, saved.stderr || saved.stdout);
    assert.ok(saved.json.warnings.some(w => w.code === "symbol_proof_fallback" && w.reason === "symbol_unparseable"));
    assert.match(readFileSync(path.join(ws, catalogue, "fallback.md"), "utf8"), /origin: symbol_fallback/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
