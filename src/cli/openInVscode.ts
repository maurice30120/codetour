import { execFile, spawn } from "child_process";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

/**
 * The Open-in-VS Code contract of ticket #244 (spec #239): the terminal Tour
 * reader used by Pi and Copilot CLI can hand the Tour to the real VS Code
 * extension at the active Step. The opening goes through the extension's URI
 * contract — the `vscode://maurice30120.codetour` URI handled by the
 * extension's URIHandler (`src/extension.ts`), whose query carries the Tour
 * file relative to the workspace and the 1-based Step number — never through
 * a `code <file>` invocation that cannot target the window with the Tour's
 * workspace. The decision logic is pure and tested in-process; only this
 * module's executor touches a process.
 */

/**
 * The receiving URI of the extension's URIHandler. A `vscode://file/...`
 * URI would only open files; the extension URI reaches the window holding
 * the workspace and lets its Tour discovery resolve the file.
 */
export const OPEN_IN_VSCODE_URI_PREFIX = "vscode://maurice30120.codetour/openTour";

/** The delay between the workspace window opening and the Tour URI (spec #239). */
export const OPEN_WINDOW_SETTLE_MS = 2000;

const VS_CODE_UNAVAILABLE_MESSAGE =
  "Visual Studio Code is not reachable: the 'code' command was not found on PATH.";

/**
 * The canonical workspace root the opening decision compares against:
 * resolved, stripped of its trailing separator, and — when the file system
 * can answer — replaced by its real path, so that a symlinked or
 * `..`-composed root compares equal to the window's folder.
 */
export function canonicalWorkspacePath(
  workspace: string,
  realpath: (value: string) => string = tryRealpath
): string {
  const resolved = path.resolve(workspace);
  let canonical = resolved;
  try {
    canonical = realpath(resolved);
  } catch {
    // An unavailable real path (removed directory, restricted mount) keeps
    // the resolved argument: two equal arguments still compare equal.
  }
  return stripTrailingSeparator(canonical);
}

function tryRealpath(value: string): string {
  return require("fs").realpathSync(value) as string;
}

function stripTrailingSeparator(value: string): string {
  return value.length > 1 && (value.endsWith("/") || value.endsWith("\\"))
    ? value.slice(0, -1)
    : value;
}

