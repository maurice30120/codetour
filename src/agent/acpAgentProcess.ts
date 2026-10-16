import { spawn } from "node:child_process";
import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";

/**
 * How to launch an ACP agent entry, such as the locally installed Vibe
 * application, over its stdio transport.
 */
export interface AcpAgentEntry {
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  /** Exact provider mode id; defaults to Vibe Ask when omitted. */
  modeId?: string;
  /** Copilot: use its advertised default, with read-only tool filtering. */
  useDefaultMode?: boolean;
}

/**
 * The transport an ACP session runs on. `exited` settles when the transport is
 * gone for any reason; a session uses it to fail fast instead of waiting on a
 * connection that can never answer.
 */
export interface AcpAgentTransport {
  stream: acp.Stream;
  exited: Promise<unknown>;
  dispose(): Promise<void>;
}

/**
 * A real ACP agent process speaking NDJSON over stdio.
 */
export interface AcpAgentProcess extends AcpAgentTransport {
  /** Resolves with the agent's exit code once the process terminates. */
  exited: Promise<number | null>;
}

/**
 * Spawns an ACP agent entry and exposes its stdio as an ACP stream. The
 * process boundary is the transport seam: the session layer only ever sees
 * the {@link AcpAgentTransport} interface, so tests drive a fake agent
 * process exactly like the installed entry.
 */
export function spawnAcpAgent(entry: AcpAgentEntry): AcpAgentProcess {
  const child = spawn(entry.command, entry.args ?? [], {
    cwd: entry.cwd,
    env: entry.env ? { ...process.env, ...entry.env } : process.env,
    stdio: ["pipe", "pipe", "inherit"]
  });

  const exited: Promise<number | null> = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code: number | null) => resolve(code));
  });

  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>
  );

  let disposed = false;
  const dispose = async () => {
    if (disposed) {
      return;
    }
    disposed = true;
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
      const killTimeout = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 3000);
      await exited.finally(() => clearTimeout(killTimeout));
    } else {
      await exited.catch(() => undefined);
    }
  };

  return { stream, exited, dispose };
}
