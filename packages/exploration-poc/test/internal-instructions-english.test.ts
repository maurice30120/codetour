import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explore } from './fixture-explore.ts';
import { DECOMPOSITION_PROMPT } from '../src/decomposition-prompt.ts';
import { mistral } from '../src/mistral.ts';
import { validateCanonicalName } from '../src/memory.ts';

// French markers for internal instruction text: accented letters plus the
// French terms that survive an accent-free scan. Internal instructions and
// tool descriptions must use none of them (ADR 0015); only the decomposition
// prompt, owned by #184 (D01), is excluded from the scans below.
const FRENCH_ACCENTS = /[éèêëàâçôûîüöÉÈÊËÀÂÇÔÛÎÜÖœŒ]/;
const FRENCH_TERMS = /\b(verbe|domaine|objet|contrat|périmètre|perimetre|dépôt|depot)\b/i;

function assertEnglish(text: string, what: string): void {
  assert.ok(!FRENCH_ACCENTS.test(text), `${what} must not contain French accented characters`);
  assert.ok(!FRENCH_TERMS.test(text), `${what} must not contain French terms`);
}

/** Everything in the harness system prompt except the #184-owned decomposition prompt. */
function harnessInstructions(systemPrompt: string): string {
  assert.ok(systemPrompt.includes(DECOMPOSITION_PROMPT), 'the system prompt must embed the canonical decomposition prompt');
  return systemPrompt.replace(DECOMPOSITION_PROMPT, '');
}

test('the harness system instructions sent to the model are English', async t => {
  const base = await mkdtemp(join(tmpdir(), 'd03-instructions-'));
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'main.ts'), 'export function start() { return 1; }\n');
  t.after(() => rm(base, { recursive: true, force: true }));
  let systemPrompt = '';
  await explore({ root, objective: 'Explain start', codeMode: true, memory: { directory: join(base, 'memory') }, model: { async complete(messages) {
    systemPrompt = messages[0].content;
    return { result: { objective: 'Explain start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
  } } });
  assertEnglish(harnessInstructions(systemPrompt), 'the harness system instructions');
});

test('the provider tool descriptions are English in memory mode and code mode', async () => {
  const original = globalThis.fetch;
  const bodies: any[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
    };
    const provider = mistral('test-key', 'fixture-model');
    await provider.complete([], { signal: new AbortController().signal, maxOutputTokens: 100, codeMode: true, memory: true });
    await provider.complete([], { signal: new AbortController().signal, maxOutputTokens: 100, codeMode: true, memory: false });
    assert.equal(bodies.length, 2);
    for (const body of bodies) {
      for (const tool of body.tools) {
        assertEnglish(tool.function.description, `the ${tool.function.name} tool description`);
        for (const parameter of Object.values(tool.function.parameters?.properties ?? {})) {
          if (typeof parameter.description === 'string') assertEnglish(parameter.description, `the ${tool.function.name} parameter description`);
        }
      }
    }
  } finally { globalThis.fetch = original; }
});

test('an invalid TypeScript identifier receives an English rejection', () => {
  const { ok, reason } = validateCanonicalName('search-indexes');
  assert.equal(ok, false);
  assertEnglish(reason ?? '', 'the canonical naming rejection reason');
  assert.match(reason ?? '', /identifier/i);
});

test('an agent guided by English instructions returns a French result for a French request', async t => {
  const base = await mkdtemp(join(tmpdir(), 'd03-french-'));
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'main.ts'), 'export function start() { return 1; }\n');
  t.after(() => rm(base, { recursive: true, force: true }));
  const frenchObjective = 'Explique le point d’entrée principal du dépôt';
  const result = await explore({ root, objective: frenchObjective, codeMode: true, memory: { directory: join(base, 'memory') }, model: { async complete(messages) {
    // The internal guidance stays English even for a French request (ADR 0015).
    assertEnglish(harnessInstructions(messages[0].content), 'the harness system instructions');
    assert.equal(messages[1].content, frenchObjective);
    return { result: { objective: frenchObjective, entryPoints: [{ name: 'point d’entrée principal', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: ['Aucune incertitude relevée.'] } };
  } } });
  assert.equal(result.objective, frenchObjective);
  assert.equal(result.entryPoints[0].name, 'point d’entrée principal');
  assert.deepEqual(result.uncertainties, ['Aucune incertitude relevée.']);
});

test('an agent guided by English instructions returns an English result for an English request', async t => {
  const base = await mkdtemp(join(tmpdir(), 'd03-english-request-'));
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'main.ts'), 'export function start() { return 1; }\n');
  t.after(() => rm(base, { recursive: true, force: true }));
  const englishObjective = 'Explain the main entry point';
  const result = await explore({ root, objective: englishObjective, codeMode: true, memory: { directory: join(base, 'memory') }, model: { async complete(messages) {
    assertEnglish(harnessInstructions(messages[0].content), 'the harness system instructions');
    assert.equal(messages[1].content, englishObjective);
    return { result: { objective: englishObjective, entryPoints: [{ name: 'main entry point', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
  } } });
  assert.equal(result.objective, englishObjective);
  assert.equal(result.entryPoints[0].name, 'main entry point');
});
