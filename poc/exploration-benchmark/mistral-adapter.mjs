import { explore } from '../../packages/exploration-poc/src/explore.ts';
import { mistral } from '../../packages/exploration-poc/src/mistral.ts';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
if (!['baseline', 'code-mode', 'memory-on', 'memory-off'].includes(request.mode) || request.mode !== process.argv[2]) throw new Error('Invalid mode');
const result = await explore({ root: request.root, objective: request.objective, budget: request.budget,
  codeMode: request.mode === 'code-mode' || request.mode === 'memory-on' || request.mode === 'memory-off',
  ...(request.mode === 'memory-on' ? { memory: { directory: request.memoryDirectory } } : {}),
  model: mistral(process.env.MISTRAL_API_KEY ?? '', process.env.MISTRAL_MODEL) });
process.stdout.write(JSON.stringify(result));
