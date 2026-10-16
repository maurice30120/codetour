import type { AcpAgentEntry } from "./acpAgentProcess";

/**
 * The ACP entry of the locally installed Vibe application, used as the agent
 * of Tour Step Conversations.
 *
 * Vibe exposes ACP through its dedicated executable. `vibe acp` launches
 * the interactive CLI with "acp" as its initial prompt and never answers
 * the protocol handshake.
 */
export function vibeAcpEntry(cwd: string): AcpAgentEntry {
  return {
    command: "vibe-acp",
    args: [],
    cwd
  };
}
