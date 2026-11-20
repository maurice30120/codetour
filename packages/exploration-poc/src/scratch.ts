import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT = 1_000_000;
const PAGE = 8_000;
const AGE = 24 * 60 * 60 * 1000;

/** Only remove old directories with a valid owner known to have exited. */
export function cleanScratch(root: string, now = Date.now()): void {
  const base = join(root, '.tours', '.scratch');
  try {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(base, entry.name);
      try {
        if (now - statSync(dir).mtimeMs < AGE) continue;
        const owner = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'));
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) continue;
        try { process.kill(owner.pid, 0); continue; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue; }
        rmSync(dir, { recursive: true, force: true });
      } catch { /* Unknown ownership or inaccessible directory: keep it. */ }
    }
  } catch { /* Missing or inaccessible scratch directory. */ }
}

export function createScratch(root: string, runId: string) {
  const dir = join(root, '.tours', '.scratch', runId);
  const entries = new Map<string, string>();
  let bytes = 0;
  let initialized = false;
  return {
    save(id: string, content: string): boolean {
      const size = Buffer.byteLength(content);
      if (size > LIMIT - bytes) return false;
      try {
        if (!initialized) {
          mkdirSync(dir, { recursive: true, mode: 0o700 });
          writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
          initialized = true;
        }
        const file = join(dir, `${entries.size + 1}.json`);
        writeFileSync(file, content, { mode: 0o600 });
        entries.set(id, file);
        bytes += size;
        return true;
      } catch { return false; }
    },
    read(id: string, offset: number) {
      const file = entries.get(id);
      if (!file) throw new Error('Unknown or unavailable scratch result');
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer');
      const data = readFileSync(file);
      if (offset > data.length || (offset < data.length && (data[offset] & 0xc0) === 0x80)) throw new Error('Invalid UTF-8 byte offset; use nextOffset');
      let end = Math.min(offset + PAGE, data.length);
      while (end < data.length && (data[end] & 0xc0) === 0x80) end--;
      const page = () => ({ content: data.subarray(offset, end).toString('utf8'), offset, nextOffset: end < data.length ? end : null, totalBytes: data.length, note: 'Temporary tool result; cite original source files, not this result.' });
      while (Buffer.byteLength(JSON.stringify(page())) > PAGE && end > offset) {
        end = offset + Math.floor((end - offset) * 0.9);
        while (end > offset && end < data.length && (data[end] & 0xc0) === 0x80) end--;
      }
      return page();
    },
    cleanup() { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Cleanup must not mask the result. */ } }
  };
}
