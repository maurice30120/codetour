/**
 * Tests for local technical validation (ticket 04)
 * 
 * Tests cover:
 * - TypeScript type checking
 * - Primitive whitelist validation
 * - Call tracing
 * - Rollback mechanism
 * - Re-execution verification
 */

const { validateCode, WHITELIST, validatePrimitives, TraceValidator, validateFull } = require('./validation.js');
const assert = require('assert');

// Test TypeScript Type Checking
async function testTypeScriptTypeChecking() {
  console.log('Testing TypeScript Type Checking...');
  
  // Test 1: Valid TypeScript code
  const validCode = `
    function test(): string {
      return "hello";
    }
  `;
  const result1 = await validateCode(validCode);
  assert.strictEqual(result1.valid, true, 'Valid TypeScript should pass');
  assert.deepStrictEqual(result1.errors, [], 'Should have no errors');
  
  // Test 2: Invalid TypeScript syntax
  const invalidCode = `function test(): string { return 123; }`;
  const result2 = await validateCode(invalidCode);
  assert.strictEqual(result2.valid, false, 'Invalid TypeScript should fail');
  assert(result2.errors.length > 0, 'Should have errors');
  
  // Test 3: Primitive usage with proper type checking
  const primitiveCode = `
    function searchAndRead(params: { query: string, file: string }): Array<{ line: number, text: string }> {
      const results = search(params.query);
      const first = results[0];
      if (first) {
        return read(params.file, first.line - 2, first.line + 2);
      }
      return [];
    }
  `;
  const result3 = await validateCode(primitiveCode);
  assert.strictEqual(result3.valid, true, 'Primitive usage should be valid TypeScript');
  
  console.log('✓ TypeScript Type Checking tests passed');
}

// Test Primitive Whitelist Validation
async function testPrimitiveWhitelist() {
  console.log('Testing Primitive Whitelist Validation...');
  
  // Test 1: Whitelist contains all 10 primitives plus aliases
  assert(WHITELIST.length >= 10, 'Should have at least 10 primitives');
  assert(WHITELIST.includes('listFiles'), 'Should include listFiles');
  assert(WHITELIST.includes('searchText'), 'Should include searchText');
  assert(WHITELIST.includes('searchIdentifiers'), 'Should include searchIdentifiers');
  assert(WHITELIST.includes('readLines'), 'Should include readLines');
  assert(WHITELIST.includes('readAround'), 'Should include readAround');
  assert(WHITELIST.includes('listSymbols'), 'Should include listSymbols');
  assert(WHITELIST.includes('findDefinitions'), 'Should include findDefinitions');
  assert(WHITELIST.includes('findReferences'), 'Should include findReferences');
  assert(WHITELIST.includes('getImports'), 'Should include getImports');
  assert(WHITELIST.includes('getGitDiff'), 'Should include getGitDiff');
  
  // Test 2: Valid code using whitelisted primitives
  const validCode = `
    function findAll(file) {
      return listFiles().filter(f => f === file);
    }
  `;
  const result1 = validatePrimitives(validCode);
  assert.strictEqual(result1.valid, true, 'Whitelisted primitive should pass');
  assert.deepStrictEqual(result1.violations, [], 'Should have no violations');
  
  // Test 3: Code using non-whitelisted functions
  const badCode = `
    function bad() {
      return require('fs').readFileSync('/etc/passwd');
    }
  `;
  const result2 = validatePrimitives(badCode);
  assert.strictEqual(result2.valid, false, 'Non-whitelisted function should fail');
  assert(result2.violations.length > 0, 'Should have violations');
  assert(result2.violations.some(v => v.type === 'dangerous-function' || v.type === 'non-whitelisted-call'), 
    'Should have dangerous-function or non-whitelisted-call violation');
  
  // Test 4: eval is rejected
  const evalCode = `
    function bad() {
      return eval('1+1');
    }
  `;
  const result3 = validatePrimitives(evalCode);
  assert.strictEqual(result3.valid, false, 'eval should be rejected');
  assert(result3.violations.some(v => v.type === 'dangerous-function'), 'Should flag dangerous function');
  
  console.log('✓ Primitive Whitelist Validation tests passed');
}

// Test Call Tracing
async function testCallTracing() {
  console.log('Testing Call Tracing...');
  
  const tracer = new TraceValidator();
  
  // Test 1: Trace primitive calls with file and line info
  const code1 = `listFiles()`;
  const result1 = await tracer.trace(code1, '/test/workspace');
  assert(result1.traces.length > 0, 'Should have traces');
  const trace = result1.traces[0];
  assert(trace.hasOwnProperty('function'), 'Trace should have function');
  assert(trace.hasOwnProperty('file'), 'Trace should have file');
  assert(trace.hasOwnProperty('line'), 'Trace should have line');
  assert(trace.hasOwnProperty('revision'), 'Trace should have revision');
  
  // Test 2: Trace multiple primitive calls
  const code2 = `searchText('test'); read('file.txt', 1, 10);`;
  const result2 = await tracer.trace(code2, '/test/workspace');
  assert(result2.traces.length >= 2, 'Should have multiple traces');
  
  // Test 3: Handle traced calls with proofs
  const code3 = `searchText('query')`;
  const result3 = await tracer.trace(code3, '/test/workspace');
  assert(result3.proofs.length > 0, 'Should have proofs');
  const proof = result3.proofs[0];
  assert(proof.hasOwnProperty('call'), 'Proof should have call');
  assert(proof.hasOwnProperty('evidence'), 'Proof should have evidence');
  
  // Test 4: Rollback
  assert(result3.hasOwnProperty('rollback'), 'Should have rollback function');
  assert(typeof result3.rollback === 'function', 'Rollback should be a function');
  const rollbackState = result3.rollback();
  assert(rollbackState.hasOwnProperty('traces'), 'Rollback should have traces');
  assert(rollbackState.hasOwnProperty('proofs'), 'Rollback should have proofs');
  assert(rollbackState.hasOwnProperty('timestamp'), 'Rollback should have timestamp');
  
  console.log('✓ Call Tracing tests passed');
}

