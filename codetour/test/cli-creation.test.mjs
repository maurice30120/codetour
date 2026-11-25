import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";

// The creation subcommands are the agent's entry point: a JSON proposal in, one
// JSON result out, diagnostics on stderr. These tests drive the built CLI
// (dist/cli.js) exactly as an agent does, so they cover the whole path:
// argument parsing, proposal reading, the shared creation rules and the exit
// codes.
const cli = path.resolve("dist/cli.js");

// A creation records whatever session identity the creating process can
// observe. Drop the ambient ones so a developer's own agent session cannot
// leak into an assertion about a record.
const CLEAN_ENV = (() => {
  const {
    CODETOUR_SESSION_ID,
    CODETOUR_RESPONSE_ID,
    CODETOUR_HOST,
    PI_SESSION_ID,
    ...rest
  } = process.env;
  return rest;
})();

const temporaryDirectories = [];

function workspace(files = {}, { git = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-cli-creation-"));
  temporaryDirectories.push(root);
  if (git) {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: root });
  }
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

function commit(root, name, content, message) {
  const target = path.join(root, name);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-m", message], { cwd: root });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

// Proposals live outside the workspaces under test: an untracked file inside a
// workspace is a change of that workspace, and several tests assert on what the
// workspace contains.
const proposalDirectory = mkdtempSync(path.join(os.tmpdir(), "codetour-cli-proposals-"));
temporaryDirectories.push(proposalDirectory);

function proposalFile(name, proposal) {
  const target = path.join(proposalDirectory, name);
  writeFileSync(target, JSON.stringify(proposal, null, 2));
  return target;
}

function runCli(cwd, args, { input, env } = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    input,
    env: { ...CLEAN_ENV, ...env }
  });
}

function canonical(root) {
  return realpathSync.native(root);
}

function tourFiles(root) {
  const directory = path.join(root, ".tours");
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => name.endsWith(".tour")).sort();
}

