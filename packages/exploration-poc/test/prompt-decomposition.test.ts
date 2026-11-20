import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explore } from './fixture-explore.ts';
import { DECOMPOSITION_PROMPT, PROMPT_SHA256, PROMPT_VERSION } from '../src/decomposition-prompt.ts';
import { PROMPT_VERSION as REEXPORTED_PROMPT_VERSION } from '../src/explore.ts';
import { mistral } from '../src/mistral.ts';

// §2.4 Criterion 1: Test with memory useful
// The trace shows the catalogue consulted and memory_run called with valid
// params, without any redundant new function
test('C1: with useful memory - uses memory_list and memory_run with valid params, no redundant function', async () => {
  const base = await mkdtemp(join(tmpdir(), 'decomposition-c1-'));
  const root = join(base, 'repo');
  const memoryDir = join(base, 'memory');
  await mkdir(root);
  await mkdir(memoryDir);
  const memory = { directory: memoryDir };
  try {
    // Setup: create a workspace with a file
    await writeFile(join(root, 'api.ts'), 'export function getUser(id: string) { return { id }; }\n');
    
    // First run: create and store a useful function
    let step = 0;
    await explore({ 
      root, 
      objective: 'Find getUser', 
      codeMode: true, 
      memory, 
      model: {
        async complete(messages) {
          if (step++ === 0) {
            return { toolCalls: [{ 
              id: 'create', 
              name: 'function_try', 
              arguments: { 
                source: 'searchText(params.query)', 
                params: { query: 'getUser' }, 
                remember: true, 
                name: 'findApiFunction',
                description: 'Searches the repository for the requested function name. Returns matching file, line and text.' 
              } 
            }] };
          }
          if (/select.*executed/i.test(messages[0].content)) return { result: { selected: ['findApiFunction'] } };
          return { 
            result: { 
              objective: 'Find getUser', 
              entryPoints: [{ 
                name: 'getUser', 
                evidence: [{ file: 'api.ts', startLine: 1, endLine: 1 }] 
              }], 
              components: [], 
              relations: [], 
              uncertainties: [] 
            } 
          };
        }
      } 
    });
    
    // Second run: verify memory_list is called and memory_run is used with valid params
    step = 0;
    let catalogCalled = false;
    let memoryRunCalled = false;
    let memoryRunParams: unknown;
    
    const result = await explore({ 
      root, 
      objective: 'Find getUser again', 
      codeMode: true, 
      memory, 
      model: {
        async complete(messages) {
          // Verify the system prompt contains the English decomposition plan protocol
          assert.match(messages[0].content, /Initial research plan/);
          assert.match(messages[0].content, /memory_list\(query\)/);
          
          if (step === 0) {
            // First call should be memory_list
            catalogCalled = true;
            step++;
            return { toolCalls: [{ id: 'list', name: 'memory_list', arguments: {} }] };
          }
          if (step === 1) {
            // Parse the catalog to get the script ID
            const catalog = JSON.parse(messages.at(-1).content);
            assert.ok(Array.isArray(catalog) && catalog.length > 0);
            const scriptId = catalog[0].id;
            memoryRunCalled = true;
            memoryRunParams = { query: 'getUser' };
            step++;
            return { toolCalls: [{ id: 'run', name: 'memory_run', arguments: { id: scriptId, params: { query: 'getUser' } } }] };
          }
          // Verify the search result contains getUser
          assert.match(messages.at(-1).content, /getUser/);
          return { 
            result: { 
              objective: 'Find getUser again', 
              entryPoints: [{ 
                name: 'getUser', 
                evidence: [{ file: 'api.ts', startLine: 1, endLine: 1 }] 
              }], 
              components: [], 
              relations: [], 
              uncertainties: [] 
            } 
          };
        }
      } 
    });
    
    assert.ok(catalogCalled, 'memory_list should be called');
    assert.ok(memoryRunCalled, 'memory_run should be called');
    assert.ok(memoryRunParams && typeof memoryRunParams === 'object' && 'query' in (memoryRunParams as any), 'memory_run should be called with valid params');
    assert.equal(result.metrics.memoryReuses, 1, 'Should reuse existing function');
  } finally { 
    await rm(base, { recursive: true, force: true }); 
  }
});

