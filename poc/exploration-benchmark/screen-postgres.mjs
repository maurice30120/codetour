import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Necessary citation coverage for the fixed PostgreSQL commit. A cited line
// does not prove the associated claim, so a pass still requires manual review.
export function screenPostgres(task, result) {
  if (!result || result.status !== 'complete') return { status: 'incomplete', missing: [] };
  const expected = {
    'pg-parse': [626, 1083],
    'pg-analyze': [700, 709, 1213],
    'pg-flow': [1083, 1213, 1216],
  }[task];
  if (!expected) return { status: 'unsupported_task', missing: [] };
  const evidence = [...result.entryPoints, ...result.components, ...result.relations].flatMap(item => item.evidence);
  const missing = expected.filter(line => !evidence.some(e => e.file === 'src/backend/tcop/postgres.c' && e.startLine <= line && e.endLine >= line));
  return { status: missing.length ? 'missing_citations' : 'citations_present', missing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = JSON.parse(await readFile(process.argv[2], 'utf8'));
  if (data.commit !== '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5') throw Error('Expected PostgreSQL commit 70c4a57b');
  console.log(JSON.stringify(data.rows.map(row => ({ mode: row.mode, repetition: row.repetition, task: row.task, ...screenPostgres(row.task, row.result) })), null, 2));
}
