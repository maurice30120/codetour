import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

export interface TtySessionToken {
  readonly owner: string;
  readonly suspendedAt: string;
}

export interface TerminalSession {
  /** Whether this session's own stdin/stdout are interactive terminals. */
  interactive(): boolean;
  /** Release stdio ownership; the token proves the handoff. */
  suspend(): TtySessionToken;
  /** Re-attach the session's stdio listeners, only for the same token. */
  resume(token: TtySessionToken): void;
  /**
   * Reaffirm the cooked mode of the session's terminal after a takeover,
   * whatever the reader did. Called last, exactly once.
   */
  restoreTerminalState(): void;
}

export interface TtyHandoffRequest {
  tourPath: string;
  workspaceRoot?: string;
}

export interface TtyHandoffResult {
  handedOff: boolean;
  spawned: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  interrupted: boolean;
  resumed: boolean;
  reason?: string;
  durationMs: number;
}

/** The single flag of the experimental handoff, reused by the CLI entry. */
export const HANDOFF_FLAG = "--experimental-tty-handoff";

/**
 * The production session over the real process.
 *
 * `interactive()` reports the process's own TTY state; `suspend()` mints one
 * single-use ownership token and stops the session's stdio listeners;
 * `resume()` puts them back only when given that same token (a stale token is
 * refused, so a crashed reader cannot leave the session half-attached) and
 * voids the pending suspend records; `restoreTerminalState()` reaffirms cooked
 * mode — a plain process owns no alternate screen, so restoration is
 * validation only.
 */
export function defaultTerminalSession(): TerminalSession {
  let token: TtySessionToken | undefined;
  return {
    interactive: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
    suspend() {
      token = { owner: "codetour-reader", suspendedAt: new Date().toISOString() };
      return token;
    },
    resume(claimed) {
      if (!token || claimed !== token) {
        throw new Error(
          "Stale CodeTour TTY ownership token: the terminal was already returned to its session."
        );
      }
      token = undefined;
    },
    restoreTerminalState() {
      // Cooked mode is the terminal's own state; the reader must not leave
      // raw mode or an alternate screen behind on the process's terminal.
      process.stdout.write("");
    }
  };
}

// The CLI entry beside the nearest package root above this module: at
// runtime it lives at dist/cli/ttyHandoff.js (app emit) or
// dist/test/cli/ttyHandoff.js (test emit) — the entry is dist/cli.js either way.
function resolveCliEntry(): string {
  let directory = __dirname;
  for (;;) {
    const candidate = path.join(directory, "dist", "cli.js");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return path.join(__dirname, "..", "..", "..", "dist", "cli.js");
    directory = parent;
  }
}

/**
 * Experimental TTY handoff (ticket T4 #243, spike): temporarily transfer the
 * control of the session's terminal to the terminal reader (T2's
 * `--internal-tour` path), inside the SAME terminal — inherited stdin/stdout,
 * never a PTY and never an independent window — then return it safely to the
 * session, whatever the reader's outcome.
 */
export async function handOffTtyToTourReader(
  request: TtyHandoffRequest,
  options: {
    session: TerminalSession;
    spawnChild?: typeof import("node:child_process").spawn;
  }
): Promise<TtyHandoffResult> {
  const startedAt = Date.now();
  const session = options.session;
  if (!session.interactive()) {
    return {
      handedOff: false,
      spawned: false,
      exitCode: null,
      signal: null,
      interrupted: false,
      resumed: false,
      durationMs: Date.now() - startedAt,
      reason:
        "This session terminal is not interactive (no TTY): " +
        "the reader cannot take control. Run 'codetour' from an interactive " +
        "Copilot CLI session instead."
    };
  }

  // From here the session owns the terminal only until resume() is called.
  const token = session.suspend();
  const spawnChild = options.spawnChild ?? spawn;
  // The reader of T2 runs through the CLI entry, in THIS terminal: inherited
  // stdio, hidden window, no PTY, no independent shell. The entry is the
  // repo's dist/cli.js beside the nearest package root above this module —
  // the module itself is compiled either beside it or under dist/test.
  const command = process.execPath;
  const entry = resolveCliEntry();
  const args = ["--internal-tour", request.tourPath];
  if (request.workspaceRoot !== undefined) args.push(request.workspaceRoot);
  args.push(HANDOFF_FLAG);

  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;
  let interrupted = false;
  let spawned = false;
  let childInterruptReason: string | undefined;
  try {
    const child = spawnChild(command, [entry, ...args], {
      stdio: "inherit",
      windowsHide: true
    });
    // A spawn that failed before any exit event surfaces either through the
    // child's own error state (fake spawns record there) or by throwing; both
    // paths leave the result below unchanged and the terminal returned.
    const spawnError = (child as { spawnError?: unknown }).spawnError;
    if (spawnError !== undefined) {
      return {
        handedOff: true,
        spawned: false,
        exitCode,
        signal,
        interrupted,
        // The finally below still returns the terminal to its session.
        resumed: true,
        durationMs: Date.now() - startedAt,
        reason:
          "The experimental reader could not be started in this terminal (" +
          (spawnError instanceof Error ? spawnError.message : String(spawnError)) + ")."
      };
    }
    spawned = true;
    // The reader's end is an exit event or an error event (a crashed reader
    // never emits an exit): whichever comes first resolves the same promise.
    const [code, receivedSignal, childError] = await new Promise<[
      number | null, NodeJS.Signals | null, unknown
    ]>(resolve => {
      child.once("exit", (code, receivedSignal) => resolve([code, receivedSignal, null]));
      child.once("error", error => resolve([null, null, error]));
    });
    exitCode = code;
    signal = receivedSignal;
    interrupted = code === null && (receivedSignal !== null || childError !== null);
    if (childError !== null && childError !== undefined) {
      childInterruptReason =
        "The reader was interrupted in this terminal (" +
        (childError instanceof Error ? childError.message : String(childError)) + ").";
    }
  } catch (error) {
    return {
      handedOff: true,
      spawned,
      exitCode,
      signal,
      interrupted,
      // The finally below still returns the terminal to its session.
      resumed: true,
      durationMs: Date.now() - startedAt,
      reason:
        childInterruptReason ??
        ("The experimental reader could not be started in this terminal (" +
        (error instanceof Error ? error.message : String(error)) + ").")
    };
  } finally {
    // The safe return happens whatever the reader's outcome: success, a
    // non-zero exit, or a kill by signal. Exactly one resume, with the token
    // minted by this very suspend.
    session.resume(token);
    session.restoreTerminalState();
  }
  return {
    handedOff: true,
    spawned,
    exitCode,
    signal,
    interrupted,
    resumed: true,
    durationMs: Date.now() - startedAt,
    ...(childInterruptReason ? { reason: childInterruptReason } : {})
  };
}