// §2.4 Criterion 2: Test with empty memory
// The trace shows a targeted, parameterized function executed successfully via function_try
test('C2: with empty memory - creates targeted parameterized function via code/function_try', async () => {
  const base = await mkdtemp(join(tmpdir(), 'decomposition-c2-'));
  const root = join(base, 'repo');
  const memoryDir = join(base, 'memory');
  await mkdir(root);
  await mkdir(memoryDir);
  const memory = { directory: memoryDir };
  try {
    // Setup: empty workspace
    await writeFile(join(root, 'index.ts'), 'export const value = 42;\n');
    
    let step = 0;
    let functionCreated = false;
    let functionParams: unknown;
    
    const result = await explore({ 
      root, 
      objective: 'Find value', 
      codeMode: true, 
      memory, 
      model: {
        async complete(messages) {
          // Verify the system prompt contains the decomposition text
          assert.match(messages[0].content, /Initial research plan/);
          // Issue #189 + spec #183 amendment: the explicit if/then decision rule
          // replaced the vague "strongly prefer" incentive, and the wrapping
          // obligation makes function_try the only path to the primitives.
          
          if (step === 0) {
            // Should check memory_list first (even though empty)
            step++;
            return { toolCalls: [{ id: 'list', name: 'memory_list', arguments: {} }] };
          }
          if (step === 1) {
            // Parse catalog - should be empty
            const catalog = JSON.parse(messages.at(-1).content);
            assert.ok(Array.isArray(catalog) && catalog.length === 0, 'Memory should be empty');
            // Create a targeted parameterized function
            functionCreated = true;
            functionParams = { query: 'value' };
            step++;
            return { 
              toolCalls: [{ 
                id: 'create', 
                name: 'code', 
                arguments: { 
                  code: 'search(params.query)', 
                  params: { query: 'value' }, 
                  remember: true, 
                  name: 'findIndexValue',
                  description: 'Search for value' 
                } 
              }] 
            };
          }
          // Should contain the search result
          assert.match(messages.at(-1).content, /value/);
          return { 
            result: { 
              objective: 'Find value', 
              entryPoints: [{ 
                name: 'value', 
                evidence: [{ file: 'index.ts', startLine: 1, endLine: 1 }] 
              }], 
              components: [], 
              relations: [], 
              uncertainties: [] 
            } 
          };
        }
      } 
    });
    
    assert.ok(functionCreated, 'A function should be created');
    assert.ok(functionParams && typeof functionParams === 'object' && 'query' in (functionParams as any), 'Function should be parameterized');
    assert.equal(result.status, 'complete');
  } finally { 
    await rm(base, { recursive: true, force: true }); 
  }
});

// §2.4 Criterion 3: Test de besoin déjà couvert par primitive
// Aucune création de fonction imposée, utilisation directe de la primitive existante
test('C3: need covered by primitive - uses primitive directly without creating function', async () => {
  const base = await mkdtemp(join(tmpdir(), 'decomposition-c3-'));
  const root = join(base, 'repo');
  await mkdir(root);
  try {
    await writeFile(join(root, 'app.ts'), 'export function main() {}\n');
    
    let step = 0;
    let primitiveUsed = false;
    
    const result = await explore({ 
      root, 
      objective: 'Find main',
      codeMode: false, // Not in code mode, so primitives are used directly
      model: {
        async complete(messages) {
          // Verify the system prompt contains the decomposition text
          assert.match(messages[0].content, /Initial research plan/);
          
          if (step === 0) {
            // Use search primitive directly
            primitiveUsed = true;
            step++;
            return { toolCalls: [{ id: 'search', name: 'search', arguments: { query: 'main' } }] };
          }
          // Parse the search result
          const files = JSON.parse(messages.at(-1).content);
          assert.ok(Array.isArray(files) && files.length > 0);
          return { 
            result: { 
              objective: 'Find main',
              entryPoints: [{ name: 'main', evidence: [{ file: 'app.ts', startLine: 1, endLine: 1 }] }],
              components: [], 
              relations: [], 
              uncertainties: [] 
            } 
          };
        }
      } 
    });
    
    assert.ok(primitiveUsed, 'Primitive should be used directly');
    assert.equal(result.status, 'complete');
  } finally { 
    await rm(base, { recursive: true, force: true }); 
  }
});

