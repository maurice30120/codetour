import { test } from "node:test";
import * as assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as os from "node:os";
import * as path from "node:path";
import type { ChildProcess } from "node:child_process";
import {
  defaultTerminalSession,
  handOffTtyToTourReader
} from "./ttyHandoff";
import type { TerminalSession, TtyHandoffRequest } from "./ttyHandoff";

// The handoff contract (ticket T4 #243, spike), observed in-process only.
// Seams under test, agreed with the steering message:
//   1. `defaultTerminalSession()` — the production TerminalSession over the
//      real process TTY state; the fakes stand in for it in every test.
//   2. `handOffTtyToTourReader()` — the experimental transfer: suspend the
//      session's stdio ownership, run the reader inside the SAME terminal
//      (inherited stdin/stdout, never a PTY), then return control exactly
//      once, even when the reader is interrupted.
// The reader module (`runTerminalTour`) and the standard reading path of
// `src/cli/index.ts` are NOT touched by this spike.

interface SpawnCall { command: string; args: string[]; options?: { stdio?: unknown } }

interface SpySession extends TerminalSession {
  suspends: Array<{ at: string }>;
  resumes: Array<{ token: unknown }>;
  restores: number;
}

/** A fake session: records ownership changes, never touches a real TTY. */
function fakeSession(interactive = true): SpySession {
  const suspends: Array<{ at: string }> = [];
  const resumes: Array<{ token: unknown }> = [];
  let restores = 0;
  return {
    interactive: () => interactive,
    suspend() {
      const token = { owner: "fake-session", at: new Date().toISOString() };
      suspends.push(token);
      return token;
    },
    resume(token: unknown) {
      // A spy keeps its history: the test reads the token the handoff resumed
      // with after the run, so nothing is cleared here.
      resumes.push({ token });
    },
    restoreTerminalState() {
      restores += 1;
    },
    suspends,
    resumes,
    get restores() {
      return restores;
    }
  } as unknown as SpySession;
}

