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
  existingTourReader,
  interactiveSession,
  openingOptions,
  openingQuestion,
  playInTerminal,
  readerInvocation,
  runTerminalReader,
  vscodeCommand,
} from "../lib/reader.mjs";

// CodeTour for Pi.
//
// This extension is the Pi host of the shared CodeTour surfaces: it registers
// the existing `codetour mcp` server only when `/codetour` is invoked, starts
// a controlled generation, and asks for the one bounded consolidation
// continuation the MCP's run state allows. It never generates a Tour, never
// restates the Tour method, and never writes Tour or Knowledge content: the
// served MCP prompt owns the method and the MCP tools own persistence.
//
// The package ships standalone (it is installed from its own directory), so it
// carries its own copy of the run-state contract in `lib/run-log.mjs`.

const SERVER_NAME = "codetour";
const MCP_TOOL_PREFIX = `mcp__${SERVER_NAME}__`;
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

/**
 * Whether this session really carries the CodeTour MCP tools.
 *
 * Registering the server is not connecting it: Pi's built-in MCP support
 * connects registered servers in the background, and a connected server's
 * tools are registered as `mcp__<server>__<tool>` (`getAllTools()` lists them
 * whatever their exposure, and a withdrawn tool becomes `hidden`). A
 * registered server without a tool is therefore either still connecting or
 * never connected, because the built-in support is disabled or replaced.
 *
 * Reading the tool registry is deliberately passive: handling
 * `mcp_servers_change` would mark this extension as the one that connects
 * registered servers and would suppress Pi's own diagnostic instead of
 * reporting the real cause.
 */
function codeTourToolsPresent(pi: ExtensionAPI): boolean {
  return pi.getAllTools().some((tool) => tool.name.startsWith(MCP_TOOL_PREFIX));
}

/** Explain a failed on-demand connection after the registration is released. */
function mcpNotConnectedMessage(): string {
  return [
    `CodeTour: the "${SERVER_NAME}" MCP server could not connect; no ${MCP_TOOL_PREFIX}* tools appeared.`,
    "Pi's built-in MCP support may be disabled or replaced, or connection startup may have timed out.",
    "Enable it with `pi config` (Built-in → mcp), or remove `-builtin:mcp` from settings, then `/reload` and try again.",
    "No run state was created.",
  ].join(" ");
}

interface GenerationChoices {
  type?: RunKind;
  reviewMode?: ReviewMode;
  request: string;
}

// `/codetour generate`, `/codetour project`, `/codetour changes critical explain the
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

interface DiscoveredTour {
  id: string;
  title: string;
}

async function readTour(pi: ExtensionAPI, ctx: ExtensionContext, title: string) {
  const launcher = await resolveLauncher();
  const workspace = await realWorkspace(ctx.cwd);
  if (!workspace) throw new Error(`${ctx.cwd} is not a usable workspace.`);

  const resolve = async (args: string[]) => {
    const cli = readerInvocation(launcher, args, workspace);
    const result = await pi.exec(cli.command, cli.args, { cwd: workspace });
    if (result.code !== 0) throw new Error(result.stderr.trim() || `CLI exited with code ${result.code}.`);
    return JSON.parse(result.stdout);
  };

  let selected: DiscoveredTour;
  if (title) {
    selected = await resolve([`--internal-resolve-tour=${title}`]);
  } else {
    const tours: DiscoveredTour[] = await resolve(["--internal-list-tours"]);
    if (tours.length === 0) throw new Error("No CodeTours found in this workspace.");
    const labels = tours.map((tour, index) => `${index + 1}. ${tour.title}`);
    const choice = tours.length === 1 ? labels[0] : await ctx.ui.select("Select a CodeTour", labels);
    if (choice === undefined) return;
    selected = tours[labels.indexOf(choice)];
    if (!selected) throw new Error("Invalid Tour selection.");
  }

  const { plan, command } = existingTourReader(selected.id, launcher, workspace);
  const play = () => runTerminalReader(plan, command);
  const outcome = ctx.hasUI && interactiveSession()
    ? await ctx.ui.custom<Awaited<ReturnType<typeof play>>>(async (tui, _theme, _keys, done) => {
        tui.stop();
        let result;
        try {
          result = await play();
        } finally {
          tui.start();
          tui.requestRender(true);
        }
        done(result);
        return { render: () => [], invalidate: () => {} };
      })
    : await runTerminalReader(plan, command, { isInteractive: () => false });
  if (outcome.degraded) {
    ctx.ui.notify(`CodeTour: ${outcome.reason} From the workspace root (${workspace}), run: ${command}`, "warning");
  } else if (outcome.exitCode !== 0) {
    ctx.ui.notify(`CodeTour: the reader ended (${outcome.signal || outcome.exitCode}).`, "warning");
  }
}

