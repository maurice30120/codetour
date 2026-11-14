import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const entrySchema = z.object({ id: z.string(), objective: z.string().max(500), description: z.string().max(300), code: z.string().max(32768), parameters: z.array(z.string()), successes: z.number().int().nonnegative(), failures: z.number().int().nonnegative(), inactivity: z.number().int().nonnegative() });
type Entry = z.infer<typeof entrySchema>;
const digest = (s: string) => createHash('sha256').update(s).digest('hex');

/** Local experimental store. The file name derives from the real repository path. */
export async function scriptMemory(root: string, directory: string, options: { deduplicate?: boolean } = {}) {
  const repo = await realpath(root);
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${digest(repo)}.json`);
  let entries: Entry[];
  try { entries = z.array(entrySchema).max(20).parse(JSON.parse(await readFile(file, 'utf8'))); }
  catch (error: any) { if (error?.code === 'ENOENT') entries = []; else throw new Error('Invalid script memory'); }
  let purges = 0;
  const persist = async () => {
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(entries), { mode: 0o600 });
    await rename(temporary, file);
  };
  const prune = () => {
    const original = entries.length;
    entries = entries.filter(e => e.inactivity < 10 && !(e.successes + e.failures >= 3 && e.failures >= 2 && e.successes + e.failures === 3));
    purges += original - entries.length;
    while (entries.length > 20) {
      entries.sort((a, b) => (a.successes / Math.max(1, a.successes + a.failures) - b.successes / Math.max(1, b.successes + b.failures)) || a.successes - b.successes || a.id.localeCompare(b.id));
      entries.shift(); purges++;
    }
  };
  return {
    catalog: () => entries.map(({ id, objective, description, parameters }) => ({ id, objective, description, parameters })),
    sources: () => Object.fromEntries(entries.map(({ id, code }) => [id, code])),
    get: (id: string) => entries.find(e => e.id === id),
    async failure(id: string) {
      const entry = entries.find(e => e.id === id);
      if (!entry) return;
      entry.failures++;
      prune();
      await persist();
    },
    async finish(successIds: string[], candidates: { objective: string; description: string; code: string; parameters: string[]; verified: boolean }[]) {
      for (const entry of entries) {
        const successes = successIds.filter(id => id === entry.id).length;
        if (successes) { entry.successes += successes; entry.inactivity = 0; }
        else entry.inactivity++;
      }
      for (const candidate of candidates) {
        const id = digest(`${candidate.code}\0${candidate.description}`).slice(0, 16);
        // Only suppress future exact duplicates. Existing ids may be referenced by
        // other scripts, so enabling this option must not rewrite the library.
        if (options.deduplicate && entries.some(e => e.code === candidate.code && JSON.stringify([...e.parameters].sort()) === JSON.stringify([...candidate.parameters].sort()))) continue;
        if (!entries.some(e => e.id === id)) { const { verified, ...entry } = candidate; entries.push({ id, ...entry, successes: verified ? 1 : 0, failures: 0, inactivity: 0 }); }
      }
      prune();
      await persist();
    },
    purges: () => purges
  };
}
