import { spawn, type ChildProcess } from "node:child_process";

/**
 * A pseudo-terminal session driven like a reader's keyboard.
 *
 * The interaction tests below need a genuine TTY (the reader refuses to paint
 * without one) and a keyboard. Driving `script` from the outside means the
 * test must know *when* the reader is ready: a fixed delay races the process
 * start on a loaded runner, so the session exposes what actually happened —
 * wait for the first painted output, press keys, then wait for the exit.
 *
 * The caller owns the command (and therefore the `script` flavour of its
 * platform); this helper owns the interaction: one buffered output, bounded
 * waits, and a guaranteed kill.
 */
export interface PtySessionOptions {
  /** The environment the session runs in; the caller's by default. */
  env?: NodeJS.ProcessEnv;
  /** How long `waitForOutput` waits when the caller passes no budget. */
  outputTimeoutMs?: number;
  /** How long `finish` waits when the caller passes no budget. */
  exitTimeoutMs?: number;
}

export interface PtySessionResult {
  /** The process exit code, or null when a signal ended it. */
  status: number | null;
  /** Everything both streams wrote, in arrival order. */
  output: string;
}

export interface PtySession {
  /** Resolves once the recorded output contains `text`. */
  waitForOutput(text: string, timeoutMs?: number): Promise<void>;
  /** Writes keys into the terminal's stdin, as the reader would receive them. */
  pressKeys(keys: string): void;
  /** Waits for the exit and returns its code with the whole output. */
  finish(timeoutMs?: number): Promise<PtySessionResult>;
  /** Kills the session if it still runs; safe to call after `finish`. */
  dispose(): void;
}

const DEFAULT_OUTPUT_TIMEOUT_MS = 10_000;
const DEFAULT_EXIT_TIMEOUT_MS = 10_000;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  describe: () => string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`waitFor: ${describe()} within ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Starts a process inside a pseudo-terminal. `command` and `args` are exactly
 * what the platform's `script` needs to give its child a TTY, so the session
 * is the same on every POSIX runner.
 */
export function startPtySession(
  command: string,
  args: string[],
  options: PtySessionOptions = {}
): PtySession {
  const child: ChildProcess = spawn(command, args, {
    env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let output = "";
  let exited = false;
  const exitedPromise = new Promise<PtySessionResult>(resolve => {
    child.once("close", (status: number | null) => {
      exited = true;
      resolve({ status, output });
    });
  });
  const append = (chunk: Buffer | string): void => {
    output += String(chunk);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  // A dead child must not turn into an unhandled 'error' event.
  child.on("error", error => {
    append(`\npty session error: ${error.message}\n`);
  });

  return {
    waitForOutput(text: string, timeoutMs = options.outputTimeoutMs ?? DEFAULT_OUTPUT_TIMEOUT_MS) {
      return withTimeout(
        new Promise<void>(resolve => {
          const check = (): void => {
            if (output.includes(text)) {
              child.stdout?.off("data", check as never);
              resolve();
              return;
            }
            if (exited) {
              resolve();
              return;
            }
            setTimeout(check, 20).unref();
          };
          check();
        }),
        timeoutMs,
        () =>
          `the reader painted ${JSON.stringify(text)} (output ends with ${JSON.stringify(output.slice(-300))})`
      );
    },
    pressKeys(keys: string) {
      child.stdin?.write(keys);
    },
    finish(timeoutMs = options.exitTimeoutMs ?? DEFAULT_EXIT_TIMEOUT_MS) {
      return withTimeout(
        exitedPromise,
        timeoutMs,
        () => `the reader exited (output ends with ${JSON.stringify(output.slice(-300))})`
      );
    },
    dispose() {
      if (!exited) child.kill("SIGKILL");
    }
  };
}
