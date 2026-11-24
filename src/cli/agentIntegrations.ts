import { execFile, spawnSync } from "child_process";
import { promises as fs, readdirSync, existsSync } from "fs";
import * as os from "os";
import * as path from "path";
import { COPILOT_EXTENSION_FILES } from "./copilot-extension.generated";
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

export interface AgentIntegration {
  id: string;
  displayName: string;
  detect(): Promise<DetectionResult>;
  status(): Promise<InstallationStatus>;
  install(): Promise<void>;
  uninstall(): Promise<void>;
  /**
   * Why this integration cannot be installed on this machine, or `undefined`
   * when it can. A detected agent whose prerequisite is missing is skipped
   * with its reason instead of failing the other agents' installation.
   */
  prerequisite?(): Promise<string | undefined>;
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
// the only CodeTour guidance Copilot loads (served MCP prompt, plugin skill,
// agentStop hook). An install or uninstall removes a directory an older CLI
// wrote under the Copilot user directory so two conflicting CodeTour skills
// cannot coexist; every other skill there belongs to someone else.
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

// The Agent Plugins 1.0 plugin is the single owner of the CodeTour MCP server
// declaration. Production installs go through `copilot plugin install` so the
// CLI owns the cache and metadata; tests and unusual layouts can write the
// same embedded files into a managed directory instead.
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

// The exact launcher the installed plugin must use. The CLI that performs the
// install is known here, so the plugin does not depend on `codetour` being on
// PATH in every future session: a Node CLI is addressed through its runtime
// and absolute script path, a native executable directly. The versioned
// plugin source still declares the portable `codetour` command for a direct
// `copilot plugin install`; the CLI-generated copy is the verified one.
function codetourPluginLauncher(): { command: string; args: string[] } {
  const script = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
  if (script && existsSync(script)) {
    // A Node-hosted CLI (npm bin, development build, standalone launcher) is
    // addressed through a Node runtime; a native executable through itself.
    if (/\.[cm]?js$/i.test(script) || /(^|[\\/])node(\.exe)?$/i.test(process.execPath)) {
      return { command: process.execPath, args: [script, "mcp"] };
    }
    return { command: process.execPath, args: ["mcp"] };
  }
  // An unidentifiable runtime keeps the documented portable command: the
  // verification below then decides whether the install may proceed.
  return { command: "codetour", args: ["mcp"] };
}

function expectedPluginFiles(): Record<string, string> {
  const files: Record<string, string> = { ...COPILOT_PLUGIN_FILES };
  const mcp = JSON.parse(files["mcp.json"]) as {
    mcpServers: Record<string, { type: string; command: string; args: string[] }>;
  };
  const launcher = codetourPluginLauncher();
  mcp.mcpServers.codetour = {
    type: "stdio",
    command: launcher.command,
    args: [...launcher.args, "--workspace-root", "${COPILOT_SESSION_CWD}"]
  };
  files["mcp.json"] = `${JSON.stringify(mcp, null, 2)}\n`;
  return files;
}

function verifyPluginLauncher(): void {
  const launcher = codetourPluginLauncher();
  const probe = spawnSync(launcher.command, [...launcher.args, "--version"], {
    encoding: "utf8", windowsHide: true, timeout: 15000
  });
  if (probe.status !== 0) {
    const detail = (probe.stderr || probe.error?.message || "").trim();
    throw new Error(
      `The CodeTour MCP launch contract could not be verified ('${[launcher.command, ...launcher.args].join(" ")}'). ` +
      (detail ? `${detail} ` : "") +
      "Keep the CLI at this path, or re-run 'codetour --install copilot' from the installation to use."
    );
  }
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
    previous.set(name, await readCopilotFile(path.join(directory, ...name.split("/"))));
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

async function writeManagedFiles(directory: string): Promise<void> {
  for (const [name, content] of Object.entries(expectedPluginFiles())) {
    const target = path.join(directory, ...name.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    if (await fs.readFile(target, "utf8") !== content) {
      throw new Error(`Could not verify ${target} after installation.`);
    }
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
// replace and an uninstall must refuse rather than delete them.
async function pluginForeignFiles(directory: string | undefined): Promise<string[]> {
  if (!directory) return [];
  const expected = new Set(Object.keys(expectedPluginFiles()));
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

async function installCopilotPlugin(): Promise<void> {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "codetour-plugin-"));
  try {
    await writeManagedFiles(staging);
    const existing = await installedCopilotPlugin();
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
    if (foreign.length) {
      throw new Error(
        `${foreign.join(", ")} in ${existing.cachePath} differ from this installation and were left untouched. ` +
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

// The legacy registration is removed only when it is the entry this CLI wrote
// or the documented `codetour mcp` launcher. Every other server, same name or
// not, is user configuration and is preserved.
async function removeLegacyCodetourMcpRegistration(): Promise<string> {
  const mcpFile = copilotMcpConfigPath();
  let config: CopilotMcpConfig;
  try {
    config = await readCopilotMcpConfig(mcpFile);
  } catch (error) {
    return `Left ${mcpFile} untouched: ${error instanceof Error ? error.message : String(error)}`;
  }
  const servers = config.mcpServers;
  if (!servers || !isCodetourMcpEntry(servers.codetour)) return "";
  delete servers.codetour;
  await writeCopilotMcpConfig(mcpFile, config);
  return `Removed the legacy 'codetour' MCP server from ${mcpFile}; the plugin is now the single registration.`;
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
    // The plugin lives outside the adapter directory and is reported
    // separately, with its own ownership states.
    const override = copilotPluginOverride();
    const installed = await installedCopilotPlugin();
    const pluginRoot = override || installed?.cachePath;
    const pluginStates = await pluginFileStates(pluginRoot);
    // An override directory that is absent, or a cache path whose files were
    // all removed, is a missing plugin, not an outdated one.
    const pluginPresent = Boolean(pluginRoot) && pluginStates.some(file => file.state !== "missing");
    const pluginCurrent = pluginPresent && pluginStates.every(file => file.state === "current");
    const pluginChanged = pluginStates.filter(file => file.state !== "current").map(file => file.name);
    const changed = [
      ...states.filter(file => file.state !== "current").map(file => file.name),
      ...(pluginCurrent ? [] : pluginChanged.map(name => `plugin:${name}`))
    ].join(", ");
    const mcpFile = copilotMcpConfigPath();
    let entry: CopilotMcpServer | undefined;
    let unreadable: string | undefined;
    try {
      entry = (await readCopilotMcpConfig(mcpFile)).mcpServers?.codetour;
    } catch (error) {
      unreadable = error instanceof Error ? error.message : String(error);
    }
    // A legacy entry this CLI owns duplicates the plugin's own server and must
    // be removed by the next install. A foreign same-named server is preserved
    // and only reported: the user owns it.
    const legacyOwned = isCodetourMcpEntry(entry);
    const legacyCurrent = legacyOwned && isCurrentCodetourMcpEntry(entry, codetourMcpEntry());
    const foreign = Boolean(entry) && !legacyOwned;
    const foreignNote = foreign
      ? ` A same-named 'codetour' server in ${mcpFile} was configured by someone else and is preserved; remove it yourself if it duplicates the plugin.`
      : "";
    if (allCurrent && pluginCurrent) {
      if (legacyOwned) {
        return {
          state: "outdated" as const,
          detail: `The adapter and plugin are installed, but a ${legacyCurrent ? "legacy" : "stale"} 'codetour' entry in ${mcpFile} duplicates the plugin's server. ` +
            "Re-run 'codetour --install copilot' to remove the entry this CLI owns."
        };
      }
      return {
        state: "installed" as const,
        detail: `The adapter files are installed in ${directory}, ` +
          `the CodeTour plugin is installed${pluginRoot ? ` in ${pluginRoot}` : ""}. ` +
          `The plugin declares the single 'codetour' MCP server.${foreignNote}`
      };
    }
    if (allCurrent && !pluginPresent) {
      return {
        state: "incomplete" as const,
        detail: `The adapter files are installed in ${directory}, but the CodeTour plugin is missing. ` +
          "Re-run 'codetour --install copilot' so Copilot loads the 'codetour' MCP server and the agentStop guard."
      };
    }
    if (allCurrent && pluginPresent) {
      return {
        state: "outdated" as const,
        detail: `The CodeTour plugin in ${pluginRoot} differs from this CLI (${pluginChanged.join(", ")}). ` +
          "Re-run 'codetour --install copilot' to replace it."
      };
    }
    if (allCurrent) {
      return {
        state: "incomplete" as const,
        detail: unreadable
          ? `The adapter files are installed in ${directory}, but ${unreadable}`
          : `The adapter files are installed in ${directory}, but the CodeTour plugin is incomplete. ` +
            "Re-run 'codetour --install copilot'."
      };
    }
    if (allMissing && !pluginPresent) {
      return {
        state: "not-installed" as const,
        detail: `No CodeTour adapter in ${directory} and no CodeTour plugin installed.`
      };
    }
    return {
      state: "outdated" as const,
      detail: `The installed CodeTour integration differs from this CLI (${changed}). ` +
        "Re-run 'codetour --install copilot' to replace it."
    };
  },
  async install() {
    const directory = copilotExtensionDirectory();
    const states = await copilotFileStates(directory);
    const differing = states.filter(file => file.state === "modified").map(file => file.name);
    // Everything that can refuse the install runs before the first write: an
    // unverified MCP launcher would leave a session without tools.
    verifyPluginLauncher();
    const previous = new Map<string, string | undefined>();
    for (const name of Object.keys(COPILOT_EXTENSION_FILES)) {
      previous.set(name, await readCopilotFile(path.join(directory, name)));
    }
    // The plugin is installed in the same transaction as the adapter files: a
    // failed install restores their previous state too.
    const override = copilotPluginOverride();
    const previousPlugin = await readManagedFiles(override);
    const pluginStatesBefore = await pluginFileStates(override);
    const pluginDiffering = pluginStatesBefore.filter(file => file.state === "modified").map(file => file.name);
    let pluginInstalledByThisRun = false;
    let retiredSkillDirectory: string | undefined;
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
      if (override) {
        await fs.mkdir(override, { recursive: true });
        await writeManagedFiles(override);
      } else {
        await installCopilotPlugin();
        pluginInstalledByThisRun = true;
      }
      retiredSkillDirectory = await removeRetiredKnowledgeSkill();
    } catch (error) {
      const unrestored = await restoreCopilotFiles(directory, previous);
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
    if (differing.length) {
      console.log(`Replaced differing adapter files (${differing.join(", ")}) in ${directory}.`);
    }
    console.log(`Installed the CodeTour adapter in ${directory}.`);
    if (retiredSkillDirectory) {
      console.log(`Removed the retired standalone Knowledge skill from ${retiredSkillDirectory}.`);
    }
    if (pluginDiffering.length) {
      console.log(`Replaced differing plugin files (${pluginDiffering.join(", ")}).`);
    }
    const pluginLocation = override || await installedCopilotPlugin().then(plugin => plugin?.cachePath);
    console.log(`Installed the CodeTour plugin${pluginLocation ? ` in ${pluginLocation}` : ""}.`);
    console.log("Run 'copilot plugin list' and 'copilot mcp list' to confirm the 'codetour' plugin and its server.");
    console.log("Run 'copilot skill list' to confirm the plugin's 'codetour-generate' skill.");
    const legacy = await removeLegacyCodetourMcpRegistration();
    if (legacy) console.log(legacy);
    console.log("Start 'copilot --experimental' in a trusted Git worktree, accept the extension");
    console.log("(Load Only or Load & Augment), then run /codetour to read or generate a Tour.");
    console.log("hooks disabled means no guard, and the MCP results remain the source of truth.");
  },
  async prerequisite() {
    // A managed override writes the plugin files directly; every other path
    // goes through `copilot plugin install`, which needs the CLI.
    if (copilotPluginOverride()) return undefined;
    const detection = await this.detect();
    return detection.state === "detected" ? undefined : detection.detail;
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
    // Remove the plugin first: without it Copilot has no CodeTour MCP server,
    // and a failure here must not leave the adapter half-removed.
    const override = copilotPluginOverride();
    if (override) {
      const pluginStates = await pluginFileStates(override);
      const preserved = pluginStates.filter(file => file.state === "modified").map(file => file.name);
      for (const file of pluginStates) {
        if (file.state === "current") {
          await fs.rm(path.join(override, ...file.name.split("/")), { force: true });
        }
      }
      if (preserved.length) {
        console.log(`Left ${preserved.join(", ")} in ${override} untouched: they differ from the plugin this CLI installed.`);
      } else {
        await fs.rmdir(override).catch(() => undefined);
        console.log(`Removed the CodeTour plugin from ${override}.`);
      }
    } else if (await installedCopilotPlugin()) {
      await removeCopilotPlugin();
      console.log("Uninstalled the CodeTour plugin.");
    }
    for (const file of states) {
      if (file.state === "current") await fs.rm(path.join(directory, file.name));
    }
    // The retired standalone Knowledge skill is removed with the rest of the
    // integration; other skills in the shared directory are untouched.
    const retiredSkillDirectory = await removeRetiredKnowledgeSkill();
    if (retiredSkillDirectory) {
      console.log(`Removed the retired standalone Knowledge skill from ${retiredSkillDirectory}.`);
    }
    const remaining = await fs.readdir(directory).catch(() => [] as string[]);
    // Idempotent: the directory may already be gone from an earlier uninstall.
    if (!remaining.length) await fs.rmdir(directory).catch(() => undefined);
    console.log(`Removed the CodeTour adapter from ${directory}.`);
    const legacy = await removeLegacyCodetourMcpRegistration();
    if (legacy) console.log(legacy);
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
  // The extension appends `--workspace-root <real cwd>`; the launcher only
  // names the runtime and the `mcp` subcommand.
  return codetourPluginLauncher();
}

function expectedPiPluginFiles(): Record<string, string> {
  return {
    ...PI_PLUGIN_FILES,
    "launcher.json": `${JSON.stringify(piLauncherFile(), null, 2)}\n`,
  };
}

async function piFileStates(directory: string): Promise<FileState[]> {
  const states: FileState[] = [];
  for (const [name, content] of Object.entries(expectedPiPluginFiles())) {
    const target = path.join(directory, ...name.split("/"));
    try {
      const existing = await fs.readFile(target, "utf8");
      states.push({ name, state: existing === content ? "current" : "modified" });
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
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
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
    const target = path.join(directory, ...name.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    if ((await fs.readFile(target, "utf8")) !== content) {
      throw new Error(`Could not verify ${target} after installation.`);
    }
  }
}

const piIntegration: AgentIntegration = {
  id: "pi",
  displayName: "Pi coding agent",
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
        detail: `No CodeTour package in ${directory} and no declaration in ${settingsFile}.`,
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
          `(${changed.join(", ")}) is missing from ${directory}. ` +
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
    const previousStates = await piFileStates(directory);
    const replaced = previousStates.filter((file) => file.state === "modified").map((file) => file.name);
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
    console.log(`Installed the CodeTour Pi package in ${directory}.`);
    console.log(`Declared it in ${settingsFile} under packages[].`);
    console.log("Run 'pi list' to confirm the package, then '/codetour' in a session to read or generate a Tour.");
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
      if (file.state === "current") {
        await fs.rm(path.join(directory, ...file.name.split("/")), { force: true });
      }
    }
    await pruneEmptyDirectories(directory);
    console.log(`Removed the CodeTour Pi package from ${directory}.`);
    console.log(`Removed its declaration from ${settingsFile}.`);
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
  async prerequisite() {
    const detection = await this.detect();
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

function selectedIntegrations(id: string | undefined): AgentIntegration[] {
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
 * Install one agent, `all` of them, or (with no id) every *compatible* agent.
 *
 * Compatibility is "the agent is present and its install prerequisite is
 * met": an absent agent is skipped with its reason, so a machine without one
 * CLI never blocks the others. A failing agent does not stop the batch either;
 * it is reported, and `failed` tells the caller to exit non-zero.
 */
export async function installAgents(id?: string): Promise<AgentBatchReport> {
  const outcomes: AgentOutcome[] = [];
  const explicit = Boolean(id && id !== ALL_AGENTS);
  for (const integration of selectedIntegrations(id)) {
    const base = { id: integration.id, displayName: integration.displayName };
    try {
      // A batch installs the agents this machine actually uses; naming one
      // agent is the instruction, so its missing prerequisite is a failure.
      if (!explicit) {
        const detection = await integration.detect();
        if (detection.state !== "detected") {
          outcomes.push({ ...base, result: "skipped", detail: detection.detail });
          continue;
        }
      }
      const reason = await integration.prerequisite?.();
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
export async function uninstallAgents(id?: string): Promise<AgentBatchReport> {
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
