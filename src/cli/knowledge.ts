import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import {
  KNOWLEDGE_SAVE_MODES,
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
  additionFile?: string;
  evidence?: string[];
  mode?: string;
  expectedRevision?: string;
}

/** The engine's write-mode vocabulary (spec #232), used as a lookup set. */
const SAVE_MODES = new Set<string>(KNOWLEDGE_SAVE_MODES);

/** The modes conditioned on the Knowledge Revision the caller read. */
const REVISION_MODES = new Set<string>(KNOWLEDGE_SAVE_MODES.filter(mode => mode !== "create"));

/** Accumulate a repeatable option, preserving the order the user wrote. */
function repeatable(value: string, previous: string[]): string[] {
  return previous.concat(value);
}

async function listCommand(options: KnowledgeOptions): Promise<void> {
  const resolved = requireWorkspace(await resolveWorkspace(options.workspace));
  if (!resolved) return;
  const { workspace } = resolved;
  const library = await loadKnowledgeLibrary(workspace, knowledgeDirectory(workspace));
  const { entries, invalid } = await library.verifiedList(options.query);
  // An absent or empty catalogue is an absence, not a failure: native
  // exploration continues without Knowledge.
  if (entries.length === 0) {
    emit({ status: "empty", workspace, entries, invalid }, KNOWLEDGE_EXIT.absent);
    return;
  }
  emit({ status: "ok", workspace, entries, invalid }, KNOWLEDGE_EXIT.ok);
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
      revision: read.revision,
      body: read.body,
      evidence: read.evidence.map(proof => ({ path: proof.path, sha256: proof.sha256 }))
    }, KNOWLEDGE_EXIT.ok);
    return;
  }
  // An unknown entry is an absence. Every other refusal is invalid and is
  // reported with its machine-readable reason only: never the body, a cited
  // path or a hash value. Its revision still leaves with the refusal whenever
  // the entry file was readable: an invalid entry stays repairable. A composed
  // refusal names too the faulty daughter of its own level (`via`), the only
  // repair target the caller can descend to; an atomic refusal never carries
  // the field, so its payload stays byte-identical.
  if (read.reason === "unknown_entry") {
    emit({ status: "absent", workspace, name }, KNOWLEDGE_EXIT.absent);
    return;
  }
  emit(
    {
      status: "invalid",
      workspace,
      name,
      reason: read.reason,
      ...(read.revision === undefined ? {} : { revision: read.revision }),
      ...(read.via === undefined ? {} : { via: read.via })
    },
    KNOWLEDGE_EXIT.invalid
  );
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
 * Read one Markdown input file (`--body-file`, `--addition-file`) against the
 * workspace. An unreadable file is a usage error: the caller gave a path that
 * cannot be used, and nothing is validated or written.
 */
async function readWorkspaceMarkdown(
  workspace: string,
  relative: string,
  label: "body" | "addition"
): Promise<{ status: "ok"; text: string } | { status: "unreadable" }> {
  const file = path.resolve(workspace, relative);
  try {
    return { status: "ok", text: await fs.readFile(file, "utf8") };
  } catch {
    process.stderr.write("codetour knowledge: cannot read " + label + " file " + relative + "\n");
    usage(`${label}_unreadable`, "Cannot read " + label + " file: " + relative);
    return { status: "unreadable" };
  }
}

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
 * The mode is `create` (default), `append` or `replace`; append and replace are
 * conditioned on the Knowledge Revision the caller read, so an append can
 * enrich an entry it actually read and a replace can repair an entry whose
 * contract no longer verifies without ever reading its body. The result
 * carries names only — never a body, a hash or a resolved path.
 */
