import * as fs from "fs";
import * as path from "path";
import { WorkspaceContext } from "./types";

// Workspace context: the supplied root and its real-path resolution. Every
// confinement check compares real paths so a symbolic link cannot escape the
// configured root.
export function createContext(workspaceRoot: string): WorkspaceContext {
  const root = path.resolve(workspaceRoot);
  const realRoot = fs.realpathSync(root);
  return { root, realRoot };
}
