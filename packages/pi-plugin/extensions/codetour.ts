import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  createRunState,
  listRunStates,
  newRunId,
  pruneRunStates,
  removeRunState,
  updateRunState,
  writeRunState,
} from "../lib/run-log.mjs";
import {
  closingLine,
  continuationMessage,
  displayKey,
  isClosed,
  knowledgeDetailLines,
  selectContinuation,
} from "../lib/guard.mjs";
import {
  TERMINAL_OPTION,
  VSCODE_OPTION,
  openingOptions,
  openingQuestion,
  readerCommand,
  vscodeOpenCommand,
} from "../lib/reader.mjs";

// CodeTour for Pi.
//
// This extension is the Pi host of the shared CodeTour surfaces: it declares
// the existing `codetour mcp` server for the session, starts a controlled
// generation from `/codetour`, and asks for the one bounded consolidation
// continuation the MCP's run state allows. It never generates a Tour, never
// restates the Tour method, and never writes Tour or Knowledge content: the
// served MCP prompt owns the method and the MCP tools own persistence.
//
// The package ships standalone (it is installed from its own directory), so it
// carries its own copy of the run-state contract in `lib/run-log.mjs`.

const SERVER_NAME = "codetour";
const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKILL_COMMAND = "/skill:codetour-generate";

type RunKind = "project" | "changes";
type ReviewMode = "neutral" | "critical";

interface Launcher {
  command: string;
  args: string[];
}

/**
 * The CLI that serves the session. `codetour --install pi` writes
 * `launcher.json` next to this file with the absolute runtime and script of the
 * installing CLI, so a stale `codetour` on PATH cannot serve an older build.
 * Without it (a checkout run by hand), PATH is the documented fallback.
 */
async function resolveLauncher(): Promise<Launcher> {
  try {
    const raw = await fs.readFile(path.join(PACKAGE_ROOT, "launcher.json"), "utf8");
    const parsed = JSON.parse(raw) as { command?: unknown; args?: unknown };
    if (
      typeof parsed.command === "string" &&
      parsed.command !== "" &&
      Array.isArray(parsed.args) &&
      parsed.args.every((arg) => typeof arg === "string")
    ) {
      return { command: parsed.command, args: parsed.args as string[] };
    }
  } catch {
    // No managed launcher: fall through to PATH.
  }
  return { command: "codetour", args: ["mcp"] };
}