/** The Tour file's path relative to the canonical workspace, POSIX-separated. */
export function relativeTourPath(tourId: string, workspace: string): string {
  let tourFile: string;
  try {
    tourFile = fileURLToPath(tourId);
  } catch {
    // Not a file URI: treat the id itself as the relative contract.
    return tourId.replace(/^\.\//, "");
  }
  const relative = path.relative(workspace, tourFile).split(path.sep).join("/");
  if (relative.startsWith("../") || relative === "" || path.isAbsolute(relative)) {
    // A Tour file outside the workspace degrades to its file name, the
    // `.tour` suffix the extension's URIHandler still matches.
    return tourFile.split(path.sep).join("/").split("/").pop() ?? relative;
  }
  return relative;
}

/**
 * The Tour URI the extension uri-handler opens: the Tour file relative to
 * the workspace plus the 1-based Step, the extension's public-link contract
 * (`src/extension.ts`: "In public links, the first step is numbered 1").
 */
export function buildTourOpenUri(address: { tourPath: string; step: number }): string {
  return (
    OPEN_IN_VSCODE_URI_PREFIX +
    "?tour=" + encodeURIComponent(address.tourPath) +
    "&step=" + (address.step + 1)
  );
}

/** One OS-level launch the plan's executor performs. */
export interface LaunchInvocation {
  command: string;
  args: string[];
}

export type OpenInVsCodeScenario = "reuse-window" | "new-window" | "multiple-windows";

export type OpenInVsCodePlan =
  | {
      kind: "launch";
      scenario: OpenInVsCodeScenario;
      invocations: LaunchInvocation[];
    }
  | { kind: "unavailable"; message: string };

/**
 * The opening decision (ticket #244): reach the extension URI contract in
 * the window that holds the workspace, and never open a duplicate window.
 * The observed windows come from the best-effort detector
 * ({@link detectOpenVsCodeWindows}); the plan only compares canonical paths.
 */
export function planOpenInVsCode(input: {
  /** The canonical workspace the Tour belongs to. */
  workspace: string;
  /** The Tour's workspace-relative `.tour` path, POSIX-separated. */
  tourPath: string;
  /** The active Step, 0-based. */
  step: number;
  /** Canonical workspaces observed open in running VS Code windows. */
  openWindows: string[];
  vscodeAvailable: boolean;
}): OpenInVsCodePlan {
  if (!input.vscodeAvailable) {
    return { kind: "unavailable", message: VS_CODE_UNAVAILABLE_MESSAGE };
  }
  const uri = buildTourOpenUri({ tourPath: input.tourPath, step: input.step });
  const openTourUri = { command: "code", args: ["--open-url", uri] as string[] };
  const matches = input.openWindows.filter(window => window === input.workspace);
  // Several matching windows: the URI alone is sent — VS Code routes it to
  // one of them — and no invocation names the folder, so the plan cannot
  // create a duplicate window. Which window receives the URI is VS Code's
  // decision, a documented detection limit.
  if (matches.length > 1) {
    return { kind: "launch", scenario: "multiple-windows", invocations: [openTourUri] };
  }
  if (matches.length === 1) {
    return { kind: "launch", scenario: "reuse-window", invocations: [openTourUri] };
  }
  return {
    kind: "launch",
    scenario: "new-window",
    // Scenario (b): open the workspace folder first — `code <folder>` reuses
    // the window that already holds it, never duplicating — then deliver the
    // Tour URI to that window.
    invocations: [{ command: "code", args: [input.workspace] }, openTourUri]
  };
}

/** The executor's seams; the defaults run the real `code` CLI. */
export interface OpenExecutionDeps {
  /** One invocation; resolves on exit 0, rejects otherwise (ENOENT included). */
  spawn: (command: string, args: string[]) => Promise<void>;
  delay: (ms: number) => Promise<void>;
}

/**
 * Runs the plan's invocations in order, inserting the workspace settle delay
 * between them. An unavailable plan and a failing launcher reject with the
 * defined messages the reader surfaces on its status line.
 */
export async function executeOpenInVsCodePlan(
  plan: OpenInVsCodePlan,
  deps?: Partial<OpenExecutionDeps>
): Promise<void> {
  if (plan.kind === "unavailable") throw new Error(plan.message);
  const { spawn, delay } = { ...defaultExecutionDeps(), ...deps };
  for (const [index, invocation] of plan.invocations.entries()) {
    if (index > 0) await delay(OPEN_WINDOW_SETTLE_MS);
    try {
      await spawn(invocation.command, invocation.args);
    } catch (error) {
      const failure = error as Error & { code?: string };
      if (failure.code === "ENOENT") throw new Error(VS_CODE_UNAVAILABLE_MESSAGE);
      throw new Error(
        "The VS Code opening failed: " +
          (failure instanceof Error ? failure.message : String(failure))
      );
    }
  }
}

function defaultExecutionDeps(): OpenExecutionDeps {
  return {
    spawn: (command, args) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: "ignore" });
        child.once("error", reject);
        child.once("exit", (code, signal) =>
          code === 0 ? resolve() :
            reject(new Error("Launcher exited with " + (signal || code)))
        );
      }),
    delay: ms => new Promise(resolve => setTimeout(resolve, ms))
  };
}

/**
 * The `code` CLI reachability probe, the detection the existing VS Code
 * agent integration uses (`code --version` through execFile).
 */