test.after(() => {
  for (const root of temporaryDirectories) {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Mermaid reference is shipped for both hosts and its example passes the CLI", () => {
  const skillPath = host => path.resolve("packages", `${host}-plugin`, "skills");
  const pi = readFileSync(path.join(skillPath("pi"), "codetour-generate/references/mermaid.md"), "utf8");
  const copilot = readFileSync(path.join(skillPath("copilot"), "codetour-generate/references/mermaid.md"), "utf8");
  assert.equal(pi, copilot);
  assert.match(pi, /prefix `Diagram —` is literal and\s+stays in English even in a French Tour/);
  for (const host of ["pi", "copilot"]) {
    const parent = readFileSync(path.join(skillPath(host), "codetour-generate/SKILL.md"), "utf8");
    assert.match(parent, /read and follow \[the Mermaid reference\]\(references\/mermaid\.md\)/);
  }
  const example = pi.match(/`(A\["Start \(CLI\)"\] --> B\["Create Tour"\])`/);
  assert.ok(example, "the reference contains the example to validate");
  const root = workspace();
  const description = ["**Diagram — Creation flow**", "", "```mermaid", "flowchart LR", example[1], "```"].join("\n");
  const result = runCli(root, ["create-project-tour", "--workspace", root], {
    input: JSON.stringify({ title: "Example", steps: [{ description }] })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
});

test("both generation skills ground committed-only Changes Tours in the selected commit", () => {
  for (const host of ["pi", "copilot"]) {
    const parent = readFileSync(path.resolve("packages", `${host}-plugin`, "skills/codetour-generate/SKILL.md"), "utf8");
    assert.match(parent, /git show <headRef>:\.\/<workspace-relative-path>/);
    assert.match(parent, /excluded local change as committed/);
  }
});

test("create-project-tour creates a Project Tour from a file proposal", () => {
  const root = workspace({ "code.ts": "export function main() {}\n" });
  const proposal = proposalFile("proposal.json", {
    title: "Architecture",
    description: "How the code is organized.",
    steps: [
      {
        title: "Overview",
        description: [
          "Where the work lives.",
          "",
          "**Diagram — Context view**",
          "",
          "```mermaid",
          "flowchart LR",
          "  Reader --> Tour",
          "```"
        ].join("\n")
      },
      {
        title: "Entry point",
        description: "The main function.",
        file: "code.ts",
        pattern: "export function main"
      }
    ]
  });

  const result = runCli(root, [
    "create-project-tour",
    "--workspace",
    root,
    "--proposal",
    proposal
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const created = JSON.parse(result.stdout);
  assert.equal(created.ok, true);
  assert.equal(created.kind, "project");
  assert.equal(created.title, "Architecture");
  assert.equal(created.stepCount, 2);
  assert.deepEqual(created.warnings, []);
  assert.equal(created.tourPath, path.join(canonical(root), ".tours", "project.tour"));

  const tour = JSON.parse(readFileSync(created.tourPath, "utf8"));
  assert.equal(tour.title, "Architecture");
  assert.equal(tour.description, "How the code is organized.");
  assert.equal(tour.steps.length, 2);
  assert.equal(tour.steps[1].file, "code.ts");
  assert.equal(tour.steps[1].pattern, "export function main");
});

test("create-project-tour reads the proposal from standard input when --proposal is omitted", () => {
  const root = workspace({ "code.ts": "export const value = 1;\n" });
  const result = runCli(root, ["create-project-tour", "--workspace", root], {
    input: JSON.stringify({
      title: "From stdin",
      steps: [{ description: "The value.", file: "code.ts", line: 1 }]
    })
  });

  assert.equal(result.status, 0, result.stderr);
  const created = JSON.parse(result.stdout);
  assert.equal(created.ok, true);
  assert.equal(created.title, "From stdin");
  assert.equal(created.tourPath, path.join(canonical(root), ".tours", "project.tour"));
});

test("create-changes-tour reads the proposal from standard input when --proposal is -", () => {
  const root = workspace({}, { git: true });
  const baseRef = commit(root, "base.txt", "base\n", "add base");
  const headRef = commit(root, "feature.ts", "export function feature() {}\n", "add feature");

  const result = runCli(
    root,
    ["create-changes-tour", "--workspace", root, "--proposal", "-"],
    {
      input: JSON.stringify({
        baseRef,
        headRef,
        steps: [
          {
            title: "Feature",
            description: "The new feature.",
            file: "feature.ts",
            pattern: "export function feature"
          }
        ]
      })
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const created = JSON.parse(result.stdout);
  assert.equal(created.kind, "changes");
  assert.equal(created.stepCount, 1);
  const tour = JSON.parse(readFileSync(created.tourPath, "utf8"));
  assert.equal(tour.ref, headRef);
  assert.equal(tour.baseRef, baseRef);
  // A committed-only Changes Tour anchors the diff, and only a rename adds
  // baseFile.
  assert.deepEqual(tour.steps[0], {
    title: "Feature",
    description: "The new feature.",
    file: "feature.ts",
    pattern: "export function feature",
    display: "diff"
  });
});

test("create-changes-tour accepts the critical review mode without persisting it", () => {
  const root = workspace({}, { git: true });
  const baseRef = commit(root, "base.txt", "base\n", "add base");
  const headRef = commit(root, "feature.ts", "export function feature() {}\n", "add feature");

  const result = runCli(root, [
    "create-changes-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("critical.json", {
      baseRef,
      headRef,
      reviewMode: "critical",
      title: "Critical review",
      steps: [{ description: "A finding.", file: "feature.ts", line: 1 }]
    })
  ]);

  assert.equal(result.status, 0, result.stderr);
  const tour = JSON.parse(readFileSync(JSON.parse(result.stdout).tourPath, "utf8"));
  assert.equal(tour.title, "Critical review");
  assert.equal("reviewMode" in tour, false);
});

test("the created Tours are readable by the existing reader", () => {
  const root = workspace({}, { git: true });
  const baseRef = commit(root, "base.txt", "base\n", "add base");
  const headRef = commit(root, "feature.ts", "export function feature() {}\n", "add feature");

  const project = runCli(root, [
    "create-project-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("project.json", {
      title: "Project walkthrough",
      steps: [{ title: "Entry", description: "The feature module.", file: "feature.ts", line: 1 }]
    })
  ]);
  assert.equal(project.status, 0, project.stderr);

  const changes = runCli(root, [
    "create-changes-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("changes.json", {
      baseRef,
      headRef,
      title: "Changes walkthrough",
      steps: [{ title: "Change", description: "The new function.", file: "feature.ts", line: 1 }]
    })
  ]);
  assert.equal(changes.status, 0, changes.stderr);

  const projectPage = path.join(root, "project.html");
  const projectRead = runCli(root, ["Project walkthrough", "--renderer", "html"], {
    env: { CODETOUR_TEST_HTML_OUTPUT: projectPage }
  });
  assert.equal(projectRead.status, 0, projectRead.stderr);
  assert.match(readFileSync(projectPage, "utf8"), /The feature module\./);

  const changesPage = path.join(root, "changes.html");
  const changesRead = runCli(root, ["Changes walkthrough", "--renderer", "html"], {
    env: { CODETOUR_TEST_HTML_OUTPUT: changesPage }
  });
  assert.equal(changesRead.status, 0, changesRead.stderr);
  assert.match(readFileSync(changesPage, "utf8"), /The new function\./);
});

test("--workspace selects the creation workspace independently of the current directory", () => {
  const cwd = workspace();
  const target = workspace({ "code.ts": "export const value = 1;\n" });

  const result = runCli(cwd, [
    "create-project-tour",
    "--workspace",
    path.relative(cwd, target),
    "--proposal",
    proposalFile("proposal.json", {
      steps: [{ description: "The value.", file: "code.ts", line: 1 }]
    })
  ]);

  assert.equal(result.status, 0, result.stderr);
  const created = JSON.parse(result.stdout);
  assert.equal(created.tourPath, path.join(canonical(target), ".tours", "project.tour"));
  assert.equal(existsSync(path.join(cwd, ".tours")), false);
});

test("a workspacePath narrows the workspace but never escapes it", () => {
  const root = workspace({ "sub/code.ts": "export const value = 1;\n" });

  const narrowed = runCli(root, [
    "create-project-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("narrowed.json", {
      workspacePath: "sub",
      steps: [{ description: "The value.", file: "code.ts", line: 1 }]
    })
  ]);
  assert.equal(narrowed.status, 0, narrowed.stderr);
  assert.equal(
    JSON.parse(narrowed.stdout).tourPath,
    path.join(canonical(root), "sub", ".tours", "project.tour")
  );

  const escaping = runCli(root, [
    "create-project-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("escaping.json", {
      workspacePath: "../outside",
      steps: [{ description: "The value." }]
    })
  ]);
  assert.equal(escaping.status, 1);
  const failure = JSON.parse(escaping.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.code, "INVALID_PROPOSAL");
  assert.ok(failure.issues.some(issue => issue.path === "workspacePath"));
  assert.equal(existsSync(path.join(canonical(root), "..", "outside")), false);
});

