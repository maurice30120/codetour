// Deterministic protocol double. No model or benchmark measurement is involved.
import { readFile, writeFile } from 'node:fs/promises';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
if (!['memory-on', 'memory-off'].includes(request.mode) || request.mode !== process.argv[2] || request.mode !== process.env.EXPLORATION_MODE || 'expected' in request) process.exit(2);
let count = null;
if (request.mode === 'memory-on') {
  if (!request.memoryDirectory) process.exit(3);
  const file = `${request.memoryDirectory}/counter`;
  try { count = Number(await readFile(file, 'utf8')); } catch { count = 0; }
  count++;
  await writeFile(file, String(count));
  if (count === 2) process.exit(7);
} else if ('memoryDirectory' in request) process.exit(4);
const source = await readFile(`${request.root}/src/math.js`, 'utf8');
process.stdout.write(JSON.stringify({ root: request.root, count, changed: source.includes('quantity * price'), status: 'complete', evidence: [{ file: 'src/math.js', startLine: 1, endLine: 2 }], metrics: { inputTokens: 5, usageAvailable: request.mode !== 'memory-on', memoryReuses: 0, memoryPurges: 0 } }));
