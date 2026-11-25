#!/usr/bin/env node
import { randomUUID } from "crypto";
import { execFileSync, spawn } from "child_process";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import { Command, CommanderError } from "commander";
import type { CodeTour } from "../store";
import { loadTour } from "../store/tourSchema";
import { discoverToursFromRoot, visibleTours } from "../core/tourDiscovery";
import { renderDescription } from "codetour-description-renderer";
import { runCreateTourCommand } from "./createTour";
import { createStandaloneTourHtml } from "./html";
import { doctor, installAgents, listAgents, uninstallAgents, agentIds } from "./agentIntegrations";
import { installChosenAgents, generationAgentIds, terminalSelectionSession } from "./agentSelection";
import { resolveReadonlyStepContext } from "./stepContext";
import { readTourImages } from "./stepImages";
import { runTerminalTour } from "./terminal";
import { runInternalOpenVsCode } from "./internalOpenVscode";
import { openTourInVsCode } from "./openInVscode";
import { defaultTerminalSession, handOffTtyToTourReader, HANDOFF_FLAG } from "./ttyHandoff";
import { resolveTourSelection } from "./tourResolution";

const USAGE = "Usage: codetour [tour] [--renderer terminal|html|vscode]";

// Only the CLI itself may describe the running script as the installed launcher.
// An embedder (a compiled test, another tool importing this module) used to be
// taken for the CLI because it also has a script in `process.argv[1]`, and the
// install then probed that script with `--version`: a test file re-ran itself
// instead of answering. The entry publishes its own path once, and the
// integration code falls back to the portable `codetour` command without it.
process.env.CODETOUR_CLI_ENTRY = path.resolve(process.argv[1] || "");

// The experimental TTY handoff flag (spike, ticket #243): variadic so the
// optional workspace root can follow the Tour file. The flag itself is
// spelled once, in the shared constant (review S2); this option spec only
// adds the value shape.
const HANDOFF_OPTION = HANDOFF_FLAG + " [paths...]";

interface Options {
  renderer?: string;
  install?: string | boolean;
  uninstall?: string | boolean;
  agents: boolean;
  doctor: boolean;
  internalListTours: boolean;
  internalResolveTour?: string | boolean;
  internalTourId?: string;
  internalTour?: string[];
  internalOpenVscode?: string[];
  experimentalTtyHandoff?: string[]; }

function buildProgram(): Command {
  const command = new Command()
    .name("codetour")
    .enablePositionalOptions()
    .allowExcessArguments(false)
    .description("Read guided Tours of a codebase, and generate them with AI agents.")
    .argument("[title]", "Tour title or Tour file name")
    .option("--renderer <type>", "open the Tour as terminal (default), html, or vscode")
    .option(
      "--install [agent]",
      "install an agent integration: " + agentIds() +
        "; with no value, choose from the generation agents (" + generationAgentIds() + "); with 'all', every compatible agent"
    )
    .option(
      "--uninstall [agent]",
      "remove an agent integration installed by this CLI; with no value or 'all', every installed agent"
    )
    .option("--agents", "list every agent integration and its state")
    .option("--doctor", "diagnose this CLI and every agent integration")
    .option("--internal-list-tours", "print the discoverable Tours as JSON")
    .option("--internal-resolve-tour [title]", "resolve a Tour by title or file name and print its identity as JSON")
    .option("--internal-tour-id <id>", "open the Tour with this discovered identity")
    .option("--internal-tour <args...>", "internal: run the terminal reader on a Tour file")
    .option("--internal-open-vscode <args...>", "internal: open a Tour file in VS Code at the active step")
    .option(
      HANDOFF_OPTION,
      "experimental: hand this terminal's control to the Tour reader, " +
        "then return it to the agent session (prototype, ticket #243)"
    )
    .action(async (title: string | undefined, options: Options) => runWithOptions(options, title))
    .exitOverride()
    // The mapped messages in toCliError are the CLI's error contract; the
    // framework's own line would duplicate them.
    .configureOutput({ outputError: () => {} });
  // Tour creation: an agent hands over its JSON proposal and gets one JSON
  // result. These commands parse their own arguments and own their exit codes,
  // so the reader's error contract is untouched. They are reserved tokens: a
  // Tour with that exact title reaches the reader through the numbered prompt
  // or --internal-tour-id.
  for (const kind of ["project", "changes"] as const) {
    command
      .command("create-" + kind + "-tour [args...]")
      .description(
        "create a CodeTour " +
          (kind === "project" ? "Project" : "Changes") +
          " Tour from a JSON proposal"
      )
      .allowUnknownOption()
      .passThroughOptions()
      .helpOption(false)
      .action(async (args: string[]) => {
        process.exitCode = await runCreateTourCommand(kind, args);
      });
  }
  return command;
}

