import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AcpAgentEntry } from "./acpAgentProcess";

/**
 * Pi's read-only launcher (ADR 0049).
 *
 * `pi-acp` spawns `pi` with a fixed argument list, offers no passthrough and
 * reads no variable for tools, so a Pi conversation would carry `bash`, `edit`
 * and `write` past the read-only client of ADR 0013. The injection point it
 * does offer — `PI_ACP_PI_COMMAND`, the executable it spawns instead of `pi` —
 * is where CodeTour puts a launcher of its own: the same `pi`, with only the
 * reading and searching tools enabled.
 *
 * The launcher is part of the agent machinery, not a setting: it is written
 * under the OS temporary directory, versioned with the extension, and never
 * touches the reader's `~/.pi` configuration. Where it cannot be provided,
 * {@link piAcpEntry} returns nothing and the profile reports a connection
 * error — an unrestricted Pi is never an outcome.
 */

/** The Pi tools a read-only Tour Step Conversation may use. */
export const PI_READONLY_TOOLS: readonly string[] = ["read", "grep", "find", "ls"];

/**
 * The launcher's version, bumped whenever its script changes, so no build
 * reuses a launcher another build wrote.
 */
export const PI_READONLY_LAUNCHER_VERSION = "1";

/** The directory, under the OS temporary directory, that holds launchers. */
const LAUNCHER_DIRECTORY = "codetour-pi-readonly";

export interface PiReadonlyLauncherOptions {
  /** The directory launchers are written under; the OS temporary one by default. */
  root?: string;
  /** The platform the launcher is provided for; the running one by default. */
  platform?: NodeJS.Platform;
}

/**
 * The script `pi-acp` runs instead of `pi`: it replaces itself with the same
 * `pi`, restricted to reading and searching, and keeps the arguments `pi-acp`
 * passes — `"$@"` is what lets a smoke test load its own extension and prove
 * the effective tool surface.
 */
export function piReadonlyLauncherScript(): string {
  return `#!/bin/sh\nexec pi --tools ${PI_READONLY_TOOLS.join(",")} --no-mcp "$@"\n`;
}

/**
 * Writes the launcher, or reuses the one already there, and returns its path:
 * undefined on Windows, which has no POSIX shell, and on any write or chmod
 * failure. A caller that gets undefined launches nothing.
 */
export function piReadonlyLauncher(
  options: PiReadonlyLauncherOptions = {}
): string | undefined {
  if ((options.platform ?? process.platform) === "win32") {
    return undefined;
  }
  const directory = path.join(options.root ?? os.tmpdir(), LAUNCHER_DIRECTORY);
  const file = path.join(
    directory,
    `pi-readonly-${PI_READONLY_LAUNCHER_VERSION}.sh`
  );
  const script = piReadonlyLauncherScript();
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (readScript(file) !== script) {
      // Staged beside the target and renamed: a stale launcher is replaced
      // whole, and a symlink planted at that path is replaced rather than
      // followed into another file.
      const staged = `${file}.${process.pid}.tmp`;
      writeFileSync(staged, script, { mode: 0o755 });
      renameSync(staged, file);
    }
    chmodSync(file, 0o755);
    return file;
  } catch {
    return undefined;
  }
}

/**
 * The ACP entry of the Pi profile: `pi-acp` (the verified adapter) launched
 * with the read-only launcher as its `pi`, or undefined when no launcher can
 * be provided here. Pi's modes are thinking levels, not permissions, so the
 * agent's current mode is accepted: the allowlist carries the read-only
 * property.
 */
export function piAcpEntry(
  cwd: string,
  options: PiReadonlyLauncherOptions = {}
): AcpAgentEntry | undefined {
  const launcher = piReadonlyLauncher(options);
  if (launcher === undefined) {
    return undefined;
  }
  return {
    command: "pi-acp",
    args: [],
    cwd,
    env: { PI_ACP_PI_COMMAND: launcher },
    useDefaultMode: true
  };
}

function readScript(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}
