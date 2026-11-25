import { execFile, spawnSync } from "child_process";
import { promises as fs, readdirSync, existsSync } from "fs";
import * as os from "os";
import * as path from "path";
import {
  LEGACY_COPILOT_PLUGIN_FILES,
  LEGACY_RUN_LOG_DIRECTORY,
  LegacySurfaceScan,
  RemovalOutcome,
  isLegacyCodetourMcpEntry,
  isLegacyPiLauncher,
  removeLegacyCopilotExtension,
  removeLegacyRunStates,
  scanLegacyCopilotExtension,
  scanLegacyRunStates
} from "./agentMigration";
import { COPILOT_PLUGIN_FILES } from "./copilot-plugin.generated";
import { PI_PLUGIN_FILES } from "./pi-plugin.generated";

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

/**
 * What `--agents` and `--doctor` report for one agent: the host is `absent`
 * (its command is not installed), `incompatible` (it is installed but cannot
 * host this integration), or the installation state of the integration
 * itself. Each state carries one line of detail saying what is wrong and what
 * to run. Spec #320, decision §5.
 */
export type AgentState =
  | "absent"
  | "incompatible"
  | "not-installed"
  | "installed"
  | "outdated"
  | "incomplete";

export interface AgentReport {
  id: string;
  displayName: string;
  state: AgentState;
  detail: string;
}