export async function isVsCodeReachable(): Promise<boolean> {
  try {
    const version = await promisify(execFile)("code", ["--version"], {
      timeout: 10000,
      windowsHide: true
    });
    return version.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** The workspace-storage facts the window detector needs; fakes test it. */
export interface OpenVsCodeDetectionDeps {
  storageRoot: string;
  listDirectories: (root: string) => Promise<string[]>;
  readFile: (filePath: string) => Promise<string>;
}

/**
 * Best-effort detection of the workspaces already open in running VS Code
 * windows, from the per-window storage records VS Code keeps on disk
 * (`User/workspaceStorage/<hash>/workspace.json`, the folder URI included).
 *
 * Documented limits: the directory is a VS Code implementation detail that
 * changed across versions and profiles; remote (ssh, container) and
 * web-hosted windows are not listed; Insiders and VSCodium keep their own
 * roots this detector does not scan; a window opened after the scan is
 * invisible. A failure or a corrupt record degrades to "workspace not
 * observed open", which the plan still handles correctly: the `code <folder>`
 * invocation can never duplicate a window.
 */
export async function detectOpenVsCodeWindows(
  deps?: Partial<OpenVsCodeDetectionDeps>
): Promise<string[]> {
  const resolved = { ...defaultDetectionDeps(), ...deps };
  let entries: string[];
  try {
    entries = await resolved.listDirectories(resolved.storageRoot);
  } catch {
    // No readable storage: no window is observed, the plan still behaves.
    return [];
  }
  const windows: string[] = [];
  for (const entry of entries) {
    try {
      const parsed = JSON.parse(
        await resolved.readFile(path.join(resolved.storageRoot, entry, "workspace.json"))
      ) as { folder?: unknown };
      if (typeof parsed.folder === "string" && parsed.folder.startsWith("file:")) {
        windows.push(canonicalWorkspacePath(fileURLToPath(parsed.folder)));
      }
    } catch {
      // A corrupt or absent record is ignored: best-effort detection.
    }
  }
  return windows;
}

function defaultDetectionDeps(): OpenVsCodeDetectionDeps {
  const storageRoot = vscodeWorkspaceStorageRoot();
  return {
    storageRoot,
    listDirectories: async root =>
      (await fs.readdir(root, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name),
    readFile: filePath => fs.readFile(filePath, "utf8")
  };
}

function vscodeWorkspaceStorageRoot(): string {
  switch (process.platform) {
    case "darwin":
      return path.join(
        os.homedir(), "Library", "Application Support", "Code", "User", "workspaceStorage"
      );
    case "win32":
      return path.join(
        process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
        "Code", "User", "workspaceStorage"
      );
    default:
      return path.join(os.homedir(), ".config", "Code", "User", "workspaceStorage");
  }
}

/**
 * The opening request the reader hands over, grounded in its view model:
 * the Tour identity, the workspace and the active Step (ticket #244).
 */
export interface OpenInVsCodeRequest {
  /** The discovery-assigned Tour file URI (`CodeTour.id`). */
  tourId: string;
  /** The workspace root the reader was composed with. */
  workspaceRoot: string;
  /** The active Step, 0-based. */
  step: number;
}

/** The reader's collaborator port for the Open-in-VS Code command. */
export type OpenInVsCodeInvoker = (request: OpenInVsCodeRequest) => Promise<void>;

/**
 * The composed invoker the terminal reader uses by default: canonical
 * workspace, best-effort window detection, `code` reachability probe, then
 * the plan executed through the OS. Every failure rejects; the reader
 * surfaces the message as a nonblocking status-line warning.
 */
export function createOpenInVsCodeInvoker(deps?: {
  execution?: Partial<OpenExecutionDeps>;
}): OpenInVsCodeInvoker {
  return async request => {
    const workspace = canonicalWorkspacePath(request.workspaceRoot);
    const [openWindows, vscodeAvailable] = await Promise.all([
      detectOpenVsCodeWindows(),
      isVsCodeReachable()
    ]);
    const plan = planOpenInVsCode({
      workspace,
      tourPath: relativeTourPath(request.tourId, workspace),
      step: request.step,
      openWindows,
      vscodeAvailable
    });
    await executeOpenInVsCodePlan(plan, deps?.execution);
  };
}
