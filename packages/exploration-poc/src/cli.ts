import { resolve } from 'node:path';
import { explore } from './explore.ts';
import { mistral } from './mistral.ts';

const args = process.argv.slice(2);
let codeMode = false;
let memory: { directory: string } | undefined;
while (args[0]?.startsWith('--')) {
  const option = args.shift();
  if (option === '--code') codeMode = true;
  else if (option === '--memory' && args[0]) memory = { directory: resolve(args.shift()!) };
  else throw new Error('Unknown or incomplete option');
}
const [root, ...objective] = args;
if (!root || !objective.length) throw new Error('Usage: npm run explore -- [--code] [--memory <directory>] <workspace> <objective>');
const result = await explore({ root: resolve(root), objective: objective.join(' '), codeMode, memory, model: mistral(process.env.MISTRAL_API_KEY ?? '', process.env.MISTRAL_MODEL) });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
