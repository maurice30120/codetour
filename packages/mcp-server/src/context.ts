import * as fs from "fs";
import * as path from "path";
import { WorkspaceContext } from "./types";

// Contexte du workspace : la racine telle que fournie, plus sa résolution en
// chemin réel. Toute vérification de confinement compare les chemins réels,
// afin qu'un lien symbolique ne puisse pas sortir de la racine configurée.
export function createContext(workspaceRoot: string): WorkspaceContext {
  const root = path.resolve(workspaceRoot);
  const realRoot = fs.realpathSync(root);
  return { root, realRoot };
}
