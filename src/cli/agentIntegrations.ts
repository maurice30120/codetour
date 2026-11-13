import { execFile, spawnSync } from "child_process";
import { promises as fs, readdirSync, existsSync } from "fs";
import * as os from "os";
import * as path from "path";
import { COPILOT_EXTENSION_FILES } from "./copilot-extension.generated";

// Agent integrations registry (spec: agent-integrations-copilot-codex.md).
// Every integration owns detection, status, installation, uninstallation and
// diagnostics through the same contract. The registry grows one entry per
// agent; an unregistered id stays explicitly unsupported.

export interface DetectionResult {
  state: "detected" | "absent";
  detail: string;
}

export type InstallationState = "not-installed" | "installed" | "outdated" | "incomplete";

export interface InstallationStatus {
  state: InstallationState;
  detail: string;
}

export interface AgentIntegration {
  id: string;
  displayName: string;
  detect(): Promise<DetectionResult>;
  status(): Promise<InstallationStatus>;
  install(): Promise<void>;
  uninstall(): Promise<void>;
}

const execFileAsync = (executable: string, args: string[]): Promise<string | undefined> =>
  new Promise(resolve => {
    execFile(executable, args, { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      resolve(error ? undefined : stdout);
    });
  });

async function runAgentCommand(executable: string, args: string[]): Promise<string> {
  const output = await execFileAsync(executable, args);
  if (output === undefined) {
    throw new Error(`'${executable}' could not be executed. Make sure it is installed and on PATH.`);
  }
  return output;
}

function firstLine(output: string): string {
  return output.trim().split(/\r?\n/)[0] || "";
}

function copilotExtensionDirectory(): string {
  return process.env.CODETOUR_COPILOT_EXTENSIONS_DIR ||
    path.join(os.homedir(), ".copilot", "extensions", "codetour");
}

// One MCP server entry as read from a user configuration. Foreign entries stay
// loose: Copilot owns their shape and this CLI never interprets it.
interface CopilotMcpServer {
  type?: string;
  command?: string;
  args?: string[];
  tools?: string[];
  [key: string]: unknown;
}

// The entry this CLI writes, with every field the launch contract needs. The
// strict shape removes the non-null assertions a loose read type would force.
type CodetourMcpEntry = {
  type: "local";
  command: string;
  args: string[];
  tools: string[];
};

interface CopilotMcpConfig {
  mcpServers?: Record<string, CopilotMcpServer>;
  [key: string]: unknown;
}

function copilotMcpConfigPath(): string {
  // Copilot reads its user MCP servers from this file; COPILOT_HOME relocates
  // the whole user directory, so honor it before the explicit override.
  const home = process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
  return process.env.CODETOUR_COPILOT_MCP_CONFIG || path.join(home, "mcp-config.json");
}

async function readCopilotMcpConfig(file: string): Promise<CopilotMcpConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    // Only a missing file means "no user configuration yet": the install
    // creates its own. Every other read error (permissions, a directory at
    // that path, an unmounted home) is reported instead of being treated as an
    // empty configuration the install may overwrite.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(
      `Could not read ${file} (${error instanceof Error ? error.message : String(error)}). ` +
      "Fix its path or permissions and run the command again; the file was left untouched so no configured MCP server is lost."
    );
  }
  try {
    return JSON.parse(raw) as CopilotMcpConfig;
  } catch {
    throw new Error(
      `${file} is not valid JSON; fix it before installing so no existing MCP server is lost.`
    );
  }
}

async function writeCopilotMcpConfig(file: string, config: CopilotMcpConfig): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(config, null, 2) + "\n", "utf8");
  } catch (error) {
    throw new Error(
      `Could not write ${file} (${error instanceof Error ? error.message : String(error)}). ` +
      "Fix its path or permissions and run the command again."
    );
  }
}