// Commander errors keep the established CLI message contract: the tests and
// the Copilot adapter rely on these exact wordings.
function toCliError(error: CommanderError): Error {
  if (error.code === "commander.helpDisplayed") return error as unknown as Error;
  const message = error.message.replace(/^error: /, "");
  const unknownOption = message.match(/unknown option '([^']+)'/);
  if (unknownOption) return new Error(`Unknown option: ${unknownOption[1]}. ${USAGE}`);
  const missingValue = message.match(/option '([^']+)'.*argument missing/);
  if (missingValue) {
    const option = missingValue[1].split(" ")[0];
    return new Error(
      option === "--renderer"
        ? "Missing value for --renderer (html or terminal)."
        : `Missing value for ${option}.`
    );
  }
  if (message.includes("too many arguments")) {
    return new Error(`Only one Tour name is allowed. ${USAGE}`);
  }
  return new Error(message);
}

function repositoryRoot(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd, encoding: "utf8", stdio: [ "ignore", "pipe", "ignore" ]
    }).trim();
  } catch {
    throw new Error("Not inside a Git worktree. Run codetour from a Git repository.");
  }
}

async function discover(root: string): Promise<CodeTour[]> {
  let customDirectory: string | undefined;
  try {
    const settings = JSON.parse(await fs.readFile(path.join(root, ".vscode", "settings.json"), "utf8"));
    if (typeof settings["codetour.customTourDirectory"] === "string") {
      customDirectory = settings["codetour.customTourDirectory"];
    }
  } catch {
    // A VS Code user setting is unavailable to the autonomous reader.
  }

  const tours = await discoverToursFromRoot(root, {
    join: path.join,
    read: uri => fs.readFile(uri, "utf8"),
    list: async uri => (await fs.readdir(uri, { withFileTypes: true })).map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory()
    })),
    id: uri => pathToFileURL(uri).toString()
  }, customDirectory);
  return visibleTours(tours, {
    isLinux: process.platform === "linux",
    isMac: process.platform === "darwin",
    isWindows: process.platform === "win32",
    isWeb: false
  });
}

async function pickTour(tours: CodeTour[], requested?: string): Promise<CodeTour> {
  // Resolution rules (exact title, file-name fallback, unique-Tour
  // shortcut) live in the shared contract; the interactive prompt below
  // only handles the case it can serve: no requested title, many Tours.
  if (!requested && tours.length > 1) {
    console.log("Select an existing CodeTour:");
    tours.forEach((tour, index) => console.log("  " + (index + 1) + ". " + tour.title));
    const answer = await new Promise<string>((resolve, reject) => {
      const readline = require("readline").createInterface({ input: process.stdin });
      let answered = false;
      process.stdout.write("Tour number: ");
      readline.once("line", (value: string) => {
        answered = true;
        resolve(value);
        readline.close();
      });
      readline.once("close", () => {
        if (!answered) reject(new Error("Tour selection cancelled."));
      });
    });
    const selection = Number(answer);
    if (!Number.isInteger(selection) || selection < 1 || selection > tours.length) {
      throw new Error("Invalid Tour selection: " + answer);
    }
    return tours[selection - 1];
  }
  return resolveTourSelection(tours, requested);
}

async function openFileInBrowser(file: string): Promise<void> {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" :
    platform === "win32" ? "powershell.exe" : "xdg-open";
  const args = platform === "darwin" ? [file] :
    platform === "win32"
      ? ["-NoProfile", "-NonInteractive", "-Command",
          "Start-Process -FilePath '" + file.replace(/'/g, "''") + "'"]
      : [file];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() :
      reject(new Error("Browser launcher failed: " + (signal || code))));
  });
}

// `--install` without a value is the interactive picker (decision §8 of spec
// #320): the terminal chooses among the generation agents. `all` keeps the
// non-interactive batch, and any other value names one agent.
// `--uninstall` has no picker: without a value it removes every integration
// this CLI installed, which stays scriptable.
function agentId(value: string | boolean): string | undefined {
  if (typeof value !== "string") return undefined;
  return value === "all" ? undefined : value;
}

