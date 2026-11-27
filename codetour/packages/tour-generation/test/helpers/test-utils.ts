import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { validateCodetourTour } from "../../src/codetour-schema";

// Test helpers of the creation rules: the package's tests run against the rules
// alone, with no host or command-line surface in between.

export function git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      const code =
        error == null
          ? 0
          : typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code?: unknown }).code as number)
            : 1;
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code });
    });
  });
}

export function tempDir(prefix = "codetour-tour-generation-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function writeFile(workspaceRoot: string, relativePath: string, content: string): void {
  const target = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

export async function initGitRepo(dir: string, branch = "main"): Promise<void> {
  await git(["init", "-b", branch], dir);
  await git(["config", "user.email", "test@example.com"], dir);
  await git(["config", "user.name", "Test User"], dir);
  await git(["config", "commit.gpgsign", "false"], dir);
  await git(["config", "tag.gpgsign", "false"], dir);
}

export async function commitFile(
  dir: string,
  relativePath: string,
  content: string,
  message: string
): Promise<void> {
  const target = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  await git(["add", "-A"], dir);
  await git(["commit", "-m", message], dir);
}

export async function headSha(dir: string): Promise<string> {
  const result = await git(["rev-parse", "HEAD"], dir);
  return result.stdout.trim();
}

export function readTourFile(
  workspaceRoot: string,
  relativePath: string
): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8")
  );
}

export function tourFileValidAgainstSchema(
  workspaceRoot: string,
  relativePath: string
): boolean {
  return Boolean(validateCodetourTour(readTourFile(workspaceRoot, relativePath)));
}