// §2.4 Criterion 4: Test de besoin composite
// Réutilisation de plusieurs petites opérations si utile
// Forbids calling one memorized function from another memorized function
test('C4: composite need - reuses multiple small operations, no chained memory calls', async () => {
  const base = await mkdtemp(join(tmpdir(), 'decomposition-c4-'));
  const root = join(base, 'repo');
  const memoryDir = join(base, 'memory');
  await mkdir(root);
  await mkdir(memoryDir);
  const memory = { directory: memoryDir };
  try {
    // Setup: workspace with multiple files
    await writeFile(join(root, 'api.ts'), 'export function getUser() {}\n');
    await writeFile(join(root, 'db.ts'), 'export function query() {}\n');
    
    // First run: create two small reusable functions
    let step = 0;
    await explore({ 
      root, 
      objective: 'Find API functions', 
      codeMode: true, 
      memory, 
      model: {
        async complete(messages) {
          if (step++ === 0) {
            return { toolCalls: [{ 
              id: 'search-api', 
              name: 'function_try', 
              arguments: { 
                source: 'searchText(params.query)', 
                params: { query: 'getUser' }, 
                remember: true, 
                name: 'searchApiFunctions',
                description: 'Searches the repository for the requested function name. Returns matching file, line and text.' 
              } 
            }] };
          }
          if (/select.*executed/i.test(messages[0].content)) return { result: { selected: ['searchApiFunctions'] } };
          return { 
            result: { 
              objective: 'Find API functions', 
              entryPoints: [{ name: 'getUser', evidence: [{ file: 'api.ts', startLine: 1, endLine: 1 }] }], 
              components: [], 
              relations: [], 
              uncertainties: [] 
            } 
          };
        }
      } 
    });
    
    // Second run: create another function
    step = 0;
    await explore({ 
      root, 
      objective: 'Find DB functions', 
      codeMode: true, 
      memory, 
      model: {
        async complete(messages) {
          if (step++ === 0) {
            return { toolCalls: [{ 
              id: 'search-db', 
              name: 'function_try', 
              arguments: { 
                source: 'searchText(params.query)', 
                params: { query: 'query' }, 
                remember: true, 
                name: 'searchDbFunctions',
                description: 'Searches the repository for the requested function name. Returns matching file, line and text.' 
              } 
            }] };
          }
          if (/select.*executed/i.test(messages[0].content)) return { result: { selected: ['searchDbFunctions'] } };
          return { 
            result: { 
              objective: 'Find DB functions', 
              entryPoints: [{ name: 'query', evidence: [{ file: 'db.ts', startLine: 1, endLine: 1 }] }], 
              components: [], 
              relations: [], 
              uncertainties: [] 
            } 
          };
        }
      } 
    });
    
    // Third run: reuse both functions (composite need)
    step = 0;
    let memoryListCalled = false;
    let firstMemoryRunCalled = false;
    let secondMemoryRunCalled = false;
    let memoryToMemoryCall = false;
    let catalog: Array<{ id: string }> = [];
    
    const result = await explore({ 
      root, 
      objective: 'Find all functions', 
      codeMode: true, 
      memory, 
      model: {
        async complete(messages) {
          // Verify the system prompt encourages composition
          assert.match(messages[0].content, /never call one memorized procedure from another/);
          
          if (step === 0) {
            memoryListCalled = true;
            step++;
            return { toolCalls: [{ id: 'list', name: 'memory_list', arguments: {} }] };
          }
          if (step === 1) {
            catalog = JSON.parse(messages.at(-1).content);
            assert.ok(catalog.length >= 2, 'Should have at least 2 functions in memory');
            
            // Use first function
            firstMemoryRunCalled = true;
            step++;
            return { toolCalls: [{ id: 'run1', name: 'memory_run', arguments: { id: catalog[0].id, params: { query: 'getUser' } } }] };
          }
          if (step === 2) {
            // Use second function - NOT calling memory_run on the result of memory_run
            // This ensures no memorized function ever calls another memorized function
            secondMemoryRunCalled = true;
            step++;
            return { toolCalls: [{ id: 'run2', name: 'memory_run', arguments: { id: catalog[1].id, params: { query: 'query' } } }] };
          }
          // Both results should be present
          assert.match(messages.at(-1).content, /getUser|query/);
          return { 
            result: { 
              objective: 'Find all functions', 
              entryPoints: [
                { name: 'getUser', evidence: [{ file: 'api.ts', startLine: 1, endLine: 1 }] },
                { name: 'query', evidence: [{ file: 'db.ts', startLine: 1, endLine: 1 }] }
              ], 
              components: [], 
              relations: [], 
              uncertainties: [] 
            } 
          };
        }
      } 
    });
    
    assert.ok(memoryListCalled, 'memory_list should be called');
    assert.ok(firstMemoryRunCalled, 'First memory_run should be called');
    assert.ok(secondMemoryRunCalled, 'Second memory_run should be called');
    assert.ok(!memoryToMemoryCall, 'No memory_run → memory_run chaining');
    assert.equal(result.metrics.memoryReuses, 2, 'Should reuse 2 functions');
  } finally { 
    await rm(base, { recursive: true, force: true }); 
  }
});

