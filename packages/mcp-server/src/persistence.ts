import * as fs from "fs";
import * as path from "path";
import { WorkspaceContext } from "./types";

export class OutputPathError extends Error {}

export async function writeTourAtomic(
  ctx: WorkspaceContext,
  relativeTarget: string,
  content: string
): Promise<void> {
  const target = path.resolve(ctx.root, relativeTarget);
  const directory = path.dirname(target);
  await fs.promises.mkdir(directory, { recursive: true });

  let realDirectory: string;
  try {
    realDirectory = fs.realpathSync(directory);
  } catch (error) {
    throw new OutputPathError(
      `Unable to resolve the output directory: ${(error as Error).message}`
    );
  }
  const relative = path.relative(ctx.realRoot, realDirectory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new OutputPathError(
      `${relativeTarget} resolves outside the workspace root`
    );
  }

  const tempFile = path.join(
    directory,
    `.${path.basename(target)}.tmp-${process.pid}-${Date.now()}`
  );
  const handle = await fs.promises.open(tempFile, "w");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.promises.rename(tempFile, target);
  } catch (error) {
    await fs.promises.unlink(tempFile).catch(() => undefined);
    throw error;
  }
}
