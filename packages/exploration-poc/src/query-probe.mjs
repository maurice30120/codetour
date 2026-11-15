import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runScript } from '../../exploration-sandbox/index.js';

// This evaluates the narrow contract “literal query -> file/line evidence”.
// It is not a validator for arbitrary scripts or for their security.
export async function probeLiteralQuery(code, scripts = {}, deadline = Infinity) {
  const root = await mkdtemp(path.join(tmpdir(), 'codetour-param-probe-'));
  const first = `alpha_${randomUUID().replaceAll('-', '')}`;
  const second = `beta_${randomUUID().replaceAll('-', '')}`;
  const absent = `absent_${randomUUID().replaceAll('-', '')}`;
  try {
    await writeFile(path.join(root, 'first.txt'), `before\n${first}\nafter\n`);
    await writeFile(path.join(root, 'second.txt'), `before\n${second}\nafter\n`);
    const samples = [];
    for (const query of [first, second, absent]) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { status: 'inconclusive', reason: 'Probe exceeded the time budget.' };
      try { samples.push(await runScript({ workspace: root, code, params: { query }, scripts, timeoutMs: Math.min(3000, remaining) })); }
      catch (error) { return { status: 'inconclusive', reason: `Probe could not run: ${error.message}` }; }
    }
    function references(value) {
      if (!value || typeof value !== 'object') return [];
      if (Array.isArray(value)) return value.flatMap(references);
      const found = [];
      if (typeof value.file === 'string') {
        const start = value.line ?? value.startLine ?? value.start;
        const end = value.endLine ?? (Array.isArray(value.lines) ? start + value.lines.length - 1 : start);
        if (Number.isInteger(start) && Number.isInteger(end)) found.push({ file: value.file, start, end });
      }
      return found.concat(Object.values(value).flatMap(references));
    }
    const refs = samples.map(references);
    const expected = ['first.txt', 'second.txt'];
    const valid = expected.every((file, i) => refs[i].length > 0 && refs[i].some(r => r.file === file && r.start <= 2 && r.end >= 2) && refs[i].every(r => r.file === file));
    if (!valid || refs[2].length !== 0) return { status: 'fail', reason: 'Results did not distinguish the two matching files and the missing query.', refs };
    return { status: 'pass', refs };
  } finally { await rm(root, { recursive: true, force: true }); }
}
