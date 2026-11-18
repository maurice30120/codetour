import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { explore } from './fixture-explore.ts';
import { mistral } from '../src/mistral.ts';
import { knowledgeDirectory, fileProofHash } from '../src/knowledge.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const workspaceRoot = (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix)).then(realpathSync);

async function writeEntry(root: string, name: string, frontmatter: string, body: string): Promise<void> {
  const directory = knowledgeDirectory(root);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.md`), `---\n${frontmatter}\n---\n${body}`);
}

const hashOf = async (root: string, file: string): Promise<string> => fileProofHash(await readFile(join(root, file)));

const VALID_FRONTMATTER = async (root: string) => `name: dispatch_flow\ndescription: How tool calls dispatch and refuse forgery\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${await hashOf(root, 'main.ts')}`;

const FINAL = (question: string) => ({ result: { objective: question, entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } });

test('a Knowledge run discovers entries by name and description and reads one validated body', async t => {
  const root = await workspaceRoot('knowledge-mode-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  const body = 'Body line one.\n\nBody line two.\n';
  await writeEntry(root, 'dispatch_flow', await VALID_FRONTMATTER(root), body);
  let step = 0;
  const result = await explore({ root, objective: 'Find start', knowledge: { directory: knowledgeDirectory(root) }, model: {
    async complete(messages, options) {
      if (step++ === 0) {
        const prompt = String(messages[0].content);
        assert.match(prompt, /Experimental Knowledge mode/);
        assert.match(prompt, /dispatch_flow/);
        assert.match(prompt, /How tool calls dispatch and refuse forgery/);
        // Availability never injects content, and no function-creation invitation exists.
        assert.ok(!prompt.includes('Body line one'));
        assert.doesNotMatch(prompt, /try function_try/);
        assert.equal(options?.knowledge, true);
        assert.equal(options?.memory, false);
        return { toolCalls: [{ id: 'list', name: 'memory_list', arguments: {} }] };
      }
      if (step === 2) {
        assert.deepEqual(JSON.parse(String(messages.at(-1).content)), [{ name: 'dispatch_flow', description: 'How tool calls dispatch and refuse forgery' }]);
        return { toolCalls: [{ id: 'read', name: 'memory_read', arguments: { name: 'dispatch_flow' } }] };
      }
      if (step === 3) {
        assert.equal(JSON.parse(String(messages.at(-1).content)), body);
        return FINAL('Find start');
      }
      throw new Error('unexpected model call');
    }
  } });
  assert.equal(result.status, 'complete');
  // Traces distinguish availability (list result) from reading (knowledge entry).
  const listed = result.callTrace.find(item => item.type === 'memory_list');
  const listedResult = (listed?.result as Array<{ name: string; description: string }>) ?? [];
  assert.deepEqual(listedResult, [{ name: 'dispatch_flow', description: 'How tool calls dispatch and refuse forgery' }]);
  assert.deepEqual(Object.keys(listedResult[0]).sort(), ['description', 'name']);
  const read = result.callTrace.find(item => item.type === 'knowledge_read');
  assert.equal(read?.knowledge?.status, 'read');
  assert.equal(read?.knowledge?.name, 'dispatch_flow');
  assert.match(String(read?.result), /Body line one\./);
});

test('stale, forged, escaping, malformed and unknown Knowledge reads refuse with invalid and leak nothing', async t => {
  const root = await workspaceRoot('knowledge-refuse-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const outside = await workspaceRoot('knowledge-outside-');
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'secret.txt'), 'outside bytes\n');
  await writeFile(join(root, 'main.ts'), 'original bytes\n');
  const staleProof = await hashOf(root, 'main.ts');
  await writeFile(join(root, 'main.ts'), 'changed bytes\n');
  await writeEntry(root, 'stale_flow', `name: stale_flow\ndescription: cites a file changed after preparation\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${staleProof}`, 'stale secret body\n');
  await writeEntry(root, 'forged_flow', `name: forged_flow\ndescription: cites a well-formed wrong hash\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${createHash('sha256').update('forged').digest('hex')}`, 'forged secret body\n');
  await writeEntry(root, 'escaping_flow', `name: escaping_flow\ndescription: cites a symlink out of the workspace\nevidence:\n  - type: file\n    path: linked.md\n    sha256: ${fileProofHash(Buffer.from('outside bytes\n'))}`, 'escaping secret body\n');
  await symlink(join(outside, 'secret.txt'), join(root, 'linked.md'));
  await writeEntry(root, 'malformed_flow', 'name: broken name\ndescription: invalid identifier\nevidence:\n  - type: file\n    path: main.ts\n    sha256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'malformed secret body\n');
  let step = 0;
  const result = await explore({ root, objective: 'Find start', knowledge: { directory: knowledgeDirectory(root) }, model: {
    async complete(messages) {
      step++;
      if (step === 1) return { toolCalls: [{ id: 'list', name: 'memory_list', arguments: {} }] };
      if (step === 2) {
        // Only schema-valid contracts are discoverable; the malformed one is not.
        const names = JSON.parse(String(messages.at(-1).content)).map((entry: { name: string }) => entry.name).sort();
        assert.deepEqual(names, ['escaping_flow', 'forged_flow', 'stale_flow']);
        return { toolCalls: ['stale_flow', 'forged_flow', 'escaping_flow', 'malformed_flow', 'never_written'].map((name, index) => ({ id: `read${index}`, name: 'memory_read', arguments: { name } })) };
      }
      const results = messages.filter((message: any) => message.role === 'tool').slice(-5).map((message: any) => JSON.parse(message.content));
      assert.deepEqual(results, ['invalid', 'invalid', 'invalid', 'invalid', 'invalid']);
      return FINAL('Find start');
    }
  } });
  const reads = result.callTrace.filter(item => item.type === 'knowledge_read');
  // Refusals carry only machine-readable kinds in the trace, never the body,
  // the cited paths or the hashes.
  assert.deepEqual(reads.map(read => read.knowledge?.reason), ['file_hash_mismatch', 'file_hash_mismatch', 'symlink_escape', 'malformed_contract', 'unknown_entry']);
  for (const read of reads) {
    assert.equal(read.knowledge?.status, 'refused');
    // The refusal carries nothing but the word; the reason kinds stay trace-only.
    assert.equal(read.result, 'invalid');
  }
});

test('forged Memory Function calls are rejected at dispatch in a --code --knowledge run', async t => {
  const root = await workspaceRoot('knowledge-forged-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'const start = 1;\n');
  let step = 0;
  const result = await explore({ root, objective: 'Find start', codeMode: true, knowledge: { directory: knowledgeDirectory(root) }, model: {
    async complete(messages) {
      step++;
      if (step === 1) return { toolCalls: [
        { id: 'run', name: 'memory_run', arguments: { id: 'anythingStored', params: {} } },
        { id: 'try', name: 'function_try', arguments: { source: '() => 1', params: {} } },
        { id: 'unusable', name: 'memory_unusable', arguments: { id: 'anythingStored' } }
      ] };
      const results = messages.filter((message: any) => message.role === 'tool').map((message: any) => JSON.parse(message.content));
      assert.deepEqual(results, [
        { error: 'Unknown tool or invalid arguments' },
        { error: 'Unknown tool or invalid arguments' },
        { error: 'Unknown tool or invalid arguments' }
      ]);
      return FINAL('Find start');
    }
  } });
  assert.equal(result.metrics.functionTries, 0);
  assert.equal(result.metrics.memoryReuses, 0);
});

test('the plain code tool keeps working in a --code --knowledge run', async t => {
  const root = await workspaceRoot('knowledge-code-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'const start = 1;\n');
  let step = 0;
  const result = await explore({ root, objective: 'Find start', codeMode: true, knowledge: { directory: knowledgeDirectory(root) }, model: {
    async complete(messages) {
      step++;
      if (step === 1) return { toolCalls: [{ id: 'probe', name: 'code', arguments: { code: 'search("start")' } }] };
      assert.match(String(messages.at(-1).content), /main\.ts/);
      assert.doesNotMatch(String(messages.at(-1).content), /Body line/);
      return FINAL('Find start');
    }
  } });
  assert.equal(result.status, 'complete');
});

test('knowledge read results go through the existing observation masking and scratch spill', async t => {
  const root = await workspaceRoot('knowledge-mask-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'export const start = 1;\n');
  const body = `${'x'.repeat(9000)} TAIL_MARKER`;
  await writeEntry(root, 'long_flow', `name: long_flow\ndescription: a long validated body\nevidence:\n  - type: file\n    path: main.ts\n    sha256: ${await hashOf(root, 'main.ts')}`, body);
  let step = 0;
  const config = { ...DEFAULT_CONFIG, context: { ...DEFAULT_CONFIG.context, keepToolResults: 1 } };
  const result = await explore({ root, objective: 'Find start', knowledge: { directory: knowledgeDirectory(root) }, config, model: {
    async complete(messages) {
      step++;
      if (step === 1) return { toolCalls: [{ id: 'long', name: 'memory_read', arguments: { name: 'long_flow' } }] };
      if (step === 2) {
        assert.match(String(messages.at(-1).content), /readScratch with resultId long/);
        return { toolCalls: [{ id: 'again', name: 'search', arguments: { query: 'start' } }] };
      }
      if (step === 3) {
        const toolMessages = messages.filter((message: any) => message.role === 'tool');
        assert.match(String(toolMessages[0].content), /Already read, result omitted/);
        assert.match(String(toolMessages[0].content), /Full result saved as long/);
        assert.ok(!String(toolMessages[0].content).includes('TAIL_MARKER'));
        return { toolCalls: [{ id: 'recover', name: 'readScratch', arguments: { resultId: 'long', offset: 8000 } }] };
      }
      if (step === 4) {
        assert.match(String(messages.at(-1).content), /TAIL_MARKER/);
        return FINAL('Find start');
      }
      throw new Error('unexpected model call');
    }
  } });
  assert.ok(result.callTrace.some(item => item.type === 'knowledge_read' && item.knowledge?.status === 'read'));
});

test('a malformed catalogue entry never blocks ordinary search in a codeless Knowledge run', async t => {
  const root = await workspaceRoot('knowledge-search-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.ts'), 'const needle = 1;\n');
  await writeEntry(root, 'wrecked', 'name: =>not-frontmatter\nnot a knowledge file\n');
  let step = 0;
  const result = await explore({ root, objective: 'Find needle', knowledge: { directory: knowledgeDirectory(root) }, model: {
    async complete(messages) {
      step++;
      // First scripted call: the system prompt answers the plan; discovery
      // returns an empty list, and the malformed entry broke nothing.
      if (step === 1) return { toolCalls: [{ id: 'list', name: 'memory_list', arguments: {} }] };
      if (step === 2) {
        assert.deepEqual(JSON.parse(String(messages.at(-1).content)), []);
        return { toolCalls: [{ id: 'scan', name: 'search', arguments: { query: 'needle' } }] };
      }
      assert.match(String(messages.at(-1).content), /main\.ts/);
      return FINAL('Find needle');
    }
  } });
  assert.equal(result.status, 'complete');
});

test('the Knowledge and Memory Function modes never combine', async t => {
  const root = await workspaceRoot('knowledge-excl-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    explore({ root, objective: 'q', codeMode: true, memory: { directory: join(root, '.tours', '.memory') }, knowledge: { directory: knowledgeDirectory(root) }, model: { async complete() { throw new Error('must not be called'); } } }),
    /exclusive of Memory Functions/
  );
});

test('historical --memory still discovers, runs and consolidates Memory Functions unchanged', async t => {
  const base = await workspaceRoot('memory-regression-');
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'repo');
  const memory = { directory: join(base, 'memory') };
  await mkdir(root);
  await writeFile(join(root, 'main.ts'), 'function alpha() {\n  return 1;\n}\n');
  const final = FINAL('Find alpha').result;
  let step = 0;
  const first = await explore({ root, objective: 'Find alpha', codeMode: true, memory, model: { async complete(messages) {
    if (step++ === 0) return { toolCalls: [{ id: 'trial', name: 'function_try', arguments: { source: 'searchText(params.query)', params: { query: 'alpha' }, remember: true, name: 'findRepoSymbols', description: 'Finds symbols in the repository and returns each match with file, line and text.' } }] };
    if (/select.*executed/i.test(String(messages[0].content))) return { result: { selected: ['findRepoSymbols'] } };
    return { result: final };
  } } });
  assert.equal(first.status, 'complete');
  step = 0;
  const second = await explore({ root, objective: 'Find alpha again', codeMode: true, memory, model: {
    async complete(messages, options) {
      assert.match(String(messages[0].content), /Script memory is enabled/);
      assert.equal(options?.memory, true);
      assert.equal(options?.knowledge, false);
      if (step++ === 0) {
        const catalog = JSON.parse(String(messages[0].content).match(/Available entries: (\[.*?\])\. If a listed function/)![1]);
        return { toolCalls: [{ id: 'reuse', name: 'memory_run', arguments: { id: catalog[0].id, params: { query: 'alpha' } } }] };
      }
      return { result: final };
    }
  } });
  assert.equal(second.metrics.memoryReuses, 1);
  assert.ok(second.callTrace.some(item => item.type === 'memory_run'));
});

test('provider requests expose Knowledge tools and never Memory Function tools', async t => {
  const bodies: any[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
  }) as typeof fetch;
  try {
    const signal = new AbortController().signal;
    await mistral('fixture').complete([], { signal, maxOutputTokens: 100, codeMode: true, memory: false, knowledge: true });
    assert.deepEqual(bodies[0].tools.map(tool => tool.function.name).sort(), ['code', 'git', 'list', 'memory_list', 'memory_read', 'read', 'readScratch', 'search']);
    bodies.length = 0;
    await mistral('fixture').complete([], { signal, maxOutputTokens: 100, codeMode: false, memory: false, knowledge: true });
    assert.deepEqual(bodies[0].tools.map(tool => tool.function.name).sort(), ['git', 'list', 'memory_list', 'memory_read', 'read', 'readScratch', 'search']);
    bodies.length = 0;
    // Historical --memory (code mode): Memory Functions stay exposed; no Knowledge read tool.
    await mistral('fixture').complete([], { signal, maxOutputTokens: 100, codeMode: true, memory: true });
    const names = bodies[0].tools.map(tool => tool.function.name);
    for (const expected of ['function_try', 'memory_list', 'memory_run', 'memory_unusable', 'readScratch']) assert.ok(names.includes(expected), `missing ${expected}`);
    assert.ok(!names.includes('memory_read'));
  } finally { globalThis.fetch = original; }
});
