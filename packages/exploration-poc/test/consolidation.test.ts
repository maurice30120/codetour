import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptMemory } from '../src/memory.ts';

// Test 1: Replace existing function with improved version
test('replace existing function with improved version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replace-'));
  const directory = join(root, 'memory');
  
  try {
    const store = await scriptMemory(root, directory);
    
    // Add initial function
    const initialCandidate = {
      objective: 'Search',
      description: 'Initial search',
      code: 'function search(query) { return query; }',
      parameters: ['query'],
      verified: true
    };
    
    await store.finish([], [initialCandidate]);
    const initialEntries = store.catalog();
    assert.equal(initialEntries.length, 1);
    const initialId = initialEntries[0].id;
    const initialEntry = store.get(initialId);
    assert.ok(initialEntry);
    assert.equal(initialEntry.code, initialCandidate.code);
    
    // Replace with improved version - need to explicitly reference the original
    const improvedCandidate = {
      objective: 'Search',
      description: 'Improved search',
      code: 'function search(query) { return query.toUpperCase(); }',
      parameters: ['query'],
      verified: true,
      fingerprint: 'improved_v1',
      version: 2,
      replaces: initialId
    };
    
    await store.finish([], [improvedCandidate]);
    const updatedEntries = store.catalog();
    
    // Should have both original and improved version
    assert.equal(updatedEntries.length, 2);
    
    const improvedEntry = store.get(initialId + '_v2');
    assert.ok(improvedEntry);
    assert.equal(improvedEntry.code, improvedCandidate.code);
    
    // Original should still exist
    const originalEntry = store.get(initialId);
    assert.ok(originalEntry);
    assert.equal(originalEntry.code, initialCandidate.code);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Test 2: Ignore duplicates or unsuitable candidates
test('ignore exact duplicates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ignore-dupes-'));
  const directory = join(root, 'memory');
  
  try {
    const store = await scriptMemory(root, directory);
    
    const candidate = {
      objective: 'Search',
      description: 'Search function',
      code: 'function search(query) { return query; }',
      parameters: ['query'],
      verified: true
    };
    
    // Add first time
    await store.finish([], [candidate]);
    assert.equal(store.catalog().length, 1);
    
    // Try to add exact duplicate
    await store.finish([], [candidate]);
    assert.equal(store.catalog().length, 1);
    
    // Add with different description but same code and parameters
    const duplicateCandidate = {
      ...candidate,
      description: 'Same search function'
    };
    await store.finish([], [duplicateCandidate]);
    // Should still be 1 due to deduplication
    assert.equal(store.catalog().length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Test 3: Verify fingerprint/version matches executed code
test('verify fingerprint and version tracking', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fingerprint-'));
  const directory = join(root, 'memory');
  
  try {
    const store = await scriptMemory(root, directory);
    
    const candidate = {
      objective: 'Search',
      description: 'Search with fingerprint',
      code: 'function search(query) { return query; }',
      parameters: ['query'],
      verified: true,
      fingerprint: 'abc123',
      version: 1
    };
    
    await store.finish([], [candidate]);
    const entries = store.catalog();
    assert.equal(entries.length, 1);
    
    const entry = store.get(entries[0].id);
    assert.ok(entry);
    // Entry should have metadata for fingerprint and version
    assert.equal((entry as any).fingerprint, 'abc123');
    assert.equal((entry as any).version, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Test 4: Simple deduplication
test('simple deduplication without scoring', async () => {
  const root = await mkdtemp(join(tmpdir(), 'simple-dedup-'));
  const directory = join(root, 'memory');
  
  try {
    const store = await scriptMemory(root, directory, { deduplicate: true });
    
    const candidate1 = {
      objective: 'Search',
      description: 'Search v1',
      code: 'function search(query) { return query; }',
      parameters: ['query'],
      verified: true
    };
    
    const candidate2 = {
      objective: 'Search',
      description: 'Search v2 - same code',
      code: 'function search(query) { return query; }',
      parameters: ['query'],
      verified: true
    };
    
    // Add both - deduplication should skip the second
    await store.finish([], [candidate1, candidate2]);
    assert.equal(store.catalog().length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Test 5: Variants suffixées, original préservé
test('variants with suffixes preserve original', async () => {
  const root = await mkdtemp(join(tmpdir(), 'variants-'));
  const directory = join(root, 'memory');
  
  try {
    const store = await scriptMemory(root, directory);
    
    const original = {
      objective: 'Search',
      description: 'Original search',
      code: 'function search(query) { return query; }',
      parameters: ['query'],
      verified: true
    };
    
    await store.finish([], [original]);
    const originalId = store.catalog()[0].id;
    
    // Add variant with suffix - need to explicitly reference the original
    const variant = {
      objective: 'Search',
      description: 'Search variant',
      code: 'function search(query, options) { return query; }',
      parameters: ['query', 'options'],
      verified: true,
      fingerprint: 'variant_1',
      version: 2,
      variantOf: originalId
    };
    
    await store.finish([], [variant]);
    const entries = store.catalog();
    
    // Should have both original and variant
    assert.equal(entries.length, 2);
    
    // Original should still exist
    const originalEntry = store.get(originalId);
    assert.ok(originalEntry);
    assert.equal(originalEntry.code, original.code);
    
    // Variant should have suffixed ID
    const variantEntry = entries.find(e => e.id.includes('_v2'));
    assert.ok(variantEntry);
    assert.equal(variantEntry?.id, originalId + '_v2');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Test 6: Rollback capability - keep original intact until validated
test('keep original intact until new version validated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rollback-'));
  const directory = join(root, 'memory');
  
  try {
    const store = await scriptMemory(root, directory);
    
    const original = {
      objective: 'Search',
      description: 'Original',
      code: 'function search(query) { return query; }',
      parameters: ['query'],
      verified: true
    };
    
    await store.finish([], [original]);
    const originalId = store.catalog()[0].id;
    const originalCode = store.get(originalId)?.code;
    
    // Add improved version (not yet validated)
    const improved = {
      objective: 'Search',
      description: 'Improved',
      code: 'function search(query) { return query.toUpperCase(); }',
      parameters: ['query'],
      verified: false, // Not validated yet
      fingerprint: 'improved_pending'
    };
    
    await store.finish([], [improved]);
    
    // Original should remain unchanged
    const currentOriginal = store.get(originalId);
    assert.ok(currentOriginal);
    assert.equal(currentOriginal.code, originalCode);
    
    // Improved version should be added separately
    assert.equal(store.catalog().length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Test 7: Add new functions (existing functionality)
test('add new functions to memory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'add-new-'));
  const directory = join(root, 'memory');
  
  try {
    const store = await scriptMemory(root, directory);
    
    const func1 = {
      objective: 'Search',
      description: 'Search function',
      code: 'function search(query) { return query; }',
      parameters: ['query'],
      verified: true
    };
    
    const func2 = {
      objective: 'Filter',
      description: 'Filter function',
      code: 'function filter(items) { return items; }',
      parameters: ['items'],
      verified: true
    };
    
    await store.finish([], [func1, func2]);
    assert.equal(store.catalog().length, 2);
    
    const ids = store.catalog().map(e => e.id);
    assert.ok(ids.every(id => store.get(id)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Test 8: Replace with improved version after validation
test('replace existing with improved version after validation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replace-validated-'));
  const directory = join(root, 'memory');
  
  try {
    const store = await scriptMemory(root, directory);
    
    const original = {
      objective: 'Search',
      description: 'Original search',
      code: 'function search(query) { return query; }',
      parameters: ['query'],
      verified: true
    };
    
    await store.finish([], [original]);
    const originalId = store.catalog()[0].id;
    
    // Add improved version that should replace the original
    const improved = {
      objective: 'Search',
      description: 'Improved search',
      code: 'function search(query) { return query.toUpperCase(); }',
      parameters: ['query'],
      verified: true,
      fingerprint: 'improved_v1',
      version: 2,
      replaces: originalId
    };
    
    await store.finish([], [improved]);
    
    // Both should exist initially
    assert.equal(store.catalog().length, 2);
    
    // After validation, original should be marked as replaced
    const originalEntry = store.get(originalId);
    assert.ok(originalEntry);
    // Original should have a replacedBy field
    assert.equal((originalEntry as any).replacedBy, improved.fingerprint);
    
    // Improved should exist
    const improvedEntry = store.catalog().find(e => e.id !== originalId);
    assert.ok(improvedEntry);
    assert.equal(store.get(improvedEntry.id)?.code, improved.code);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