async function saveCommand(options: KnowledgeSaveOptions): Promise<void> {
  const resolved = requireWorkspace(await resolveWorkspace(options.workspace));
  if (!resolved) return;
  const { workspace } = resolved;

  if (options.mode !== undefined && !SAVE_MODES.has(options.mode)) {
    usage("unknown_mode", '--mode must be "create", "append" or "replace".');
    return;
  }

  const hasProposal = options.proposal !== undefined;
  const hasConvenience = options.name !== undefined || options.description !== undefined ||
    options.bodyFile !== undefined || options.additionFile !== undefined ||
    (options.evidence ?? []).length > 0;
  if (hasProposal && hasConvenience) {
    usage("ambiguous_input", "Use either --proposal or the convenience flags, not both.");
    return;
  }
  if (!hasProposal && !hasConvenience) {
    usage("missing_input", "Pass --proposal, or --name, --description, --body-file and --evidence.");
    return;
  }
  if (hasProposal && options.expectedRevision !== undefined) {
    usage("ambiguous_input", "Declare expectedRevision inside the proposal entry, not as a flag.");
    return;
  }
  if (!hasProposal && options.expectedRevision !== undefined &&
    (options.mode === undefined || !REVISION_MODES.has(options.mode))) {
    usage("missing_mode", "--expected-revision only applies to --mode append or --mode replace.");
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
    if (options.mode !== undefined && proposal !== null && typeof proposal === "object" && !Array.isArray(proposal)) {
      const record = proposal as Record<string, unknown>;
      if (record.mode !== undefined && record.mode !== options.mode) {
        usage("ambiguous_input", "The proposal declares another mode; use either --mode or the proposal's mode.");
        return;
      }
      proposal = { ...record, mode: options.mode };
    }
  } else if (options.mode === "append") {
    // An append carries an addition, never a description or a body: it can
    // not rewrite what the entry is, only extend it.
    if (options.name === undefined || options.additionFile === undefined) {
      usage("missing_entry_field", "Append convenience mode requires --name and --addition-file.");
      return;
    }
    if (options.description !== undefined || options.bodyFile !== undefined) {
      usage("ambiguous_input", "An append takes --addition-file; --description and --body-file belong to create and replace.");
      return;
    }
    const addition = await readWorkspaceMarkdown(workspace, options.additionFile, "addition");
    if (addition.status !== "ok") return;
    proposal = {
      mode: "append",
      entries: [{
        name: options.name,
        addition: addition.text,
        evidence: (options.evidence ?? []).map(evidence => ({ path: evidence })),
        ...(options.expectedRevision === undefined ? {} : { expectedRevision: options.expectedRevision })
      }]
    };
  } else {
    if (options.name === undefined || options.description === undefined || options.bodyFile === undefined) {
      if (options.additionFile !== undefined) {
        usage("missing_mode", "--addition-file only applies to --mode append.");
        return;
      }
      usage("missing_entry_field", "Convenience mode requires --name, --description and --body-file.");
      return;
    }
    // The body is the one input resolved against the workspace, like evidence.
    const body = await readWorkspaceMarkdown(workspace, options.bodyFile, "body");
    if (body.status !== "ok") return;
    proposal = {
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      entries: [{
        name: options.name,
        description: options.description,
        body: body.text,
        evidence: (options.evidence ?? []).map(evidence => ({ path: evidence })),
        ...(options.expectedRevision === undefined ? {} : { expectedRevision: options.expectedRevision })
      }]
    };
  }

  const result = await saveKnowledgeProposal(workspace, proposal);
  if (result.status === "saved") {
    // Warnings are advisory backing signals about published entries; they
    // name published entries only, never a cited path or a hash value.
    emit(
      {
        status: "saved",
        workspace,
        saved: result.saved,
        warnings: result.warnings,
      },
      KNOWLEDGE_EXIT.ok
    );
    return;
  }
  if (result.status === "appended") {
    // An append is a modification, never a creation: the CLI reports it with
    // its own status and keeps naming entries only.
    emit(
      {
        status: "appended",
        workspace,
        appended: result.appended,
        warnings: result.warnings,
      },
      KNOWLEDGE_EXIT.ok
    );
    return;
  }
  if (result.status === "replaced") {
    // A rewrite is a modification, never a creation: the CLI reports it with
    // its own status and keeps naming entries only.
    emit(
      {
        status: "replaced",
        workspace,
        replaced: result.replaced,
        warnings: result.warnings,
      },
      KNOWLEDGE_EXIT.ok
    );
    return;
  }
  if (result.status === "no_change") {
    // An addition that brought nothing literally new is a completed no-op:
    // a success, never a refusal, and never a publication.
    emit({ status: "no_change", workspace }, KNOWLEDGE_EXIT.ok);
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
    .description("list Knowledge entries by name, description and revision; a composed entry also names its daughters")
    .option("--workspace <dir>", "workspace root (defaults to the current directory)")
    .option("--query <text>", "literal case-insensitive name or description filter")
    .action((options: KnowledgeOptions) => runAction(() => listCommand(options)));
  knowledge
    .command("read <name>")
    .description("read one Knowledge entry and its revision after verifying every declared SHA-256 proof")
    .option("--workspace <dir>", "workspace root (defaults to the current directory)")
    .action((name: string, options: KnowledgeOptions) => runAction(() => readCommand(name, options)));
  knowledge
    .command("hash <path>")
    .description("print the deterministic SHA-256 of a workspace file, for evidence proofs")
    .option("--workspace <dir>", "workspace root (defaults to the current directory)")
    .action((target: string, options: KnowledgeOptions) => runAction(() => hashCommand(target, options)));
  knowledge
    .command("save")
    .description("validate and persist a proposal (zero, one or many entries); an entry declaring `dependencies` is composed; nothing is written on any refusal")
    .option("--workspace <dir>", "workspace root (defaults to the current directory)")
    // `dependencies` is the only way to compose an entry from the CLI: two
    // daughters at least, names only — the engine resolves each file and pins
    // her revision itself. An append never accepts the field, and a replace of
    // a composed entry redeclares every daughter it carried or is refused:
    // `dependencies_incomplete` for a missing list, `dependencies_removed` for
    // one that drops a daughter — a swap included.
    .option("--proposal <file>", 'proposal JSON: {"mode"?,"entries":[{"name","description","body","evidence":[{"path","sha256"?}],"dependencies":[{"name"}]?,"expectedRevision"?}]} or, for append, {"mode":"append","entries":[{"name","addition","evidence"?,"expectedRevision"}]}')
    .option("--mode <mode>", 'write mode: "create" (default), "append" or "replace"')
    .option("--expected-revision <token>", "convenience: Knowledge Revision of the appended or replaced entry; required by --mode append and --mode replace")
    .option("--name <name>", "convenience: entry name, with --description, --body-file and --evidence, or with --addition-file for append")
    .option("--description <text>", "convenience: one-line entry description (create and replace)")
    .option("--body-file <file>", "convenience: Markdown body file, resolved against the workspace (create and replace)")
    .option("--addition-file <file>", "convenience: Markdown addition inserted verbatim by append, resolved against the workspace")
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
