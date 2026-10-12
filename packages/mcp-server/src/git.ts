import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { WorkspaceContext } from "./types";

// Toutes les opérations Git du serveur passent par `git` en ligne de commande,
// exécuté dans le workspace configuré. Le Changes Tour dépend de cet
// historique : merge-base, vérification du SHA de tête, liste des fichiers
// modifiés et détection des changements non committés.

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function git(args: string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code =
          error == null
            ? 0
            : typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code?: unknown }).code as number)
            : 1;
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code });
      }
    );
  });
}

export async function isGitRepository(ctx: WorkspaceContext): Promise<boolean> {
  const result = await git(["rev-parse", "--is-inside-work-tree"], ctx.root);
  return result.code === 0 && result.stdout.trim() === "true";
}

export async function currentHeadSha(
  ctx: WorkspaceContext
): Promise<string | null> {
  const result = await git(["rev-parse", "HEAD"], ctx.root);
  return result.code === 0 ? result.stdout.trim() : null;
}

export async function currentBranchName(
  ctx: WorkspaceContext
): Promise<string | null> {
  const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], ctx.root);
  return result.code === 0 ? result.stdout.trim() : null;
}

// Résout une référence Git fournie par l'agent en SHA de commit complet
// avant toute invocation Git : une chaîne brute passée en argument positionnel
// pourrait sinon être interprétée comme une option Git (ex. `--output=...`)
// et modifier le comportement de la commande. La couche de validation refuse
// les références commençant par `-`, donc l'argument composé ci-dessous ne
// peut être interprété que comme un rev.
export async function resolveCommit(
  ctx: WorkspaceContext,
  ref: string
): Promise<string | null> {
  const result = await git(
    ["rev-parse", "--verify", `${ref}^{commit}`],
    ctx.root
  );
  return result.code === 0 && result.stdout.trim().length > 0
    ? result.stdout.trim()
    : null;
}

export async function mergeBase(
  ctx: WorkspaceContext,
  a: string,
  b: string
): Promise<string> {
  const result = await git(["merge-base", a, b], ctx.root);
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || `git merge-base failed (exit code ${result.code})`
    );
  }
  return result.stdout.trim();
}

export async function committedDiffIsEmpty(
  ctx: WorkspaceContext,
  a: string,
  b: string
): Promise<boolean> {
  const result = await git(["diff", "--quiet", a, b], ctx.root);
  return result.code === 0;
}

export async function changedFiles(
  ctx: WorkspaceContext,
  a: string,
  b: string
): Promise<string[]> {
  const result = await git(["diff", "--name-only", "-z", a, b], ctx.root);
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || `git diff failed (exit code ${result.code})`
    );
  }
  return result.stdout.split("\0").filter((entry) => entry.length > 0);
}

export interface CommitAnchor {
  kind: "file" | "directory" | "other";
  contents?: string;
}

// Lit les ancres dans l'arbre du commit, jamais via le checkout (qui peut
// contenir des modifications exclues, des suppressions ou des liens
// symboliques). Seuls les blobs demandés sont chargés ; les modes de l'arbre
// distinguent les fichiers réguliers des liens symboliques et submodules.
export async function readCommitAnchors(
  ctx: WorkspaceContext,
  ref: string,
  files: string[]
): Promise<Map<string, CommitAnchor>> {
  const prefix = normalizeSlashes(await workspacePrefix(ctx));
  const result = await git(["ls-tree", "--full-tree", "-r", "-t", "-z", ref], ctx.root);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Unable to read the commit tree.");
  }
  const requested = new Set(files.map((file) => path.posix.normalize(normalizeSlashes(file))));
  const anchors = new Map<string, CommitAnchor>([[".", { kind: "directory" }]]);
  for (const entry of result.stdout.split("\0")) {
    const separator = entry.indexOf("\t");
    if (separator < 0) continue;
    const [mode, type, object] = entry.slice(0, separator).split(" ");
    const repoPath = entry.slice(separator + 1);
    if (!repoPath.startsWith(prefix)) continue;
    const file = repoPath.slice(prefix.length);
    const kind = type === "tree" ? "directory"
      : mode === "100644" || mode === "100755" ? "file" : "other";
    const anchor: CommitAnchor = { kind };
    if (kind === "file" && requested.has(file)) {
      const blob = await git(["cat-file", "blob", object], ctx.root);
      if (blob.code !== 0) {
        throw new Error(blob.stderr.trim() || `Unable to read ${file} at ${ref}.`);
      }
      anchor.contents = blob.stdout;
    }
    anchors.set(file, anchor);
  }
  return anchors;
}

