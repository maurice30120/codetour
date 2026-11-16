import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { realpath } from 'node:fs/promises';
import { explore } from '../src/explore.ts';

// Ticket #190 (spec #183): on the 2026-11-16 real run the model called
// memory_list six times with returned=0 and revised its plan seven times
// without ever reaching function_try — it treats the empty catalogue as a
// dead end instead of a creation trigger. After two empty memory_list
// results in the same run, the tool result itself carries a visible English
// note inviting function_try for durably reusable questions (injected in the
// tool result, no extra LLM call, once per run, traced in the callTrace).

const validResult = {
  objective: 'Find start',
  entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }],
  components: [],
  relations: [],
  uncertainties: [],
};

async function setup(t: import('node:test').TestContext) {
  const base = await mkdtemp(join(tmpdir(), 'empty-list-note-'));
  const root = join(base, 'repo');
  const memoryDir = join(base, 'memory');
  await mkdir(root);
  await mkdir(memoryDir);
  await writeFile(join(root, 'main.ts'), 'export function start() { return 42; }\n');
  t.after(() => rm(base, { recursive: true, force: true }));
  return { root, memoryDir };
}

test('the second empty memory_list result carries the anti-loop note, once per run', async t => {
  const { root, memoryDir } = await setup(t);
  const toolContents: string[] = [];
  let step = 0;
  const result = await explore({
    root,
    objective: 'Find start',
    codeMode: true,
    memory: { directory: memoryDir },
    model: {
      async complete(messages: any[]) {
        step++;
        if (step <= 3) {
          if (step >= 2) {
            const last = messages.at(-1);
            toolContents.push(typeof last?.content === 'string' ? last.content : '');
          }
          return { toolCalls: [{ id: `l${step}`, name: 'memory_list', arguments: { query: 'start', question_id: 'q1' } }] };
        }
        toolContents.push(String(messages.at(-1)?.content ?? ''));
        return { result: validResult, usage: { inputTokens: 50, outputTokens: 20 } };
      }
    }
  });
  assert.equal(result.status, 'complete');
  // First empty call: plain empty result, no note.
  assert.equal(toolContents[0], '[]');
  // Second empty call: the visible anti-loop note is injected in the tool result.
  assert.match(toolContents[1], /catalogue is empty again/);
  assert.match(toolContents[1], /function_try\(source, params\)/);
  assert.match(toolContents[1], /otherwise state why not/);
  // Third empty call: the note was already emitted once — no repetition.
  assert.equal(toolContents[2], '[]');
  // The note is observable in the call trace on the memory_list call that carried it.
  const noted = result.callTrace.find(call => call.type === 'memory_list' && JSON.stringify(call.result ?? {}).includes('catalogue is empty again'));
  assert.ok(noted, 'the anti-loop note is traced in the callTrace');
});

test('the anti-loop note never appears while the catalogue returns results', async t => {
  const { root, memoryDir } = await setup(t);
  const catalogueFile = join(memoryDir, `${createHash('sha256').update(await realpath(root)).digest('hex')}.json`);
  await writeFile(catalogueFile, JSON.stringify([{
    id: 'findStart',
    objective: 'Find the start function',
    description: 'Locates the start function of the workspace.',
    code: 'searchText(params.query)',
    parameters: ['query'],
    successes: 1,
    failures: 0
  }]));
  const toolContents: string[] = [];
  let step = 0;
  const result = await explore({
    root,
    objective: 'Find start',
    codeMode: true,
    memory: { directory: memoryDir },
    model: {
      async complete(messages: any[]) {
        step++;
        if (step <= 2) {
          if (step >= 2) {
            const last = messages.at(-1);
            toolContents.push(typeof last?.content === 'string' ? last.content : '');
          }
          return { toolCalls: [{ id: `l${step}`, name: 'memory_list', arguments: { query: 'start', question_id: 'q1' } }] };
        }
        toolContents.push(String(messages.at(-1)?.content ?? ''));
        return { result: validResult, usage: { inputTokens: 50, outputTokens: 20 } };
      }
    }
  });
  assert.equal(result.status, 'complete');
  for (const content of toolContents) {
    assert.doesNotMatch(content, /catalogue is empty again/, 'no anti-loop note when the catalogue returns entries');
  }
});

test('a filtered miss exposes the nonempty catalogue without claiming it is empty', async t => {
  const { root, memoryDir } = await setup(t);
  const catalogueFile = join(memoryDir, `${createHash('sha256').update(await realpath(root)).digest('hex')}.json`);
  await writeFile(catalogueFile, JSON.stringify([{ id: 'searchRepoText', objective: 'Find all literal occurrences of a text query across repository files', description: 'Searches the repository for a literal text query.', code: 'searchText(params.query)', parameters: ['query'], successes: 1, failures: 0 }]));
  let step = 0;
  const responses: any[] = [];
  await explore({ root, objective: 'Find start', codeMode: true, memory: { directory: memoryDir }, model: { async complete(messages) {
    if (step > 0) responses.push(JSON.parse(messages.at(-1).content));
    if (step++ < 2) return { toolCalls: [{ id: `miss${step}`, name: 'memory_list', arguments: { query: 'literal occurrences of a text query across repository files with line numbers' } }] };
    return { result: validResult };
  } } });
  for (const response of responses) {
    assert.deepEqual(response.results, []);
    assert.equal(response.available[0].id, 'searchRepoText');
    assert.doesNotMatch(response.note, /catalogue is empty/i);
  }
});
