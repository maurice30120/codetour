import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import {
  knowledgeDirectory,
  loadKnowledgeLibrary,
  hashWorkspaceFile,
  saveKnowledgeProposal
} from "codetour-knowledge";

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

interface KnowledgeSaveOptions extends KnowledgeOptions {
  proposal?: string;
  name?: string;
  description?: string;
  bodyFile?: string;
  evidence?: string[];
}

/** Accumulate a repeatable option, preserving the order the user wrote. */
function repeatable(value: string, previous: string[]): string[] {
  return previous.concat(value);
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

const usage = (reason: string, message: string): void => {
  emit({ status: "usage", reason, message }, KNOWLEDGE_EXIT.usage);
};

/**
 * Read a JSON proposal file. An unreadable file is a usage error (the caller
 * gave a path that cannot be used); malformed JSON is an invalid contract and
 * is refused before anything is written.
 */
async function readProposal(file: string): Promise<{ status: "ok"; value: unknown } | { status: "unreadable" } | { status: "malformed" }> {
  let source: string;
  try {
    source = await fs.readFile(file, "utf8");
  } catch {
    process.stderr.write("codetour knowledge: cannot read proposal " + file + "\n");
    return { status: "unreadable" };
  }
  try {
    return { status: "ok", value: JSON.parse(source) };
  } catch {
    return { status: "malformed" };
  }
}

/**
 * Validate and persist a Knowledge proposal (zero, one or many entries).
 *
 * A proposal file and the convenience flags are two ways to describe the same
 * input, never combined. Validation, conflict detection and publication are
 * owned by `saveKnowledgeProposal`, so the CLI cannot diverge from the shared
 * contract: a refusal publishes nothing and an existing entry is preserved.
 * The result carries names only — never a body, a hash or a resolved path.
 */
async function saveCommand(options: KnowledgeSaveOptions): Promise<void> {
  const resolved = requireWorkspace(await resolveWorkspace(options.workspace));
  if (!resolved) return;
  const { workspace } = resolved;

  const hasProposal = options.proposal !== undefined;
  const hasConvenience = options.name !== undefined || options.description !== undefined ||
    options.bodyFile !== undefined || (options.evidence ?? []).length > 0;
  if (hasProposal && hasConvenience) {
    usage("ambiguous_input", "Use either --proposal or the convenience flags, not both.");
    return;
  }
  if (!hasProposal && !hasConvenience) {
    usage("missing_input", "Pass --proposal, or --name, --description, --body-file and --evidence.");
    return;
  }

  let proposal: unknown;
  if (hasProposal) {
    const file = path.resolve(process.cwd(), options.proposal!);
    const read = await readProposal(file);
    if (read.status === "unreadable") {
      usage("proposal_unreadable", "Cannot read proposal: " + file);
      return;
    }
    if (read.status === "malformed") {
      emit({ status: "invalid", workspace, rejected: [{ reason: "malformed_proposal" }] }, KNOWLEDGE_EXIT.invalid);
      return;
    }
    proposal = read.value;
  } else {
    if (options.name === undefined || options.description === undefined || options.bodyFile === undefined) {
      usage("missing_entry_field", "Convenience mode requires --name, --description and --body-file.");
      return;
    }
    // The body is the one input resolved against the workspace, like evidence.
    const file = path.resolve(workspace, options.bodyFile);
    let body: string;
    try {
      body = await fs.readFile(file, "utf8");
    } catch {
      process.stderr.write("codetour knowledge: cannot read body file " + options.bodyFile + "\n");
      usage("body_unreadable", "Cannot read body file: " + options.bodyFile);
      return;
    }
    proposal = {
      entries: [{
        name: options.name,
        description: options.description,
        body,
        evidence: (options.evidence ?? []).map(evidence => ({ path: evidence }))
      }]
    };
  }

  const result = await saveKnowledgeProposal(workspace, proposal);
  if (result.status === "saved") {
    emit({ status: "saved", workspace, saved: result.saved }, KNOWLEDGE_EXIT.ok);
    return;
  }
  if (result.status === "no-op") {
    // An explicit zero-entry proposal is a valid, observable no-op.
    emit({ status: "no-op", workspace, entries: [] }, KNOWLEDGE_EXIT.ok);
    return;
  }
  if (result.status === "conflict") {
    emit({ status: "conflict", workspace, conflicts: result.conflicts }, KNOWLEDGE_EXIT.invalid);
    return;
  }
  emit({ status: "invalid", workspace, rejected: result.rejected }, KNOWLEDGE_EXIT.invalid);
}

/** Register the native `knowledge` command family on the root program. */
export function registerKnowledgeCommand(program: Command): void {
  const knowledge = program
    .command("knowledge")
    .description("discover, verify, read and save Knowledge entries; deterministic, offline, no model");
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
  knowledge
    .command("save")
    .description("validate and persist a proposal (zero, one or many entries); nothing is written on any refusal")
    .option("--workspace <dir>", "workspace root (defaults to the current directory)")
    .option("--proposal <file>", 'proposal JSON: {"entries":[{"name","description","body","evidence":[{"path","sha256"?}]}]}')
    .option("--name <name>", "convenience: entry name, with --description, --body-file and --evidence")
    .option("--description <text>", "convenience: one-line entry description")
    .option("--body-file <file>", "convenience: Markdown body file, resolved against the workspace")
    .option("--evidence <path>", "convenience: workspace-relative evidence path (repeatable)", repeatable, [])
    .action((options: KnowledgeSaveOptions) => runAction(() => saveCommand(options)));
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
