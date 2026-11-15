import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const MAX_FILES = 500;
const MAX_BYTES = 1024 * 1024;
const MAX_OUTPUT = 12000;

/** Read-only workspace interface. Symlinks escaping the workspace are rejected. */
export async function workspace(root: string) {
  const base = await realpath(root);
  const cache = new Map<string, string[]>();
  async function checked(path: string) {
    const target = await realpath(resolve(base, path));
    const rel = relative(base, target);
    if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(base, rel) !== target) throw new Error('Path outside workspace');
    return target;
  }
  async function list(maxFiles = MAX_FILES) {
    const files: string[] = [];
    async function visit(dir: string, prefix: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (files.length >= maxFiles) return;
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await visit(resolve(dir, entry.name), name);
        else if (entry.isFile()) files.push(name);
      }
    }
    await visit(base, '');
    return files.sort();
  }
  async function read(file: string, startLine = 1, endLine = startLine + 99, fresh = false) {
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine - startLine >= 100) throw new Error('Invalid line range');
    const path = await checked(file);
    let lines = fresh ? undefined : cache.get(path);
    if (!lines) {
      const info = await stat(path);
      if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Not a regular file or file too large');
      const text = await readFile(path, 'utf8');
      lines = text === '' ? [] : text.split('\n');
      if (text.endsWith('\n')) lines.pop();
      cache.set(path, lines);
    }
    return lines.slice(startLine - 1, endLine).map((text, i) => ({ line: startLine + i, text })).slice(0, 100);
  }
  async function search(query: string) {
    if (!query || query.length > 200) throw new Error('Invalid query');
    const found: { file: string; line: number; text: string }[] = [];
    for (const file of await list(30000)) {
      try {
        const path = await checked(file);
        const info = await stat(path);
        if (!info.isFile() || info.size > MAX_BYTES) continue;
        const lines = (await readFile(path, 'utf8')).split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(query)) found.push({ file, line: i + 1, text: lines[i].slice(0, 500) });
          if (found.length >= 50) return found;
        }
      } catch { /* unreadable files are not evidence */ }
    }
    return found;
  }
  async function git(timeout = 3000) {
    const { stdout } = await run('git', ['-C', base, 'log', '-1', '--format=%H%n%s'], { timeout: Math.max(1, Math.min(3000, timeout)), maxBuffer: MAX_OUTPUT, env: { PATH: process.env.PATH, HOME: base, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' } });
    return stdout.slice(0, MAX_OUTPUT);
  }
  return { list, read, search, git };
}