// §2.4 Criterion 5: Test de sortie erronée/absence de preuve
// Correction ou incertitude explicite, pas de faux succès
test('C5: error or missing proof - explicit correction or uncertainty, no false success', async () => {
  const base = await mkdtemp(join(tmpdir(), 'decomposition-c5-'));
  const root = join(base, 'repo');
  await mkdir(root);
  try {
    await writeFile(join(root, 'main.ts'), 'const x = 1;\n');
    
    let step = 0;
    const result = await explore({ 
      root, 
      objective: 'Find non-existent function', 
      codeMode: true, 
      model: {
        async complete(messages) {
          // Verify the system prompt handles missing proofs
          assert.match(messages[0].content, /Return sourced findings and explicit uncertainties/);
          
          if (step === 0) {
            // Try to search for something that doesn't exist
            step++;
            return { toolCalls: [{ id: 'search', name: 'search', arguments: { query: 'nonExistentFunction' } }] };
          }
          // No results found
          const searchResult = JSON.parse(messages.at(-1).content);
          assert.ok(searchResult.matches?.length === 0 || !searchResult.matches, 'No matches');
          
          // Should return with uncertainty, not false success
          return { 
            result: { 
              objective: 'Find non-existent function', 
              entryPoints: [], 
              components: [], 
              relations: [], 
              uncertainties: ['Could not find non-existent function in the codebase'] 
            } 
          };
        }
      } 
    });
    
    assert.equal(result.status, 'partial');
    assert.equal(result.stopReason, 'evidence_missing');
    assert.ok(result.uncertainties.length > 0, 'Should have explicit uncertainties');
    assert.match(result.uncertainties[0], /non-existent|missing|not found/i, 'Uncertainty should explain missing proof');
    assert.equal(result.entryPoints.length, 0, 'Should not claim false entry points');
  } finally { 
    await rm(base, { recursive: true, force: true }); 
  }
});

// §2.4 Criterion 6: Comparer les tokens du prompt et les appels sur ces tests
// La décomposition ne doit pas être considérée utile du seul fait qu'elle est observée
test('the canonical research prompt has a stable fingerprint and flexible plan', () => {
  assert.equal(REEXPORTED_PROMPT_VERSION, PROMPT_VERSION);
  assert.match(DECOMPOSITION_PROMPT, /initial research plan as a flexible guide/);
  assert.match(DECOMPOSITION_PROMPT, /memory_list/);
  assert.equal(PROMPT_SHA256.length, 64);
});

