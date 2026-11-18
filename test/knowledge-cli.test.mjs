import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
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
      ]
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
    assert.deepEqual(unmatched.json, { status: "empty", workspace: ws, entries: [] });

    const empty = runCli(["knowledge", "list"], { cwd: absent });
    assert.equal(empty.status, 3, empty.stderr);
    assert.deepEqual(empty.json, { status: "empty", workspace: absent, entries: [] });
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
      symbolic: "unsupported_proof",
      malformed: "malformed_contract",
      empty_body: "malformed_contract"
    };
    for (const [name, reason] of Object.entries(expected)) {
      const result = runCli(["knowledge", "read", name], { cwd: ws });
      assert.equal(result.status, 4, `${name}: ${result.stdout} ${result.stderr}`);
      assert.deepEqual(result.json, { status: "invalid", workspace: ws, name, reason });
      assert.doesNotMatch(result.stdout, /SECRET BODY|outside secret bytes|\.ts|sha256|[0-9a-f]{64}/);
    }

    // Discovery is metadata-only: malformed contracts are skipped, while
    // well-formed entries with stale evidence stay discoverable (the read gate
    // is what refuses them), and no body leaks.
    const listed = runCli(["knowledge", "list"], { cwd: ws });
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(listed.json.entries.map(item => item.name),
      ["absolute", "changed", "forged", "missing", "outside", "symlink"]);
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
