import { promises as fs } from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { loadTour } from "../store/tourSchema";
import {
  canonicalWorkspacePath,
  openTourInVsCode,
  type OpenInVsCodeCompositionDeps
} from "./openInVscode";

/**
 * The non-interactive Open-in-VS Code surface of the composition root
 * (ticket #242, amendment): `codetour --internal-open-vscode <tour> [workspace]`.
 *
 * The end-of-generation dialogue of the Pi plugin hands this command over, so
 * the "VS Code" choice walks the same real opening as the reading flow — the
 * T5 decision module is reused as-is (canonical workspace, best-effort window
 * detection, plan, executor), and this runner only debouches it, exactly like
 * `--internal-tour` debouches the reader composition. The active Step after a
 * generation is the first one.
 *
 * The Windows detection, the reachability probe and the plan executor are
 * injectable seams: the tests drive this runner in-process with fakes, no
 * PTY and no real `code` process.
 */
export type InternalOpenVscodeDeps = OpenInVsCodeCompositionDeps;

export async function runInternalOpenVsCode(args: string[], deps?: InternalOpenVscodeDeps): Promise<void> {
  if (args.length < 1 || args.length > 2) {
    throw new Error("Internal Open-in-VS Code requires a Tour path and an optional workspace root.");
  }
  // A relative Tour path is anchored where the dialogue runs: the workspace
  // root when it is given, the caller's directory otherwise.
  const tourFile = args[1] ? path.resolve(args[1], args[0]) : path.resolve(args[0]);
  const workspace = canonicalWorkspacePath(args[1] || path.dirname(tourFile));
  // The recorded Tour file is validated exactly like `--internal-tour`: a
  // missing or malformed Tour fails before a window is ever opened.
  const tourId = loadTour(
    await fs.readFile(tourFile, "utf8"),
    pathToFileURL(tourFile).toString()
  ).id;
  await openTourInVsCode({ workspaceRoot: workspace, tourId, step: 0 }, deps);
}