// The launcher registered for Copilot must start the CLI that ran the install,
// not whatever a stale `codetour` on PATH happens to be: an older release can
// lack the `mcp` command, leaving the session without tools. A Node-script CLI
// (npm bin, development build, standalone launcher) is addressed through its
// runtime and absolute script path; a native executable is addressed directly.
function codetourMcpEntry(): CodetourMcpEntry {
  const script = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
  const [command, args]: [string, string[]] =
    script && existsSync(script) && /\.[cm]?js$/i.test(script)
      ? [process.execPath, [script, "mcp"]]
      : ["codetour", ["mcp"]];
  return { type: "local", command, args, tools: ["*"] };
}

function sameValues(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// Canonical equality for the entry this CLI writes. JSON key order is not part
// of an installation, and Copilot's `local` transport is the default when
// `type` is absent, so both forms describe the same server and neither may
// trigger a rewrite. The fields that define the launch contract are compared
// one by one, never through a serialization of the whole object.
function isCurrentCodetourMcpEntry(
  entry: CopilotMcpServer | undefined,
  expected: CodetourMcpEntry
): boolean {
  if (!entry) return false;
  return (entry.type ?? expected.type) === expected.type &&
    entry.command === expected.command &&
    Array.isArray(entry.args) && sameValues(entry.args, expected.args) &&
    Array.isArray(entry.tools) && sameValues(entry.tools, expected.tools);
}

// Ownership: the uninstall removes exactly the entry this CLI writes, or the
// documented `codetour mcp` launcher — the stable launch contract of the
// standalone CLI. A same-named server launched another way belongs to another
// installation and is preserved: "a local entry whose last argument is mcp" is
// far too broad and would delete a foreign server.
function isCodetourMcpEntry(entry: CopilotMcpServer | undefined): boolean {
  if (!entry || (entry.type ?? "local") !== "local") return false;
  if (typeof entry.command !== "string" || !Array.isArray(entry.args)) return false;
  return (entry.command === "codetour" && sameValues(entry.args, ["mcp"])) ||
    isCurrentCodetourMcpEntry(entry, codetourMcpEntry());
}

function verifyCodetourMcpEntry(entry: CodetourMcpEntry): void {
  const invocation = [entry.command, ...entry.args].join(" ");
  const probe = spawnSync(entry.command, [...entry.args, "--version"], {
    encoding: "utf8", windowsHide: true, timeout: 15000
  });
  if (probe.status !== 0) {
    const detail = (probe.stderr || probe.error?.message || "").trim();
    throw new Error(
      `The CodeTour MCP launch contract could not be verified ('${invocation}'). ` +
      (detail ? `${detail} ` : "") +
      `Keep the CLI at this path, or re-run 'codetour --install copilot' from the installation to use.`
    );
  }
}

interface FileState {
  name: string;
  state: "current" | "modified" | "missing";
}

async function copilotFileStates(directory: string): Promise<FileState[]> {
  const states: FileState[] = [];
  for (const [name, content] of Object.entries(COPILOT_EXTENSION_FILES)) {
    const target = path.join(directory, name);
    let existing: string;
    try {
      existing = await fs.readFile(target, "utf8");
    } catch {
      states.push({ name, state: "missing" });
      continue;
    }
    states.push({ name, state: existing === content ? "current" : "modified" });
  }
  return states;
}

// Read a managed adapter file for the rollback snapshot. Only a missing file is
// `undefined`; an unreadable file stops the install before its first write
// instead of being recorded as "did not exist" and deleted by a rollback.
async function readCopilotFile(target: string): Promise<string | undefined> {
  try {
    return await fs.readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

// A failed install puts the adapter back as it found it: files that existed get
// their previous content, files this install created are removed. The returned
// names are the ones a best-effort restore could not repair, so the caller can
// report them instead of claiming a clean rollback.
async function restoreCopilotFiles(
  directory: string,
  previous: Map<string, string | undefined>
): Promise<string[]> {
  const unrestored: string[] = [];
  for (const [name, content] of previous) {
    const target = path.join(directory, name);
    try {
      if (content === undefined) {
        await fs.rm(target, { force: true });
      } else {
        await fs.writeFile(target, content, "utf8");
      }
    } catch {
      unrestored.push(name);
    }
  }
  return unrestored;
}

const copilotIntegration: AgentIntegration = {
  id: "copilot",
  displayName: "GitHub Copilot CLI",
  async detect() {
    const version = await execFileAsync("copilot", ["--version"]);
    return version
      ? { state: "detected", detail: firstLine(version) }
      : { state: "absent", detail: "The 'copilot' command was not found on PATH." };
  },
  async status() {
    const directory = copilotExtensionDirectory();
    const states = await copilotFileStates(directory);
    const allCurrent = states.every(file => file.state === "current");
    const allMissing = states.every(file => file.state === "missing");
    const changed = states.filter(file => file.state !== "current").map(file => file.name).join(", ");
    const mcpFile = copilotMcpConfigPath();
    let registered = false;
    let current = false;
    let entry: CopilotMcpServer | undefined;
    let unreadable: string | undefined;
    try {
      entry = (await readCopilotMcpConfig(mcpFile)).mcpServers?.codetour;
      registered = isCodetourMcpEntry(entry);
      // The registered launcher must be the one this CLI would write now: an
      // entry left by another installation can point at a stale CLI.
      current = registered && isCurrentCodetourMcpEntry(entry, codetourMcpEntry());
    } catch (error) {
      unreadable = error instanceof Error ? error.message : String(error);
    }
    if (allCurrent && current) {
      return {
        state: "installed" as const,
        detail: `The adapter files are installed in ${directory} and the 'codetour' MCP server is registered in ${mcpFile}.`
      };
    }
    if (allCurrent && registered) {
      return {
        state: "outdated" as const,
        detail: `The 'codetour' MCP server in ${mcpFile} was registered by a different CodeTour installation. ` +
          "Re-run 'codetour --install copilot' to register the current launcher."
      };
    }
    if (allCurrent) {
      // The tools come from the MCP registration, so a current adapter without
      // it is incomplete even though every file matches.
      return {
        state: "incomplete" as const,
        detail: unreadable
          ? `The adapter files are installed in ${directory}, but ${unreadable}`
          : entry
            ? `The adapter files are installed in ${directory}, but the 'codetour' entry in ${mcpFile} was configured another way and left untouched. ` +
              "Re-run 'codetour --install copilot' to register the launcher of this CLI."
            : `The adapter files are installed in ${directory}, but the 'codetour' MCP server is missing from ${mcpFile}. ` +
              "Re-run 'codetour --install copilot' so Copilot exposes 'codetour-create_project_tour' and 'codetour-create_changes_tour'."
      };
    }
    if (allMissing && !registered) {
      return {
        state: "not-installed" as const,
        detail: unreadable
          ? `No CodeTour adapter in ${directory}. ${unreadable}`
          : `No CodeTour adapter in ${directory}.`
      };
    }
    return {
      state: "outdated" as const,
      detail: `The installed adapter differs from this CLI (${changed}). Re-run 'codetour --install copilot' to replace it` +
        (registered ? " and refresh the 'codetour' MCP server." : " and register the 'codetour' MCP server.")
    };
  },
  async install() {
    const directory = copilotExtensionDirectory();
    const states = await copilotFileStates(directory);
    const differing = states.filter(file => file.state === "modified").map(file => file.name);
    const entry = codetourMcpEntry();
    // Everything that can refuse the install runs before the first write: the
    // verified launch contract and the user configuration this install must
    // preserve. A refusal then leaves no partial installation behind.
    verifyCodetourMcpEntry(entry);
    const mcpFile = copilotMcpConfigPath();
    const mcpConfig = await readCopilotMcpConfig(mcpFile);
    const previous = new Map<string, string | undefined>();
    for (const name of Object.keys(COPILOT_EXTENSION_FILES)) {
      previous.set(name, await readCopilotFile(path.join(directory, name)));
    }
    const registered = isCurrentCodetourMcpEntry(mcpConfig.mcpServers?.codetour, entry);
    try {
      await fs.mkdir(directory, { recursive: true });
      for (const [name, content] of Object.entries(COPILOT_EXTENSION_FILES)) {
        const target = path.join(directory, name);
        await fs.writeFile(target, content, "utf8");
        // Verify the written file and its path before reporting success.
        if (await fs.readFile(target, "utf8") !== content) {
          throw new Error(`Could not verify ${target} after installation.`);
        }
      }
      // The extension also joins the session with its own MCP server, but that
      // registration is invisible and can be lost with the extension process.
      // The documented user configuration makes the tools discoverable on its
      // own, whatever the extension mode or install state.
      if (!registered) {
        mcpConfig.mcpServers = { ...mcpConfig.mcpServers, codetour: entry };
        await writeCopilotMcpConfig(mcpFile, mcpConfig);
      }
    } catch (error) {
      // Adapter files are already written: put the previous state back so a
      // failed install never leaves half a registration.
      const unrestored = await restoreCopilotFiles(directory, previous);
      if (unrestored.length) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} ` +
          `The previous adapter files could not be fully restored (${unrestored.join(", ")}); ` +
          "re-run 'codetour --install copilot' once the cause is fixed."
        );
      }
      throw error;
    }
    if (differing.length) {
      console.log(`Replaced differing adapter files (${differing.join(", ")}) in ${directory}.`);
    }
    console.log(`Installed the CodeTour adapter in ${directory}.`);
    if (registered) {
      console.log(`The 'codetour' MCP server is already registered in ${mcpFile}.`);
    } else {
      console.log(`Registered the 'codetour' MCP server in ${mcpFile}.`);
    }
    console.log("Start 'copilot --experimental' in a trusted Git worktree, accept the extension");
    console.log("(Load Only or Load & Augment), then run /codetour.");
    console.log("Verify with 'copilot mcp list': the 'codetour' server must be enabled and expose");
    console.log("'codetour-create_project_tour' and 'codetour-create_changes_tour'.");
    const onPath = spawnSync("codetour", ["mcp", "--version"], { encoding: "utf8", windowsHide: true }).status === 0;
    if (!onPath) {
      console.log(
        `The adapter resolves the CodeTour CLI through CODETOUR_CLI or PATH. Keep this command on PATH or set:`
      );
      console.log(`  CODETOUR_CLI="${path.resolve(process.argv[1] || "codetour")}"`);
    }
  },
  async uninstall() {
    const directory = copilotExtensionDirectory();
    const states = await copilotFileStates(directory);
    const foreign = states.filter(file => file.state === "modified");
    if (foreign.length) {
      throw new Error(
        `${foreign.map(file => file.name).join(", ")} in ${directory} differ from this installation ` +
        "and were left untouched. Only files this CLI owns are removed."
      );
    }
    for (const file of states) {
      if (file.state === "current") await fs.rm(path.join(directory, file.name));
    }
    const remaining = await fs.readdir(directory).catch(() => [] as string[]);
    // Idempotent: the directory may already be gone from an earlier uninstall.
    if (!remaining.length) await fs.rmdir(directory).catch(() => undefined);
    console.log(`Removed the CodeTour adapter from ${directory}.`);
    const mcpFile = copilotMcpConfigPath();
    let mcpConfig: CopilotMcpConfig;
    try {
      mcpConfig = await readCopilotMcpConfig(mcpFile);
    } catch (error) {
      // Files this CLI owns are already removed; an unreadable user
      // configuration is reported, never overwritten or partially edited.
      console.log(`Left ${mcpFile} untouched: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const servers = mcpConfig.mcpServers;
    if (servers && isCodetourMcpEntry(servers.codetour)) {
      delete servers.codetour;
      await writeCopilotMcpConfig(mcpFile, mcpConfig);
      console.log(`Removed the 'codetour' MCP server from ${mcpFile}.`);
    }
  }
};

const VSCODE_EXTENSION_ID = "maurice30120.codetour";

function findVsix(): string | undefined {
  const candidates: string[] = [];
  if (process.env.CODETOUR_VSIX) candidates.push(process.env.CODETOUR_VSIX);
  const cliDirectory = path.dirname(path.resolve(process.argv[1] || "."));
  for (const directory of [process.cwd(), cliDirectory, path.dirname(cliDirectory)]) {
    try {
      for (const entry of readdirSync(directory)) {
        if (entry.endsWith(".vsix")) candidates.push(path.join(directory, entry));
      }
    } catch {
      // A directory that cannot be listed contributes no candidate.
    }
  }
  return candidates.find(candidate => existsSync(candidate));
}

const vscodeIntegration: AgentIntegration = {
  id: "vscode",
  displayName: "Visual Studio Code",
  async detect() {
    const version = await execFileAsync("code", ["--version"]);
    return version
      ? { state: "detected", detail: firstLine(version) }
      : { state: "absent", detail: "The 'code' command was not found on PATH." };
  },
  async status() {
    let listing: string;
    try {
      listing = await runAgentCommand("code", ["--list-extensions"]);
    } catch {
      // An unavailable VS Code CLI keeps --agents and --doctor usable; the
      // integration state is simply unknown rather than a failed command.
      return { state: "not-installed" as const, detail: "The 'code' command is not available; the state is unknown." };
    }
    const installed = listing.split(/\r?\n/).some(id => id.trim() === VSCODE_EXTENSION_ID);
    return installed
      ? { state: "installed" as const, detail: `Extension ${VSCODE_EXTENSION_ID} is installed.` }
      : { state: "not-installed" as const, detail: `Extension ${VSCODE_EXTENSION_ID} is not installed.` };
  },
  async install() {
    const vsix = findVsix();
    if (!vsix) {
      throw new Error(
        "No CodeTour .vsix was found in the current directory or next to the CLI. " +
        "Package one with 'npm run package' or point CODETOUR_VSIX at it."
      );
    }
    console.log(await runAgentCommand("code", ["--install-extension", vsix]));
    const status = await this.status();
    if (status.state !== "installed") {
      throw new Error(`Visual Studio Code did not report ${VSCODE_EXTENSION_ID} after installation.`);
    }
  },
  async uninstall() {
    const status = await this.status();
    if (status.state === "not-installed") {
      console.log(`Extension ${VSCODE_EXTENSION_ID} is not installed; nothing to remove.`);
      return;
    }
    console.log(await runAgentCommand("code", ["--uninstall-extension", VSCODE_EXTENSION_ID]));
  }
};

export const agentIntegrations: AgentIntegration[] = [copilotIntegration, vscodeIntegration];

export function agentIds(): string {
  return agentIntegrations.map(integration => integration.id).join(", ");
}

export function findAgentIntegration(id: string): AgentIntegration {
  const integration = agentIntegrations.find(candidate => candidate.id === id);
  if (!integration) {
    throw new Error(
      `Unsupported agent: ${id}. Available agents: ${agentIntegrations.map(candidate => candidate.id).join(", ")}.`
    );
  }
  return integration;
}

export async function listAgents(): Promise<void> {
  for (const integration of agentIntegrations) {
    const detection = await integration.detect();
    const status = await integration.status();
    console.log(`${integration.id}\t${integration.displayName}`);
    console.log(`  ${detection.state === "detected" ? `detected (${detection.detail})` : detection.detail}`);
    console.log(`  ${status.state}: ${status.detail}`);
  }
}

export async function doctor(): Promise<void> {
  const git = spawnSync("git", ["--version"], { encoding: "utf8", windowsHide: true });
  console.log(git.status === 0 ? `OK: ${firstLine(git.stdout)}` : "Missing: git is not available on PATH.");
  for (const integration of agentIntegrations) {
    const detection = await integration.detect();
    const status = await integration.status();
    console.log(`${integration.id}: ${detection.state} (${detection.detail}); integration ${status.state}. ${status.detail}`);
  }
}
