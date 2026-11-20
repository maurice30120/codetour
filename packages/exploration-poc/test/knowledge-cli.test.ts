import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileProofHash } from '../src/knowledge.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const workspace_ = (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix)).then(realpathSync);

// Provider-shaped responses for the scripted model (no LLM); real usage counters.
const PLAN = { understand: ['inspect'], investigate: ['find dispatch'], reuse: [] };
const FINAL_RESULT = { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 2 }] }], components: [], relations: [], uncertainties: [] };

async function seed(root: string, name: string, frontmatter: string, body: string): Promise<void> {
  const directory = join(root, '.tours', '.memory', 'knowledge');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.md`), `---\n${frontmatter}\n---\n${body}`);
}

/**
 * Write the fixture transport for one spawned CLI run: a plan call without
 * tools, then one scripted turn per replay step, then the final structured
 * JSON. Every request carrying tools appends its offered tool names to
 * `<toolsFile>` so provider-request assertions can inspect what the harness
 * actually exposes; every tool call appends the emitted name for the trace.
 */
async function transport(root: string, toolsFile: string, reads: number): Promise<string> {
  const preload = join(root, 'transport.mjs');
  await writeFile(preload, `import { appendFileSync } from 'node:fs';
globalThis.__step = 0;
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  const toolNames = body.tools ? body.tools.map(tool => tool.function.name).sort() : null;
  appendFileSync(${JSON.stringify(toolsFile)}, JSON.stringify(toolNames) + '\\n');
  if (!body.tools) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(${JSON.stringify(PLAN)}) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  globalThis.__step++;
  const step = globalThis.__step;
  const respond = (payload, id) => new Response(JSON.stringify({ choices: [{ message: payload }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  if (step === 1) return respond({ tool_calls: [{ id: 'list', type: 'function', function: { name: 'memory_list', arguments: '{}' } }] });
  if (step === 2 && ${reads > 0}) return respond({ tool_calls: [{ id: 'read1', type: 'function', function: { name: 'memory_read', arguments: '{"name":"dispatch_flow"}' } }] });
  if (step === 3 && ${reads > 1}) return respond({ tool_calls: [{ id: 'read2', type: 'function', function: { name: 'memory_read', arguments: '{"name":"stale_entry"}' } }] });
  return respond({ content: JSON.stringify(${JSON.stringify(FINAL_RESULT)}) });
};`);
  return preload;
}

const spawn = (root: string, preload: string, output: string, flags: string[], env: Record<string, string> = {}) => spawnSync(process.execPath, ['--import', preload, cli, ...flags, '--workspace', root, '--output-file', output, '--tokens', '2000', '--iterations', '8', 'Find start'], {
  encoding: 'utf8', timeout: 30000, env: { ...process.env, MISTRAL_API_KEY: 'fixture-key', ...env }
});

test('a --code --knowledge CLI run keeps search tools and code, reads only a validated Knowledge, and traces refusals', async t => {
  const root = await workspace_('t220-code-kn-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'const start = 1;\nconst needle = 2;\n');
  const body = 'Body of the validated entry.\n';
  // One valid entry, one stale one (its cited file changed after preparation)
  // and one malformed neighbour: the run must survive all three.
  await seed(root, 'dispatch_flow', `name: dispatch_flow\ndescription: How tool calls dispatch and refuse forgery\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${fileProofHash(Buffer.from('const start = 1;\nconst needle = 2;\n'))}`, body);
  await seed(root, 'stale_entry', `name: stale_entry\ndescription: cites a stale file\nevidence:\n  - type: file\n    path: main.ts\n    sha256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`, 'stale secret body\n');
  await seed(root, 'breaking', 'name: breaky\ndescription: not the file name', 'malformed secret body\n');
  const output = join(root, 'result.json');
  const toolsFile = `${output}.tools`;
  const preload = await transport(root, toolsFile, 2);
  const child = spawn(root, preload, output, ['--code', '--knowledge']);
  assert.equal(child.status, 0, child.stderr);
  // Provider request: the search tools, `code`, the scratch tool and the two
  // Knowledge tools; Memory Function tools are absent.
  const requests = (await readFile(toolsFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(requests[0], null); // the plan call offers no tools
  assert.deepEqual(requests[1], ['code', 'git', 'list', 'memory_list', 'memory_read', 'read', 'readScratch', 'search']);
  // Historical --memory would offer Memory Functions instead; untouched below.
  const result = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(result.status, 'complete');
  assert.equal(result.metrics.memoryReuses, 0);
  assert.equal(result.metrics.functionTries, 0);
  // Discovery, read and refusal stay distinguishable in the traces.
  const listed = result.callTrace.find(item => item.type === 'memory_list');
  assert.deepEqual((listed?.result as Array<{ name: string }>)?.map(entry => entry.name).sort(), ['dispatch_flow', 'stale_entry']);
  // Story 18: each discoverable entry is traced as available before any read.
  const available = result.callTrace.filter(item => item.type === 'knowledge_available');
  assert.deepEqual(available.map(item => item.knowledge?.name).sort(), ['dispatch_flow', 'stale_entry']);
  for (const item of available) assert.equal(item.knowledge?.status, 'available');
  const reads = result.callTrace.filter(item => item.type === 'knowledge_read');
  assert.equal(reads.length, 2);
  assert.equal(reads[0].knowledge?.status, 'read');
  assert.match(String(reads[0].result), /Body of the validated entry/);
  // A stale read refuses: exactly `invalid`, no body, no sensitive detail.
  assert.equal(reads[1].knowledge?.status, 'refused');
  assert.equal(reads[1].knowledge?.reason, 'file_hash_mismatch');
  assert.equal(String(reads[1].result), 'invalid');
  assert.ok(!JSON.stringify(result.callTrace).includes('stale secret body'));
  assert.ok(!JSON.stringify(result.callTrace).includes('malformed secret body'));
});

test('a --code --memory CLI run keeps its historical Memory Function tools so the old mode stays intact', async t => {
  const root = await workspace_('t220-code-mem-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'const start = 1;\nconst needle = 2;\n');
  const output = join(root, 'result.json');
  const toolsFile = `${output}.tools`;
  const preload = await transport(root, toolsFile, 0);
  const child = spawn(root, preload, output, ['--code', '--memory']);
  assert.equal(child.status, 0, child.stderr);
  const requests = (await readFile(toolsFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const result = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(result.metrics.modelCalls, 3); // plan, the memory_list turn, then the final answer
  assert.equal(result.metrics.toolCalls, 1);
  // The historical request still offers function_try and the Memory Function
  // tools, and never a Knowledge read: the mode is untouched.
  assert.deepEqual(requests[1], ['findDefinitions', 'findReferences', 'function_try', 'getGitDiff', 'getImports', 'listFiles', 'listSymbols', 'memory_list', 'memory_run', 'memory_unusable', 'readAround', 'readLineFragment', 'readLines', 'readScratch', 'searchIdentifiers', 'searchText']);
  // No Knowledge run: no availability traces either.
  assert.ok(!result.callTrace.some(item => item.type === 'knowledge_available'));
});
test('the CLI refuses --memory and --knowledge together, before any model call', async t => {
  const root = await workspace_('t220-conflict-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, [cli, '--code', '--memory', '--knowledge', '--tokens', '100', 'Find start'], {
    encoding: 'utf8', timeout: 30000, env: { ...process.env, MISTRAL_API_KEY: 'fixture-key' }
  });
  assert.equal(child.status, 1);
  const report = JSON.parse(child.stdout);
  assert.equal(report.status, 'failed');
  assert.match(String(report.error), /exclusive of Memory Functions/);
  assert.equal(report.metrics.modelCalls, 0);
});
