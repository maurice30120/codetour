import { createInterface } from "readline";
import {
  AgentBatchReport, AgentIntegration, AgentReport, agentIntegrations, installAgents, reportAgents
} from "./agentIntegrations";

// Interactive agent selection (spec #320, decision §8). The picker offers only
// the hosts that generate Tours from the CodeTour skill in this delivery; the
// VS Code extension is a reader integration and stays available through
// `--install vscode`. The decisions live behind the session seam below, so the
// terminal is the only part that needs a real terminal.

export function generationAgents(): AgentIntegration[] {
  return agentIntegrations.filter(integration => integration.supportsGeneration);
}

export function generationAgentIds(): string {
  return generationAgents().map(integration => integration.id).join(", ");
}

/**
 * The picker's terminal. `interactive` is false when the CLI has no terminal
 * to ask on: the caller must then name an agent instead of choosing for the
 * user.
 */
export interface SelectionSession {
  interactive: boolean;
  print(line: string): void;
  ask(prompt: string): Promise<string>;
}

export function terminalSelectionSession(): SelectionSession {
  return {
    // The answer comes from standard input, so that is the stream that must be
    // a terminal; a redirected stdin cannot answer a numbered list.
    interactive: Boolean(process.stdin.isTTY),
    print: line => console.log(line),
    ask: prompt => new Promise<string>(resolve => {
      const readline = createInterface({ input: process.stdin });
      let answered = false;
      process.stdout.write(prompt);
      readline.once("line", (answer: string) => {
        answered = true;
        resolve(answer);
        readline.close();
      });
      // End of input (Ctrl-D, a closed pipe) cancels: the caller treats it
      // like an empty answer instead of hanging.
      readline.once("close", () => {
        if (!answered) resolve("");
      });
    })
  };
}

/**
 * Read one picker answer: numbers from the offered list, agent ids, or both.
 * An empty answer selects nothing — a deliberate no-op, never "everything".
 */
export function parseAgentSelection(answer: string, agents: AgentReport[]): string[] {
  const selected: string[] = [];
  for (const token of answer.split(/[,\s]+/).filter(Boolean)) {
    const chosen = /^\d+$/.test(token)
      ? agents[Number(token) - 1]
      : agents.find(agent => agent.id.toLowerCase() === token.toLowerCase());
    if (!chosen) {
      throw new Error(
        `Unknown agent selection: ${token}. Enter numbers from the list or agent ids ` +
        `(${agents.map(agent => agent.id).join(", ")}).`
      );
    }
    if (!selected.includes(chosen.id)) selected.push(chosen.id);
  }
  return selected;
}

/**
 * Install the agents chosen in an interactive terminal. Without a terminal the
 * command fails with one instruction: installing every agent instead would
 * decide for the caller, and the ticket forbids it.
 */
export async function installChosenAgents(session: SelectionSession): Promise<AgentBatchReport> {
  if (!session.interactive) {
    throw new Error(
      "Choosing the agents to install needs an interactive terminal. " +
      `Run 'codetour --install <agent>' with one of: ${generationAgentIds()} ` +
      "(or vscode), or install every compatible agent with 'codetour --install all'."
    );
  }
  const agents = await reportAgents(generationAgents());
  session.print(
    "Select the CodeTour agents to install; the VS Code extension stays available with 'codetour --install vscode'."
  );
  agents.forEach((agent, index) => session.print(`  ${index + 1}. ${agent.displayName} (${agent.state})`));
  const ids = parseAgentSelection(await session.ask("Agent numbers or ids (empty to cancel): "), agents);
  if (!ids.length) {
    session.print("No agent selected; nothing was installed.");
    return { outcomes: [], failed: false };
  }
  return installAgents(ids);
}
