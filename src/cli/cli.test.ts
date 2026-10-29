import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const cli = path.resolve(__dirname, "../../cli.js");

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-cli-e2e-"));
  spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
  mkdirSync(path.join(root, ".tours"));
  mkdirSync(path.join(root, "nested", "deep"), { recursive: true });
  const tour = {
    title: "Architecture",
    description: "Existing Project Tour",
    steps: [
      { title: "Introduction", description: "Welcome to **CodeTour**." },
      { title: "Second step", description: "The second explanation." }
    ]
  };
  const original = JSON.stringify(tour, null, 2);
  writeFileSync(path.join(root, ".tours", "architecture.tour"), original);
  writeFileSync(path.join(root, ".tours", "another.tour"), JSON.stringify({
    title: "Other",
    steps: [{ title: "Other step", description: "Other explanation." }]
  }));
  return { root, original };
}

function run(cwd: string, args: string[], output?: string, input?: string) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: "utf8", input,
    env: {
      ...process.env,
      ...(output ? { CODETOUR_TEST_HTML_OUTPUT: output } : {})
    }
  });
}

test("the CLI opens an existing Project Tour from a nested Git worktree without mutation", () => {
  const { root, original } = fixture();
  try {
    const output = path.join(root, "playback.html");
    const result = run(path.join(root, "nested", "deep"), ["architecture", "--renderer", "html"], output);
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(output, "utf8");
    assert.match(html, /Architecture/);
    assert.match(html, /Introduction/);
    assert.match(html, /Second step/);
    assert.match(html, /Previous/);
    assert.match(html, /Next/);
    assert.match(html, /Finish/);
    assert.match(html, /Welcome to/);
    assert.equal(readFileSync(path.join(root, ".tours", "architecture.tour"), "utf8"), original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the CLI selects from multiple Tours using its numbered prompt", () => {
  const { root } = fixture();
  try {
    const output = path.join(root, "selected.html");
    const result = run(root, [], output, "2\n");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Select an existing CodeTour/);
    assert.match(readFileSync(output, "utf8"), /Other/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI errors do not write or launch", () => {
  const { root } = fixture();
  const empty = mkdtempSync(path.join(os.tmpdir(), "codetour-no-git-"));
  try {
    assert.notEqual(run(empty, ["Architecture"]).status, 0);
    assert.match(run(empty, ["Architecture"]).stderr, /Git worktree/);
    assert.notEqual(run(root, ["Missing Tour"]).status, 0);
    assert.match(run(root, ["Missing Tour"]).stderr, /not found/);
    assert.match(run(root, ["Architecture", "--renderer", "unknown"]).stderr, /Unknown renderer/);
    assert.match(run(root, ["Architecture", "--unexpected"]).stderr, /Unknown option/);
    assert.match(run(root, ["Architecture", "--renderer"]).stderr, /Missing value/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});


test("standalone HTML shows referenced Git snapshot rather than a dirty worktree", () => {
  const { root } = fixture();
  try {
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, {cwd: root, encoding: "utf8"});
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    writeFileSync(path.join(root, "code.ts"), "export const historical = 42;\n");
    git("add", "code.ts");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "snapshot");
    const ref = git("rev-parse", "HEAD");
    writeFileSync(path.join(root, "code.ts"), "export const dirty = 99;\n");
    git("add", "code.ts");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "later");
    writeFileSync(path.join(root, ".tours", "snapshot.tour"), JSON.stringify({
      title: "Snapshot", ref, steps: [{title: "Code", file: "code.ts", line: 1, description: "Example"}]
    }));
    const output = path.join(root, "snapshot.html");
    const result = run(root, ["snapshot"], output);
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(output, "utf8");
    assert.match(html, /historical = 42/);
    assert.doesNotMatch(html, /dirty = 99/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});


test("standalone HTML inlines an image from the Tour workspace", () => {
  const { root } = fixture();
  try {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/6T8AAAAASUVORK5CYII=", "base64");
    writeFileSync(path.join(root, "image.png"), png);
    writeFileSync(path.join(root, ".tours", "image.tour"), JSON.stringify({
      title: "Image", steps: [{title: "Picture", description: "![Example](./image.png)"}]
    }));
    const output = path.join(root, "image.html");
    const result = run(root, ["image"], output);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, "utf8"), /data:image\/png;base64,/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});


test("standalone HTML renders Mermaid as a PNG", { timeout: 30000 }, () => {
  const { root } = fixture();
  try {
    writeFileSync(path.join(root, ".tours", "diagram.tour"), JSON.stringify({
      title: "Diagram", steps: [{title: "Chart", description:
        "**Diagram — Flow**\n\n```mermaid\nflowchart TD\nA[Start] --> B[End]\n```"}]
    }));
    const output = path.join(root, "diagram.html");
    const result = spawnSync(process.execPath, [cli, "diagram"], {
      cwd: root, encoding: "utf8", timeout: 25000,
      env: { ...process.env, CODETOUR_TEST_HTML_OUTPUT: output }
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.match(readFileSync(output, "utf8"), /data:image\/png;base64,/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test("the Copilot adapter can list discoverable Tours without a TTY", () => {
  const { root } = fixture();
  try {
    const result = run(path.join(root, "nested", "deep"), ["--internal-list-tours"]);
    assert.equal(result.status, 0, result.stderr);
    const tours = JSON.parse(result.stdout);
    assert.deepEqual(tours.map((tour: {title: string}) => tour.title), ["Architecture", "Other"]);
    assert.ok(tours.every((tour: {id: string}) => tour.id.startsWith("file:")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test("a selected discovered Tour identity opens the requested tour", () => {
  const { root } = fixture();
  try {
    const output = path.join(root, "identity.html");
    const list = JSON.parse(run(root, ["--internal-list-tours"]).stdout);
    const result = run(root, ["--internal-tour-id", list[1].id, "--renderer", "html"], output);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, "utf8"), /Other explanation/);
    const rejected = run(root, ["--internal-tour-id", "file:///outside.tour"], output);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /no longer available/);
  } finally { rmSync(root, {recursive:true, force:true}); }
});
