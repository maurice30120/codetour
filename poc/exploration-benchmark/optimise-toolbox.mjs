import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScript } from '../../packages/exploration-sandbox/index.js';

const base = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(base, 'workspace');
const output = process.argv[2];
if (!output) throw Error('Usage: node optimise-toolbox.mjs OUTPUT');
const key = process.env.MISTRAL_API_KEY || execFileSync('security', ['find-generic-password', '-s', 'ai.mistral.vibe', '-a', 'MISTRAL_API_KEY', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const model = process.env.MISTRAL_MODEL || 'mistral-small-latest';
const tasks = JSON.parse(await readFile(process.env.TASKS_FILE || path.join(base, 'tasks.json'), 'utf8'));
const reps = Number(process.env.TOOLBOX_REPETITIONS || 3);
if (!Number.isInteger(reps) || reps < 1 || reps > 10) throw Error('Invalid repetitions');
const func = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const string = { type: 'string' }, number = { type: 'integer' };
const search = func('search', 'Find literal occurrences. Input query is exact text.', { query: string }, ['query']);
const list = func('list', 'List up to 500 workspace file paths.', {}, []);
const read = func('read', 'Read a numbered source range, at most 100 lines.', { file: string, start: number, end: number }, ['file', 'start', 'end']);
const context = func('context', 'Find a literal symbol and return up to 6 surrounding source excerpts of 5 lines on each side.', { query: string }, ['query']);
const batch = func('contexts', 'Find up to 3 literal symbols and return up to 4 surrounding source excerpts each, 3 lines on either side.', { queries: { type: 'array', items: string } }, ['queries']);
const compose = func('code', 'Compose repository primitives in a JavaScript expression: list() returns paths; search(text) returns [{file,line,text}]; read(file,start,end) returns {file,start,lines}. Keep results bounded and preserve source lines. params carries changing inputs.', { code: string, params: { type: 'object' } }, ['code', 'params']);
const source = {
  list: 'list()',
  search: 'search(params.query)',
  read: 'read(params.file,params.start,params.end)',
  context: 'search(params.query).slice(0,6).map(x=>read(x.file,Math.max(1,x.line-5),x.line+5))',
  lean: 'search(params.query).slice(0,6).map(x=>{const r=read(x.file,Math.max(1,x.line-3),x.line+3);return {file:r.file,lines:r.lines.map((text,i)=>({line:r.start+i,text}))}})',
  contexts: 'params.queries.slice(0,3).map(query=>({query, excerpts:search(query).slice(0,4).map(x=>read(x.file,Math.max(1,x.line-3),x.line+3))}))',
};
const variants = { separate: [search, read], context: [context, read], batch: [batch, read] };
const generated = process.env.GENERATED_FILE ? JSON.parse(await readFile(process.env.GENERATED_FILE, 'utf8')).rows : [];
for (let i = 0; i < generated.length; i++) {
  if (generated[i].error || generated[i].probes.some(p => p.error)) throw Error('Generated function failed its probes');
  variants[`generated${i + 1}`] = [context, read];
}
variants.lean = [func('context', 'Find a literal symbol, returning up to 6 nearby excerpts with numbered lines.', { query: string }, ['query']), read];
variants.compose = [compose];
variants.tourSeparate = [list, search, read];
variants.tourCompose = [compose];
variants.tourGuided = [compose];
const chosenVariants = process.env.TOUR ? ['tourSeparate', 'tourCompose', 'tourGuided'] : generated.length ? ['context', ...generated.map((_, i) => `generated${i + 1}`)] : process.env.COMPOSE ? ['separate', 'lean', 'compose'] : process.env.LEAN ? ['separate', 'context', 'lean'] : ['separate', 'context', 'batch'];
const records = [];
await writeFile(output, JSON.stringify({ model, reps, source, tasks, records }), { flag: 'wx' });
async function request(messages, tools) {
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, ...(tools ? { tools } : {}), temperature: 0, max_tokens: 1400 }), signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  const data = await response.json();
  return { message: data.choices[0].message, usage: data.usage };
}
async function save() { await writeFile(output, JSON.stringify({ model, reps, source, generated, tasks, records }, null, 2) + '\n'); }
async function exploration(task, variant, repetition) {
  const guidance = variant === 'tourGuided' ? ' Compose primitives in one code call where it reduces round trips. For example, search(params.query).slice(0,4).map(hit=>read(hit.file,Math.max(1,hit.line-3),hit.line+3)) returns bounded context for a changing symbol. Use exact properties file and line, use params for changing values, and explicitly read missing callers, callees and uses before concluding. Search is literal and accepts only one string argument. Do not assume a relationship from matching names.' : '';
  const messages = [{ role: 'system', content: 'Explore the repository with the available tools. Answer the question in French, concisely, with file paths and line numbers supporting each claim. State uncertainty when evidence is insufficient.' + guidance }, { role: 'user', content: task.objective }];
  const calls = [], usage = { input: 0, output: 0 }, transcript = [];
  for (let i = 0; i < 7; i++) {
    const result = await request(messages, variants[variant]);
    usage.input += result.usage?.prompt_tokens || 0;
    usage.output += result.usage?.completion_tokens || 0;
    const message = result.message;
    messages.push(message);
    if (!message.tool_calls?.length) return { repetition, variant, task: task.id, status: 'complete', answer: message.content, usage, calls, transcript };
    for (const call of message.tool_calls) {
      let value;
      try {
        const params = JSON.parse(call.function.arguments);
        if (!variants[variant].some(t => t.function.name === call.function.name)) throw Error('Unavailable tool');
        const code = call.function.name === 'code' ? params.code : call.function.name === 'context' && variant.startsWith('generated') ? generated[Number(variant.slice(9)) - 1].generated.code : call.function.name === 'context' && variant === 'lean' ? source.lean : source[call.function.name];
        value = await runScript({ workspace: root, code, params: call.function.name === 'code' ? params.params : params });
      } catch (error) { value = { error: String(error.message) }; }
      const serialized = JSON.stringify(value);
      const content = serialized.length <= 12000 ? serialized : JSON.stringify({ error: 'Result too large; narrow the query' });
      calls.push({ name: call.function.name, arguments: call.function.arguments, outputBytes: Buffer.byteLength(content) });
      transcript.push({ name: call.function.name, content });
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }
  }
  return { repetition, variant, task: task.id, status: 'partial', usage, calls, transcript };
}
for (let repetition = 1; repetition <= reps; repetition++) {
  for (const task of tasks) {
    for (const variant of repetition % 2 ? chosenVariants : [...chosenVariants].reverse()) {
      let row;
      try { row = await exploration(task, variant, repetition); }
      catch (error) { row = { repetition, variant, task: task.id, status: 'error', error: String(error.message).replaceAll(key, '[redacted]') }; }
      records.push(row); await save();
      console.log(JSON.stringify({ repetition, task: task.id, variant, status: row.status, usage: row.usage }));
    }
  }
}