export default function codetourPlugin(pi: ExtensionAPI) {
  // One closing line per run and per distinct set of facts: observability must
  // not become a chorus on every stop of a long conversation.
  const reported = new Map<string, string>();

  // The opening dialogue is asked once per run: observability must not become
  // a chorus, and the user answers the end of the generation only once.
  const offered = new Set<string>();

  // The built-in MCP host connects registrations made after session startup.
  // Keep no CodeTour server or tool definitions in an ordinary Pi session.
  // A user-configured MCP server of the same name takes precedence, and is
  // never unregistered by CodeTour.
  let registeredOnDemand = false;

  function releaseMcp(): void {
    if (!registeredOnDemand) return;
    pi.unregisterMcpServer(SERVER_NAME);
    registeredOnDemand = false;
  }

  async function connectMcp(workspace: string): Promise<boolean> {
    // Respect an existing, connected user/project registration.
    if (codeTourToolsPresent(pi)) return true;
    const launcher = await resolveLauncher();
    pi.registerMcpServer(SERVER_NAME, {
      command: launcher.command,
      args: [...launcher.args, "--workspace-root", workspace],
      description: "CodeTour: guided code tours and verified Knowledge.",
      exposure: "deferred",
    });
    registeredOnDemand = true;

    // Runtime registrations connect asynchronously. Do not send the skill or
    // create a run state until its tools are actually available. A bounded
    // wait also reports disabled/replaced built-in MCP without hanging Pi.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (codeTourToolsPresent(pi)) return true;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    releaseMcp();
    return false;
  }

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
    // terminal, or the Tour at its active step in VS Code through the CLI's
    // Open-in-VS Code surface (ticket #244's contract). Never a textual
    // summary, whatever the choice; reading never opens an independent window.
    if (!isClosed(state) || offered.has(state.runId)) return;
    offered.add(state.runId);
    const question = openingQuestion(state);
    if (!question) return;
    const choice = await ctx.ui.select(question, openingOptions());
    if (choice === TERMINAL_OPTION) {
      // The real reader opens immediately (review F2): the launcher CLI is
      // spawned with inherited stdio — this very terminal, never an
      // independent window — and the call returns only when the reading ends,
      // which hands the terminal back to the session. A non-interactive
      // session or a failed spawn degrades to the documented hand-over
      // command, never a crash and never a summary in the Tour's place.
      const outcome = await playInTerminal(state, await resolveLauncher());
      if (outcome.degraded && outcome.command) {
        ctx.ui.notify(
          outcome.reason
            ? `CodeTour: ${outcome.reason} Run ${outcome.command} at the ` +
              `workspace root — the reader plays in this terminal, never an ` +
              "independent window."
            : `Run ${outcome.command} at the workspace root — the reader plays ` +
              "in this terminal, never an independent window.",
          "warning"
        );
      } else if (outcome.played && outcome.exitCode !== 0) {
        ctx.ui.notify(
          `CodeTour: the reader ended (${outcome.signal || outcome.exitCode}); ` +
            "the terminal is back with your session.",
          "warning"
        );
      }
    } else if (choice === VSCODE_OPTION) {
      const command = vscodeCommand(state);
      if (!command) {
        ctx.ui.notify("CodeTour: the created Tour has no path to open in VS Code.", "warning");
        return;
      }
      const launcher = await resolveLauncher();
      const args = [...launcher.args];
      if (args[args.length - 1] === "mcp") args.pop();
      try {
        const result = await pi.exec(launcher.command, [...args, "--internal-open-vscode", state.tourPath, ctx.cwd], { cwd: ctx.cwd });
        if (result.code !== 0) {
          ctx.ui.notify(`CodeTour: could not open the Tour in VS Code: ${result.stderr.trim() || `exit ${result.code}`}. Run ${command} at the workspace root.`, "warning");
        }
      } catch (error) {
        ctx.ui.notify(`CodeTour: could not open the Tour in VS Code: ${error instanceof Error ? error.message : String(error)}. Run ${command} at the workspace root.`, "warning");
      }
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    // No MCP registration at startup: ordinary conversations pay no CodeTour
    // tool or server-description cost. Only /codetour opts into the MCP.
    const workspace = await realWorkspace(ctx.cwd);
    if (workspace) await pruneRunStates(workspace).catch(() => undefined);
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
    if (event.aborted) {
      releaseMcp();
      return;
    }

    const candidate = selectContinuation(listed.states, { workspace, sessionId });
    if (!candidate) {
      releaseMcp();
      return;
    }

    const marked = await updateRunState(workspace, candidate.runId, (state: Record<string, any>) =>
      state.continuationUsed
        ? null
        : { ...state, continuationUsed: true, updatedAt: new Date().toISOString() }
    );
    if (!marked.updated) {
      releaseMcp();
      return;
    }

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
    description: "Read an existing CodeTour: /codetour read [tour]; generate one: /codetour generate",
    handler: async (rawArgs, ctx) => {
      let input = rawArgs.trim();
      if (!input) {
        const choice = await ctx.ui.select("CodeTour", ["Générer", "Lire"]);
        if (choice === undefined) return;
        input = choice === "Générer" ? "generate" : "read";
      }
      if (/^read(?:\s|$)/.test(input)) {
        const title = input.slice(4).trim().replace(/^(["'])(.*)\1$/, "$2");
        try {
          await readTour(pi, ctx, title);
        } catch (error) {
          ctx.ui.notify(`CodeTour: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
        return;
      }
      const choices = parseChoices(input);

      let type = choices.type;
      let reviewMode = choices.reviewMode;
      if (!type) {
        const choice = await ctx.ui.select("Quel tour générer ?", [
          "Project Tour",
          "Changes Tour — Neutre",
          "Changes Tour — Critique",
        ]);
        if (!choice) {
          ctx.ui.notify("CodeTour: generation cancelled.", "info");
          return;
        }
        type = choice === "Project Tour" ? "project" : "changes";
        if (type === "changes") {
          reviewMode = choice === "Changes Tour — Critique" ? "critical" : "neutral";
        }
      }
      if (type === "changes" && !reviewMode) {
        const mode = await ctx.ui.select("Mode de revue", ["Neutre", "Critique"]);
        if (!mode) {
          ctx.ui.notify("CodeTour: generation cancelled.", "info");
          return;
        }
        reviewMode = mode === "Critique" ? "critical" : "neutral";
      }

      const workspace = await realWorkspace(ctx.cwd);
      if (!workspace) {
        ctx.ui.notify(`CodeTour: ${ctx.cwd} is not a usable workspace.`, "error");
        return;
      }
      try {
        if (!(await connectMcp(workspace))) {
          ctx.ui.notify(mcpNotConnectedMessage(), "error");
          return;
        }
      } catch (error) {
        releaseMcp();
        ctx.ui.notify(
          `CodeTour: could not register the on-demand MCP server (${
            error instanceof Error ? error.message : String(error)
          }).`,
          "error"
        );
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
        releaseMcp();
        return;
      }
      try {
        pi.sendUserMessage(
          skillInvocation({ type, reviewMode, runId, request: choices.request }),
          { expandPromptTemplates: true }
        );
      } catch (error) {
        await removeRunState(workspace, runId);
        releaseMcp();
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