export interface AgentIntegration {
  id: string;
  displayName: string;
  /**
   * This host generates Tours from the CodeTour skill in this delivery, so the
   * interactive picker offers it. The VS Code extension is a reader
   * integration: `--install vscode` still names it explicitly.
   */
  supportsGeneration: boolean;
  detect(): Promise<DetectionResult>;
  status(): Promise<InstallationStatus>;
  install(): Promise<void>;
  uninstall(): Promise<void>;
  /**
   * Why this detected host cannot host the integration (too old, unsupported
   * surface, no distributable extension on this machine), or `undefined` when
   * it can. A detected agent whose prerequisite is missing is skipped with its
   * reason instead of failing the other agents' installation.
   */
  prerequisite?(detection: DetectionResult): Promise<string | undefined>;
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

function copilotHome(): string {
  return process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
}

function copilotExtensionDirectory(): string {
  // COPILOT_HOME relocates the whole user directory, so it wins over the
  // default home; the explicit override exists for tests and unusual layouts.
  return process.env.CODETOUR_COPILOT_EXTENSIONS_DIR ||
    path.join(copilotHome(), "extensions", "codetour");
}

// The standalone Knowledge skill is retired: the Agent Plugins 1.0 plugin is
// the only CodeTour guidance Copilot loads (plugin skill and agentStop hook).
// An install or uninstall removes a directory an older CLI wrote under the
// Copilot user directory so two conflicting CodeTour skills cannot coexist;
// every other skill there belongs to someone else.
async function removeRetiredKnowledgeSkill(): Promise<string | undefined> {
  const skillDirectory = path.join(copilotHome(), "skills", "codetour-knowledge");
  try {
    await fs.stat(skillDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  await fs.rm(skillDirectory, { recursive: true, force: true });
  return skillDirectory;
}

// The Agent Plugins 1.0 plugin carries the CodeTour skill and the agentStop
// hook, and no server of any kind. Production installs go through
// `copilot plugin install` so the CLI owns the cache and metadata; tests and
// unusual layouts can write the same embedded files into a managed directory
// instead.
const COPILOT_PLUGIN_NAME = "codetour";

function copilotPluginOverride(): string | undefined {
  return process.env.CODETOUR_COPILOT_PLUGIN_DIR;
}

interface CopilotConfig {
  installedPlugins?: Array<{ name?: string; version?: string; cache_path?: string }>;
  [key: string]: unknown;
}

// Copilot's config.json is JSON with leading `//` comment lines; strip only
// whole-line comments before parsing so the metadata stays readable.
function parseCopilotConfig(raw: string): CopilotConfig {
  const withoutComments = raw
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith("//"))
    .join("\n");
  return JSON.parse(withoutComments) as CopilotConfig;
}

async function readCopilotConfig(): Promise<CopilotConfig | undefined> {
  try {
    return parseCopilotConfig(await fs.readFile(path.join(copilotHome(), "config.json"), "utf8"));
  } catch {
    return undefined;
  }
}

async function installedCopilotPlugin(): Promise<{ version?: string; cachePath?: string } | undefined> {
  const config = await readCopilotConfig();
  const entry = config?.installedPlugins?.find(plugin => plugin.name === COPILOT_PLUGIN_NAME);
  if (!entry) return undefined;
  return { version: entry.version, cachePath: entry.cache_path };
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

interface CopilotMcpConfig {
  mcpServers?: Record<string, CopilotMcpServer>;
  [key: string]: unknown;
}

function copilotMcpConfigPath(): string {
  // Copilot reads its user MCP servers from this file; COPILOT_HOME relocates
  // the whole user directory, so honor it before the explicit override.
  return process.env.CODETOUR_COPILOT_MCP_CONFIG || path.join(copilotHome(), "mcp-config.json");
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

// Ownership of the retired MCP registration: the entry an older CodeTour CLI
// wrote, identified by the frozen literal shapes in agentMigration.ts. The
// writers that produced them are gone, so nothing here is compared against a
// live launcher.
const isCodetourMcpEntry = isLegacyCodetourMcpEntry;

interface FileState {
  name: string;
  // `legacy` is a file an older release wrote and this release replaces or
  // removes: still ours, never a user edit.
  state: "current" | "legacy" | "modified" | "missing";
}

// Read a managed file for the rollback snapshot. Only a missing file is
// `undefined`; an unreadable file stops the install before its first write
// instead of being recorded as "did not exist" and deleted by a rollback.
async function readManagedFile(target: string): Promise<string | undefined> {
  try {
    return await fs.readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

// The launcher an installed agent package records so a session uses the CLI
// that performed the install instead of whatever `codetour` happens to be on
// PATH. A Node-hosted CLI (npm bin, development build, standalone launcher) is
// addressed through its runtime and absolute script path; a native executable
// through itself.
//
// The script comes from the entry marker the CLI publishes (see index.ts), not
// from `process.argv[1]`: an embedder that imports this module is not the CLI,
// and probing its own script would run it again. Without the marker the
// documented portable command is recorded, and `verifyLauncher` has nothing to
// prove.
function codetourLauncher(): { command: string; args: string[] } {
  const entry = process.env.CODETOUR_CLI_ENTRY;
  const script = entry ? path.resolve(entry) : undefined;
  // A published entry that is not a script file describes no launchable CLI:
  // the portable command is the honest record.
  if (script && /\.(?:c|m)?js$/i.test(script) && existsSync(script)) {
    return { command: process.execPath, args: [script] };
  }
  // An unidentifiable runtime keeps the documented portable command: the
  // launcher is then too generic to be verified from here.
  return { command: "codetour", args: [] };
}

function isPortableLauncher(launcher: { command: string; args: string[] }): boolean {
  return launcher.command === "codetour" && launcher.args.length === 0;
}

function verifyLauncher(agent: string): void {
  const launcher = codetourLauncher();
  // Nothing was observed about this process, so there is nothing to prove; the
  // portable command is verified by the session that runs it.
  if (isPortableLauncher(launcher)) return;
  // `--help` is the one invocation every CodeTour CLI answers with exit 0
  // since the standalone release: it proves the recorded runtime and script
  // start together, without creating anything.
  const probe = spawnSync(launcher.command, [...launcher.args, "--help"], {
    encoding: "utf8", windowsHide: true, timeout: 15000
  });
  if (probe.status !== 0) {
    const detail = (probe.stderr || probe.error?.message || "").trim();
    throw new Error(
      `The CodeTour launch contract could not be verified ('${[launcher.command, ...launcher.args].join(" ")}'). ` +
      (detail ? `${detail} ` : "") +
      `Keep the CLI at this path, or re-run 'codetour --install ${agent}' from the installation to use.`
    );
  }
}

function expectedPluginFiles(): Readonly<Record<string, string>> {
  return COPILOT_PLUGIN_FILES;
}

// Files of the retired release that may still sit in the plugin cache. They are
// CodeTour's, but the host owns the cache: `copilot plugin uninstall` removes
// them, so they neither block an uninstall nor count as a foreign file.
async function legacyPluginFiles(directory: string | undefined): Promise<string[]> {
  if (!directory) return [];
  const present: string[] = [];
  for (const name of LEGACY_COPILOT_PLUGIN_FILES) {
    if (await fs.readFile(path.join(directory, name), "utf8").catch(() => undefined) !== undefined) {
      present.push(name);
    }
  }
  return present;
}

// The plugin files are embedded with POSIX relative paths so one map works on
// every platform; `path.join` only translates separators at the filesystem
// boundary.
async function pluginFileStates(directory: string | undefined): Promise<FileState[]> {
  const states: FileState[] = [];
  if (!directory) return Object.keys(expectedPluginFiles()).map(name => ({ name, state: "missing" as const }));
  for (const [name, content] of Object.entries(expectedPluginFiles())) {
    const target = path.join(directory, ...name.split("/"));
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

async function readManagedFiles(
  directory: string | undefined
): Promise<Map<string, string | undefined>> {
  const previous = new Map<string, string | undefined>();
  if (!directory) return previous;
  for (const name of Object.keys(expectedPluginFiles())) {
    previous.set(name, await readManagedFile(path.join(directory, ...name.split("/"))));
  }
  return previous;
}

async function restoreManagedFiles(
  directory: string,
  previous: Map<string, string | undefined>
): Promise<string[]> {
  const unrestored: string[] = [];
  for (const [name, content] of previous) {
    const target = path.join(directory, ...name.split("/"));
    try {
      if (content === undefined) {
        await fs.rm(target, { force: true });
      } else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, "utf8");
      }
    } catch {
      unrestored.push(name);
    }
  }
  return unrestored;
}

// Write one managed file, unless it already holds exactly this content: a
// reinstall that changes nothing must not touch the filesystem, and the
// content is the proof of ownership. Returns whether anything was written.
async function writeIfChanged(target: string, content: string): Promise<boolean> {
  const existing = await fs.readFile(target, "utf8").catch(() => undefined);
  if (existing === content) return false;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  if (await fs.readFile(target, "utf8") !== content) {
    throw new Error(`Could not verify ${target} after installation.`);
  }
  return true;
}

async function writeManagedFiles(directory: string): Promise<void> {
  for (const [name, content] of Object.entries(expectedPluginFiles())) {
    await writeIfChanged(path.join(directory, ...name.split("/")), content);
  }
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCommand(executable: string, args: string[], timeout = 120000): Promise<CommandResult> {
  return new Promise(resolve => {
    execFile(executable, args, { encoding: "utf8", windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const status = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        const detail = error && typeof error.code === "string" ? error.message : stderr || "";
        resolve({ status, stdout: stdout || "", stderr: detail });
      });
  });
}

// Files inside the plugin cache that this CLI did not install. The cache is
// Copilot-managed, but a user may have added notes or patches there; both a
// replace and an uninstall must refuse rather than delete them. The MCP
// declaration of the retired release is CodeTour's, so it never counts here.
async function pluginForeignFiles(directory: string | undefined): Promise<string[]> {
  if (!directory) return [];
  const expected = new Set([
    ...Object.keys(expectedPluginFiles()),
    ...LEGACY_COPILOT_PLUGIN_FILES
  ]);
  const foreign: string[] = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), relative);
      else if (!expected.has(relative)) foreign.push(relative);
    }
  };
  await walk(directory, "");
  return foreign;
}

async function assertPluginCacheOwned(directory: string | undefined): Promise<void> {
  const foreign = await pluginForeignFiles(directory);
  if (foreign.length) {
    throw new Error(
      `${foreign.join(", ")} in ${directory} were not installed by this CLI and were left untouched. ` +
      "Remove them yourself before reinstalling or uninstalling the plugin."
    );
  }
}

// Install the plugin through Copilot's own plugin manager. Returns whether the
// Copilot-managed cache changed: a plugin whose files are all current is left
// in place, so a reinstall that changes nothing does not churn the cache.
async function installCopilotPlugin(): Promise<boolean> {
  const existing = await installedCopilotPlugin();
  if (existing) {
    const states = await pluginFileStates(existing.cachePath);
    const retired = await legacyPluginFiles(existing.cachePath);
    if (existing.cachePath && states.every(file => file.state === "current") && retired.length === 0) {
      return false;
    }
  }
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "codetour-plugin-"));
  try {
    await writeManagedFiles(staging);
    if (existing) {
      // A reinstall replaces the previous plugin (the documented upgrade
      // path); an uninstall preserves extra files instead.
      const removed = await runCommand("copilot", ["plugin", "uninstall", COPILOT_PLUGIN_NAME]);
      if (removed.status !== 0) {
        throw new Error(
          `Copilot could not replace the installed '${COPILOT_PLUGIN_NAME}' plugin: ${(removed.stderr || removed.stdout).trim()}`
        );
      }
    }
    const installed = await runCommand("copilot", ["plugin", "install", staging]);
    if (installed.status !== 0) {
      throw new Error(
        `Copilot did not install the CodeTour plugin: ${(installed.stderr || installed.stdout).trim() || `exit ${installed.status}`}. ` +
        "Make sure 'copilot' is installed and on PATH."
      );
    }
    const after = await installedCopilotPlugin();
    if (!after) {
      throw new Error("Copilot reported a successful install but lists no 'codetour' plugin.");
    }
    return true;
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function removeCopilotPlugin(force = false): Promise<void> {
  const existing = await installedCopilotPlugin();
  if (!existing) return;
  if (!force && existing.cachePath) {
    await assertPluginCacheOwned(existing.cachePath);
    const states = await pluginFileStates(existing.cachePath);
    const foreign = states.filter(file => file.state === "modified").map(file => file.name);
    // The retired MCP declaration is removed by `copilot plugin uninstall` with
    // the rest of the cache, so it is never a reason to refuse.
    const retired = new Set(LEGACY_COPILOT_PLUGIN_FILES);
    const blocked = foreign.filter(name => !retired.has(name));
    if (blocked.length) {
      throw new Error(
        `${blocked.join(", ")} in ${existing.cachePath} differ from this installation and were left untouched. ` +
        "Only files this CLI owns are removed; remove the plugin with 'copilot plugin uninstall codetour' if you accept losing those edits."
      );
    }
  }
  const removed = await runCommand("copilot", ["plugin", "uninstall", COPILOT_PLUGIN_NAME]);
  if (removed.status !== 0 && !force) {
    throw new Error(
      `Copilot could not uninstall the '${COPILOT_PLUGIN_NAME}' plugin: ${(removed.stderr || removed.stdout).trim()}`
    );
  }
}

// What the user configuration says about the retired server, for the migration
// report: absent, ours (either frozen launch shape) or a same-named server this
// CLI cannot prove it wrote.
type LegacyRegistrationState =
  | { state: "absent" }
  | { state: "owned" }
  | { state: "foreign"; entry: unknown; unreadable?: undefined }
  | { state: "unreadable"; unreadable: string };

async function legacyRegistrationState(mcpFile: string): Promise<LegacyRegistrationState> {
  let config: CopilotMcpConfig;
  try {
    config = await readCopilotMcpConfig(mcpFile);
  } catch (error) {
    return { state: "unreadable", unreadable: error instanceof Error ? error.message : String(error) };
  }
  const entry = config.mcpServers?.codetour;
  if (entry === undefined) return { state: "absent" };
  return isCodetourMcpEntry(entry) ? { state: "owned" } : { state: "foreign", entry };
}

// The retired registration is removed only when it matches a frozen launch
// shape of an older CodeTour CLI. Every other server, same name or not, is user
// configuration: it is reported with the manual removal instruction and kept.
async function removeLegacyCodetourMcpRegistration(): Promise<string[]> {
  const mcpFile = copilotMcpConfigPath();
  const found = await legacyRegistrationState(mcpFile);
  if (found.state === "unreadable") {
    return [`Left ${mcpFile} untouched: ${found.unreadable}`];
  }
  if (found.state === "foreign") {
    return [
      `Preserved the 'codetour' server in ${mcpFile}: this CLI did not write it. ` +
      "Remove the 'codetour' entry from its mcpServers yourself if it points at a file this release no longer ships."
    ];
  }
  if (found.state === "absent") return [];
  const config = await readCopilotMcpConfig(mcpFile);
  delete config.mcpServers!.codetour;
  await writeCopilotMcpConfig(mcpFile, config);
  return [`Removed the retired 'codetour' MCP server from ${mcpFile}.`];
}

function reportMigration(outcome: RemovalOutcome): void {
  for (const file of outcome.removed) console.log(`Removed the retired CodeTour file ${file}.`);
  for (const file of outcome.preserved) {
    console.log(
      `Preserved ${file}: it does not match the release this CLI retires, so it is yours to remove.`
    );
  }
}

/**
 * Remove what this release retires and CodeTour can prove it owns. Both
 * `--install` and `--uninstall` of either generation agent carry it, so an
 * upgraded machine never keeps a launch command for a server that is gone: the
 * Copilot adapter directory of the previous release, the `codetour` MCP entry
 * of a user configuration matching a frozen launch shape, and the guarded run
 * states of the workspace this command runs in. Everything else is reported and
 * preserved (DESIGN §11).
 */
async function migrateRetiredSurfaces(): Promise<void> {
  for (const line of await removeLegacyCodetourMcpRegistration()) console.log(line);
  const outcome: RemovalOutcome = { removed: [], preserved: [] };
  const collect = (other: RemovalOutcome) => {
    outcome.removed.push(...other.removed);
    outcome.preserved.push(...other.preserved);
  };
  collect(await removeLegacyCopilotExtension(copilotExtensionDirectory()));
  collect(await removeLegacyRunStates(path.join(process.cwd(), LEGACY_RUN_LOG_DIRECTORY)));
  reportMigration(outcome);
}

// The plugin is installed through `copilot plugin install`, so only a Copilot
// CLI that ships the `plugin` command can host this integration. Asking the
// host for that command answers "too old or unsupported" without this CLI
// inventing a version floor.
async function copilotSupportsPlugins(): Promise<boolean> {
  return (await execFileAsync("copilot", ["plugin", "--help"])) !== undefined;
}

const copilotIntegration: AgentIntegration = {
  id: "copilot",
  displayName: "GitHub Copilot CLI",
  supportsGeneration: true,
  async detect() {
    const version = await execFileAsync("copilot", ["--version"]);
    return version
      ? { state: "detected", detail: firstLine(version) }
      : { state: "absent", detail: "The 'copilot' command was not found on PATH." };
  },
  async status() {
    // The plugin lives outside the retired adapter directory and is reported
    // with its own ownership states.
    const override = copilotPluginOverride();
    const installed = await installedCopilotPlugin();
    const pluginRoot = override || installed?.cachePath;
    const pluginStates = await pluginFileStates(pluginRoot);
    // An override directory that is absent, or a cache path whose files were
    // all removed, is a missing plugin, not an outdated one.
    const pluginPresent = Boolean(pluginRoot) && pluginStates.some(file => file.state !== "missing");
    const pluginCurrent = pluginPresent && pluginStates.every(file => file.state === "current");
    const pluginChanged = pluginStates.filter(file => file.state !== "current").map(file => file.name);
    const retiredInPlugin = await legacyPluginFiles(pluginRoot);
    const location = pluginRoot ? ` in ${pluginRoot}` : "";
    const mcpFile = copilotMcpConfigPath();
    const registration = await legacyRegistrationState(mcpFile);
    const unreadable = registration.state === "unreadable" ? registration.unreadable : undefined;
    const foreign = registration.state === "foreign";
    const foreignNote = foreign
      ? ` A same-named 'codetour' server in ${mcpFile} was configured by someone else and is preserved; remove it yourself.`
      : "";
    const migratedNote = registration.state === "owned"
      ? ` The retired 'codetour' MCP server this CLI registered is still in ${mcpFile}. ` +
        "Re-run 'codetour --install copilot' to remove it."
      : "";
    if (pluginCurrent && retiredInPlugin.length === 0) {
      if (registration.state === "owned") {
        return { state: "outdated" as const, detail: `The CodeTour plugin is installed${location}.${migratedNote}` };
      }
      return {
        state: "installed" as const,
        detail: `The CodeTour plugin is installed${location}. ` +
          `It carries the generation skill and the informative agentStop hook, and no server.${foreignNote}`
      };
    }
    if (pluginCurrent) {
      return {
        state: "outdated" as const,
        detail: `The CodeTour plugin${location} still carries the retired MCP declaration (${retiredInPlugin.join(", ")}). ` +
          "Re-run 'codetour --install copilot' to replace it."
      };
    }
    if (!pluginPresent) {
      return {
        state: "not-installed" as const,
        detail: unreadable
          ? `No CodeTour plugin installed, and ${unreadable}`
          : `No CodeTour plugin${location ? ` in ${pluginRoot}` : ""} installed. ` +
            "Run 'codetour --install copilot' to install it." +
            (registration.state === "owned" ? ` ${mcpFile} still declares the retired 'codetour' server.` : "")
      };
    }
    return {
      state: "outdated" as const,
      detail: `The CodeTour plugin${location} differs from this CLI (${pluginChanged.join(", ")}). ` +
        "Re-run 'codetour --install copilot' to replace it."
    };
  },
  async install() {
    // The plugin is installed through Copilot's own manager, so the host can
    // replace the retired declaration with the current files in one step. A
    // managed override directory is written directly instead.
    const override = copilotPluginOverride();
    const previousPlugin = await readManagedFiles(override);
    const pluginStatesBefore = await pluginFileStates(override);
    const pluginDiffering = pluginStatesBefore.filter(file => file.state === "modified").map(file => file.name);
    // Whether this run left a plugin behind that a rollback must remove.
    let pluginInstalledByThisRun = false;
    let pluginChanged = false;
    let retiredSkillDirectory: string | undefined;
    try {
      if (override) {
        const statesBefore = await pluginFileStates(override);
        await fs.mkdir(override, { recursive: true });
        await writeManagedFiles(override);
        pluginChanged = statesBefore.some(file => file.state !== "current");
        // The override directory is managed by this CLI: the retired
        // declaration of an older install goes with the files it replaces.
        for (const name of await legacyPluginFiles(override)) {
          await fs.rm(path.join(override, name), { force: true });
          pluginChanged = true;
        }
      } else {
        const created = !(await installedCopilotPlugin());
        pluginChanged = await installCopilotPlugin();
        pluginInstalledByThisRun = created && pluginChanged;
      }
      retiredSkillDirectory = await removeRetiredKnowledgeSkill();
    } catch (error) {
      const unrestored: string[] = [];
      if (override) {
        unrestored.push(...await restoreManagedFiles(override, previousPlugin));
      } else if (pluginInstalledByThisRun) {
        await removeCopilotPlugin(true).catch(() => undefined);
      }
      if (unrestored.length) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} ` +
          `The previous integration files could not be fully restored (${unrestored.join(", ")}); ` +
          "re-run 'codetour --install copilot' once the cause is fixed."
        );
      }
      throw error;
    }
    if (retiredSkillDirectory) {
      console.log(`Removed the retired standalone Knowledge skill from ${retiredSkillDirectory}.`);
    }
    if (pluginDiffering.length) {
      console.log(`Replaced differing plugin files (${pluginDiffering.join(", ")}).`);
    }
    const pluginLocation = override || await installedCopilotPlugin().then(plugin => plugin?.cachePath);
    console.log(
      pluginChanged
        ? `Installed the CodeTour plugin${pluginLocation ? ` in ${pluginLocation}` : ""}.`
        : `The CodeTour plugin${pluginLocation ? ` in ${pluginLocation}` : ""} is already current.`
    );
    console.log("Run 'copilot plugin list' to confirm the 'codetour' plugin, and 'copilot skill list' for its skill.");
    // The retired adapter, registration and run states are ours; anything else
    // in those directories is reported and left in place.
    await migrateRetiredSurfaces();
    console.log("Start 'copilot --experimental' in a trusted Git worktree, accept the extension");
    console.log("(Load Only or Load & Augment), then run /codetour to read or generate a Tour.");
    console.log("Generation runs the CodeTour CLI from the plugin's skill: no server is registered.");
  },
  async prerequisite(detection) {
    // A managed override writes the plugin files directly; every other path
    // goes through `copilot plugin install`, which needs the CLI.
    if (copilotPluginOverride()) return undefined;
    if (detection.state !== "detected") return detection.detail;
    if (!await copilotSupportsPlugins()) {
      return "The installed GitHub Copilot CLI has no 'plugin' command, so it cannot host the CodeTour plugin. " +
        "Update it ('copilot update'), then run 'codetour --install copilot'.";
    }
    return undefined;
  },
  async uninstall() {
    // Remove the plugin first: a failure here must not leave a half-removed
    // integration behind.
    const override = copilotPluginOverride();
    if (override) {
      const pluginStates = await pluginFileStates(override);
      const preserved = pluginStates.filter(file => file.state === "modified").map(file => file.name);
      for (const file of pluginStates) {
        if (file.state === "current") {
          await fs.rm(path.join(override, ...file.name.split("/")), { force: true });
        }
      }
      for (const name of await legacyPluginFiles(override)) {
        await fs.rm(path.join(override, name), { force: true });
      }
      if (preserved.length) {
        console.log(`Left ${preserved.join(", ")} in ${override} untouched: they differ from the plugin this CLI installed.`);
      } else {
        // Remove the directories the uninstall emptied, deepest first: an empty
        // skeleton would make the next `status()` report a half-installed
        // plugin, exactly like the Pi package.
        await pruneEmptyDirectories(override);
        console.log(`Removed the CodeTour plugin from ${override}.`);
      }
    } else if (await installedCopilotPlugin()) {
      await removeCopilotPlugin();
      console.log("Uninstalled the CodeTour plugin.");
    }
    // The retired standalone Knowledge skill is removed with the rest of the
    // integration; other skills in the shared directory are untouched.
    const retiredSkillDirectory = await removeRetiredKnowledgeSkill();
    if (retiredSkillDirectory) {
      console.log(`Removed the retired standalone Knowledge skill from ${retiredSkillDirectory}.`);
    }
    await migrateRetiredSurfaces();
  }
};

// ---------------------------------------------------------------------------
// Pi coding agent (spec #236).
//
// Pi has no plugin format of its own: an integration is a Pi package (a
// `package.json` with `pi.extensions` / `pi.skills`) declared in the user
// settings. The install writes that package into a managed directory and adds
// its absolute path to `packages[]`, so Pi and `status()` agree on one
// identity. The generated `launcher.json` records the CLI that performed the
// install, exactly like the Copilot plugin's `mcp.json` launcher: a session
// must not be served by whatever `codetour` happens to be on PATH.
// ---------------------------------------------------------------------------

function piAgentDirectory(): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

function piPluginDirectory(): string {
  return process.env.CODETOUR_PI_PLUGIN_DIR || path.join(piAgentDirectory(), "packages", "codetour-plugin");
}

function piSettingsPath(): string {
  // PI_CODING_AGENT_DIR relocates the whole agent directory; the explicit
  // override exists for tests and unusual layouts.
  return process.env.CODETOUR_PI_SETTINGS || path.join(piAgentDirectory(), "settings.json");
}

function piLauncherFile(): { command: string; args: string[] } {
  // The skill runs the recorded CLI with top-level subcommands; the launcher
  // names only the runtime and, for a script CLI, its absolute path.
  return codetourLauncher();
}

function expectedPiPluginFiles(): Record<string, string> {
  return {
    ...PI_PLUGIN_FILES,
    "launcher.json": `${JSON.stringify(piLauncherFile(), null, 2)}\n`,
  };
}

/**
 * The launcher of an older release recorded the retired `mcp` subcommand. It
 * is still this CLI's file — the install rewrites it and the uninstall removes
 * it — so it is neither `current` nor a user edit.
 */
function isLegacyPiLauncherFile(name: string, content: string): boolean {
  return name === "launcher.json" && isLegacyPiLauncher(content);
}

async function piFileStates(directory: string): Promise<FileState[]> {
  const states: FileState[] = [];
  for (const [name, content] of Object.entries(expectedPiPluginFiles())) {
    const target = path.join(directory, ...name.split("/"));
    try {
      const existing = await fs.readFile(target, "utf8");
      const state = existing === content
        ? "current" as const
        : isLegacyPiLauncherFile(name, existing) ? "legacy" as const : "modified" as const;
      states.push({ name, state });
    } catch {
      states.push({ name, state: "missing" });
    }
  }
  return states;
}

interface PiSettings {
  packages?: unknown;
  [key: string]: unknown;
}

async function readPiSettings(file: string): Promise<PiSettings> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    // Only a missing file means "no user settings yet": the install creates
    // its own. A permission error or a directory at that path must not be
    // silently replaced by an empty configuration.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(
      `Could not read ${file} (${error instanceof Error ? error.message : String(error)}). ` +
      "Fix its path or permissions and run the command again; the file was left untouched so no configured package is lost."
    );
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as PiSettings;
  } catch {
    throw new Error(
      `${file} is not a JSON object; fix it before installing so no existing Pi package is lost.`
    );
  }
}

async function writePiSettings(file: string, settings: PiSettings): Promise<void> {
  // A settings file that already holds this declaration and nothing else this
  // install changes is left byte for byte in place.
  const content = `${JSON.stringify(settings, null, 2)}\n`;
  try {
    if (await fs.readFile(file, "utf8").catch(() => undefined) === content) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf8");
  } catch (error) {
    throw new Error(
      `Could not write ${file} (${error instanceof Error ? error.message : String(error)}). ` +
      "Fix its path or permissions and run the command again."
    );
  }
}

// A `packages` entry is either a source string or an object with a `source`
// field. Only the exact absolute path this CLI manages counts as "declared":
// an npm or git source with the same name is someone else's package.
function piPackageSources(settings: PiSettings): string[] {
  if (!Array.isArray(settings.packages)) return [];
  return settings.packages.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (typeof entry === "object" && entry !== null) {
      const source = (entry as { source?: unknown }).source;
      if (typeof source === "string") return [source];
    }
    return [];
  });
}

function declaresPiPackage(settings: PiSettings, directory: string): boolean {
  const target = path.resolve(directory);
  return piPackageSources(settings).some((source) => {
    if (!path.isAbsolute(source)) return false;
    return path.resolve(source) === target;
  });
}

function withPiPackage(settings: PiSettings, directory: string): PiSettings {
  if (declaresPiPackage(settings, directory)) return settings;
  const packages = Array.isArray(settings.packages) ? [...settings.packages] : [];
  packages.push(path.resolve(directory));
  return { ...settings, packages };
}

function withoutPiPackage(settings: PiSettings, directory: string): PiSettings {
  if (!Array.isArray(settings.packages)) return settings;
  const target = path.resolve(directory);
  const packages = settings.packages.filter((entry) => {
    if (typeof entry === "string") {
      return !(path.isAbsolute(entry) && path.resolve(entry) === target);
    }
    if (typeof entry === "object" && entry !== null) {
      const source = (entry as { source?: unknown }).source;
      if (typeof source === "string" && path.isAbsolute(source)) {
        return path.resolve(source) !== target;
      }
    }
    return true;
  });
  return { ...settings, packages };
}

// Files in the managed package directory that this CLI did not write. The
// directory belongs to Pi, but a user may have added notes or patches there: an
// uninstall refuses rather than deleting them.
async function piForeignFiles(directory: string): Promise<string[]> {
  const expected = new Set(Object.keys(expectedPiPluginFiles()));
  const foreign: string[] = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), relative);
      else if (!expected.has(relative)) foreign.push(relative);
    }
  };
  await walk(directory, "");
  return foreign;
}

// Remove the directories an uninstall emptied, deepest first: leaving an empty
// skeleton behind makes the next `status()` report a half-installed package.
async function pruneEmptyDirectories(directory: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) await pruneEmptyDirectories(path.join(directory, entry.name));
  }
  const remaining = await fs.readdir(directory).catch(() => [] as string[]);
  if (!remaining.length) await fs.rmdir(directory).catch(() => undefined);
}

async function writePiManagedFiles(directory: string): Promise<void> {
  for (const [name, content] of Object.entries(expectedPiPluginFiles())) {
    await writeIfChanged(path.join(directory, ...name.split("/")), content);
  }
}

const piIntegration: AgentIntegration = {
  id: "pi",
  displayName: "Pi coding agent",
  supportsGeneration: true,
  async detect() {
    const version = await execFileAsync("pi", ["--version"]);
    return version
      ? { state: "detected", detail: firstLine(version) }
      : { state: "absent", detail: "The 'pi' command was not found on PATH." };
  },
  async status() {
    const directory = piPluginDirectory();
    const settingsFile = piSettingsPath();
    const states = await piFileStates(directory);
    const changed = states.filter((file) => file.state !== "current").map((file) => file.name);
    let declared: boolean;
    try {
      declared = declaresPiPackage(await readPiSettings(settingsFile), directory);
    } catch (error) {
      return {
        state: "incomplete" as const,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    if (states.every((file) => file.state === "missing") && !declared) {
      return {
        state: "not-installed" as const,
        detail: `No CodeTour package in ${directory} and no declaration in ${settingsFile}. ` +
          "Run 'codetour --install pi' to install both.",
      };
    }
    if (declared && states.every((file) => file.state === "current")) {
      return {
        state: "installed" as const,
        detail: `The CodeTour package is installed in ${directory} and declared in ${settingsFile}.`,
      };
    }
    if (declared) {
      return {
        state: "incomplete" as const,
        detail:
          `The CodeTour package is declared in ${settingsFile} but ` +
          `(${changed.join(", ")}) is missing from or differs in ${directory}. ` +
          "Re-run 'codetour --install pi'.",
      };
    }
    return {
      state: "outdated" as const,
      detail:
        `The CodeTour package in ${directory} differs from this CLI (${changed.join(", ")}) ` +
        `or is not declared in ${settingsFile}. Re-run 'codetour --install pi' to replace it.`,
    };
  },
  async install() {
    const directory = piPluginDirectory();
    const settingsFile = piSettingsPath();
    // Everything that can refuse the install runs before the first write, so a
    // failing settings file never leaves half a package behind.
    const settings = await readPiSettings(settingsFile);
    // Everything that can refuse the install runs before the first write: a
    // recorded launcher that cannot start this CLI would leave the session
    // without a generator.
    verifyLauncher("pi");
    const previousStates = await piFileStates(directory);
    const replaced = previousStates.filter((file) => file.state === "modified").map((file) => file.name);
    const retired = previousStates.filter((file) => file.state === "legacy").map((file) => file.name);
    const previousFiles = new Map<string, string | undefined>();
    for (const name of Object.keys(expectedPiPluginFiles())) {
      const target = path.join(directory, ...name.split("/"));
      previousFiles.set(name, await fs.readFile(target, "utf8").catch(() => undefined));
    }
    try {
      await writePiManagedFiles(directory);
      await writePiSettings(settingsFile, withPiPackage(settings, directory));
    } catch (error) {
      for (const [name, content] of previousFiles) {
        const target = path.join(directory, ...name.split("/"));
        if (content === undefined) await fs.rm(target, { force: true }).catch(() => undefined);
        else await fs.writeFile(target, content, "utf8").catch(() => undefined);
      }
      await writePiSettings(settingsFile, settings).catch(() => undefined);
      throw error;
    }
    if (replaced.length) {
      console.log(`Replaced differing package files (${replaced.join(", ")}) in ${directory}.`);
    }
    if (retired.length) {
      console.log(`Replaced the retired package files (${retired.join(", ")}) in ${directory}.`);
    }
    console.log(`Installed the CodeTour Pi package in ${directory}.`);
    console.log(`Declared it in ${settingsFile} under packages[].`);
    console.log("Run 'pi list' to confirm the package, then '/codetour' in a session to read or generate a Tour.");
    await migrateRetiredSurfaces();
  },
  async uninstall() {
    const directory = piPluginDirectory();
    const settingsFile = piSettingsPath();
    const states = await piFileStates(directory);
    const foreign = [
      ...states.filter((file) => file.state === "modified").map((file) => file.name),
      ...(await piForeignFiles(directory)),
    ];
    if (foreign.length) {
      throw new Error(
        `${foreign.join(", ")} in ${directory} differ from this installation or were not written by it, ` +
        "and were left untouched. Only files this CLI owns are removed; remove them yourself before uninstalling."
      );
    }
    const settings = await readPiSettings(settingsFile);
    // Remove the declaration first: a package that stays declared after its
    // files are gone makes Pi report a failed install at every start.
    await writePiSettings(settingsFile, withoutPiPackage(settings, directory));
    for (const file of states) {
      if (file.state === "current" || file.state === "legacy") {
        await fs.rm(path.join(directory, ...file.name.split("/")), { force: true });
      }
    }
    await pruneEmptyDirectories(directory);
    console.log(`Removed the CodeTour Pi package from ${directory}.`);
    console.log(`Removed its declaration from ${settingsFile}.`);
    await migrateRetiredSurfaces();
  },
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
  supportsGeneration: false,
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
      : {
        state: "not-installed" as const,
        detail: `Extension ${VSCODE_EXTENSION_ID} is not installed. Run 'codetour --install vscode' to install it.`
      };
  },
  async prerequisite(detection) {
    if (detection.state !== "detected") return detection.detail;
    if (!findVsix()) {
      return (
        "No CodeTour .vsix was found in the current directory or next to the CLI. " +
        "Package one with 'npm run package' or point CODETOUR_VSIX at it."
      );
    }
    return undefined;
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

export const agentIntegrations: AgentIntegration[] = [
  copilotIntegration,
  piIntegration,
  vscodeIntegration,
];

export function agentIds(): string {
  return agentIntegrations.map(integration => integration.id).join(", ");
}

export type AgentOutcomeResult =
  | "installed"
  | "already-installed"
  | "uninstalled"
  | "not-installed"
  | "skipped"
  | "failed";

export interface AgentOutcome {
  id: string;
  displayName: string;
  result: AgentOutcomeResult;
  detail?: string;
}

export interface AgentBatchReport {
  outcomes: AgentOutcome[];
  failed: boolean;
}

const ALL_AGENTS = "all";

// `CODETOUR_DISABLE_AGENTS` keeps an agent out of a batch install or uninstall:
// a machine where an agent CLI exists but must not be touched (CI, a shared
// account, a machine served by another build). An explicit `--install <agent>`
// ignores it, because naming the agent is the instruction.
function disabledAgents(): Set<string> {
  return new Set(
    (process.env.CODETOUR_DISABLE_AGENTS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

function selectedIntegrations(id: string | string[] | undefined): AgentIntegration[] {
  if (Array.isArray(id)) return id.map(findAgentIntegration);
  if (id && id !== ALL_AGENTS) return [findAgentIntegration(id)];
  const disabled = disabledAgents();
  return agentIntegrations.filter((integration) => !disabled.has(integration.id));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportOutcomes(outcomes: AgentOutcome[]): void {
  console.log("Agent integrations:");
  for (const outcome of outcomes) {
    const detail = outcome.detail ? ` (${outcome.detail})` : "";
    const line = `  ${outcome.id}: ${outcome.result}${detail}`;
    // A failure is an error, never a note: stdout stays the readable summary,
    // stderr carries what a caller must not miss.
    if (outcome.result === "failed") console.error(line);
    else console.log(line);
  }
}

/**
 * Install the named agents, or with no id every *compatible* agent.
 *
 * Compatibility is "the agent is present and its host can hold the
 * integration": an absent host is skipped with its reason, so a machine
 * without one CLI never blocks the others. A failing agent does not stop the
 * batch either; it is reported, and `failed` tells the caller to exit
 * non-zero. A list of ids (an interactive selection) is as explicit as a
 * single id: each one asked for by name must install.
 */
export async function installAgents(id?: string | string[]): Promise<AgentBatchReport> {
  const outcomes: AgentOutcome[] = [];
  const explicit = Array.isArray(id) || Boolean(id && id !== ALL_AGENTS);
  for (const integration of selectedIntegrations(id)) {
    const base = { id: integration.id, displayName: integration.displayName };
    try {
      // A batch installs the agents this machine actually uses; naming an
      // agent is the instruction, so its missing prerequisite is a failure.
      const detection = await integration.detect();
      if (!explicit && detection.state !== "detected") {
        outcomes.push({ ...base, result: "skipped", detail: detection.detail });
        continue;
      }
      const reason = await integration.prerequisite?.(detection);
      if (reason) {
        outcomes.push({ ...base, result: explicit ? "failed" : "skipped", detail: reason });
        continue;
      }
      const status = await integration.status();
      if (status.state === "installed") {
        outcomes.push({ ...base, result: "already-installed", detail: status.detail });
        continue;
      }
      await integration.install();
      outcomes.push({ ...base, result: "installed" });
    } catch (error) {
      outcomes.push({ ...base, result: "failed", detail: messageOf(error) });
    }
  }
  reportOutcomes(outcomes);
  return { outcomes, failed: outcomes.some((outcome) => outcome.result === "failed") };
}

/**
 * Remove one agent, `all` of them, or (with no id) every agent this CLI can
 * see as installed. Uninstalling does not need the agent CLI to be present:
 * the files and declarations this CLI wrote are removable without it.
 */
export async function uninstallAgents(id?: string | string[]): Promise<AgentBatchReport> {
  const outcomes: AgentOutcome[] = [];
  for (const integration of selectedIntegrations(id)) {
    const base = { id: integration.id, displayName: integration.displayName };
    try {
      const status = await integration.status();
      if (status.state === "not-installed") {
        outcomes.push({ ...base, result: "not-installed", detail: status.detail });
        continue;
      }
      await integration.uninstall();
      outcomes.push({ ...base, result: "uninstalled" });
    } catch (error) {
      outcomes.push({ ...base, result: "failed", detail: messageOf(error) });
    }
  }
  reportOutcomes(outcomes);
  return { outcomes, failed: outcomes.some((outcome) => outcome.result === "failed") };
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

/**
 * What one agent's state is, for `--agents` and `--doctor`: the host's
 * availability first, then the integration's own installation state.
 *
 * An installed integration is reported by its installation state even when
 * its host is missing: the files are still on disk, and the uninstall must
 * still find them.
 */
export async function reportAgent(integration: AgentIntegration): Promise<AgentReport> {
  const base = { id: integration.id, displayName: integration.displayName };
  const detection = await integration.detect();
  const status = await integration.status();
  if (status.state !== "not-installed") return { ...base, state: status.state, detail: status.detail };
  if (detection.state === "absent") {
    return {
      ...base,
      state: "absent",
      detail: `${detection.detail} Install ${integration.displayName}, then run 'codetour --install ${integration.id}'.`
    };
  }
  const reason = await integration.prerequisite?.(detection);
  if (reason) return { ...base, state: "incompatible", detail: reason };
  return { ...base, state: status.state, detail: status.detail };
}

export async function reportAgents(integrations: AgentIntegration[]): Promise<AgentReport[]> {
  const reports: AgentReport[] = [];
  for (const integration of integrations) reports.push(await reportAgent(integration));
  return reports;
}

export async function listAgents(): Promise<void> {
  for (const report of await reportAgents(agentIntegrations)) {
    console.log(`${report.id}\t${report.displayName}`);
    console.log(`  ${report.state}: ${report.detail}`);
  }
}

/**
 * Whether the Codex CLI still carries the `codetour` server an older release of
 * this extension registered for it. CodeTour can no longer reach or repair that
 * configuration — it has no server to register — so `--doctor` reports it and
 * prints the client's own removal command instead of editing the client store.
 */
function codexDeclaresCodetour(): boolean {
  const probe = spawnSync("codex", ["mcp", "get", "codetour"], {
    encoding: "utf8", windowsHide: true, timeout: 10000
  });
  return probe.error === undefined && probe.status === 0;
}

function reportScan(scan: LegacySurfaceScan, ownedHint: string, preservedHint: string): void {
  for (const file of scan.owned) console.log(`retired: ${file}. ${ownedHint}`);
  for (const file of scan.preserved) console.log(`retired: ${file} is preserved. ${preservedHint}`);
}

/**
 * The retired surfaces `--doctor` reports and never edits: what CodeTour cannot
 * prove it wrote, or cannot reach at all (spec #320, DESIGN §11).
 */
async function reportRetiredSurfaces(): Promise<void> {
  const mcpFile = copilotMcpConfigPath();
  const registration = await legacyRegistrationState(mcpFile);
  if (registration.state === "owned") {
    console.log(
      `retired: ${mcpFile} declares the 'codetour' MCP server this release removed; ` +
      "'codetour --install all' or 'codetour --uninstall all' removes the entry this CLI wrote."
    );
  } else if (registration.state === "foreign") {
    console.log(
      `retired: ${mcpFile} declares a 'codetour' MCP server this CLI did not write. It is preserved; ` +
      "remove that mcpServers entry yourself if it points at a file this release no longer ships."
    );
  } else if (registration.state === "unreadable") {
    console.log(`retired: ${registration.unreadable}`);
  }
  reportScan(
    await scanLegacyCopilotExtension(copilotExtensionDirectory()),
    "The MCP-routed Copilot adapter of the previous release: an install or uninstall removes it.",
    "It does not match the adapter this CLI installed, so it is yours to remove."
  );
  reportScan(
    await scanLegacyRunStates(path.join(process.cwd(), LEGACY_RUN_LOG_DIRECTORY)),
    "A guarded run state of the retired agentStop hook: an install or uninstall removes it.",
    "It does not satisfy the retired run-state contract, so it is yours to remove."
  );
  if (codexDeclaresCodetour()) {
    console.log(
      "retired: Codex still declares a 'codetour' MCP server pointing at a file this release no longer ships. " +
      "Remove it with 'codex mcp remove codetour'."
    );
  }
}

export async function doctor(): Promise<void> {
  const git = spawnSync("git", ["--version"], { encoding: "utf8", windowsHide: true });
  console.log(git.status === 0 ? `OK: ${firstLine(git.stdout)}` : "Missing: git is not available on PATH.");
  for (const report of await reportAgents(agentIntegrations)) {
    console.log(`${report.id}: ${report.state}. ${report.detail}`);
  }
  await reportRetiredSurfaces();
}
