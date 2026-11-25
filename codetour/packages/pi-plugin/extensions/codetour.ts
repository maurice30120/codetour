import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  readCreations,
  selectCreated,
  summaryLines,
  tokenLine,
  tokenReading,
} from "../lib/journal.mjs";
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
// The package is two surfaces:
//
//  - the `codetour-generate` skill, which makes the agent create a Tour with
//    the CodeTour CLI (`codetour create-project-tour` / `create-changes-tour`)
//    from the workspace it is in: no MCP server and no CodeTour checkout;
//  - this extension, which reads the creation journal when a response settles
//    and reports, once, the Tours that response created and the response's
//    token reading.
//
// The report is purely informative (DESIGN §4): it never blocks, never asks for
// a continuation, never calls a model, never writes Tour content, and never
// changes the agent's exit status. It has nothing to say when no creation is
// attributed to the response.

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKILL_COMMAND = "/skill:codetour-generate";

type RunKind = "project" | "changes";
type ReviewMode = "neutral" | "critical";

interface Launcher {
  command: string;
  args: string[];
}

interface CreationRecord {
  workspace: string;
  tourPath: string;
  tourTitle: string;
  kind: RunKind;
  at: string;
  sessionId: string | null;
  responseId: string | null;
  host: string | null;
}

/**
 * The CLI that serves the session. `codetour --install pi` writes
 * `launcher.json` next to this file with the absolute runtime and script of the
 * installing CLI, so a stale `codetour` on PATH cannot serve an older build.
 * Without it (a checkout run by hand), PATH is the documented fallback.
 */
async function installedLauncher(): Promise<Launcher | undefined> {
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
    // No managed launcher: PATH is the documented fallback.
  }
  return undefined;
}

/**
 * The argv words of the CLI to call: the recorded launcher when installed,
 * `codetour` from PATH otherwise. Every surface here calls a top-level
 * subcommand, and `launcher.json` records no subcommand at all.
 */
function cliWords(launcher: Launcher | undefined): string[] {
  return launcher ? [launcher.command, ...launcher.args] : ["codetour"];
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
  cli?: string[];
  request: string;
}): string {
  const parts = [SKILL_COMMAND, `type=${choices.type}`];
  if (choices.type === "changes" && choices.reviewMode) {
    parts.push(`reviewMode=${choices.reviewMode}`);
  }
  // The installed CLI travels as one JSON array of argv words: skill arguments
  // are free text, so a single self-delimiting token keeps a path with spaces
  // intact (DESIGN §9). Without a recorded launcher the skill uses PATH.
  if (choices.cli) parts.push(`codetour-cli=${JSON.stringify(choices.cli)}`);
  if (choices.request) parts.push(`request=${choices.request}`);
  return parts.join(" ");
}

/** The usage of the assistant messages of the last agent run of the response. */
function responseUsages(event: { messages?: unknown } | undefined): unknown[] {
  const messages = Array.isArray(event?.messages) ? event.messages : [];
  return messages
    .filter((message: any) => message?.role === "assistant")
    .map((message: any) => message.usage);
}

/**
 * Fallback reading of the same response from the session entries, used when
 * `agent_end` delivered no message. It cannot be bounded exactly, so the
 * reading is reported as approximate.
 */
function sessionUsages(ctx: ExtensionContext, since: number): unknown[] {
  const entries =
    typeof ctx.sessionManager?.getEntries === "function" ? ctx.sessionManager.getEntries() : [];
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry: any) => entry?.type === "message" && entry.role === "assistant")
    .filter((entry: any) => {
      const at = Date.parse(entry.timestamp);
      return !Number.isFinite(at) || at >= since;
    })
    .map((entry: any) => entry.usage);
}

interface DiscoveredTour {
  id: string;
  title: string;
}

