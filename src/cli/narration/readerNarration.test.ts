import { after, before, test } from "node:test";
import * as assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

const cli = path.resolve(__dirname, "../../../cli.js");

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function initGitWorktree(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
}

const TOUR = {
  title: "Narration",
  steps: [
    { title: "Introduction", description: "First spoken description" },
    { title: "Middle", description: "Second spoken description" },
    { title: "End", description: "Third spoken description" }
  ]
};

/**
 * A fake local speech command for the real reader: it records its pid and the
 * utterance, then keeps "speaking" so interruption and cleanup are observable.
 * The utterance is argv data after `--`, exactly like `say` receives it.
 */
const FAKE_SPEECH_SCRIPT = [
  "#!/bin/sh",
  'printf \'%s %s\\n\' "$$" "$2" >> "$CODETOUR_SPEECH_LOG"',
  "exec sleep 30",
  ""
].join("\n");

interface ReaderSession {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the bundled reader in a genuine pseudo-terminal, sends `keys` after
 * TermDOM has attached, then quits. The keys are printf escape sequences, so
 * "\u001b[C" is the right-arrow key.
 */
function readTourWithKeys(keys: string[], env: NodeJS.ProcessEnv): ReaderSession {
  const keyScript = keys.map(key => "printf '" + key + "'; sleep 1;").join(" ");
  const input = "(sleep 2; " + keyScript + " sleep 1; printf q)";
  const reader = process.execPath + " '" + cli + "' --internal-tour '" + tourPath + "'";
  // GNU and BSD `script` disagree on the command syntax; both provide the
  // pseudo-terminal TermDOM requires and forward the piped keystrokes.
  const command = process.platform === "darwin"
    ? input + " | script -q /dev/null " + reader
    : input + " | timeout -k 1s 25s script -q -e -c '" + reader + "' /dev/null";
  const result = spawnSync("bash", ["-lc", command], {
    encoding: "utf8", timeout: 40000,
    env: { ...process.env, TERM: "xterm-256color", CI: "true", ...env }
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function assertProcessesExited(lines: string[]): Promise<void> {
  const pids = lines.map(line => Number(line.split(" ")[0])).filter(pid => pid > 0);
  const deadline = Date.now() + 5000;
  for (const pid of pids) {
    for (;;) {
      try {
        process.kill(pid, 0);
      } catch {
        break;
      }
      if (Date.now() > deadline) {
        assert.fail("speech process " + pid + " is still alive after the reader closed");
      }
      await sleep(100);
    }
  }
}

const directory = mkdtempSync(path.join(os.tmpdir(), "codetour-narration-reader-"));
const tourPath = path.join(directory, "tour.tour");
const fakeSpeech = path.join(directory, "fake-speech");

before(() => {
  initGitWorktree(directory);
  writeFileSync(tourPath, JSON.stringify(TOUR));
  writeFileSync(fakeSpeech, FAKE_SPEECH_SCRIPT);
  chmodSync(fakeSpeech, 0o755);
});

after(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** A fresh speech log per test, so sessions cannot observe each other. */
function speechSession(): { env: NodeJS.ProcessEnv; log: () => string[] } {
  const logPath = path.join(directory, "speech-" + randomUUID() + ".log");
  return {
    env: { CODETOUR_SPEECH_COMMAND: fakeSpeech, CODETOUR_SPEECH_LOG: logPath },
    log: () => {
      try {
        return readFileSync(logPath, "utf8").split("\n").filter(Boolean);
      } catch {
        return [];
      }
    }
  };
}

test("a session starts silent; V speaks the current step and V stops it", {
  skip: process.platform === "win32"
}, async () => {
  const { env, log } = speechSession();
  const session = readTourWithKeys(["v", "v"], env);
  assert.equal(session.status, 0, session.stderr + "\n" + session.stdout.slice(-1500));
  assert.match(session.stdout, /VOICE OFF/);
  assert.match(session.stdout, /VOICE ON/);
  assert.deepEqual(log().map(line => line.slice(line.indexOf(" ") + 1)),
    ["First spoken description"]);
  await assertProcessesExited(log());
});

test("navigation interrupts the previous speech and narrates the displayed step", {
  skip: process.platform === "win32"
}, async () => {
  const { env, log } = speechSession();
  const session = readTourWithKeys(["v", "\\033[C"], env);
  assert.equal(session.status, 0, session.stderr + "\n" + session.stdout.slice(-1500));
  assert.deepEqual(log().map(line => line.slice(line.indexOf(" ") + 1)),
    ["First spoken description", "Second spoken description"]);
  await assertProcessesExited(log());
});

test("rapid navigation narrates only the steps actually displayed", {
  skip: process.platform === "win32"
}, async () => {
  // Both right-arrows arrive before any render completes, so the middle Step
  // is never displayed: the voice must skip it, not queue or double anyone.
  const { env, log } = speechSession();
  const session = readTourWithKeys(["v", "\\033[C\\033[C"], env);
  assert.equal(session.status, 0, session.stderr + "\n" + session.stdout.slice(-1500));
  assert.deepEqual(log().map(line => line.slice(line.indexOf(" ") + 1)),
    ["First spoken description", "Third spoken description"]);
  await assertProcessesExited(log());
});

test("a v typed in the chat prompt stays text and never toggles the voice", {
  skip: process.platform === "win32"
}, async () => {
  // /bin/echo exists on PATH: the chat opens without launching any agent,
  // because no question is ever submitted.
  const { env, log } = speechSession();
  const session = readTourWithKeys(["a", "v", "\\033"],
    { ...env, CODETOUR_ACP_COMMAND: "/bin/echo" });
  assert.equal(session.status, 0, session.stderr + "\n" + session.stdout.slice(-1500));
  assert.match(session.stdout, /v▌/);
  assert.doesNotMatch(session.stdout, /VOICE ON/);
  assert.deepEqual(log(), []);
});

test("scrolling and opening the chat never restart the narration", {
  skip: process.platform === "win32"
}, async () => {
  const { env, log } = speechSession();
  const session = readTourWithKeys(["v", "j", "k", " ", "a", "\\033"],
    { ...env, CODETOUR_ACP_COMMAND: "/bin/echo" });
  assert.equal(session.status, 0, session.stderr + "\n" + session.stdout.slice(-1500));
  assert.match(session.stdout, /VOICE ON/);
  assert.deepEqual(log().map(line => line.slice(line.indexOf(" ") + 1)),
    ["First spoken description"]);
  await assertProcessesExited(log());
});

test("a platform without local speech warns without blocking the reader", {
  skip: process.platform !== "linux"
}, async () => {
  const session = readTourWithKeys(["v", "\\033[C"], {});
  assert.equal(session.status, 0, session.stderr + "\n" + session.stdout.slice(-1500));
  assert.match(session.stdout, /Narration failed/);
  assert.match(session.stdout, /Middle/);
});
