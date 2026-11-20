import { test } from "node:test";
import * as assert from "node:assert";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PI_READONLY_LAUNCHER_VERSION,
  PI_READONLY_TOOLS,
  piAcpEntry,
  piReadonlyLauncher
} from "./piReadonlyLauncher";

/**
 * The Pi launcher (ADR 0049) is tested without Pi: the script it writes, the
 * arguments a fake `pi` receives, and the ACP entry the catalogue launches.
 * The tool surface a real Pi actually ends up with is the manual smoke test's
 * job, because only a running agent can prove it.
 */

/** A directory the test owns, under the OS temporary directory. */
function temporaryDirectory(): string {
  return mkdtempSync(path.join(os.tmpdir(), "codetour-pi-launcher-"));
}

const POSIX_ONLY = { skip: process.platform === "win32" };

test("the launcher restricts Pi to the reading and searching tools", () => {
  const root = temporaryDirectory();
  const launcher = piReadonlyLauncher({ root });

  assert.ok(launcher, "a POSIX platform provides the launcher");
  assert.equal(
    path.dirname(launcher),
    path.join(root, "codetour-pi-readonly"),
    "launchers live in one CodeTour directory"
  );
  assert.equal(
    path.basename(launcher),
    `pi-readonly-${PI_READONLY_LAUNCHER_VERSION}.sh`,
    "the file name carries the launcher's version"
  );

  // The whole script: a POSIX shell that replaces itself with the only Pi
  // command a read-only conversation may run, keeping the arguments pi-acp
  // passes and any extra one (a smoke test loads its extension that way).
  assert.equal(
    readFileSync(launcher, "utf8"),
    '#!/bin/sh\nexec pi --tools read,grep,find,ls --no-mcp "$@"\n'
  );
  assert.deepEqual([...PI_READONLY_TOOLS], ["read", "grep", "find", "ls"]);
  // No tool that could change the workspace or run a program.
  for (const forbidden of ["bash", "powershell", "edit", "write"]) {
    assert.ok(
      !readFileSync(launcher, "utf8").includes(forbidden),
      `the launcher never enables ${forbidden}`
    );
  }
  // An unwritable script would be a Pi nobody can launch.
  assert.ok((statSync(launcher).mode & 0o111) !== 0, "the launcher is executable");
});

test("the launcher is written once and reused as is", () => {
  const root = temporaryDirectory();
  const first = piReadonlyLauncher({ root });
  const content = readFileSync(first!, "utf8");
  const second = piReadonlyLauncher({ root });

  assert.equal(second, first, "the same build reuses the same launcher");
  assert.equal(readFileSync(second!, "utf8"), content);
  assert.deepEqual(
    readdirSync(path.dirname(first!)),
    [`pi-readonly-${PI_READONLY_LAUNCHER_VERSION}.sh`],
    "no staged or duplicate file is left behind"
  );
});

test("the launcher runs pi with the allowlist and passes its arguments through", POSIX_ONLY, () => {
  const root = temporaryDirectory();
  const launcher = piReadonlyLauncher({ root })!;
  // A `pi` that reports its own arguments: the launcher's exec line, exactly
  // as pi-acp and a smoke test's extra argument reach it.
  const bin = path.join(root, "bin");
  const log = path.join(root, "argv.txt");
  mkdirSync(bin);
  const fakePi = path.join(bin, "pi");
  writeFileSync(fakePi, '#!/bin/sh\nprintf "%s\\n" "$@" > "$PI_ARGV_LOG"\n');
  chmodSync(fakePi, 0o755);

  execFileSync(launcher, ["--mode", "rpc", "--no-themes", "-e", "extension.ts"], {
    env: {
      ...process.env,
      PATH: bin + path.delimiter + (process.env.PATH ?? ""),
      PI_ARGV_LOG: log
    }
  });

  assert.deepEqual(readFileSync(log, "utf8").split("\n").slice(0, -1), [
    "--tools",
    "read,grep,find,ls",
    "--no-mcp",
    "--mode",
    "rpc",
    "--no-themes",
    "-e",
    "extension.ts"
  ]);
});

test("no launcher, no entry: Pi is never launched unrestricted", () => {
  const root = temporaryDirectory();

  // Windows has no POSIX shell, and a file system that refuses the write is
  // the same answer: no launcher, and therefore no Pi profile to launch.
  assert.equal(piReadonlyLauncher({ platform: "win32", root }), undefined);
  assert.equal(piAcpEntry("/workspace", { platform: "win32", root }), undefined);
  assert.equal(
    existsSync(path.join(root, "codetour-pi-readonly")),
    false,
    "no launcher was written"
  );

  // A path whose parent is a regular file cannot hold a launcher either.
  const file = path.join(root, "not-a-directory");
  writeFileSync(file, "");
  const unusable = { root: path.join(file, "codetour-pi-readonly") };
  assert.equal(piReadonlyLauncher(unusable), undefined);
  assert.equal(piAcpEntry("/workspace", unusable), undefined);
});

test("Pi is launched through pi-acp and the launcher, never as a bare pi", POSIX_ONLY, () => {
  const root = temporaryDirectory();
  const entry = piAcpEntry("/workspace", { root });

  assert.ok(entry, "a POSIX platform launches Pi");
  // pi-acp is the verified ACP adapter, and the reader's own `pi` settings are
  // irrelevant: the launcher is the only thing that decides Pi's tools.
  assert.equal(entry.command, "pi-acp");
  assert.deepEqual(entry.args, []);
  assert.equal(entry.cwd, "/workspace");
  assert.deepEqual(entry.env, {
    PI_ACP_PI_COMMAND: path.join(root, "codetour-pi-readonly", `pi-readonly-${PI_READONLY_LAUNCHER_VERSION}.sh`)
  });
  // Pi's modes are thinking levels, not permissions: its read-only property
  // comes from the allowlist, so the agent's current mode is accepted.
  assert.equal(entry.useDefaultMode, true);
  assert.equal(entry.modeId, undefined);
});

test("the launcher is never written into the reader's Pi configuration", () => {
  const root = temporaryDirectory();
  const home = path.join(root, "home");
  const tmp = path.join(root, "tmp");
  mkdirSync(home);
  mkdirSync(tmp);
  const previous = { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
  try {
    process.env.HOME = home;
    process.env.TMPDIR = tmp;
    const launcher = piReadonlyLauncher();

    assert.ok(launcher);
    assert.ok(
      launcher.startsWith(path.join(tmp, "codetour-pi-readonly")),
      "the launcher lives in the OS temporary directory"
    );
    assert.equal(
      existsSync(path.join(home, ".pi")),
      false,
      "the agent's own configuration is never touched"
    );
  } finally {
    restoreEnvironment(previous);
  }
});

/** Puts the environment back as it was: an unset variable stays unset. */
function restoreEnvironment(previous: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}
