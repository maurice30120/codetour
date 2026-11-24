import { execFile, spawn } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { canonicalWorkspacePath } from "../core/workspacePath";

export { canonicalWorkspacePath };

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
 * URI would only open files; the extension URI lets Tour discovery resolve
 * the file in the receiving window.
 */
export const OPEN_IN_VSCODE_URI_PREFIX = "vscode://maurice30120.codetour/openTour";

/** The delay between the workspace window opening and the Tour URI (spec #239). */
export const OPEN_WINDOW_SETTLE_MS = 2000;

const VS_CODE_UNAVAILABLE_MESSAGE =
  "Visual Studio Code is not reachable: the 'code' command was not found on PATH.";


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
export function buildTourOpenUri(address: { tourPath: string; step: number; workspace?: string }): string {
  return (
    OPEN_IN_VSCODE_URI_PREFIX +
    "?tour=" + encodeURIComponent(address.tourPath) +
    "&step=" + (address.step + 1) +
    (address.workspace ? "&workspace=" + encodeURIComponent(address.workspace) : "")
  );
}

/** One OS-level launch the plan's executor performs. */
export interface LaunchInvocation {
  command: string;
  args: string[];
}

export type OpenInVsCodePlan =
  | {
      kind: "launch";
      invocations: LaunchInvocation[];
    }
  | { kind: "unavailable"; message: string };

/**
 * The opening decision (ticket #244): reach the extension URI contract in
 * the window that holds the workspace. Persistent workspace storage does
 * not establish whether a window is currently open.
 */
export function planOpenInVsCode(input: {
  /** The canonical workspace the Tour belongs to. */
  workspace: string;
  /** The Tour's workspace-relative `.tour` path, POSIX-separated. */
  tourPath: string;
  /** The active Step, 0-based. */
  step: number;
  vscodeAvailable: boolean;
}): OpenInVsCodePlan {
  if (!input.vscodeAvailable) {
    return { kind: "unavailable", message: VS_CODE_UNAVAILABLE_MESSAGE };
  }
  const uri = buildTourOpenUri({ tourPath: input.tourPath, step: input.step, workspace: input.workspace });
  const openTourUri = { command: "code", args: ["--open-url", uri] as string[] };
  // Workspace storage is persistent and does not prove a window is open.
  // Ask VS Code to open the workspace before sending its relative Tour URI,
  // even if a previously observed workspace happens to match.
  return {
    kind: "launch",
    // Delegate workspace opening or reuse to VS Code, then deliver the URI.
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
 * workspace, `code` reachability probe, then
 * the plan executed through the OS. Every failure rejects; the reader
 * surfaces the message as a nonblocking status-line warning.
 */
export function createOpenInVsCodeInvoker(deps?: {
  execution?: Partial<OpenExecutionDeps>;
}): OpenInVsCodeInvoker {
  return request => openTourInVsCode(request, deps?.execution ? { execution: deps.execution } : undefined);
}

/**
 * The one opening composition every surface walks (review S3): canonical
 * workspace, `code` reachability, the plan, then its execution through the OS. The reader's
 * invoker and the `--internal-open-vscode` runner are two debouches of this
 * single sequence, never two copies of it.
 */
export async function openTourInVsCode(
  request: OpenInVsCodeRequest,
  deps?: OpenInVsCodeCompositionDeps
): Promise<void> {
  const workspace = canonicalWorkspacePath(request.workspaceRoot);
  const vscodeAvailable = await (deps?.vscodeAvailable ? deps.vscodeAvailable() : isVsCodeReachable());
  const plan = planOpenInVsCode({
    workspace,
    tourPath: relativeTourPath(request.tourId, workspace),
    step: request.step,
    vscodeAvailable
  });
  await executeOpenInVsCodePlan(plan, deps?.execution);
}

/** The injectable seams of the shared opening composition; fakes test it. */
export interface OpenInVsCodeCompositionDeps {
  /** Whether the `code` CLI answers. */
  vscodeAvailable?: () => Promise<boolean>;
  /** The execution seams of the plan executor. */
  execution?: Partial<OpenExecutionDeps>;
}