export async function renamedFiles(
  ctx: WorkspaceContext,
  base: string,
  head: string
): Promise<Map<string, string>> {
  const prefix = normalizeSlashes(await workspacePrefix(ctx));
  const result = await git(["diff", "--name-status", "--find-renames", "-z", base, head], ctx.root);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Unable to read file renames.");
  }
  const fields = result.stdout.split("\0");
  const renames = new Map<string, string>();
  for (let index = 0; index < fields.length && fields[index];) {
    const status = fields[index++];
    const oldPath = fields[index++];
    if (status.startsWith("R") || status.startsWith("C")) {
      const newPath = fields[index++];
      if (status.startsWith("R") && oldPath.startsWith(prefix) && newPath.startsWith(prefix)) {
        renames.set(newPath.slice(prefix.length), oldPath.slice(prefix.length));
      }
    }
  }
  return renames;
}

export async function workspacePrefix(ctx: WorkspaceContext): Promise<string> {
  const result = await git(["rev-parse", "--show-prefix"], ctx.root);
  return result.code === 0 ? result.stdout.trim() : "";
}

export const RESERVED_TOUR_FILES = [
  ".tours/project.tour",
  ".tours/changes.tour",
];

export interface UncommittedEntry {
  path: string;
  status: string;
}

export function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

// Changements staged, unstaged et untracked du workspace, à l'exception des
// deux fichiers de Tour réservés : une génération précédente ne doit pas
// provoquer son propre avertissement de workspace sale.
export async function uncommittedChanges(
  ctx: WorkspaceContext
): Promise<UncommittedEntry[]> {
  const result = await git(
    ["status", "--porcelain=v1", "--untracked-files=normal"],
    ctx.root
  );
  if (result.code !== 0) {
    return [];
  }
  const prefix = normalizeSlashes(await workspacePrefix(ctx));
  const entries: UncommittedEntry[] = [];
  for (const line of result.stdout.split("\n")) {
    if (line.length < 4) {
      continue;
    }
    const status = line.slice(0, 2);
    let repoPath = line.slice(3);
    if ((status.includes("R") || status.includes("C")) && repoPath.includes(" -> ")) {
      repoPath = repoPath.slice(0, repoPath.indexOf(" -> "));
    }
    if (!normalizeSlashes(repoPath).startsWith(prefix)) {
      continue;
    }
    let workspacePath = normalizeSlashes(repoPath).slice(prefix.length);
    if (status === "??" && workspacePath.endsWith("/")) {
      const directory = workspacePath.slice(0, -1);
      if (directory === ".tours" && toursDirectoryOnlyContainsReserved(ctx, directory)) {
        continue;
      }
    }
    if (RESERVED_TOUR_FILES.includes(workspacePath)) {
      continue;
    }
    entries.push({ path: workspacePath, status });
  }
  return entries;
}

// Un répertoire `.tours` non suivi apparaît sous la forme d'une seule entrée
// `?? .tours/` en mode « normal » : on l'ignore uniquement si son contenu se
// limite aux fichiers de Tour réservés.
function toursDirectoryOnlyContainsReserved(
  ctx: WorkspaceContext,
  directory: string
): boolean {
  const absolute = path.resolve(ctx.root, directory);
  let files: string[];
  try {
    files = fs.readdirSync(absolute, { recursive: true }) as string[];
  } catch {
    return false;
  }
  return (
    files.length > 0 &&
    files.every((file) =>
      RESERVED_TOUR_FILES.includes(
        normalizeSlashes(path.posix.join(directory, file))
      )
    )
  );
}
