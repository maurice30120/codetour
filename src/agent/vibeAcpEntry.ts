import type { AcpAgentEntry } from "./acpAgentProcess";

/**
 * The ACP entry of the locally installed Vibe application, used as the agent
 * of Tour Step Conversations.
 *
 * The exact installed invocation is confirmed by the pending manual trial
 * with a real Vibe installation (see the spec's Further Notes); the
 * deterministic session-layer tests use a fake ACP agent process at the same
 * transport boundary, so nothing here is exercised by them.
 */
export function vibeAcpEntry(cwd: string): AcpAgentEntry {
  return {
    command: "vibe",
    args: ["acp"],
    cwd
  };
}
