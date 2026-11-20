import type * as acp from "@agentclientprotocol/sdk";

/**
 * Authentication over ACP (ADR 0048). CodeTour never authenticates on its
 * own: this module owns the two facts the ACP clients and the reading panel
 * share — the terminal authentication capability the client announces, and
 * which method of an agent the reader's own `Sign in` action can use.
 */

/**
 * The client capabilities CodeTour announces on `initialize`.
 *
 * `_meta["terminal-auth"]` is the capability an agent gates its terminal
 * authentication method on, so an agent that can only be connected from an
 * interactive terminal has a way to say so. Reading files inside the session
 * workspace is the only other capability the read-only client declares.
 */
export function clientCapabilities(): acp.ClientCapabilities {
  return {
    fs: { readTextFile: true },
    _meta: { "terminal-auth": true }
  };
}

/**
 * The `_meta["terminal-auth"]` description a terminal authentication method
 * may carry: the command the client runs in its own terminal.
 */
export interface TerminalAuthSpec {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** The name the client gives the terminal it opens. */
  label?: string;
}

/** One way the reader's `Sign in` action connects an Agent Profile. */
export type AgentSignInPlan =
  | {
      kind: "terminal";
      methodId: string;
      /** The terminal's name: the spec's label, or the method's name. */
      label: string;
      command: string;
      args: string[];
      env: Record<string, string>;
    }
  | {
      /** The ACP method the agent handles itself through `authenticate`. */
      kind: "authenticate";
      methodId: string;
      label: string;
    };

/**
 * How the reader can connect the agent whose methods are announced, or
 * undefined when it announced none that CodeTour can use.
 *
 * A terminal method comes first: it is the only path that actually connects an
 * agent whose `authenticate` does nothing. It is usable when it declares the
 * command to run — a terminal method without one is not a path CodeTour can
 * take, and it is never passed to `authenticate`. Otherwise the first
 * agent-handled method is the fallback.
 */
export function signInPlan(
  authMethods: readonly acp.AuthMethod[]
): AgentSignInPlan | undefined {
  for (const method of authMethods) {
    const spec = terminalAuthSpec(method);
    if (spec) {
      return {
        kind: "terminal",
        methodId: method.id,
        label: spec.label ?? method.name,
        command: spec.command,
        args: spec.args ?? [],
        env: spec.env ?? {}
      };
    }
  }
  const agent = authMethods.find(method => !isTerminalMethod(method));
  return agent
    ? { kind: "authenticate", methodId: agent.id, label: agent.name }
    : undefined;
}

/** True for the methods an agent runs itself, through `authenticate`. */
function isTerminalMethod(
  method: acp.AuthMethod
): method is acp.AuthMethodTerminal & { type: "terminal" } {
  return "type" in method && method.type === "terminal";
}

/** The command a terminal method declares, when it declares a usable one. */
function terminalAuthSpec(method: acp.AuthMethod): TerminalAuthSpec | undefined {
  if (!isTerminalMethod(method)) {
    return undefined;
  }
  const raw = method._meta?.["terminal-auth"];
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const spec = raw as Record<string, unknown>;
  if (typeof spec.command !== "string" || spec.command.trim().length === 0) {
    return undefined;
  }
  return {
    command: spec.command,
    args: stringList(spec.args),
    env: stringRecord(spec.env),
    label: typeof spec.label === "string" ? spec.label : undefined
  };
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") {
      record[key] = entry;
    }
  }
  return record;
}