/** A fake spawn: records the call, never starts a process nor a PTY. */
function fakeSpawnChild(script: {
  error?: unknown; exitCode?: number | null; signal?: NodeJS.Signals | null
}): { spawnChild: typeof import("node:child_process").spawn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawnChild = ((command: string, args: string[]) => {
    calls.push({ command, args });
    const child = new EventEmitter() as unknown as ChildProcess;
    child.stdin = new EventEmitter() as ChildProcess["stdin"];
    child.stdout = new EventEmitter() as ChildProcess["stdout"];
    child.stderr = new EventEmitter() as ChildProcess["stderr"];
    if (script.error !== undefined) {
      // The failing-reader case models a reader that STARTED and crashed:
      // the child exists (spawned), then errors — after the listeners.
      queueMicrotask(() => child.emit("error", script.error));
    } else {
      // exitCode null means a kill by signal: never collapse it onto 0.
      // Emitted in a microtask: the handoff attaches its listener after
      // spawn returns, so a synchronous emit would be lost and hang it.
      const code = script.exitCode === undefined ? 0 : script.exitCode;
      queueMicrotask(() => child.emit("exit", code, script.signal ?? null));
    }
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
  return { spawnChild, calls };
}

function request(tourPath = "samples/demo.tour", workspaceRoot?: string): TtyHandoffRequest { // eslint-disable-line
  return { tourPath, workspaceRoot };
}

test("a session that is not interactive refuses the handoff before any process starts", async () => {
  const session = fakeSession(false);
  const { spawnChild, calls } = fakeSpawnChild({});
  const result = await handOffTtyToTourReader(request(), { session, spawnChild });
  assert.equal(result.handedOff, false);
  assert.equal(result.spawned, false);
  assert.match(String(result.reason), /not interactive/i);
  assert.match(String(result.reason), /TTY/i);
  // A non-interactive session is a documented limitation, not a crash:
  // the launcher Copilot stays blocked and nothing is suspended.
  assert.equal(session.suspends.length, 0);
  assert.equal(session.resumes.length, 0);
  assert.equal(calls.length, 0);
  assert.ok(result.durationMs >= 0);
});

test("an interactive session suspends itself before the reader starts, then resumes exactly once", async () => {
  const session = fakeSession(true);
  const { spawnChild, calls } = fakeSpawnChild({ exitCode: 0 });
  // The handoff — not this test — owns the suspend: it mints one token, and
  // this test checks the resumed token is exactly the one recorded.
  const result = await handOffTtyToTourReader(request("samples/demo.tour", process.cwd()), { session, spawnChild });
  assert.equal(result.handedOff, true);
  assert.equal(result.spawned, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.interrupted, false);
  // Safe return: the session is resumed exactly once, with the handoff's token.
  assert.equal(session.suspends.length, 1);
  assert.equal(session.resumes.length, 1);
  assert.equal(session.resumes[0].token, session.suspends[0]);
  assert.ok(result.durationMs >= 0);
  assert.equal(calls.length, 1);
  // The same-terminal contract: node itself, then the CLI entry beside it,
  // then the reader's options — the session's argv is preserved in order.
  assert.equal(calls[0].command, process.execPath);
  assert.match(String(calls[0].args[0]), /dist[\/]cli\.js$/);
  // The handoff flag NEVER travels to the child (review F1): the child runs
  // the internal reading path, bare; a flag without a value reaches Commander
  // as `true` and made the child crash with `TypeError: boolean true is not
  // iterable` before it ever read the Tour.
  assert.deepEqual(calls[0].args.slice(1), ["--internal-tour", "samples/demo.tour", process.cwd()]);
  assert.ok(!calls[0].args.includes("--experimental-tty-handoff"));
});

test("an interrupted reader still returns the terminal to the session exactly once", async () => {
  const session = fakeSession(true);
  const { spawnChild } = fakeSpawnChild({ exitCode: null, signal: "SIGINT" });
  const result = await handOffTtyToTourReader(request(), { session, spawnChild });
  assert.equal(result.interrupted, true);
  assert.equal(result.signal, "SIGINT");
  assert.equal(result.exitCode, null);
  assert.notEqual(result.interrupted, undefined);
  assert.ok(result.durationMs >= 0);
  // Exactly one resume, with the exactly one token the handoff minted.
  assert.equal(session.suspends.length, 1);
  assert.equal(session.resumes.length, 1);
  assert.equal(session.resumes[0].token, session.suspends[0]);
});

test("a failing reader process still restores the session, never a half-handed terminal", async () => {
  const session = fakeSession(true);
  const { spawnChild } = fakeSpawnChild({ error: new Error("reader crashed") });
  const result = await handOffTtyToTourReader(request(), { session, spawnChild });
  assert.equal(result.resumed, true);
  assert.equal(result.handedOff, true);
  assert.equal(result.spawned, true);
  // The error is reported through the result, never thrown across the seam.
  assert.match(String(result.reason), /reader crashed/);
  // Exactly one suspend, one resume, and they are the handoff's own.
  assert.equal(session.suspends.length, 1);
  assert.equal(session.resumes.length, 1);
});

test("the production session over the real process reports the process TTY state", () => {
  const session = defaultTerminalSession();
  assert.equal(typeof session.interactive(), "boolean");
  const token = session.suspend();
  assert.equal(token.owner, "codetour-reader");
  assert.ok(token.suspendedAt);
  assert.doesNotThrow(() => session.resume(token));
});

test("the handoff runs the reader inside the same terminal, without opening one", async () => {
  const session = fakeSession(true);
  const { spawnChild, calls } = fakeSpawnChild({ exitCode: 0 });
  const before = os.tmpdir();
  const result = await handOffTtyToTourReader(
    request(path.join("samples", "demo.tour"), before),
    { session, spawnChild }
  );
  assert.equal(result.handedOff, true);
  assert.equal(result.spawned, true);
  assert.equal(result.resumed, true);
  assert.ok(result.durationMs >= 0);
  // Same terminal: the workspace root is passed through untouched, no
  // independent shell, window or PTY was involved (this test process has no
  // TTY at all when run by node --test).
  assert.deepEqual(calls[0].args.slice(1, 4), [
    "--internal-tour", path.join("samples", "demo.tour"), before
  ]);
  // No handoff flag in the child's command line (review F1).
  assert.ok(!calls[0].args.includes("--experimental-tty-handoff"));
  // One suspend, one resume — the handoff's own, token-consistent.
  assert.equal(session.suspends.length, 1);
  assert.equal(session.resumes.length, 1);
  assert.equal(session.resumes[0].token, session.suspends[0]);
});