test("an anchor outside the workspace is refused and nothing is written", () => {
  const root = workspace({ "code.ts": "export const value = 1;\n" });

  const result = runCli(root, [
    "create-project-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("proposal.json", {
      steps: [{ description: "Escaping anchor.", file: "../outside.ts", line: 1 }]
    })
  ]);

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.code, "INVALID_PROPOSAL");
  assert.deepEqual(
    failure.issues.filter(issue => issue.path === "steps[0].file").map(issue => issue.message),
    ["resolves outside the workspace root"]
  );
  assert.match(result.stderr, /CodeTour: creation refused \(INVALID_PROPOSAL\)/);
  assert.equal(existsSync(path.join(root, ".tours")), false);
});

test("an invalid proposal leaves an existing Tour untouched", () => {
  const root = workspace({ "code.ts": "export const value = 1;\n" });
  const previous = JSON.stringify({ title: "Previous", steps: [{ description: "Kept." }] }, null, 2);
  mkdirSync(path.join(root, ".tours"), { recursive: true });
  writeFileSync(path.join(root, ".tours", "project.tour"), previous);

  const result = runCli(root, [
    "create-project-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("proposal.json", {
      steps: [{ description: "Bad anchor.", file: "code.ts", pattern: "not in the file" }]
    })
  ]);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).ok, false);
  assert.equal(readFileSync(path.join(root, ".tours", "project.tour"), "utf8"), previous);
});

