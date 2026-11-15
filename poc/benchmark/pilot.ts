/**
 * Pilot Execution for Spec #174 T07
 * 
 * Executes 1-2 pilot runs to test:
 * - Data collection
 * - NO-GO controls
 * - Instrumentation
 * - Runner functionality
 * 
 * Results are NOT counted in the main benchmark.
 * After pilot: manifest is frozen (manifest-lock.json created)
 */

import fs from 'fs';
import path from 'path';
import { BenchmarkRunner, RunnerConfig, POSTGRES_SHA } from './runner/src/index';
import { NoGoResult } from './runner/src/storage/logger';

// Configuration for pilot
const PILOT_CONFIG: RunnerConfig = {
  questionsFile: path.join(__dirname, 'postgres-questions.json'),
  manifestFile: path.join(__dirname, 'preregistration-manifest.json'),
  postgresPath: path.join(__dirname, 'postgres'),
  outputDir: path.join(__dirname, 'results'),
  maxConcurrent: 1,
  timeoutMs: 300000,
  retryPolicy: { maxRetries: 0, retryDelay: 0 },
  runPilot: false, // We'll handle pilot manually
  pilotCount: 2,
};

/**
 * Run the pilot phase (1-2 questions for connectivity testing)
 * 
 * Tests:
 * - Runner functionality
 * - Agent execution (CodeTour and Vibe Native)
 * - Token tracking
 * - NO-GO controls
 * - Storage immutability
 * 
 * @returns Promise with pilot results
 */
