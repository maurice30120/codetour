import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync, realpathSync } from "node:fs";
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

test("the CLI revalidates an existing Tour using whole-file patterns", () => {
  const { root } = fixture();
  try {
    writeFileSync(path.join(root, "source.ts"), "first line\nsecond line\n");
    const tour = path.join(root, ".tours", "validate.tour");
    writeFileSync(tour, JSON.stringify({ title: "Example", steps: [
      { title: "Intro", description: "Welcome" },
      { title: "Code", description: "Example", file: "source.ts", pattern: "first line\nsecond line" }
    ] }));
    const valid = run(root, ["--internal-validate-tour", tour]);
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).ok, true);
    writeFileSync(path.join(root, "source.ts"), "changed\n");
    const invalid = run(root, ["--internal-validate-tour", tour]);
    assert.equal(invalid.status, 1, invalid.stderr);
    assert.equal(JSON.parse(invalid.stdout).ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
    const result = run(root, ["--renderer", "html"], output, "2\n");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Select an existing CodeTour/);
    assert.match(readFileSync(output, "utf8"), /Other/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the VS Code renderer opens a named Tour from a nested directory without a TTY", {
  skip: process.platform === "win32"
}, () => {
  const { root } = fixture();
  try {
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    const code = path.join(bin, "code");
    const invocations = path.join(root, "code.log");
    writeFileSync(code, '#!/bin/sh\nif [ "$1" = --version ]; then echo 1.147.0; else printf "%s\\n" "$@" >> "$CODETOUR_CODE_LOG"; fi\n');
    chmodSync(code, 0o755);
    const result = spawnSync(process.execPath, [cli, "architecture", "--renderer", "vscode"], {
      cwd: path.join(root, "nested", "deep"),
      encoding: "utf8",
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, CODETOUR_CODE_LOG: invocations }
    });
    assert.equal(result.status, 0, result.stderr);
    const [workspace, flag, uri] = readFileSync(invocations, "utf8").trim().split("\n");
    // The CLI answers the canonical spelling (ADR 0056): the native real path,
    // which is the form `fs.promises.realpath` returns on an 8.3 short path.
    assert.equal(workspace, realpathSync.native(root));
    assert.equal(flag, "--open-url");
    assert.equal(new URL(uri).searchParams.get("tour"), ".tours/architecture.tour");
    assert.equal(new URL(uri).searchParams.get("step"), "1");
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

test("a bare experimental-tty-handoff flag fails cleanly, never `boolean true is not iterable`", () => {
  // Commander maps a variadic option without a value to `true`; the real
  // handoff crash (review F1) reproduced exactly through this argv shape:
  // `--internal-tour /tmp/x.tour --experimental-tty-handoff`.
  const { root } = fixture();
  try {
    const tourPath = path.join(root, ".tours", "architecture.tour");
    for (const args of [
      ["--experimental-tty-handoff"],
      ["--internal-tour", tourPath, "--experimental-tty-handoff"]
    ]) {
      const result = run(root, args);
      assert.notEqual(result.status, 0);
      const output = result.stderr + result.stdout;
      assert.doesNotMatch(output, /is not iterable/i);
      assert.match(output, /The experimental TTY handoff requires a Tour file path\./);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the reader entry rejects a non-TTY host without hiding the error", () => {
  // The TermDOM reader needs an interactive terminal; run() drives the
  // bundled CLI over pipes, so no TTY is attached. The guard lives at the
  // entry point — the adapter and the reading module are never reached.
  const { root } = fixture();
  try {
    const tourPath = path.join(root, ".tours", "architecture.tour");
    const result = run(root, ["--internal-tour", tourPath]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TermDOM requires an interactive terminal/);
  } finally {
    rmSync(root, { recursive: true, force: true });
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
    const result = run(root, ["snapshot", "--renderer", "html"], output);
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
    const result = run(root, ["image", "--renderer", "html"], output);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, "utf8"), /data:image\/png;base64,/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});


test("standalone HTML renders Mermaid as a sanitized SVG", { timeout: 30000 }, () => {
  const { root } = fixture();
  try {
    writeFileSync(path.join(root, ".tours", "diagram.tour"), JSON.stringify({
      title: "Diagram", steps: [{title: "Chart", description:
        "**Diagram — Flow**\n\n```mermaid\nflowchart TD\nA[Start] --> B[End]\n```"}]
    }));
    const output = path.join(root, "diagram.html");
    const result = spawnSync(process.execPath, [cli, "diagram", "--renderer", "html"], {
      cwd: root, encoding: "utf8", timeout: 25000,
      env: { ...process.env, CODETOUR_TEST_HTML_OUTPUT: output }
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    // The browser is a real HTML surface: the diagram travels as a sanitized
    // SVG data URI (ADR 0024), sharp at every zoom level, not a PNG.
    assert.match(readFileSync(output, "utf8"), /data:image\/svg\+xml;base64,/);
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


test("CLI selects a Tour by a filename containing spaces and Unicode", () => {
  const { root } = fixture();
  try {
    writeFileSync(path.join(root, ".tours", "guide été.tour"), JSON.stringify({
      title: "A different title", steps: [{description: "Filename selection"}]
    }));
    const output = path.join(root, "output.html");
    const result = run(root, ["guide été", "--renderer", "html"], output);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, "utf8"), /Filename selection/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});


test("a Tour titled mcp opens like any other title", () => {
  const { root } = fixture();
  try {
    writeFileSync(path.join(root, ".tours", "reserved.tour"), JSON.stringify({
      title: "mcp",
      steps: [{ title: "Free title", description: "A Tour named like the retired command." }]
    }));
    // `mcp` is no longer a reserved subcommand: the title reaches the reader
    // directly, and the numbered prompt keeps working.
    const output = path.join(root, "free.html");
    const opened = run(root, ["mcp", "--renderer", "html"], output);
    assert.equal(opened.status, 0, opened.stderr);
    assert.match(readFileSync(output, "utf8"), /A Tour named like the retired command/);
    const listed = JSON.parse(run(root, ["--internal-list-tours"]).stdout) as { title: string }[];
    const selection = String(listed.findIndex(tour => tour.title === "mcp") + 1);
    const selected = path.join(root, "selected.html");
    const chosen = run(root, ["--renderer", "html"], selected, selection + "\n");
    assert.equal(chosen.status, 0, chosen.stderr);
    assert.match(readFileSync(selected, "utf8"), /A Tour named like the retired command/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the CLI help documents the terminal renderer as the default", () => {
  const { root } = fixture();
  try {
    const result = run(root, ["--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--renderer <type>\s+open the Tour as terminal \(default\), html, or vscode/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the CLI reads in the calling terminal and never opens an independent window", () => {
  const { root } = fixture();
  try {
    // run() spawns the CLI over pipes: no terminal. The default renderer and
    // the explicit `terminal` renderer must both reject such a host at the
    // composition root's TTY validation (ticket #241) — never fall back to
    // an independent terminal window, and never print an opened message.
    for (const args of [["architecture"], ["architecture", "--renderer", "terminal"]]) {
      const result = run(root, args);
      assert.notEqual(result.status, 0, args.join(" "));
      assert.match(result.stderr, /TermDOM requires an interactive terminal/);
      assert.doesNotMatch(result.stdout, /CodeTour: opened/);
    }
  } finally { rmSync(root, {recursive:true, force:true}); }
});

test("macOS CLI reports a failing browser launcher", {skip: process.platform !== "darwin"}, () => {
  const { root } = fixture();
  try {
    const bin = path.join(root, "bin"); mkdirSync(bin);
    const launcher = path.join(bin, "open"); writeFileSync(launcher, "#!/bin/sh\nexit 42\n"); chmodSync(launcher, 0o755);
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: bin + path.delimiter + process.env.PATH };
    delete env.CODETOUR_TEST_HTML_OUTPUT;
    const result = spawnSync(process.execPath, [cli, "architecture", "--renderer", "html"], {cwd: root, encoding: "utf8", env});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Browser launcher failed: 42/);
    assert.doesNotMatch(result.stdout, /CodeTour: opened/);
  } finally { rmSync(root, {recursive:true, force:true}); }
});