async function runWithOptions(options: Options, title: string | undefined): Promise<void> {
  // The experimental TTY handoff (spike, ticket #243) runs before everything
  // else and never reaches the standard reading path: the session's terminal
  // is lent to the full terminal reader, then returned to the session.
  if (options.experimentalTtyHandoff) {
    // Commander maps a variadic option without a value to `true`: treating
    // the bare flag as the argument list crashed with
    // `TypeError: boolean true is not iterable` before the Tour was ever
    // read (review F1). The flag is never propagated to the spawned reader
    // (`ttyHandoff.ts`), so this guard only receives that bare form.
    if (!Array.isArray(options.experimentalTtyHandoff)) {
      throw new Error("The experimental TTY handoff requires a Tour file path.");
    }
    const [handoffTour, handoffRoot] = options.experimentalTtyHandoff;
    if (!handoffTour) {
      throw new Error("The experimental TTY handoff requires a Tour file path.");
    }
    console.log("CodeTour (experimental): handing this terminal's control to the Tour reader;");
    console.log("CodeTour (experimental): leave the Tour to return control to your session.");
    const handoff = await handOffTtyToTourReader(
      { tourPath: handoffTour, workspaceRoot: handoffRoot },
      { session: defaultTerminalSession() }
    );
    if (handoff.reason) console.error("CodeTour (experimental): " + handoff.reason);
    if (handoff.handedOff) {
      console.log("CodeTour (experimental): terminal returned to the session.");
    }
    if (handoff.interrupted || (handoff.spawned && handoff.exitCode !== 0)) {
      process.exitCode = handoff.exitCode ?? 1;
    }
    return;
  }

  // Agent integrations run before Tour discovery: an installation is a
  // machine-level action, valid outside any Git worktree.
  if (options.agents) {
    await listAgents();
    return;
  }
  if (options.doctor) {
    await doctor();
    return;
  }
  if (options.install !== undefined) {
    const report = typeof options.install === "string"
      ? await installAgents(agentId(options.install))
      : await installChosenAgents(terminalSelectionSession());
    if (report.failed) process.exitCode = 1;
    return;
  }
  if (options.uninstall) {
    const report = await uninstallAgents(agentId(options.uninstall));
    if (report.failed) process.exitCode = 1;
    return;
  }

  if (options.internalTour) {
    if (options.internalTour.length < 1 || options.internalTour.length > 2) {
      throw new Error("Internal terminal runner requires a Tour path and optional workspace root.");
    }
    const source = loadTour(
      await fs.readFile(options.internalTour[0], "utf8"),
      pathToFileURL(options.internalTour[0]).toString()
    );
    await runTerminalTour(source, repositoryRoot(options.internalTour[1] || path.dirname(options.internalTour[0])));
    return;
  }

  if (options.internalOpenVscode) {
    await runInternalOpenVsCode(options.internalOpenVscode);
    return;
  }

  // The renderer is validated before Git worktree detection, exactly as the
  // previous hand-rolled parser did: a bad renderer fails anywhere.
  const renderer = options.renderer ?? "terminal";
  if (renderer !== "terminal" && renderer !== "html" && renderer !== "vscode") {
    throw new Error("Unknown renderer '" + renderer + "'. Use terminal, html, or vscode.");
  }

  const root = repositoryRoot(process.cwd());
  const tours = await discover(root);
  if (options.internalListTours) {
    console.log(JSON.stringify(tours.map(tour => ({id: tour.id, title: tour.title}))));
    return;
  }
  // Non-interactive resolution surface for the Copilot adapter: resolve the
  // shared selection contract for an optional requested title and print the
  // resolved identity, or fail with the exact resolution error. No prompt.
  if (options.internalResolveTour !== undefined) {
    if (title) throw new Error("Only one Tour name is allowed. " + USAGE);
    const requested = typeof options.internalResolveTour === "string" ? options.internalResolveTour : undefined;
    const resolved = resolveTourSelection(tours, requested);
    console.log(JSON.stringify({id: resolved.id, title: resolved.title}));
    return;
  }
  // Only select identities from this workspace's discovered list. Copilot
  let selected: CodeTour | undefined;
  if (options.internalTourId) {
    selected = tours.find(tour => tour.id === options.internalTourId);
    if (!selected) throw new Error("Selected Tour is no longer available.");
    if (title) throw new Error("Only one Tour can be selected.");
  }
  const tour = selected ?? await pickTour(tours, title);

  // The terminal reader is the default and reads in the caller's own
  // terminal: the agent's terminal is the Playback Surface, never an
  // independent terminal window (ticket #241). Only an explicit
  // --renderer html opens the browser page.
  if (renderer === "vscode") {
    await openTourInVsCode({ tourId: tour.id, workspaceRoot: root, step: 0 });
    return;
  }
  if (renderer === "terminal") {
    await runTerminalTour(tour, root);
    return;
  }

  const output = process.env.CODETOUR_TEST_HTML_OUTPUT ||
    path.join(os.tmpdir(), "codetour-" + randomUUID() + ".html");
  const contexts = tour.steps.map(step => resolveReadonlyStepContext(root, tour, step));
  const html = await createStandaloneTourHtml(tour, contexts, {
    // The browser is a real HTML surface: the sanitized SVG stays sharp at
    // every zoom level, unlike the terminal's half-block preview (ADR 0024).
    renderStepDescription: async description => {
      const { images } = await readTourImages(root, description);
      return renderDescription(description, "dark", {
        diagramFormat: "svg",
        resolveImageBytes: imagePath => images.get(imagePath)
      });
    }
  });
  await fs.writeFile(output, html, "utf8");
  if (!process.env.CODETOUR_TEST_HTML_OUTPUT) {
    await openFileInBrowser(output);
  }
  console.log("CodeTour: opened " + tour.title + " (" + output + ")");
}

async function main(): Promise<void> {
  const command = buildProgram();
  try {
    await command.parseAsync(process.argv, { from: "node" });
  } catch (error) {
    if ((error as CommanderError).code === "commander.helpDisplayed") return;
    // A command with subcommands but no action prints its help and raises
    // `commander.help`: that is an informational success, not a JSON result.
    if ((error as CommanderError).code === "commander.help") return;
    throw toCliError(error as CommanderError);
  }
}

void main().catch(error => {
  console.error("CodeTour: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