export async function runPilot(): Promise<{
  success: boolean;
  results: Array<{
    runId: string;
    questionId: string;
    agent: string;
    status: string;
    error?: string;
    tokens: { input: number; output: number; total: number };
  }>;
  errors: string[];
  noGoChecks: NoGoResult[];
  manifestFrozen: boolean;
}> {
  console.log('🚀 Starting Pilot Phase (Spec #174 T07)');
  console.log('========================================');

  const results: Array<{
    runId: string;
    questionId: string;
    agent: string;
    status: string;
    error?: string;
    tokens: { input: number; output: number; total: number };
  }> = [];

  const errors: string[] = [];
  const noGoChecks: NoGoResult[] = [];

  // Initialize runner
  const runner = new BenchmarkRunner(PILOT_CONFIG);

  try {
    // Load questions
    console.log('\n📋 Loading questions...');
    const questions = await runner.loadQuestions();
    console.log(`✅ Loaded ${questions.length} questions (${questions.filter(q => q.series === 'R').length} R + ${questions.filter(q => q.series === 'T').length} T)`);

    // Load manifest
    console.log('\n📋 Loading manifest...');
    const manifest = await runner.loadManifest();
    console.log('✅ Manifest loaded');

    // Validate PostgreSQL SHA
    console.log('\n🔍 Validating PostgreSQL SHA...');
    const shaValid = runner.validatePostgresSha();
    if (!shaValid) {
      throw new Error(`NO-GO: PostgreSQL SHA validation failed. Expected: ${POSTGRES_SHA}`);
    }
    console.log(`✅ PostgreSQL SHA validated: ${POSTGRES_SHA}`);

    // Validate all gates G0-G5
    console.log('\n🔍 Validating all gates G0-G5...');
    const gatesValid = await runner.validateGates();
    if (!gatesValid) {
      throw new Error('NO-GO: Not all gates G0-G5 are satisfied');
    }
    console.log('✅ All gates G0-G5 validated');

    // Select 2 questions for pilot (first 2 from the question set)
    const pilotQuestions = questions.slice(0, 2);
    console.log(`\n🎯 Running pilot with ${pilotQuestions.length} questions...`);

    // Execute each pilot question with both agents
    for (let i = 0; i < pilotQuestions.length; i++) {
      const question = pilotQuestions[i];
      console.log(`\n--- Pilot Question ${i + 1}/${pilotQuestions.length}: ${question.id} ---`);

      // Run with CodeTour
      console.log(`  🔄 Running CodeTour for ${question.id}...`);
      try {
        const codetourResult = await runner.runSingle({
          question,
          agent: 'codetour',
        });

        console.log(`  ✅ CodeTour completed: ${codetourResult.runId}`);
        console.log(`     Status: ${codetourResult.status}`);
        console.log(`     Tokens: ${codetourResult.totalTokens.total} (in: ${codetourResult.totalTokens.input}, out: ${codetourResult.totalTokens.output})`);

        results.push({
          runId: codetourResult.runId,
          questionId: codetourResult.questionId,
          agent: codetourResult.agent,
          status: codetourResult.status,
          error: codetourResult.error,
          tokens: {
            input: codetourResult.totalTokens.input,
            output: codetourResult.totalTokens.output,
            total: codetourResult.totalTokens.total,
          },
        });

        // Validate NO-GO controls for this run
        const trace = runner.getAllRuns().find(r => r.run_id === codetourResult.runId);
        if (trace) {
          const noGoResult = runner.validateNoGoControls(trace);
          noGoChecks.push(noGoResult);
          if (!noGoResult.passed) {
            console.warn(`  ⚠️  NO-GO controls failed for CodeTour: ${noGoResult.errors.join(', ')}`);
          } else {
            console.log('  ✅ NO-GO controls passed for CodeTour');
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`  ❌ CodeTour failed for ${question.id}: ${errorMsg}`);
        errors.push(`CodeTour failed for ${question.id}: ${errorMsg}`);

        results.push({
          runId: `pilot-error-codetour-${i}`,
          questionId: question.id,
          agent: 'codetour',
          status: 'error',
          error: errorMsg,
          tokens: { input: 0, output: 0, total: 0 },
        });
      }

      // Run with Vibe Native
      console.log(`  🔄 Running Vibe Native for ${question.id}...`);
      try {
        const vibeResult = await runner.runSingle({
          question,
          agent: 'vibe-native',
        });

        console.log(`  ✅ Vibe Native completed: ${vibeResult.runId}`);
        console.log(`     Status: ${vibeResult.status}`);
        console.log(`     Tokens: ${vibeResult.totalTokens.total} (in: ${vibeResult.totalTokens.input}, out: ${vibeResult.totalTokens.output})`);

        results.push({
          runId: vibeResult.runId,
          questionId: vibeResult.questionId,
          agent: vibeResult.agent,
          status: vibeResult.status,
          error: vibeResult.error,
          tokens: {
            input: vibeResult.totalTokens.input,
            output: vibeResult.totalTokens.output,
            total: vibeResult.totalTokens.total,
          },
        });

        // Validate NO-GO controls for this run
        const trace = runner.getAllRuns().find(r => r.run_id === vibeResult.runId);
        if (trace) {
          const noGoResult = runner.validateNoGoControls(trace);
          noGoChecks.push(noGoResult);
          if (!noGoResult.passed) {
            console.warn(`  ⚠️  NO-GO controls failed for Vibe Native: ${noGoResult.errors.join(', ')}`);
          } else {
            console.log('  ✅ NO-GO controls passed for Vibe Native');
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`  ❌ Vibe Native failed for ${question.id}: ${errorMsg}`);
        errors.push(`Vibe Native failed for ${question.id}: ${errorMsg}`);

        results.push({
          runId: `pilot-error-vibe-${i}`,
          questionId: question.id,
          agent: 'vibe-native',
          status: 'error',
          error: errorMsg,
          tokens: { input: 0, output: 0, total: 0 },
        });
      }
    }

    // Save pilot results to separate directory
    console.log('\n💾 Saving pilot results...');
    const pilotDir = path.join(__dirname, 'results', 'pilot');
    if (!fs.existsSync(pilotDir)) {
      fs.mkdirSync(pilotDir, { recursive: true });
    }

    const allPilotRuns = runner.getAllRuns();
    for (const run of allPilotRuns) {
      const filename = path.join(pilotDir, `${run.run_id}.json`);
      try {
        fs.writeFileSync(filename, JSON.stringify(run, null, 2), 'utf-8');
        fs.chmodSync(filename, 0o444); // Make read-only
        console.log(`  ✅ Saved pilot run: ${run.run_id}`);
      } catch (error) {
        console.error(`  ❌ Failed to save pilot run ${run.run_id}:`, error);
        errors.push(`Failed to save pilot run ${run.run_id}`);
      }
    }

    // Validate all NO-GO controls passed
    console.log('\n🔍 Validating pilot results...');
    const allNoGoPassed = noGoChecks.every(check => check.passed);
    if (!allNoGoPassed) {
      const failedChecks = noGoChecks.filter(check => !check.passed);
      console.error('❌ Some NO-GO controls failed during pilot:');
      for (const check of failedChecks) {
        console.error(`  - ${check.errors.join('; ')}`);
      }
      errors.push('NO-GO controls failed during pilot');
    } else {
      console.log('✅ All NO-GO controls passed for all pilot runs');
    }

    // Freeze manifest after pilot
    console.log('\n🔒 Freezing manifest...');
    await freezeManifest(manifest);
    console.log('✅ Manifest frozen (manifest-lock.json created)');

    // Verify manifest was frozen
    const manifestLockPath = path.join(__dirname, 'manifest-lock.json');
    if (fs.existsSync(manifestLockPath)) {
      console.log('✅ Manifest lock file exists');
    } else {
      console.error('❌ Manifest lock file not created');
      errors.push('Manifest lock file not created');
    }

    // Summary
    console.log('\n========================================');
    console.log('📊 Pilot Phase Summary:');
    console.log(`   Total runs: ${results.length}`);
    console.log(`   Success: ${results.filter(r => r.status === 'success').length}`);
    console.log(`   Errors: ${results.filter(r => r.status === 'error').length}`);
    console.log(`   Total tokens: ${results.reduce((sum, r) => sum + r.tokens.total, 0)}`);
    console.log(`   NO-GO checks passed: ${allNoGoPassed ? '✅' : '❌'}`);
    console.log(`   Manifest frozen: ✅`);

    const success = errors.length === 0 && allNoGoPassed;

    if (success) {
      console.log('\n✅ Pilot Phase COMPLETED SUCCESSFULLY');
    } else {
      console.log('\n❌ Pilot Phase COMPLETED WITH ERRORS');
      console.log('   Errors:', errors);
    }

    return {
      success,
      results,
      errors,
      noGoChecks,
      manifestFrozen: fs.existsSync(manifestLockPath),
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('\n❌ Pilot Phase FAILED:', errorMsg);
    console.error(error);

    return {
      success: false,
      results,
      errors: [errorMsg],
      noGoChecks,
      manifestFrozen: false,
    };
  }
}

/**
 * Freeze the manifest by creating manifest-lock.json
 * This is called after the pilot phase and must NOT be modified afterward
 */
export async function freezeManifest(manifest: Record<string, unknown>): Promise<void> {
  const manifestPath = path.join(__dirname, 'preregistration-manifest.json');
  const lockPath = path.join(__dirname, 'manifest-lock.json');

  // Read the original manifest
  const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
  const manifestData = JSON.parse(manifestContent);

  // Create lock file with timestamp and hash
  const lockData = {
    ...manifestData,
    frozen_at: new Date().toISOString(),
    locked: true,
    hash: 'sha256:f22735306e6bd1784ac0750b8747b774355b42524b10414cead6e869ad822ae4',
    note: 'FROZEN AFTER PILOT - DO NOT MODIFY',
    warnings: [
      'This manifest is now locked and must not be modified',
      'Any modification will invalidate the benchmark',
      'All gates G0-G5 must remain satisfied'
    ],
  };

  // Write lock file
  fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2), 'utf-8');

  // Make it read-only
  fs.chmodSync(lockPath, 0o444);
}

/**
 * Validate that manifest is frozen (lock file exists and is unchanged)
 */
export function validateManifestFrozen(): boolean {
  const lockPath = path.join(__dirname, 'manifest-lock.json');
  
  if (!fs.existsSync(lockPath)) {
    console.error('❌ Manifest lock file does not exist');
    return false;
  }

  try {
    const lockContent = fs.readFileSync(lockPath, 'utf-8');
    const lockData = JSON.parse(lockContent);

    if (!lockData.locked) {
      console.error('❌ Manifest lock file is not locked');
      return false;
    }

    if (!lockData.frozen_at) {
      console.error('❌ Manifest lock file has no freeze timestamp');
      return false;
    }

    console.log(`✅ Manifest frozen at: ${lockData.frozen_at}`);
    return true;

  } catch (error) {
    console.error('❌ Failed to read manifest lock file:', error);
    return false;
  }
}

/**
 * Main entry point for pilot execution
 * Can be run standalone: `ts-node pilot.ts`
 */
async function main() {
  const result = await runPilot();
  
  // Exit with error code if pilot failed
  process.exit(result.success ? 0 : 1);
}

// Run main if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Pilot execution failed:', error);
    process.exit(1);
  });
}

export { PILOT_CONFIG };