test("a Mermaid error is refused with its issue and no write", () => {
  const root = workspace({ "code.ts": "export const value = 1;\n" });

  const result = runCli(root, [
    "create-project-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("proposal.json", {
      steps: [
        {
          description: [
            "**Diagram — Broken**",
            "",
            "```mermaid",
            "this is not mermaid at all (((",
            "```"
          ].join("\n")
        }
      ]
    })
  ]);

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.code, "INVALID_PROPOSAL");
  assert.ok(failure.issues.some(issue => issue.path.startsWith("steps[0].description.mermaid[")));
  assert.equal(existsSync(path.join(root, ".tours")), false);
});

test("an image reference that is not a PNG or JPEG is refused with no write", () => {
  const root = workspace({
    "code.ts": "export const value = 1;\n",
    "notes.txt": "not an image\n"
  });

  const result = runCli(root, [
    "create-project-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("proposal.json", {
      steps: [{ description: "See ![the note](notes.txt)." }]
    })
  ]);

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.code, "INVALID_PROPOSAL");
  assert.ok(failure.issues.some(issue => issue.path.startsWith("steps[0].description.image[")));
  assert.equal(existsSync(path.join(root, ".tours")), false);
});

test("create-changes-tour refuses a workspace that is not a Git repository", () => {
  const root = workspace({ "code.ts": "export const value = 1;\n" });

  const result = runCli(root, [
    "create-changes-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("proposal.json", {
      baseRef: "main",
      headRef: "a".repeat(40),
      steps: [{ description: "Nothing." }]
    })
  ]);

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.code, "GIT_REPOSITORY_REQUIRED");
  assert.match(failure.message, /create-changes-tour requires a Git repository/);
  assert.equal(existsSync(path.join(root, ".tours")), false);
});

test("create-changes-tour refuses a stale head, an unknown base and an empty comparison", () => {
  const root = workspace({}, { git: true });
  commit(root, "base.txt", "base\n", "add base");
  const headRef = commit(root, "feature.ts", "export function feature() {}\n", "add feature");

  const stale = runCli(root, [
    "create-changes-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("stale.json", {
      baseRef: "main",
      headRef: "a".repeat(40),
      steps: [{ description: "Nothing." }]
    })
  ]);
  assert.equal(stale.status, 1);
  assert.equal(JSON.parse(stale.stdout).code, "STALE_HEAD");

  const unknownBase = runCli(root, [
    "create-changes-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("unknown-base.json", {
      baseRef: "no-such-ref",
      headRef,
      steps: [{ description: "Nothing." }]
    })
  ]);
  assert.equal(unknownBase.status, 1);
  assert.equal(JSON.parse(unknownBase.stdout).code, "INVALID_BASE_REF");

  const empty = runCli(root, [
    "create-changes-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("empty.json", {
      baseRef: headRef,
      headRef,
      steps: [{ description: "Nothing." }]
    })
  ]);
  assert.equal(empty.status, 1);
  assert.equal(JSON.parse(empty.stdout).code, "NO_CHANGES");
  assert.deepEqual(tourFiles(root), []);
});

test("create-project-tour --help prints its usage on stderr and creates nothing", () => {
  const root = workspace();

  // Exit 0 promises a created Tour, so a usage text must never travel on
  // stdout: an agent that reads stdout as a result document would report a
  // Tour that does not exist.
  for (const flag of ["--help", "-h"]) {
    const result = runCli(root, ["create-project-tour", flag]);

    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Usage: codetour create-project-tour --workspace <dir> \[--proposal <file\|->\]/);
    assert.equal(existsSync(path.join(root, ".tours")), false);
  }
});

