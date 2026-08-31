import * as fs from "fs";
import * as path from "path";
import { WorkspaceContext } from "./types";

export function createContext(workspaceRoot: string): WorkspaceContext {
  const root = path.resolve(workspaceRoot);
  const realRoot = fs.realpathSync(root);
  return { root, realRoot };
}