async function realWorkspace(cwd: string): Promise<string | undefined> {
  try {
    const real = await fs.realpath(cwd);
    const stat = await fs.stat(real);
    return stat.isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

interface GenerationChoices {
  type?: RunKind;
  reviewMode?: ReviewMode;
  request: string;
}

// `/codetour`, `/codetour project`, `/codetour changes critical explain the
// renderer`, `/codetour generate changes neutral <phrase>`. Anything that is
// not a recognised choice word belongs to the user's request and is forwarded
// verbatim.
function parseChoices(raw: string): GenerationChoices {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  let index = 0;
  if (words[0] === "generate") index = 1;
  let type: RunKind | undefined;
  const head = words[index];
  if (head === "project" || head === "changes") {
    type = head;
    index += 1;
  }
  let reviewMode: ReviewMode | undefined;
  if (type === "changes") {
    const mode = words[index];
    if (mode === "neutral" || mode === "critical") {
      reviewMode = mode;
      index += 1;
    }
  }
  return { type, reviewMode, request: words.slice(index).join(" ") };
}

function skillInvocation(choices: {
  type: RunKind;
  reviewMode?: ReviewMode;
  runId: string;
  request: string;
}): string {
  const parts = [SKILL_COMMAND, `type=${choices.type}`];
  if (choices.type === "changes" && choices.reviewMode) {
    parts.push(`reviewMode=${choices.reviewMode}`);
  }
  parts.push(`runId=${choices.runId}`);
  if (choices.request) parts.push(`request=${choices.request}`);
  return parts.join(" ");
}

export default function codetourPlugin(pi: ExtensionAPI) {
  // One closing line per run and per distinct set of facts: observability must
  // not become a chorus on every stop of a long conversation.
  const reported = new Map<string, string>();

  // The opening dialogue is asked once per run: observability must not become
  // a chorus, and the user answers the end of the generation only once.
  const offered = new Set<string>();

  async function report(ctx: ExtensionContext, state: Record<string, any>): Promise<void> {
    if (state.tourCreated !== true) return;
    const key = `${displayKey(state)}|${isClosed(state)}`;
    if (key === "|false") return;
    if (reported.get(state.runId) === key) return;
    reported.set(state.runId, key);
    ctx.ui.notify(closingLine(state), "info");
    for (const line of knowledgeDetailLines(state)) {
      ctx.ui.notify(line, "warning");
    }
    // At the end of the generation (the run is closed), ask the user how to
    // open the created Tour (ticket #242): the real interactive reader in the
    // terminal, or the Tour at its active step in VS Code (the open-in-VS Code
    // contract of ticket #244). Never a textual summary, whatever the choice;
    // reading never opens an independent window.
    if (!isClosed(state) || offered.has(state.runId)) return;
    offered.add(state.runId);
    const question = openingQuestion(state);
    if (!question) return;
    const choice = await ctx.ui.select(question, openingOptions());
    if (choice === TERMINAL_OPTION) {
      const command = readerCommand(state);
      if (command) {
        ctx.ui.notify(
          `Run ${command} at the workspace root — the reader plays in this ` +
            "terminal, never an independent window.",
          "info"
        );
      }
    } else if (choice === VSCODE_OPTION) {
      const command = vscodeOpenCommand(state);
      if (command) ctx.ui.notify(`Open in VS Code (the Tour at the active step): ${command}`, "info");
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    const workspace = await realWorkspace(ctx.cwd);
    if (!workspace) return;
    const launcher = await resolveLauncher();
    pi.registerMcpServer(SERVER_NAME, {
      command: launcher.command,
      args: [...launcher.args, "--workspace-root", workspace],
      description: "CodeTour: guided code tours and verified Knowledge.",
      exposure: "deferred",
    });
    // Old run states of this workspace can no longer drive the guard.
    await pruneRunStates(workspace).catch(() => undefined);
  });

  // The bounded consolidation guard: the Pi equivalent of the Copilot
  // `agentStop` hook, in process instead of a subprocess. It reads the run
  // state only, is inert for an ordinary conversation or a closed run, and asks
  // for at most one continuation, marked under the cross-process lock.
  pi.on("agent_before_settle", async (event, ctx) => {
    const workspace = await realWorkspace(ctx.cwd);
    if (!workspace) return;
    const sessionId = ctx.sessionManager.getSessionId();
    const listed = await listRunStates(workspace);
    for (const problem of listed.problems) {
      ctx.ui.notify(`CodeTour: ignored run state (${problem})`, "warning");
    }
    for (const state of listed.states) {
      if (state.workspace !== workspace || state.sessionId !== sessionId) continue;
      await report(ctx, state);
    }
    if (event.aborted) return;

    const candidate = selectContinuation(listed.states, { workspace, sessionId });
    if (!candidate) return;

    const marked = await updateRunState(workspace, candidate.runId, (state: Record<string, any>) =>
      state.continuationUsed
        ? null
        : { ...state, continuationUsed: true, updatedAt: new Date().toISOString() }
    );
    if (!marked.updated) return;

    return {
      entries: [
        ...event.entries,
        {
          type: "custom_message" as const,
          customType: "codetour-consolidation",
          content: continuationMessage(candidate),
          display: false,
        },
      ],
      continue: true,
    };
  });

  pi.registerCommand("codetour", {
    description: "Start a CodeTour Project Tour or Changes Tour",
    handler: async (rawArgs, ctx) => {
      const choices = parseChoices(rawArgs);
      let type = choices.type;
      if (!type) {
        const choice = await ctx.ui.select("CodeTour: which tour?", [
          "Project Tour",
          "Changes Tour",
        ]);
        if (!choice) {
          ctx.ui.notify("CodeTour: generation cancelled.", "info");
          return;
        }
        type = choice === "Project Tour" ? "project" : "changes";
      }
      let reviewMode = choices.reviewMode;
      if (type === "changes" && !reviewMode) {
        const mode = await ctx.ui.select("CodeTour: review mode", [
          "neutral — factual explanation",
          "critical — explanation plus review findings",
        ]);
        if (!mode) {
          ctx.ui.notify("CodeTour: generation cancelled.", "info");
          return;
        }
        reviewMode = mode.startsWith("critical") ? "critical" : "neutral";
      }

      const workspace = await realWorkspace(ctx.cwd);
      if (!workspace) {
        ctx.ui.notify(`CodeTour: ${ctx.cwd} is not a usable workspace.`, "error");
        return;
      }
      const sessionId = ctx.sessionManager.getSessionId();
      const runId = newRunId();
      try {
        await writeRunState(
          workspace,
          createRunState({
            runId,
            workspace,
            sessionId,
            kind: type,
            request: choices.request || null,
          })
        );
      } catch (error) {
        ctx.ui.notify(
          `CodeTour: could not create the run state (${
            error instanceof Error ? error.message : String(error)
          }).`,
          "error"
        );
        return;
      }
      try {
        pi.sendUserMessage(
          skillInvocation({ type, reviewMode, runId, request: choices.request }),
          { expandPromptTemplates: true }
        );
      } catch (error) {
        await removeRunState(workspace, runId);
        ctx.ui.notify(
          `CodeTour: could not start the generation (${
            error instanceof Error ? error.message : String(error)
          }).`,
          "error"
        );
      }
    },
  });
}
