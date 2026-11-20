import * as acp from "@agentclientprotocol/sdk";
import { spawnAcpAgent } from "./acpAgentProcess";
import {
  commandExists,
  type AgentAvailability,
  type AgentProbeOutcome,
  type AgentProfile
} from "./agentCatalogue";
import { clientCapabilities } from "./agentAuth";

/**
 * The Agent Probe: the bounded availability probe of ADR 0048.
 *
 * One probe spawns the profile's entry, asks `initialize` then `session/new`,
 * and disposes the session and the transport as soon as it answers: only the
 * state, the announced configuration options and the authentication methods
 * survive, for the lifetime of the reading panel.
 *
 * The deadline is 5 seconds per profile, distinct from the 30 seconds a
 * conversation startup is allowed: an agent that is merely slow must not cost
 * the reader a whole conversation attempt.
 */

/** The probe deadline per profile, distinct from a conversation's startup. */
export const AGENT_PROBE_TIMEOUT_MS = 5_000;

/**
 * The ACP error code of `RequestError.authRequired()`: "authentication
 * required" is read from this code, never from the message text.
 */
const AUTH_REQUIRED_CODE = -32000;

export interface AgentProbeOptions {
  timeoutMs?: number;
  /** True when the command resolves to an executable; PATH lookup by default. */
  exists?(command: string): boolean;
}

/** The probe's own deadline, distinguishable from an agent's failure. */
class ProbeDeadlineError extends Error {}

/**
 * Probes one Agent Profile and classifies what happened:
 * `not-installed` for an absent executable, `auth-required` for the ACP
 * authentication error code, `connection-error` for the deadline and every
 * other failure, `available` once `session/new` answered.
 *
 * The probe never selects a mode: an agent that announces none is still
 * available, and mode selection belongs to the conversation session.
 */
export async function probeAgentProfile(
  profile: AgentProfile,
  cwd: string,
  options: AgentProbeOptions = {}
): Promise<AgentProbeOutcome> {
  const entry = profile.entry(cwd);
  if (!entry) {
    return {
      availability: {
        state: "connection-error",
        reason: "This agent has no launcher on this platform."
      }
    };
  }
  const exists = options.exists ?? commandExists;
  if (!exists(entry.command)) {
    return { availability: { state: "not-installed" } };
  }

  const timeoutMs = options.timeoutMs ?? AGENT_PROBE_TIMEOUT_MS;
  const agent = spawnAcpAgent(entry);
  const connection = acp.client({ name: "codetour" }).connect(agent.stream);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ProbeDeadlineError(
        `The agent did not answer the probe within ${deadlineLabel(timeoutMs)}.`
      )),
      timeoutMs
    );
  });
  // A transport that dies before answering fails the probe instead of
  // leaving it on a connection that can never speak again.
  const exited = agent.exited.then(
    () => {
      throw new Error("The ACP agent exited before answering the probe.");
    },
    (error: unknown) => {
      throw error;
    }
  );
  const bounded = <T>(operation: Promise<T>): Promise<T> =>
    Promise.race([operation, deadline, exited]);

  let authMethods: acp.AuthMethod[] | undefined;
  try {
    const initialized = await bounded(
      connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: clientCapabilities()
      })
    );
    authMethods = initialized.authMethods ?? undefined;
    const session = await bounded(
      connection.agent.request(acp.methods.agent.session.new, {
        cwd,
        mcpServers: []
      })
    );
    return {
      availability: {
        state: "available",
        configOptions: session.configOptions ?? []
      },
      authMethods
    };
  } catch (error) {
    return {
      availability: classifyProbeFailure(error),
      authMethods
    };
  } finally {
    if (timer) clearTimeout(timer);
    connection.close();
    await agent.dispose().catch(() => undefined);
  }
}

/**
 * Runs the authentication method the agent handles itself, on a throwaway
 * transport: connect, `initialize`, `authenticate`, release. It never opens a
 * session and never asks anything, and the caller re-probes the profile
 * afterwards to see whether the agent is connected now.
 *
 * Only an agent-handled method is ever passed here: the ACP spec forbids
 * passing a terminal method to `authenticate`, so those run in a terminal
 * instead and never reach this function.
 */
export async function authenticateAgentProfile(
  profile: AgentProfile,
  cwd: string,
  methodId: string,
  options: AgentProbeOptions = {}
): Promise<void> {
  const entry = profile.entry(cwd);
  if (!entry) {
    throw new Error("This agent has no launcher on this platform.");
  }
  const timeoutMs = options.timeoutMs ?? AGENT_PROBE_TIMEOUT_MS;
  const agent = spawnAcpAgent(entry);
  const connection = acp.client({ name: "codetour" }).connect(agent.stream);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ProbeDeadlineError(
        `The agent did not answer the sign in within ${deadlineLabel(timeoutMs)}.`
      )),
      timeoutMs
    );
  });
  // A transport that dies — an entry that cannot even be spawned included —
  // fails the sign in instead of waiting on a connection that can never speak.
  const exited = agent.exited.then(
    () => {
      throw new Error("The ACP agent exited before the sign in completed.");
    },
    (error: unknown) => {
      throw error;
    }
  );
  try {
    await Promise.race([
      connection.agent
        .request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: clientCapabilities()
        })
        .then(() =>
          connection.agent.request(acp.methods.agent.authenticate, { methodId })
        ),
      deadline,
      exited
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    connection.close();
    await agent.dispose().catch(() => undefined);
  }
}

function classifyProbeFailure(error: unknown): AgentAvailability {
  if (isMissingExecutable(error)) {
    return { state: "not-installed" };
  }
  if (error instanceof acp.RequestError && error.code === AUTH_REQUIRED_CODE) {
    return { state: "auth-required", authMethods: [] };
  }
  return {
    state: "connection-error",
    reason: error instanceof Error ? error.message : String(error)
  };
}

function deadlineLabel(timeoutMs: number): string {
  return timeoutMs >= 1000 ? `${timeoutMs / 1000} s` : `${timeoutMs} ms`;
}

function isMissingExecutable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
