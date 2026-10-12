import * as fs from "fs";
import * as path from "path";
import { Issue, WorkspaceContext } from "./types";

// Contexte du workspace : la racine telle que fournie, plus sa résolution en
// chemin réel. Toute vérification de confinement compare les chemins réels,
// afin qu'un lien symbolique ne puisse pas sortir de la racine configurée.
export function createContext(workspaceRoot: string): WorkspaceContext {
  const root = path.resolve(workspaceRoot);
  const realRoot = fs.realpathSync(root);
  if (!fs.statSync(realRoot).isDirectory()) {
    throw new Error("workspace root must be a directory");
  }
  return { root, realRoot };
}

// Un appel peut restreindre le workspace configuré, jamais en étendre la
// frontière.
export function selectContext(
  defaultContext: WorkspaceContext,
  workspacePath?: string
): { context?: WorkspaceContext; issues: Issue[] } {
  if (workspacePath === undefined) {
    return { context: defaultContext, issues: [] };
  }
  const invalid = (message: string) => ({
    issues: [{ path: "workspacePath", message }],
  });
  if (workspacePath.trim() === "" || workspacePath.includes("\0")) {
    return invalid("must be a non-empty relative directory path without NUL characters");
  }
  if (path.isAbsolute(workspacePath) || path.win32.isAbsolute(workspacePath)) {
    return invalid("must be relative to the configured workspace root");
  }
  const normalized = path.posix.normalize(workspacePath.replace(/\\/g, "/"));
  if (normalized === ".." || normalized.startsWith("../")) {
    return invalid("must remain inside the configured workspace root");
  }
  let context: WorkspaceContext;
  try {
    context = createContext(path.resolve(defaultContext.root, normalized));
  } catch {
    return invalid("must point to an accessible directory inside the configured workspace");
  }
  const relative = path.relative(defaultContext.realRoot, context.realRoot);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return invalid("resolves outside the configured workspace root");
  }
  return { context, issues: [] };
}