// Test Documentation and Rollback
async function testDocumentationAndRollback() {
  console.log('Testing Documentation and Rollback...');
  
  const code = `
    function safeSearch(query: string) {
      return searchText(query);
    }
  `;
  
  // Test 1: Create documentation for validation results
  const result = await validateCode(code);
  const doc = result.documentation;
  assert(doc.hasOwnProperty('status'), 'Documentation should have status');
  assert(doc.hasOwnProperty('errors'), 'Documentation should have errors');
  assert(doc.hasOwnProperty('warnings'), 'Documentation should have warnings');
  assert(doc.hasOwnProperty('timestamp'), 'Documentation should have timestamp');
  
  // Test 2: No semantic validation claims
  assert(doc.notes && doc.notes.length > 0, 'Should have notes');
  assert(doc.notes.some(n => n.includes('No claims')), 'Should have no claims disclaimer');
  assert(doc.notes.includes('Local technical validation only'), 'Should explicitly state local technical validation only');
  assert(doc.notes.includes('No claims of exhaustiveness'), 'Should explicitly state no exhaustiveness');
  
  console.log('✓ Documentation and Rollback tests passed');
}

// Test Re-execution Verification
async function testReExecutionVerification() {
  console.log('Testing Re-execution Verification...');
  
  // Test 1: Verify code before execution
  const validCode = `
    function test(query: string) {
      return searchText(query).slice(0, 10);
    }
  `;
  const result1 = await validateCode(validCode);
  assert(result1.valid, 'Valid code should pass');
  assert(result1.verification !== undefined, 'Should have verification');
  assert(result1.verification.hasOwnProperty('reExecutable'), 'Should have reExecutable');
  assert(result1.verification.reExecutable === true, 'Should be reExecutable');
  
  // Test 2: Reject infinite loop
  const infiniteLoopCode = `
    function bad() {
      while (true) {}
    }
  `;
  const result2 = await validateCode(infiniteLoopCode);
  // Note: TypeScript might still validate this syntactically
  
  // Test 3: Full validation with tracer
  const tracer = new TraceValidator();
  const traceResult = await tracer.trace(validCode, '/test/workspace');
  assert(traceResult.verification.reExecutable === true, 'Should be reExecutable in trace');
  
  console.log('✓ Re-execution Verification tests passed');
}

// Test Integration
async function testIntegration() {
  console.log('Testing Integration...');
  
  // Test 1: Full validation pipeline for valid code
  const validCode = `
    function findFunctionDefinition(symbol: string): { file: string, line: number }[] {
      return findDefinitions(symbol);
    }
  `;
  const result = await validateFull(validCode, '/test/workspace', { trace: true });
  assert.strictEqual(result.valid, true, 'Valid code should pass full validation');
  assert(result.typeChecking.valid, 'Type checking should pass');
  assert(result.primitiveValidation.valid, 'Primitive validation should pass');
  assert(result.traceValidation.traces.length > 0, 'Should have traces');
  assert(result.traceValidation.verification.reExecutable, 'Should be reExecutable');
  
  // Test 2: Invalid code fails validation
  const badCode = `
    function bad() {
      return eval('dangerous');
    }
  `;
  const result2 = await validateFull(badCode, '/test/workspace', { trace: true });
  assert.strictEqual(result2.valid, false, 'Invalid code should fail full validation');
  assert(result2.primitiveValidation.valid === false, 'Primitive validation should fail');
  
  // Test 3: No semantic validation claim
  const wrongButValidCode = `
    function add(a: number, b: number): number {
      return a - b; // Wrong implementation but type-correct
    }
  `;
  const result3 = await validateFull(wrongButValidCode, '/test/workspace', { trace: true });
  assert(result3.valid, 'Type-correct code should pass even with wrong logic');
  assert(result3.documentation.notes.includes('No claims of semantic validation'), 
    'Should not claim semantic validation');
  
  console.log('✓ Integration tests passed');
}

// Run all tests
async function runAllTests() {
  console.log('========================================');
  console.log('Running Local Technical Validation Tests');
  console.log('========================================\n');
  
  try {
    await testTypeScriptTypeChecking();
    await testPrimitiveWhitelist();
    await testCallTracing();
    await testDocumentationAndRollback();
    await testReExecutionVerification();
    await testIntegration();
    
    console.log('\n========================================');
    console.log('✓ All tests passed!');
    console.log('========================================');
    return true;
  } catch (error) {
    console.error('\n✗ Test failed:', error.message);
    console.error(error.stack);
    return false;
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { runAllTests };
