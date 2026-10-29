import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const cli = path.resolve(__dirname, "../../cli.js");

test("the detached reader entry rejects a non-TTY host without hiding the error", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "codetour-terminal-host-"));
  try {
    const tourPath = path.join(dir, "tour.tour");
    writeFileSync(tourPath, JSON.stringify({
      title: "Playback", steps: [{ title: "Introduction", description: "Hello TermDOM" }]
    }));
    const result = spawnSync(process.execPath, [cli, "--internal-tour", tourPath], {
      encoding: "utf8", timeout: 10000
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TermDOM requires an interactive terminal/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the real TermDOM reader supports a pseudo-terminal and keyboard-driven finish", {
  skip: process.platform !== "linux"
}, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "codetour-terminal-pty-"));
  try {
    const tourPath = path.join(dir, "tour.tour");
    writeFileSync(tourPath, JSON.stringify({
      title: "Playback",
      steps: [
        { title: "Introduction", description: "First description" },
        { title: "Conclusion", description: "Second description" }
      ]
    }));
    // 'script' provides a genuine PTY; the keyboard sequence is sent after
    // TermDOM has attached. This exercises the bundled public reader.
    const command = [
      "(sleep 2; printf '\\033[Cq')",
      "| script -q -e -c",
      "'" + process.execPath + " " + cli + " --internal-tour " + tourPath + "'",
      "/dev/null"
    ].join(" ");
    const result = spawnSync("bash", ["-lc", command], {
      encoding: "utf8", timeout: 16000,
      env: { ...process.env, TERM: "xterm-256color", CI: "true" }
    });
    assert.equal(result.status, 0, (result.stderr || "") + "\n" +
      (result.stdout || "").slice(-1200));
    assert.match(result.stdout, /Introduction/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
