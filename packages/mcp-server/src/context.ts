import * as fs from "fs";
import * as path from "path";
import { WorkspaceContext } from "./types";

// Workspace context: the supplied root and its resolved real path. All
// confinement checks compare real paths so a symlink cannot escape the
// configured root.
export function createContext(workspaceRoot: string): WorkspaceContext {
  const root = path.resolve(workspaceRoot);
  const realRoot = fs.realpathSync(root);
  return { root, realRoot };
}
