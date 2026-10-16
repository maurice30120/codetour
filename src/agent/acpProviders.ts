import type { AcpAgentEntry } from "./acpAgentProcess";
import { vibeAcpEntry } from "./vibeAcpEntry";

export interface AcpProvider {
  name: string;
  entry: AcpAgentEntry;
}

/** Installed executables only: starting a conversation never downloads software. */
export function acpProviders(cwd: string): AcpProvider[] {
  return [
    { name: "Vibe", entry: vibeAcpEntry(cwd) },
    {
      name: "Copilot",
      entry: {
        command: "copilot",
        args: ["--acp", "--stdio", "--available-tools=view,grep,glob", "--disable-builtin-mcps"],
        cwd,
        useDefaultMode: true
      }
    },
    { name: "Codex", entry: { command: "codex-acp", cwd, modeId: "read-only" } },
    { name: "Claude Code", entry: { command: "claude-agent-acp", cwd, modeId: "plan" } }
  ];
}