test("a usage or IO failure exits with 2 and prints no result document", () => {
  const root = workspace({ "not-a-directory.txt": "text\n" });

  const missingWorkspace = runCli(root, ["create-changes-tour"]);
  assert.equal(missingWorkspace.status, 2);
  assert.equal(missingWorkspace.stdout, "");
  assert.match(missingWorkspace.stderr, /CodeTour: Missing required option: --workspace <dir>/);

  const unknownOption = runCli(root, ["create-project-tour", "--workspace", root, "--nope"]);
  assert.equal(unknownOption.status, 2);
  assert.equal(unknownOption.stdout, "");
  assert.match(unknownOption.stderr, /CodeTour: Unknown option: --nope/);

  const missingValue = runCli(root, ["create-project-tour", "--workspace"]);
  assert.equal(missingValue.status, 2);
  assert.match(missingValue.stderr, /CodeTour: Missing value for --workspace/);

  const unexpectedArgument = runCli(root, ["create-project-tour", "extra"]);
  assert.equal(unexpectedArgument.status, 2);
  assert.match(unexpectedArgument.stderr, /CodeTour: Unexpected argument: extra/);

  const unreadableProposal = runCli(root, [
    "create-project-tour",
    "--workspace",
    root,
    "--proposal",
    path.join(root, "missing.json")
  ]);
  assert.equal(unreadableProposal.status, 2);
  assert.equal(unreadableProposal.stdout, "");
  assert.match(unreadableProposal.stderr, /CodeTour: Unable to read the proposal file/);

  const unusableWorkspace = runCli(root, [
    "create-project-tour",
    "--workspace",
    path.join(root, "not-a-directory.txt")
  ]);
  assert.equal(unusableWorkspace.status, 2);
  assert.equal(unusableWorkspace.stdout, "");
  assert.match(unusableWorkspace.stderr, /CodeTour: --workspace is not an accessible directory/);
});

test("an unexpected creation error exits 1 with a failure document, never empty stdout", () => {
  const root = workspace();
  // A `.tours` file where the Tours directory must go makes the atomic write
  // fail with a file-system error the creation rules do not classify: the
  // command must still answer with one JSON document.
  writeFileSync(path.join(root, ".tours"), "not a directory\n");

  const result = runCli(root, [
    "create-project-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("unexpected.json", {
      title: "Broken",
      steps: [{ description: "Anything." }]
    })
  ]);

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.code, "INTERNAL_ERROR");
  assert.match(failure.message, /tours/);
  assert.match(result.stderr, /CodeTour: internal error/);
});

test("a proposal that is not JSON is refused with a failure document", () => {
  const root = workspace();
  const broken = path.join(root, "broken.json");
  writeFileSync(broken, "{ not json");

  const result = runCli(root, [
    "create-project-tour",
    "--workspace",
    root,
    "--proposal",
    broken
  ]);

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.code, "INVALID_PROPOSAL");
  assert.match(failure.message, /not valid JSON/);
  assert.match(result.stderr, /CodeTour: creation refused \(INVALID_PROPOSAL\)/);
});

test("paths containing spaces work for the workspace, the proposal and the Tour file name", () => {
  const root = workspace({ "my code.ts": "export const value = 1;\n" });
  const spaced = path.join(root, "my workspace");
  mkdirSync(spaced);
  writeFileSync(path.join(spaced, "code.ts"), "export const value = 1;\n");
  const proposal = path.join(root, "my proposal.json");
  writeFileSync(
    proposal,
    JSON.stringify({
      title: "Spaced tour",
      fileName: "my tour",
      steps: [{ description: "The value.", file: "code.ts", line: 1 }]
    })
  );

  const result = runCli(root, [
    "create-project-tour",
    "--workspace",
    spaced,
    "--proposal",
    proposal
  ]);

  assert.equal(result.status, 0, result.stderr);
  const created = JSON.parse(result.stdout);
  assert.equal(created.tourPath, path.join(canonical(spaced), ".tours", "my tour.tour"));
  assert.equal(JSON.parse(readFileSync(created.tourPath, "utf8")).title, "Spaced tour");
});

