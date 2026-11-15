import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScript } from '../../packages/exploration-sandbox/index.js';

const base = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(base, 'workspace');
const output = process.argv[2];
if (!output) throw Error('Usage: node generate-toolbox.mjs OUTPUT');
const key = process.env.MISTRAL_API_KEY || execFileSync('security', ['find-generic-password', '-s', 'ai.mistral.vibe', '-a', 'MISTRAL_API_KEY', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const model = process.env.MISTRAL_MODEL || 'mistral-small-latest';
const rows = [];
await writeFile(output, JSON.stringify({ model, rows }), { flag: 'wx' });
for (let repetition = 1; repetition <= 3; repetition++) {
  const messages = [
    { role: 'system', content: 'Create a reusable repository exploration function. No previous memory is available. Return only JSON with keys code and description.' },
    { role: 'user', content: 'Create one compact JavaScript expression to find a literal symbol specified by params.query and return a few bounded source excerpts around its occurrences. It should reduce subsequent search-and-read turns and output volume. Available synchronous functions: search(text) returns [{file,line,text}], read(file,start,end) returns {file,start,lines}. read accepts at most 100 lines; line numbers start at 1. Code is evaluated as an expression, not a function or statement. Use params.query, never a hardcoded symbol. Return valid JSON only.' + (process.env.GUIDED ? ' Use the exact search result properties file and line (not l). Limit the number of hits to at most 6. Clamp the start to at least 1 with Math.max(1, hit.line-5); use hit.line+5 as the end. Do not use read(...).lines as a number. Return the result of read for each hit. Ensure queries with zero hits return an empty array.' : '') }
  ];
  let row = { repetition };
  try {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 1000 }), signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const data = await response.json();
    const content = String(data.choices[0].message.content ?? '').replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const generated = JSON.parse(content);
    if (typeof generated.code !== 'string' || typeof generated.description !== 'string') throw Error('Invalid generated function');
    const probes = [];
    for (const query of ['totalPrice', 'Catalog', 'postOrder', 'nonexistent_symbol_482']) {
      try { const result = await runScript({ workspace: root, code: generated.code, params: { query } }); probes.push({ query, result, bytes: Buffer.byteLength(JSON.stringify(result)) }); }
      catch (error) { probes.push({ query, error: String(error.message) }); }
    }
    row = { ...row, generated, usage: data.usage, probes };
  } catch (error) { row.error = String(error.message).replaceAll(key, '[redacted]'); }
  rows.push(row);
  await writeFile(output, JSON.stringify({ model, rows }, null, 2) + '\n');
  console.log(JSON.stringify({ repetition, valid: !row.error && row.probes?.every(p => !p.error), error: row.error }));
}
