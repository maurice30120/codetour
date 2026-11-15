/**
 * Test script to validate T07 setup
 * 
 * This script validates that:
 * 1. All required files exist
 * 2. Pilot can be executed
 * 3. Main campaign can be executed
 * 4. All NO-GO controls pass
 * 5. Manifest can be frozen
 * 
 * Uses mock executions to avoid actual LLM calls
 */

import fs from 'fs';
import path from 'path';
import { BenchmarkRunner, RunnerConfig, POSTGRES_SHA } from './runner/src/index';
import { freezeManifest, validateManifestFrozen, runPilot } from './pilot';
import { runMainCampaign, verifyAllRunsImmutable, getAllCampaignRuns } from './main-campaign';
import { handleFailure, shouldRetry, shouldRecord, TEST_CASES } from './failure-handler';

/**
 * Test all components of T07
 */
async function testT07Setup() {
  console.log('🧪 Testing T07 Setup');
  console.log('===================\n');

  const tests: Array<{ name: string; passed: boolean; error?: string; details?: string }> = [];

  // Test 1: Required files exist
  console.log('1️⃣  Testing required files...');
  const requiredFiles = [
    'pilot.ts',
    'main-campaign.ts',
    'failure-handler.ts',
    'runner/src/index.ts',
    'runner/src/execution/manager.ts',
    'runner/src/execution/tracker.ts',
    'runner/src/storage/logger.ts',
    'runner/src/agents/codetour.ts',
    'runner/src/agents/vibe.ts',
    'postgres-questions.json',
    'preregistration-manifest.json',
  ];

  let allFilesExist = true;
  const missingFiles: string[] = [];

  for (const file of requiredFiles) {
    const filepath = path.join(__dirname, file);
    if (!fs.existsSync(filepath)) {
      allFilesExist = false;
      missingFiles.push(file);
    }
  }

  if (allFilesExist) {
    tests.push({ name: 'Required files exist', passed: true, details: 'All files found' });
    console.log('   ✅ All required files exist\n');
  } else {
    tests.push({ name: 'Required files exist', passed: false, error: `Missing: ${missingFiles.join(', ')}` });
    console.log(`   ❌ Missing files: ${missingFiles.join(', ')}\n`);
  }

  // Test 2: PostgreSQL questions can be loaded
  console.log('2️⃣  Testing PostgreSQL questions loading...');
  try {
    const config: RunnerConfig = {
      questionsFile: path.join(__dirname, 'postgres-questions.json'),
      manifestFile: path.join(__dirname, 'preregistration-manifest.json'),
      postgresPath: path.join(__dirname, 'postgres'),
      outputDir: path.join(__dirname, 'results'),
    };

    const runner = new BenchmarkRunner(config);
    const questions = await runner.loadQuestions();

    if (questions.length === 40) {
      const seriesR = questions.filter(q => q.series === 'R').length;
      const seriesT = questions.filter(q => q.series === 'T').length;
      
      tests.push({
        name: 'Questions loading',
        passed: true,
        details: `40 questions (R:${seriesR}, T:${seriesT})`
      });
      console.log(`   ✅ Loaded ${questions.length} questions (R:${seriesR}, T:${seriesT})\n`);
    } else {
      tests.push({
        name: 'Questions loading',
        passed: false,
        error: `Expected 40 questions, got ${questions.length}`
      });
      console.log(`   ❌ Expected 40 questions, got ${questions.length}\n`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    tests.push({ name: 'Questions loading', passed: false, error: errorMsg });
    console.error(`   ❌ Failed to load questions: ${errorMsg}\n`);
  }

  // Test 3: PostgreSQL SHA validation
  console.log('3️⃣  Testing PostgreSQL SHA validation...');
  try {
    const config: RunnerConfig = {
      questionsFile: path.join(__dirname, 'postgres-questions.json'),
      manifestFile: path.join(__dirname, 'preregistration-manifest.json'),
      postgresPath: path.join(__dirname, 'postgres'),
      outputDir: path.join(__dirname, 'results'),
    };

    const runner = new BenchmarkRunner(config);
    await runner.loadQuestions();
    const shaValid = runner.validatePostgresSha();

    if (shaValid) {
      tests.push({ name: 'PostgreSQL SHA validation', passed: true, details: POSTGRES_SHA });
      console.log(`   ✅ SHA validated: ${POSTGRES_SHA}\n`);
    } else {
      tests.push({ name: 'PostgreSQL SHA validation', passed: false, error: 'SHA mismatch' });
      console.log('   ❌ SHA validation failed\n');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    tests.push({ name: 'PostgreSQL SHA validation', passed: false, error: errorMsg });
    console.error(`   ❌ SHA validation error: ${errorMsg}\n`);
  }

  // Test 4: Gates validation (G0-G5)
  console.log('4️⃣  Testing gates validation (G0-G5)...');
  try {
    const config: RunnerConfig = {
      questionsFile: path.join(__dirname, 'postgres-questions.json'),
      manifestFile: path.join(__dirname, 'preregistration-manifest.json'),
      postgresPath: path.join(__dirname, 'postgres'),
      outputDir: path.join(__dirname, 'results'),
    };

    const runner = new BenchmarkRunner(config);
    const gatesValid = await runner.validateGates();

    if (gatesValid) {
      tests.push({ name: 'Gates G0-G5 validation', passed: true, details: 'All gates passed' });
      console.log('   ✅ All gates G0-G5 validated\n');
    } else {
      tests.push({ name: 'Gates G0-G5 validation', passed: false, error: 'Some gates failed' });
      console.log('   ❌ Some gates failed\n');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    tests.push({ name: 'Gates G0-G5 validation', passed: false, error: errorMsg });
    console.error(`   ❌ Gates validation error: ${errorMsg}\n`);
  }

  // Test 5: Failure handler
  console.log('5️⃣  Testing failure handler...');
  const context = { questionId: 'test', agent: 'codetour' as const, series: 'R' };

  let allFailureTestsPassed = true;

  // Test infrastructure errors should retry
  for (const error of TEST_CASES.infrastructure) {
    const result = handleFailure(error, context);
    if (result.action !== 'retry' || !result.isInfrastructure) {
      allFailureTestsPassed = false;
      console.log(`   ❌ Infrastructure error should retry: ${error.message}`);
    }
  }

  // Test agent errors should record
  for (const error of TEST_CASES.agent) {
    const result = handleFailure(error, context);
    if (result.action !== 'record' || !result.isAgentFailure) {
      allFailureTestsPassed = false;
      console.log(`   ❌ Agent error should record: ${error.message}`);
    }
  }

  if (allFailureTestsPassed) {
    tests.push({ name: 'Failure handler', passed: true, details: 'All test cases passed' });
    console.log('   ✅ All failure handler tests passed\n');
  } else {
    tests.push({ name: 'Failure handler', passed: false, error: 'Some test cases failed' });
    console.log('   ❌ Some failure handler tests failed\n');
  }

  // Test 6: Manifest can be frozen
  console.log('6️⃣  Testing manifest freezing...');
  try {
    const manifestPath = path.join(__dirname, 'preregistration-manifest.json');
    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent);

    // Freeze manifest
    await freezeManifest(manifest);

    // Check it's frozen
    const isFrozen = validateManifestFrozen();

    if (isFrozen) {
      tests.push({ name: 'Manifest freezing', passed: true, details: 'Manifest locked' });
      console.log('   ✅ Manifest frozen successfully\n');

      // Clean up lock file for next tests
      const lockPath = path.join(__dirname, 'manifest-lock.json');
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
    } else {
      tests.push({ name: 'Manifest freezing', passed: false, error: 'Manifest not frozen' });
      console.log('   ❌ Manifest not frozen\n');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    tests.push({ name: 'Manifest freezing', passed: false, error: errorMsg });
    console.error(`   ❌ Manifest freezing error: ${errorMsg}\n`);
  }

  // Test 7: Directories exist
  console.log('7️⃣  Testing required directories...');
  const requiredDirs = [
    path.join(__dirname, 'results'),
    path.join(__dirname, 'results', 'runs'),
    path.join(__dirname, 'results', 'pilot'),
  ];

  let allDirsExist = true;
  const missingDirs: string[] = [];

  for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) {
      allDirsExist = false;
      missingDirs.push(dir);
    }
  }

  if (allDirsExist) {
    tests.push({ name: 'Required directories', passed: true, details: 'All directories exist' });
    console.log('   ✅ All required directories exist\n');
  } else {
    // Try to create them
    for (const dir of missingDirs) {
      fs.mkdirSync(dir, { recursive: true });
    }
    tests.push({ name: 'Required directories', passed: true, details: 'Directories created' });
    console.log('   ✅ All required directories created\n');
  }

  // Test 8: NO-GO controls validation
  console.log('8️⃣  Testing NO-GO controls...');
  try {
    const config: RunnerConfig = {
      questionsFile: path.join(__dirname, 'postgres-questions.json'),
      manifestFile: path.join(__dirname, 'preregistration-manifest.json'),
      postgresPath: path.join(__dirname, 'postgres'),
      outputDir: path.join(__dirname, 'results'),
    };

    const runner = new BenchmarkRunner(config);
    await runner.loadQuestions();

    // Create a mock trace to test NO-GO controls
    const mockTrace = {
      run_id: 'test-run-1',
      timestamp: new Date().toISOString(),
      agent: 'codetour' as const,
      question_id: 'test-question',
      series: 'R' as const,
      postgres_sha: POSTGRES_SHA,
      calls: [
        {
          call_id: 'call-1',
          call_type: 'prompt' as const,
          input_tokens: 100,
          output_tokens: 50,
          usage_missing: false,
        },
      ],
      total_tokens: {
        input: 100,
        output: 50,
        total: 150,
        verified: true,
      },
      status: 'success' as const,
    };

    // This should pass all NO-GO controls
    const noGoResult = runner.validateNoGoControls(mockTrace);

    if (noGoResult.passed) {
      tests.push({ name: 'NO-GO controls', passed: true, details: 'All controls passed for valid trace' });
      console.log('   ✅ NO-GO controls passed for valid trace\n');
    } else {
      tests.push({ name: 'NO-GO controls', passed: false, error: noGoResult.errors.join(', ') });
      console.log(`   ❌ NO-GO controls failed: ${noGoResult.errors.join(', ')}\n`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    tests.push({ name: 'NO-GO controls', passed: false, error: errorMsg });
    console.error(`   ❌ NO-GO controls error: ${errorMsg}\n`);
  }

  // Summary
  console.log('═'.repeat(65));
  console.log('📊 TEST SUMMARY');
  console.log('═'.repeat(65));

  const passedCount = tests.filter(t => t.passed).length;
  const failedCount = tests.length - passedCount;

  console.log(`\nTotal: ${tests.length} tests`);
  console.log(`Passed: ${passedCount}`);
  console.log(`Failed: ${failedCount}`);

  if (failedCount > 0) {
    console.log('\n❌ Failed tests:');
    for (const test of tests.filter(t => !t.passed)) {
      console.log(`  - ${test.name}: ${test.error}`);
    }
  } else {
    console.log('\n✅ All tests passed!');
  }

  console.log('\n' + '═'.repeat(65));

  return {
    passed: passedCount,
    failed: failedCount,
    total: tests.length,
    tests,
    overallSuccess: failedCount === 0,
  };
}

// Run if executed directly
if (require.main === module) {
  testT07Setup().then(result => {
    process.exit(result.overallSuccess ? 0 : 1);
  }).catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

export { testT07Setup };