test("a successful creation records one journal entry with the observed session identity", () => {
  const root = workspace();
  const proposal = proposalFile("proposal.json", {
    title: "Journaled",
    steps: [{ description: "Anything." }]
  });

  const result = runCli(root, [
    "create-project-tour",
    "--workspace",
    root,
    "--proposal",
    proposal
  ], {
    env: {
      CODETOUR_SESSION_ID: "session-abc",
      CODETOUR_RESPONSE_ID: "response-1",
      CODETOUR_HOST: "pi"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const created = JSON.parse(result.stdout);
  const directory = path.join(canonical(root), ".tours", ".log", "creations");
  const records = readdirSync(directory);
  assert.equal(records.length, 1);
  assert.match(records[0], /^\d+-\d+-[0-9a-f]+\.json$/);
  const record = JSON.parse(readFileSync(path.join(directory, records[0]), "utf8"));
  assert.deepEqual(record, {
    version: 1,
    workspace: canonical(root),
    tourPath: created.tourPath,
    tourTitle: "Journaled",
    kind: "project",
    at: record.at,
    sessionId: "session-abc",
    responseId: "response-1",
    host: "pi"
  });
  assert.equal(Number.isNaN(Date.parse(record.at)), false);
});

test("the journal records an unknown identity as null and follows the Pi session variable", () => {
  const root = workspace();
  const proposal = proposalFile("proposal.json", {
    steps: [{ description: "Anything." }]
  });

  const first = runCli(root, ["create-project-tour", "--workspace", root, "--proposal", proposal]);
  assert.equal(first.status, 0, first.stderr);
  const second = runCli(root, ["create-project-tour", "--workspace", root, "--proposal", proposal], {
    env: { PI_SESSION_ID: "pi-session-1" }
  });
  assert.equal(second.status, 0, second.stderr);

  const directory = path.join(canonical(root), ".tours", ".log", "creations");
  const records = readdirSync(directory)
    .map(name => JSON.parse(readFileSync(path.join(directory, name), "utf8")))
    .sort((left, right) => left.at.localeCompare(right.at));
  assert.equal(records.length, 2);
  assert.equal(records[0].sessionId, null);
  assert.equal(records[0].responseId, null);
  assert.equal(records[0].host, null);
  assert.equal(records[1].sessionId, "pi-session-1");
  assert.equal(records[1].host, "pi");
  assert.equal(records[1].responseId, null);
});

test("the journal follows the Copilot session identity the CLI exports to tools", () => {
  const root = workspace();
  const result = runCli(root, [
    "create-project-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("proposal.json", { steps: [{ description: "Anything." }] })
  ], {
    env: { COPILOT_AGENT_SESSION_ID: "copilot-session-1" }
  });

  assert.equal(result.status, 0, result.stderr);
  const directory = path.join(canonical(root), ".tours", ".log", "creations");
  const records = readdirSync(directory)
    .map(name => JSON.parse(readFileSync(path.join(directory, name), "utf8")));
  assert.equal(records.length, 1);
  assert.equal(records[0].sessionId, "copilot-session-1");
  assert.equal(records[0].host, "copilot");
  assert.equal(records[0].responseId, null);
});

test("an unavailable journal never fails a creation", () => {
  const root = workspace();
  // A regular file where the journal directory belongs: every journal write
  // fails, and the creation must still succeed.
  mkdirSync(path.join(root, ".tours"), { recursive: true });
  writeFileSync(path.join(root, ".tours", ".log"), "blocked\n");

  const result = runCli(root, [
    "create-project-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("proposal.json", { steps: [{ description: "Anything." }] })
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
  assert.equal(readFileSync(path.join(root, ".tours", ".log"), "utf8"), "blocked\n");
  assert.deepEqual(tourFiles(root), ["project.tour"]);
});

test("a creation journal does not count as an uncommitted change for the next creation", () => {
  const root = workspace({}, { git: true });
  const baseRef = commit(root, "base.txt", "base\n", "add base");
  const headRef = commit(root, "feature.ts", "export function feature() {}\n", "add feature");

  const project = runCli(root, [
    "create-project-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("project.json", { steps: [{ description: "Anything." }] })
  ]);
  assert.equal(project.status, 0, project.stderr);

  const changes = runCli(root, [
    "create-changes-tour",
    "--workspace",
    root,
    "--proposal",
    proposalFile("changes.json", {
      baseRef,
      headRef,
      includeUncommittedChanges: true,
      steps: [{ description: "The feature.", file: "feature.ts", line: 1 }]
    })
  ]);

  assert.equal(changes.status, 0, changes.stderr);
  const created = JSON.parse(changes.stdout);
  assert.deepEqual(created.warnings, []);
  const tour = JSON.parse(readFileSync(created.tourPath, "utf8"));
  assert.equal(tour.ref, headRef);
});
