import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (!args[0] || (args.length !== 1 && (args.length !== 3 || args[1] !== '--workspace'))) {
  console.error('Usage: node evaluate.mjs result.json [--workspace directory]');
  process.exit(2);
}

try {
  const result = JSON.parse(await readFile(args[0], 'utf8'));
  const expected = JSON.parse(await readFile(path.join(base, 'expected.json'), 'utf8'));
  if (!Object.hasOwn(expected, result.taskId) || !Array.isArray(result.evidence)) {
    throw new Error('Unknown taskId or missing evidence array');
  }
  const root = await realpath(args[2] ?? path.join(base, 'workspace'));
  const valid = [];
  const invalid = [];
  for (const evidence of result.evidence) {
    try {
      if (typeof evidence.file !== 'string' || path.isAbsolute(evidence.file) ||
          !Number.isInteger(evidence.startLine) || !Number.isInteger(evidence.endLine) ||
          evidence.startLine < 1 || evidence.endLine < evidence.startLine) throw new Error('invalid reference');
      const file = await realpath(path.resolve(root, evidence.file));
      const relative = path.relative(root, file);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('outside workspace');
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      const contents = await readFile(file, 'utf8');
      const lines = contents === '' ? 0 : contents.split('\n').length - (contents.endsWith('\n') ? 1 : 0);
      if (evidence.endLine > lines) throw new Error('line out of bounds');
      valid.push({ ...evidence, file: relative.split(path.sep).join('/') });
    } catch (error) {
      invalid.push({ evidence, reason: error.message });
    }
  }
  const covered = expected[result.taskId].filter(zone => valid.some(ref =>
    ref.file === zone.file && ref.startLine <= zone.endLine && ref.endLine >= zone.startLine));
  const coveredIds = new Set(covered.map(zone => zone.id));
  console.log(JSON.stringify({ taskId: result.taskId, valid, invalid,
    covered: covered.map(zone => zone.id),
    missing: expected[result.taskId].filter(zone => !coveredIds.has(zone.id)).map(zone => zone.id),
    note: 'Valid references and overlapping zones require manual relevance and relation review.' }, null, 2));
} catch (error) {
  console.error(`Evaluation failed: ${error.message}`);
  process.exit(1);
}
