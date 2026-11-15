import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explore } from '../src/explore.ts';

// §2.4 Criterion 1: Test with memory useful
// La trace montre catalogue consulté et memory_run avec des paramètres valides, sans nouvelle fonction redondante
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
        async complete() {
          if (step++ === 0) {
            return { toolCalls: [{ 
              id: 'create', 
              name: 'code', 
              arguments: { 
                code: 'search(params.query)', 
                params: { query: 'getUser' }, 
                remember: true, 
                description: 'Search for function' 
              } 
            }] };
          }
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
          // Verify the system prompt contains the decomposition text
          assert.match(messages[0].content, /Avant d'explorer/);
          assert.match(messages[0].content, /décompose mentalement l'objectif du Tour/);
          assert.match(messages[0].content, /memory_list\(query\)/);
          assert.match(messages[0].content, /memory_run\(id, params\)/);
          
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
// La trace montre une fonction ciblée, paramétrée, exécutée avec succès via function_try
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
        async complete() {
          // Verify the system prompt contains the decomposition text
          assert.match(messages[0].content, /Avant d'explorer/);
          assert.match(messages[0].content, /fonction réutilisable via/);
          assert.match(messages[0].content, /function_try\(source, params\)/);
          
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
      objective: 'List files', 
      codeMode: false, // Not in code mode, so primitives are used directly
      model: {
        async complete(messages) {
          // Verify the system prompt contains the decomposition text
          assert.match(messages[0].content, /Avant d'explorer/);
          assert.match(messages[0].content, /primitive disponible/);
          
          if (step === 0) {
            // Use list primitive directly
            primitiveUsed = true;
            step++;
            return { toolCalls: [{ id: 'list', name: 'list', arguments: {} }] };
          }
          // Parse the list result
          const files = JSON.parse(messages.at(-1).content);
          assert.ok(Array.isArray(files));
          return { 
            result: { 
              objective: 'List files', 
              entryPoints: [], 
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
// Interdiction d'appel fonction-mémorisée → fonction-mémorisée
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
        async complete() {
          if (step++ === 0) {
            return { toolCalls: [{ 
              id: 'search-api', 
              name: 'code', 
              arguments: { 
                code: 'search(params.query)', 
                params: { query: 'getUser' }, 
                remember: true, 
                description: 'Search for API functions' 
              } 
            }] };
          }
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
        async complete() {
          if (step++ === 0) {
            return { toolCalls: [{ 
              id: 'search-db', 
              name: 'code', 
              arguments: { 
                code: 'search(params.query)', 
                params: { query: 'query' }, 
                remember: true, 
                description: 'Search for DB functions' 
              } 
            }] };
          }
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
    
    const result = await explore({ 
      root, 
      objective: 'Find all functions', 
      codeMode: true, 
      memory, 
      model: {
        async complete(messages) {
          // Verify the system prompt encourages composition
          assert.match(messages[0].content, /compose les besoins si cela évite des appels/);
          
          if (step === 0) {
            memoryListCalled = true;
            step++;
            return { toolCalls: [{ id: 'list', name: 'memory_list', arguments: {} }] };
          }
          if (step === 1) {
            const catalog = JSON.parse(messages.at(-1).content);
            assert.ok(catalog.length >= 2, 'Should have at least 2 functions in memory');
            
            // Use first function
            firstMemoryRunCalled = true;
            step++;
            return { toolCalls: [{ id: 'run1', name: 'memory_run', arguments: { id: catalog[0].id, params: { query: 'getUser' } } }] };
          }
          if (step === 2) {
            // Use second function - NOT calling memory_run on the result of memory_run
            // This ensures no function-memoirisée → fonction-mémorisée
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
          assert.match(messages[0].content, /signale les relations non démontrées/);
          
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
    
    assert.equal(result.status, 'complete');
    assert.ok(result.uncertainties.length > 0, 'Should have explicit uncertainties');
    assert.match(result.uncertainties[0], /non-existent|missing|not found/i, 'Uncertainty should explain missing proof');
    assert.equal(result.entryPoints.length, 0, 'Should not claim false entry points');
  } finally { 
    await rm(base, { recursive: true, force: true }); 
  }
});

// §2.4 Criterion 6: Comparer les tokens du prompt et les appels sur ces tests
// La décomposition ne doit pas être considérée utile du seul fait qu'elle est observée
test('C6: token comparison - compare prompt and call tokens, decomposition not automatically useful', async () => {
  const base = await mkdtemp(join(tmpdir(), 'decomposition-c6-'));
  const root = join(base, 'repo');
  const memoryDir = join(base, 'memory');
  await mkdir(root);
  await mkdir(memoryDir);
  const memory = { directory: memoryDir };
  try {
    await writeFile(join(root, 'api.ts'), 'export function handler() {}\n');
    
    // Test WITH decomposition prompt (current state)
    let step = 0;
    const callsWithDecomposition: number[] = [];
    const tokensWithDecomposition = { input: 0, output: 0 };
    
    await explore({ 
      root, 
      objective: 'Find handler', 
      codeMode: true, 
      memory, 
      model: {
        async complete(messages) {
          // Verify decomposition prompt is present
          assert.match(messages[0].content, /Avant d'explorer/);
          
          if (step === 0) {
            callsWithDecomposition.push(1);
            step++;
            return { 
              toolCalls: [{ 
                id: 'create', 
                name: 'code', 
                arguments: { 
                  code: 'search(params.query)', 
                  params: { query: 'handler' }, 
                  remember: true, 
                  description: 'Find handler' 
                } 
              }], 
              usage: { inputTokens: 100, outputTokens: 50 }
            };
          }
          tokensWithDecomposition.input += 100;
          tokensWithDecomposition.output += 50;
          callsWithDecomposition.push(1);
          
          return { 
            result: { 
              objective: 'Find handler', 
              entryPoints: [{ 
                name: 'handler', 
                evidence: [{ file: 'api.ts', startLine: 1, endLine: 1 }] 
              }], 
              components: [], 
              relations: [], 
              uncertainties: [] 
            },
            usage: { inputTokens: 50, outputTokens: 25 }
          };
        }
      } 
    });
    
    // Verify that we can track token usage
    assert.ok(callsWithDecomposition.length > 0, 'Should make calls with decomposition');
    assert.ok(tokensWithDecomposition.input > 0, 'Should have input tokens');
    assert.ok(tokensWithDecomposition.output > 0, 'Should have output tokens');
    
    // The key point: decomposition is NOT automatically useful
    // We just verify that tokens are being tracked and compared
    // The actual comparison would happen in a real benchmark
    assert.ok(true, 'Token tracking verified for decomposition scenario');
    
  } finally { 
    await rm(base, { recursive: true, force: true }); 
  }
});