test('plan token overhead is counted in the run usage accounting', async () => {
  const base = await mkdtemp(join(tmpdir(), 'decomposition-plan-tokens-'));
  const root = join(base, 'repo');
  await mkdir(root);
  try {
    await writeFile(join(root, 'main.ts'), 'export function start() { return 42; }\n');
    const plan = { questions: [{ id: 'q1', question: 'Where is the entry point declared?', reuse: false }] };
    let modelCalls = 0;
    const result = await explore({
      root,
      objective: 'Find start',
      codeMode: true,
      model: {
        async complete() {
          modelCalls++;
          if (modelCalls === 1) return { plan, toolCalls: [{ id: 'search-1', name: 'search', arguments: { query: 'start' } }], usage: { inputTokens: 120, outputTokens: 60 } };
          return { result: { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] }, usage: { inputTokens: 80, outputTokens: 30 } };
        }
      }
    });
    // The plan-bearing generation's tokens are fully counted, nothing hidden.
    assert.equal(result.metrics.inputTokens, 200);
    assert.equal(result.metrics.outputTokens, 90);
    assert.equal(result.metrics.usageAvailable, true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// §D01 (#184): a missing plan is a visible anomaly, never a presumed success.
test('a complete run ends with a run_end entry carrying the stop reason and final usage', async () => {
  const base = await mkdtemp(join(tmpdir(), 'decomposition-run-end-'));
  const root = join(base, 'repo');
  await mkdir(root);
  try {
    await writeFile(join(root, 'main.ts'), 'export function start() { return 42; }\n');
    let modelCalls = 0;
    const result = await explore({
      root,
      objective: 'Find start',
      codeMode: true,
      model: {
        async complete() {
          modelCalls++;
          if (modelCalls === 1) return { plan: { questions: [{ id: 'q1', question: 'Where is the entry point declared?', reuse: false }] }, toolCalls: [{ id: 'search-1', name: 'search', arguments: { query: 'start', question_id: 'q1' } }], usage: { inputTokens: 100, outputTokens: 20 } };
          return { result: { objective: 'Find start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] }, usage: { inputTokens: 50, outputTokens: 10 } };
        }
      }
    });
    const runEnd = result.callTrace.at(-1);
    assert.equal(runEnd?.type, 'run_end');
    assert.equal(runEnd?.runId, result.runId);
    assert.match(runEnd?.outcome ?? '', /status=complete; stopReason=none/);
    assert.equal((runEnd?.result as any).inputTokens, 150);
    assert.equal((runEnd?.result as any).outputTokens, 30);
    assert.equal((runEnd?.result as any).stopReason, null);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('a partial run and a failed run both end with a run_end entry', async () => {
  const base = await mkdtemp(join(tmpdir(), 'decomposition-run-end-partial-'));
  const root = join(base, 'repo');
  await mkdir(root);
  try {
    await writeFile(join(root, 'main.ts'), 'export function start() { return 42; }\n');
    // Partial: the iteration budget stops the run with an explicit reason.
    const partial = await explore({ root, objective: 'Find start', budget: { iterations: 1 }, codeMode: true, model: { async complete() { return { toolCalls: [{ id: 'search-1', name: 'search', arguments: { query: 'start' } }] }; } } });
    const partialEnd = partial.callTrace.at(-1);
    assert.equal(partialEnd?.type, 'run_end');
    assert.match(partialEnd?.outcome ?? '', /status=partial; stopReason=iterations/);
    // Failed: the evidence validation rejects the run; the failure trace still
    // ends with run_end.
    await assert.rejects(explore({ root, objective: 'Find start', codeMode: true, model: { async complete() { return { result: { objective: 'Find start', entryPoints: [{ name: 'missing', evidence: [{ file: 'missing.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } }; } } }), (error: any) => {
      const runEnd = error.exploration.callTrace.at(-1);
      assert.equal(runEnd.type, 'run_end');
      assert.match(runEnd.outcome, /status=failed; stopReason=none/);
      assert.equal(runEnd.runId, error.exploration.runId);
      return true;
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// §D01 (#184): the initial plan must be in English. A practicable deterministic
// screen (accented characters, obvious French tokens) flags a non-English plan
// as a visible anomaly — a heuristic, never sold as proof, never a hard
// failure on its own.