async function readTour(pi: ExtensionAPI, ctx: ExtensionContext, title: string) {
  const words = cliWords(await installedLauncher());
  const cli = { command: words[0], args: words.slice(1) };
  const workspace = await realWorkspace(ctx.cwd);
  if (!workspace) throw new Error(`${ctx.cwd} is not a usable workspace.`);

  const resolve = async (args: string[]) => {
    const invocation = readerInvocation(cli, args, workspace);
    const result = await pi.exec(invocation.command, invocation.args, { cwd: workspace });
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

  const { plan, command } = existingTourReader(selected.id, cli, workspace);
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
  // The response window of DESIGN §4: `agent_start` opens it and
  // `agent_settled` closes it. Pi exposes no response identity (#323 recon
  // §5.c), so the boundary is this instant, compared with the creation
  // records' own `at`.
  let responseStart: number | undefined;
  // The usage of the last run's assistant messages, and how many runs the
  // response contained (`agent_end` may repeat for a retry or a queued
  // follow-up inside one response).
  let runUsages: unknown[] = [];
  let runCount = 0;

  // Observability must not become a chorus: one report per response window,
  // and one opening dialogue per created Tour whatever the host re-emits.
  const reportedResponses = new Set<number>();
  const offeredTours = new Set<string>();

  /**
   * The end-of-response report: the Tours this response created, then its
   * single token reading. Silent when no creation is attributed.
   */
  async function reportResponse(
    ctx: ExtensionContext,
    created: CreationRecord[],
    windowStart: number
  ): Promise<void> {
    for (const line of summaryLines(created)) {
      ctx.ui.notify(line, "info");
    }
    // The reading is exact only when it covers the whole response: a single
    // run, whose messages `agent_end` delivered. A repeated run (retry,
    // compaction retry, queued follow-up) leaves only the last one, and the
    // session entries cannot be bounded to the response at all, so both are
    // labelled approximate.
    const fromRun = runUsages.length > 0;
    const usages = fromRun ? runUsages : sessionUsages(ctx, windowStart);
    const approximate = !fromRun || runCount !== 1;
    ctx.ui.notify(tokenLine(tokenReading(usages, { approximate })), "info");
  }

  /**
   * The opening dialogue of ticket #242, re-pointed at the creation journal:
   * the real interactive reader in this terminal, or the Tour at its active
   * step in VS Code. Never a textual summary, never an independent window, and
   * never a second question for the same Tour.
   */
  async function offerReader(
    ctx: ExtensionContext,
    record: CreationRecord,
    workspace: string
  ): Promise<void> {
    const key = `${record.tourPath}|${record.at}`;
    if (offeredTours.has(key)) return;
    offeredTours.add(key);
    // Print and JSON modes have no dialogue to offer (ctx.hasUI === false).
    if (ctx.hasUI === false) return;
    const tour = { tourPath: record.tourPath, tourTitle: record.tourTitle, workspace };
    const question = openingQuestion(tour);
    if (!question) return;
    const choice = await ctx.ui.select(question, openingOptions());
    const words = cliWords(await installedLauncher());
    if (choice === TERMINAL_OPTION) {
      // The real reader opens immediately: the installed CLI is spawned with
      // inherited stdio — this very terminal, never an independent window — and
      // the call returns only when the reading ends. A non-interactive session
      // or a failed spawn degrades to the documented hand-over command.
      const outcome = await playInTerminal(tour, { command: words[0], args: words.slice(1) });
      if (outcome.degraded && outcome.command) {
        ctx.ui.notify(
          outcome.reason
            ? `CodeTour: ${outcome.reason} Run ${outcome.command} at the ` +
              "workspace root — the reader plays in this terminal, never an independent window."
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
      const command = vscodeCommand(tour);
      if (!command) {
        ctx.ui.notify("CodeTour: the created Tour has no path to open in VS Code.", "warning");
        return;
      }
      try {
        const result = await pi.exec(
          words[0],
          [...words.slice(1), "--internal-open-vscode", record.tourPath, ctx.cwd],
          { cwd: ctx.cwd }
        );
        if (result.code !== 0) {
          ctx.ui.notify(
            `CodeTour: could not open the Tour in VS Code: ${
              result.stderr.trim() || `exit ${result.code}`
            }. Run ${command} at the workspace root.`,
            "warning"
          );
        }
      } catch (error) {
        ctx.ui.notify(
          `CodeTour: could not open the Tour in VS Code: ${
            error instanceof Error ? error.message : String(error)
          }. Run ${command} at the workspace root.`,
          "warning"
        );
      }
    }
  }

  // The window opens at the first run of the response, so a retry or a queued
  // follow-up does not hide the creations of the runs before it.
  pi.on("agent_start", () => {
    if (responseStart === undefined) responseStart = Date.now();
    runUsages = [];
    runCount = 0;
  });

  pi.on("agent_end", (event) => {
    runCount += 1;
    runUsages = responseUsages(event);
  });

  // `agent_settled` is Pi's final, notification-only boundary: it cannot ask
  // for a continuation, it fires once per settled response, and it is emitted
  // in print mode too. Nothing below returns a value.
  pi.on("agent_settled", async (event, ctx) => {
    const start = responseStart;
    responseStart = undefined;
    if (event?.aborted === true || start === undefined) return;
    if (reportedResponses.has(start)) return;
    reportedResponses.add(start);
    try {
      const workspace = await realWorkspace(ctx.cwd);
      if (!workspace) return;
      const { records } = await readCreations(workspace);
      const created = selectCreated(records, {
        workspace,
        sessionId: ctx.sessionManager.getSessionId(),
        since: start,
        now: Date.now(),
      }) as CreationRecord[];
      if (created.length === 0) return;
      await reportResponse(ctx, created, start);
      for (const record of created) {
        // One dialogue per Tour: a host that cannot open one still gets the
        // report, and the next Tour keeps its own offer.
        try {
          await offerReader(ctx, record, workspace);
        } catch {
          // An opening never fails the response.
        }
      }
    } catch {
      // The journal is observability only: a reading failure is never a
      // response failure and never a Tour to report.
    }
  });

  pi.registerCommand("codetour", {
    description: "Read an existing CodeTour: /codetour read [tour]; generate one: /codetour generate",
    handler: async (rawArgs, ctx) => {
      let input = rawArgs.trim();
      if (!input) {
        const choice = await ctx.ui.select("CodeTour", ["Generate", "Read"]);
        if (choice === undefined) return;
        input = choice === "Generate" ? "generate" : "read";
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
        const choice = await ctx.ui.select("Which tour should be generated?", [
          "Project Tour",
          "Changes Tour — Neutral",
          "Changes Tour — Critical",
        ]);
        if (!choice) {
          ctx.ui.notify("CodeTour: generation cancelled.", "info");
          return;
        }
        type = choice === "Project Tour" ? "project" : "changes";
        if (type === "changes") {
          reviewMode = choice === "Changes Tour — Critical" ? "critical" : "neutral";
        }
      }
      if (type === "changes" && !reviewMode) {
        const mode = await ctx.ui.select("Review mode", ["Neutral", "Critical"]);
        if (!mode) {
          ctx.ui.notify("CodeTour: generation cancelled.", "info");
          return;
        }
        reviewMode = mode === "Critical" ? "critical" : "neutral";
      }

      const workspace = await realWorkspace(ctx.cwd);
      if (!workspace) {
        ctx.ui.notify(`CodeTour: ${ctx.cwd} is not a usable workspace.`, "error");
        return;
      }
      // The agent creates the Tour with the installed CLI; no run state, no
      // MCP registration and nothing to release afterwards.
      try {
        pi.sendUserMessage(
          skillInvocation({
            type,
            reviewMode,
            cli: await cliForSkill(),
            request: choices.request,
          }),
          { expandPromptTemplates: true }
        );
      } catch (error) {
        ctx.ui.notify(
          `CodeTour: could not start the generation (${
            error instanceof Error ? error.message : String(error)
          }).`,
          "error"
        );
      }
    },
  });

  /** The argv words the skill must call, recorded only when the CLI is known. */
  async function cliForSkill(): Promise<string[] | undefined> {
    const launcher = await installedLauncher();
    return launcher ? cliWords(launcher) : undefined;
  }
}
