/**
 * One canonical spelling for a workspace root, shared by every surface that
 * writes or compares one: the VS Code extension, the terminal reader, the
 * creation CLI, its journal and the plugin hooks.
 *
 * A comparison is only meaningful if both sides spell the root the same way,
 * and two spellings of one directory are the norm, not the exception: a
 * `..`-composed or symlinked path, a trailing separator, a mapped drive, and —
 * the reason this module exists — an 8.3 short name on Windows, which the
 * platform's `realpath` implementations do not all expand. Node's
 * `fs.realpathSync` keeps `C:\Users\RUNNER~1\...` while `fs.promises.realpath`
 * answers the long on-disk form, so a server writing with one and a hook
 * comparing with the other never agree.
 *
 * The canonical form is therefore the **native** real path (the file system's
 * own answer, on-disk case, no symlink, no short name) with its trailing
 * separator removed. When the real path cannot be answered — a removed
 * directory, a restricted mount — the resolved argument is used instead, so two
 * equal arguments still compare equal.
 */
const { realpathSync } = require("fs");
const path = require("path");

/** Removes the separator a caller may have left at the end of a root. */
function stripTrailingSeparator(value) {
  return value.length > 1 && (value.endsWith("/") || value.endsWith("\\"))
    ? value.slice(0, -1)
    : value;
}

/**
 * The canonical spelling of a workspace root: resolved, native real path when
 * the file system can answer, trailing separator removed.
 *
 * `realpath` is injectable so a caller can state the answer it wants (the
 * extension's URI receiver and its tests do), and so a surface that owns its
 * own resolver can pin the same rule.
 */
function canonicalWorkspacePath(
  workspace,
  realpath = nativeRealpath
) {
  const resolved = path.resolve(workspace);
  let canonical = resolved;
  try {
    canonical = realpath(resolved);
  } catch {
    // An unavailable real path keeps the resolved argument.
  }
  return stripTrailingSeparator(canonical);
}

/** Whether two spellings name the same workspace root. */
function sameWorkspace(left, right) {
  return canonicalWorkspacePath(left) === canonicalWorkspacePath(right);
}

/**
 * The real path the platform's own file system answers: `realpathSync.native`
 * goes through the OS call (`GetFinalPathNameByHandleW` on Windows), which is
 * what expands a short name and normalises the case. It is unavailable on a
 * platform that does not offer it, where the JavaScript resolution is already
 * the file system's answer.
 */
function nativeRealpath(value) {
  return typeof realpathSync.native === "function"
    ? realpathSync.native(value)
    : realpathSync(value);
}

module.exports = { canonicalWorkspacePath, sameWorkspace, stripTrailingSeparator };
