import { readFile, realpath } from "node:fs/promises";
import * as path from "node:path";

/** Resolve real paths so local image references cannot escape through symlinks. */
export async function readWorkspaceImage(root: string, imagePath: string): Promise<Uint8Array | undefined> {
  if (path.isAbsolute(imagePath) || imagePath.split(/[\\/]/).includes("..")) return undefined;
  try {
    const realRoot = await realpath(root);
    const image = await realpath(path.resolve(realRoot, imagePath));
    const relative = path.relative(realRoot, image);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return undefined;
    return await readFile(image);
  } catch {
    return undefined;
  }
}
