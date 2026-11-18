import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { knowledgeDirectory, loadKnowledgeLibrary, hashWorkspaceFile } from "codetour-knowledge";

/**
 * The `codetour knowledge` family is the deterministic, native surface of the
 * Knowledge contract (ADR 0039): it reads and hashes files, never calls a
 * model, needs no API key and no network, and always writes exactly one
 * machine-readable JSON object on stdout. Diagnostics go to stderr only.
 *
 * Exit statuses are stable: 0 success, 2 usage/unusable workspace, 3 absence,
 * 4 invalid contract or evidence. Unexpected internal failures are 1.
 */
export const KNOWLEDGE_EXIT = { ok: 0, internal: 1, usage: 2, absent: 3, invalid: 4 } as const;

interface UsageFailure {
  status: "usage";
  reason: string;
  message?: string;
}

function emit(payload: object, exitCode: number): void {
  process.stdout.write(JSON.stringify(payload) + "\n");
  process.exitCode = exitCode;
}

function diagnose(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write("codetour knowledge: " + message + "\n");
}

async function runAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    diagnose(error);
    emit({ status: "error", reason: "internal_error" }, KNOWLEDGE_EXIT.internal);
  }
}

interface ResolvedWorkspace {
  status: "ok";
  workspace: string;
}

/**
 * Resolve the workspace once, from an explicit `--workspace` or the launch
 * directory: the real path is the only spelling evidence is computed against.
 * A missing, unreadable or non-directory workspace is a usage error (exit 2).
 */
export async function resolveWorkspace(explicit?: string): Promise<ResolvedWorkspace | UsageFailure> {
  const candidate = path.resolve(process.cwd(), explicit ?? ".");
  let real: string;
  try {
    real = await fs.realpath(candidate);
  } catch {
    return { status: "usage", reason: "workspace_unusable", message: "Workspace does not exist: " + candidate };
  }
  try {
    const info = await fs.stat(real);
    if (!info.isDirectory()) {
      return { status: "usage", reason: "workspace_unusable", message: "Workspace is not a directory: " + candidate };
    }
    await fs.access(real);
  } catch {
    return { status: "usage", reason: "workspace_unusable", message: "Workspace is not readable: " + candidate };
  }
  return { status: "ok", workspace: real };
}

function requireWorkspace(resolved: ResolvedWorkspace | UsageFailure): ResolvedWorkspace | undefined {
  if (resolved.status !== "ok") {
    emit(resolved, KNOWLEDGE_EXIT.usage);
    return undefined;
  }
  return resolved;
}

interface KnowledgeOptions {
  workspace?: string;
  query?: string;
}

async function listCommand(options: KnowledgeOptions): Promise<void> {
  const resolved = requireWorkspace(await resolveWorkspace(options.workspace));
  if (!resolved) return;
  const { workspace } = resolved;
  const library = await loadKnowledgeLibrary(workspace, knowledgeDirectory(workspace));
  const entries = await library.list(options.query);
  // An absent or empty catalogue is an absence, not a failure: native
  // exploration continues without Knowledge.
  if (entries.length === 0) {
    emit({ status: "empty", workspace, entries }, KNOWLEDGE_EXIT.absent);
    return;
  }
  emit({ status: "ok", workspace, entries }, KNOWLEDGE_EXIT.ok);
}

async function readCommand(name: string, options: KnowledgeOptions): Promise<void> {
  const resolved = requireWorkspace(await resolveWorkspace(options.workspace));
  if (!resolved) return;
  const { workspace } = resolved;
  const library = await loadKnowledgeLibrary(workspace, knowledgeDirectory(workspace));
  const read = await library.read(name);
  if (read.status === "valid") {
    emit({
      status: "valid",
      workspace,
      name: read.name,
      description: read.description,
      body: read.body,
      evidence: read.evidence.map(proof => ({ path: proof.path, sha256: proof.sha256 }))
    }, KNOWLEDGE_EXIT.ok);
    return;
  }
  // An unknown entry is an absence. Every other refusal is invalid and is
  // reported with its machine-readable reason only: never the body, a cited
  // path or a hash value.
  if (read.reason === "unknown_entry") {
    emit({ status: "absent", workspace, name }, KNOWLEDGE_EXIT.absent);
    return;
  }
  emit({ status: "invalid", workspace, name, reason: read.reason }, KNOWLEDGE_EXIT.invalid);
}

async function hashCommand(target: string, options: KnowledgeOptions): Promise<void> {
  const resolved = requireWorkspace(await resolveWorkspace(options.workspace));
  if (!resolved) return;
  const { workspace } = resolved;
  const hashed = await hashWorkspaceFile(workspace, target);
  if (hashed.status === "ok") {
    emit({ status: "ok", workspace, path: hashed.path, sha256: hashed.sha256 }, KNOWLEDGE_EXIT.ok);
    return;
  }
  if (hashed.status === "absent") {
    emit({ status: "absent", workspace, path: target, reason: hashed.reason }, KNOWLEDGE_EXIT.absent);
    return;
  }
  emit({ status: "invalid", workspace, path: target, reason: hashed.reason }, KNOWLEDGE_EXIT.invalid);
}

/** Register the native `knowledge` command family on the root program. */
export function registerKnowledgeCommand(program: Command): void {
  const knowledge = program
    .command("knowledge")
    .description("discover, verify and read Knowledge entries; deterministic, offline, no model");
  knowledge
    .command("list")
    .description("list Knowledge entries by name and description only")
    .option("--workspace <dir>", "workspace root (defaults to the current directory)")
    .option("--query <text>", "literal case-insensitive name or description filter")
    .action((options: KnowledgeOptions) => runAction(() => listCommand(options)));
  knowledge
    .command("read <name>")
    .description("read one Knowledge entry after verifying every declared SHA-256 proof")
    .option("--workspace <dir>", "workspace root (defaults to the current directory)")
    .action((name: string, options: KnowledgeOptions) => runAction(() => readCommand(name, options)));
  knowledge
    .command("hash <path>")
    .description("print the deterministic SHA-256 of a workspace file, for evidence proofs")
    .option("--workspace <dir>", "workspace root (defaults to the current directory)")
    .action((target: string, options: KnowledgeOptions) => runAction(() => hashCommand(target, options)));
}

/** True when the process was launched through the `knowledge` family. */
export function isKnowledgeInvocation(argv: readonly string[]): boolean {
  return argv[2] === "knowledge";
}

/**
 * A commander parse error inside the knowledge family keeps the family's
 * contract: JSON on stdout and the documented usage status, never the root
 * CLI's human message.
 */
export function reportKnowledgeUsageError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  emit({ status: "usage", reason: "invalid_arguments", message }, KNOWLEDGE_EXIT.usage);
}
