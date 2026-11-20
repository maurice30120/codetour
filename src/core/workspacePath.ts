/**
 * Host-independent workspace path identity. Both the CLI opening composition
 * and the extension's URI receiver compare workspace roots, so they share one
 * canonical spelling instead of each re-implementing it.
 */
import { realpathSync } from "fs";
import * as path from "path";

/**
 * The canonical workspace root a workspace comparison uses: resolved,
 * stripped of its trailing separator, and — when the file system can answer —
 * replaced by its real path, so that a symlinked or `..`-composed root
 * compares equal to the window's folder.
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
  return realpathSync(value);
}

function stripTrailingSeparator(value: string): string {
  return value.length > 1 && (value.endsWith("/") || value.endsWith("\\"))
    ? value.slice(0, -1)
    : value;
}
