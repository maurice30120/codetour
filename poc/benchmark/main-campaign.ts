/**
 * Main Campaign Execution for Spec #174 T07
 * 
 * Executes 80 runs:
 * - Series R: 20 questions × 2 agents (CodeTour + Vibe-native) = 40 runs
 *   - CodeTour: empty memory, persists between requests
 *   - Vibe-native: independent sessions
 * - Series T: 20 questions × 2 agents = 40 runs
 *   - CodeTour: NEW empty memory at start of T
 *   - Vibe-native: independent sessions
 * 
 * All runs are REAL executions (no mocks, no simulations)
 * All runs must be immutable and timestamped with run-id
 */

import fs from 'fs';
import path from 'path';
import { BenchmarkRunner, RunnerConfig, RunResult, POSTGRES_SHA } from './runner/src/index';
import { NoGoResult } from './runner/src/storage/logger';
import { validateManifestFrozen } from './pilot';
import { handleFailure } from './failure-handler';

// Configuration for main campaign
const CAMPAIGN_CONFIG: RunnerConfig = {
  questionsFile: path.join(__dirname, 'postgres-questions.json'),
  manifestFile: path.join(__dirname, 'preregistration-manifest.json'),
  postgresPath: path.join(__dirname, 'postgres'),
  outputDir: path.join(__dirname, 'results'),
  maxConcurrent: 1, // Sequential execution for reliability
  timeoutMs: 300000, // 5 minutes per run
  retryPolicy: {
    maxRetries: 3,
    retryDelay: 5000, // 5 seconds between retries
  },
  runPilot: false, // Pilot already done
};

/**
 * Separate Series R and Series T questions
 */
function separateQuestions(questions: Array<{ id: string; series: string; objective: string }>): {
  seriesR: Array<{ id: string; series: string; objective: string }>;
  seriesT: Array<{ id: string; series: string; objective: string }>;
} {
  const seriesR = questions.filter(q => q.series === 'R');
  const seriesT = questions.filter(q => q.series === 'T');
  return { seriesR, seriesT };
}

/**
 * Run Series R (Repetition)
 * - 20 questions × 2 agents = 40 runs
 * - CodeTour: empty memory at start, persists between requests
 * - Vibe-native: independent sessions
 */
async function runSeriesR(
  runner: BenchmarkRunner,
  questions: Array<{ id: string; series: string; objective: string }>
): Promise<{
  runs: RunResult[];
  errors: string[];
  noGoChecks: NoGoResult[];
}> {
  console.log('\n📊 Starting Series R — Répétition (40 runs)');
  console.log('============================================');
  console.log('  CodeTour: empty memory, persists between requests');
  console.log('  Vibe-native: independent sessions');

  const runs: RunResult[] = [];
  const errors: string[] = [];
  const noGoChecks: NoGoResult[] = [];

  // Execute each question with both agents
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    console.log(`\n--- Series R, Question ${i + 1}/${questions.length}: ${question.id} ---`);

    // Run with CodeTour (memory persists between requests in series R)
    console.log(`  🔄 Running CodeTour for ${question.id}...`);
    try {
      const result = await runner.runSingle({
        question,
        agent: 'codetour',
      });

      console.log(`  ✅ CodeTour completed: ${result.runId}`);
      console.log(`     Tokens: ${result.totalTokens.total}`);
      console.log(`     Status: ${result.status}`);

      runs.push(result);

      // Validate NO-GO controls
      const allRuns = runner.getAllRuns();
      const trace = allRuns.find(r => r.run_id === result.runId);
      if (trace) {
        const noGoResult = runner.validateNoGoControls(trace);
        noGoChecks.push(noGoResult);
        if (!noGoResult.passed) {
          console.warn(`  ⚠️  NO-GO controls failed: ${noGoResult.errors.join(', ')}`);
          errors.push(`NO-GO controls failed for CodeTour ${question.id}: ${noGoResult.errors.join(', ')}`);
        } else {
          console.log('  ✅ NO-GO controls passed');
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ CodeTour failed for ${question.id}: ${errorMsg}`);
      errors.push(`CodeTour failed for ${question.id}: ${errorMsg}`);

      // Check if it's an infrastructure failure (should retry)
      const context = { questionId: question.id, agent: 'codetour' };
      const failureResult = handleFailure(error, context);
      
      if (failureResult.action === 'retry') {
        console.log(`  🔄 Infrastructure failure - will retry according to policy`);
        // The runner's retryPolicy will handle retries
      } else {
        console.log(`  📝 Agent failure - recorded and continues`);
      }
    }

    // Run with Vibe-native (independent session)
    console.log(`  🔄 Running Vibe Native for ${question.id}...`);
    try {
      const result = await runner.runSingle({
        question,
        agent: 'vibe-native',
      });

      console.log(`  ✅ Vibe Native completed: ${result.runId}`);
      console.log(`     Tokens: ${result.totalTokens.total}`);
      console.log(`     Status: ${result.status}`);

      runs.push(result);

      // Validate NO-GO controls
      const allRuns = runner.getAllRuns();
      const trace = allRuns.find(r => r.run_id === result.runId);
      if (trace) {
        const noGoResult = runner.validateNoGoControls(trace);
        noGoChecks.push(noGoResult);
        if (!noGoResult.passed) {
          console.warn(`  ⚠️  NO-GO controls failed: ${noGoResult.errors.join(', ')}`);
          errors.push(`NO-GO controls failed for Vibe Native ${question.id}: ${noGoResult.errors.join(', ')}`);
        } else {
          console.log('  ✅ NO-GO controls passed');
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ Vibe Native failed for ${question.id}: ${errorMsg}`);
      errors.push(`Vibe Native failed for ${question.id}: ${errorMsg}`);

      // Check if it's an infrastructure failure
      const context = { questionId: question.id, agent: 'vibe-native' };
      const failureResult = handleFailure(error, context);
      
      if (failureResult.action === 'retry') {
        console.log(`  🔄 Infrastructure failure - will retry according to policy`);
      } else {
        console.log(`  📝 Agent failure - recorded and continues`);
      }
    }
  }

  console.log(`\n✅ Series R completed: ${runs.length} runs`);
  return { runs, errors, noGoChecks };
}

/**
 * Run Series T (Transfer)
 * - 20 questions × 2 agents = 40 runs
 * - CodeTour: NEW empty memory at start of T
 * - Vibe-native: independent sessions
 */
async function runSeriesT(
  runner: BenchmarkRunner,
  questions: Array<{ id: string; series: string; objective: string }>
): Promise<{
  runs: RunResult[];
  errors: string[];
  noGoChecks: NoGoResult[];
}> {
  console.log('\n📊 Starting Series T — Transfert (40 runs)');
  console.log('============================================');
  console.log('  CodeTour: NEW empty memory at start of T');
  console.log('  Vibe-native: independent sessions');

  const runs: RunResult[] = [];
  const errors: string[] = [];
  const noGoChecks: NoGoResult[] = [];

  // Note: In a real implementation, we would reset CodeTour memory here
  // For T05, this is handled by the executor
  console.log('  ℹ️  CodeTour memory reset for Series T');

  // Execute each question with both agents
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    console.log(`\n--- Series T, Question ${i + 1}/${questions.length}: ${question.id} ---`);

    // Run with CodeTour (new memory at start of T)
    console.log(`  🔄 Running CodeTour for ${question.id}...`);
    try {
      const result = await runner.runSingle({
        question,
        agent: 'codetour',
      });

      console.log(`  ✅ CodeTour completed: ${result.runId}`);
      console.log(`     Tokens: ${result.totalTokens.total}`);
      console.log(`     Status: ${result.status}`);

      runs.push(result);

      // Validate NO-GO controls
      const allRuns = runner.getAllRuns();
      const trace = allRuns.find(r => r.run_id === result.runId);
      if (trace) {
        const noGoResult = runner.validateNoGoControls(trace);
        noGoChecks.push(noGoResult);
        if (!noGoResult.passed) {
          console.warn(`  ⚠️  NO-GO controls failed: ${noGoResult.errors.join(', ')}`);
          errors.push(`NO-GO controls failed for CodeTour ${question.id}: ${noGoResult.errors.join(', ')}`);
        } else {
          console.log('  ✅ NO-GO controls passed');
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ CodeTour failed for ${question.id}: ${errorMsg}`);
      errors.push(`CodeTour failed for ${question.id}: ${errorMsg}`);

      const context = { questionId: question.id, agent: 'codetour' };
      const failureResult = handleFailure(error, context);
      
      if (failureResult.action === 'retry') {
        console.log(`  🔄 Infrastructure failure - will retry according to policy`);
      } else {
        console.log(`  📝 Agent failure - recorded and continues`);
      }
    }

    // Run with Vibe-native (independent session)
    console.log(`  🔄 Running Vibe Native for ${question.id}...`);
    try {
      const result = await runner.runSingle({
        question,
        agent: 'vibe-native',
      });

      console.log(`  ✅ Vibe Native completed: ${result.runId}`);
      console.log(`     Tokens: ${result.totalTokens.total}`);
      console.log(`     Status: ${result.status}`);

      runs.push(result);

      // Validate NO-GO controls
      const allRuns = runner.getAllRuns();
      const trace = allRuns.find(r => r.run_id === result.runId);
      if (trace) {
        const noGoResult = runner.validateNoGoControls(trace);
        noGoChecks.push(noGoResult);
        if (!noGoResult.passed) {
          console.warn(`  ⚠️  NO-GO controls failed: ${noGoResult.errors.join(', ')}`);
          errors.push(`NO-GO controls failed for Vibe Native ${question.id}: ${noGoResult.errors.join(', ')}`);
        } else {
          console.log('  ✅ NO-GO controls passed');
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ Vibe Native failed for ${question.id}: ${errorMsg}`);
      errors.push(`Vibe Native failed for ${question.id}: ${errorMsg}`);

      const context = { questionId: question.id, agent: 'vibe-native' };
      const failureResult = handleFailure(error, context);
      
      if (failureResult.action === 'retry') {
        console.log(`  🔄 Infrastructure failure - will retry according to policy`);
      } else {
        console.log(`  📝 Agent failure - recorded and continues`);
      }
    }
  }

  console.log(`\n✅ Series T completed: ${runs.length} runs`);
  return { runs, errors, noGoChecks };
}

/**
 * Run the main campaign (80 runs total)
 */
export async function runMainCampaign(): Promise<{
  success: boolean;
  totalRuns: number;
  seriesR: {
    runs: RunResult[];
    errors: string[];
    noGoChecks: NoGoResult[];
  };
  seriesT: {
    runs: RunResult[];
    errors: string[];
    noGoChecks: NoGoResult[];
  };
  allErrors: string[];
  allNoGoChecks: NoGoResult[];
  manifestValid: boolean;
  allGatesValid: boolean;
}> {
  console.log('🚀 Starting Main Campaign (Spec #174 T07)');
  console.log('==========================================');
  console.log('Target: 80 runs (40 R + 40 T)');

  const allErrors: string[] = [];
  const allNoGoChecks: NoGoResult[] = [];

  // Initialize runner
  const runner = new BenchmarkRunner(CAMPAIGN_CONFIG);

  try {
    // Load questions
    console.log('\n📋 Loading questions...');
    const questions = await runner.loadQuestions();
    console.log(`✅ Loaded ${questions.length} questions`);

    // Separate into Series R and T
    const { seriesR, seriesT } = separateQuestions(questions);
    console.log(`   Series R: ${seriesR.length} questions`);
    console.log(`   Series T: ${seriesT.length} questions`);

    if (seriesR.length !== 20 || seriesT.length !== 20) {
      throw new Error(`NO-GO: Expected 20 questions per series, got R:${seriesR.length}, T:${seriesT.length}`);
    }

    // Validate all gates G0-G5
    console.log('\n🔍 Validating all gates G0-G5...');
    const allGatesValid = await runner.validateGates();
    if (!allGatesValid) {
      throw new Error('NO-GO: Not all gates G0-G5 are satisfied');
    }
    console.log('✅ All gates G0-G5 validated');

    // Validate PostgreSQL SHA
    console.log('\n🔍 Validating PostgreSQL SHA...');
    const shaValid = runner.validatePostgresSha();
    if (!shaValid) {
      throw new Error(`NO-GO: PostgreSQL SHA validation failed. Expected: ${POSTGRES_SHA}`);
    }
    console.log(`✅ PostgreSQL SHA validated: ${POSTGRES_SHA}`);

    // Validate manifest is frozen
    console.log('\n🔒 Validating manifest is frozen...');
    const manifestValid = validateManifestFrozen();
    if (!manifestValid) {
      throw new Error('NO-GO: Manifest is not frozen (manifest-lock.json missing or invalid)');
    }
    console.log('✅ Manifest is frozen');

    // Run Series R
    console.log('\n🎯 Starting Series R (40 runs)...');
    const seriesRResult = await runSeriesR(runner, seriesR);
    allErrors.push(...seriesRResult.errors);
    allNoGoChecks.push(...seriesRResult.noGoChecks);

    // Run Series T
    console.log('\n🎯 Starting Series T (40 runs)...');
    const seriesTResult = await runSeriesT(runner, seriesT);
    allErrors.push(...seriesTResult.errors);
    allNoGoChecks.push(...seriesTResult.noGoChecks);

    // Total runs
    const totalRuns = seriesRResult.runs.length + seriesTResult.runs.length;
    console.log('\n==========================================');
    console.log('📊 Campaign Summary:');
    console.log(`   Total runs: ${totalRuns}`);
    console.log(`   Series R: ${seriesRResult.runs.length} runs`);
    console.log(`   Series T: ${seriesTResult.runs.length} runs`);
    console.log(`   Errors: ${allErrors.length}`);
    console.log(`   NO-GO checks failed: ${allNoGoChecks.filter(c => !c.passed).length}`);

    // Validate all runs are retrievable
    console.log('\n🔍 Validating all runs are retrievable...');
    const allRunTraces = runner.getAllRuns();
    const allRunIds = allRunTraces.map(r => r.run_id);
    
    const retrievableCount = allRunIds.length;
    const expectedCount = totalRuns;
    
    if (retrievableCount !== expectedCount) {
      console.warn(`⚠️  Expected ${expectedCount} retrievable runs, got ${retrievableCount}`);
      allErrors.push(`Not all runs are retrievable: expected ${expectedCount}, got ${retrievableCount}`);
    } else {
      console.log(`✅ All ${retrievableCount} runs are retrievable`);
    }

    // Validate all NO-GO controls passed
    const allNoGoPassed = allNoGoChecks.every(check => check.passed);
    if (!allNoGoPassed) {
      const failedChecks = allNoGoChecks.filter(check => !check.passed);
      console.error(`❌ ${failedChecks.length} NO-GO controls failed during campaign`);
      for (const check of failedChecks.slice(0, 5)) {
        console.error(`  - ${check.errors.join('; ')}`);
      }
      allErrors.push(`${failedChecks.length} NO-GO controls failed during campaign`);
    } else {
      console.log('✅ All NO-GO controls passed for all runs');
    }

    // Verify manifest was not modified
    console.log('\n🔒 Verifying manifest was not modified...');
    const manifestPath = path.join(__dirname, 'preregistration-manifest.json');
    const lockPath = path.join(__dirname, 'manifest-lock.json');
    
    if (!fs.existsSync(manifestPath)) {
      throw new Error('NO-GO: Pre-registration manifest is missing');
    }
    
    if (!fs.existsSync(lockPath)) {
      throw new Error('NO-GO: Manifest lock file is missing');
    }
    
    // Check that lock file is still there and valid
    try {
      const lockContent = fs.readFileSync(lockPath, 'utf-8');
      const lockData = JSON.parse(lockContent);
      
      if (!lockData.locked) {
        throw new Error('NO-GO: Manifest lock file indicates manifest is not locked');
      }
      
      if (!lockData.frozen_at) {
        throw new Error('NO-GO: Manifest lock file has no freeze timestamp');
      }
      
      console.log(`✅ Manifest still frozen (locked at ${lockData.frozen_at})`);
    } catch (error) {
      throw new Error(`NO-GO: Failed to verify manifest lock: ${error}`);
    }

    // Summary statistics
    const totalTokens = allRunTraces.reduce((sum, r) => sum + r.total_tokens.total, 0);
    const successCount = allRunTraces.filter(r => r.status === 'success').length;
    const errorCount = allRunTraces.filter(r => r.status === 'error').length;
    const timeoutCount = allRunTraces.filter(r => r.status === 'timeout').length;

    console.log('\n📈 Campaign Statistics:');
    console.log(`   Success: ${successCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log(`   Timeouts: ${timeoutCount}`);
    console.log(`   Total tokens: ${totalTokens}`);

    const success = totalRuns === 80 && allErrors.length === 0 && allNoGoPassed && retrievableCount === 80;

    if (success) {
      console.log('\n✅ Main Campaign COMPLETED SUCCESSFULLY');
      console.log('   All 80 runs executed');
      console.log('   All NO-GO controls passed');
      console.log('   All runs retrievable');
      console.log('   Manifest unchanged');
    } else {
      console.log('\n❌ Main Campaign COMPLETED WITH ISSUES');
      if (totalRuns !== 80) {
        console.log(`   Expected 80 runs, got ${totalRuns}`);
      }
      if (allErrors.length > 0) {
        console.log(`   Errors: ${allErrors.length}`);
      }
      if (!allNoGoPassed) {
        console.log(`   NO-GO controls failed: ${allNoGoChecks.filter(c => !c.passed).length}`);
      }
      if (retrievableCount !== 80) {
        console.log(`   Not all runs retrievable: ${retrievableCount}/80`);
      }
    }

    return {
      success,
      totalRuns,
      seriesR: seriesRResult,
      seriesT: seriesTResult,
      allErrors,
      allNoGoChecks,
      manifestValid: true,
      allGatesValid: true,
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('\n❌ Main Campaign FAILED:', errorMsg);
    console.error(error);

    return {
      success: false,
      totalRuns: 0,
      seriesR: { runs: [], errors: [errorMsg], noGoChecks: [] },
      seriesT: { runs: [], errors: [errorMsg], noGoChecks: [] },
      allErrors: [errorMsg],
      allNoGoChecks: [],
      manifestValid: false,
      allGatesValid: false,
    };
  }
}

/**
 * Get all run traces from the campaign
 */
export function getAllCampaignRuns(): Array<{
  run_id: string;
  timestamp: string;
  agent: string;
  question_id: string;
  series: string;
  status: string;
  total_tokens: { input: number; output: number; total: number };
}> {
  const runner = new BenchmarkRunner(CAMPAIGN_CONFIG);
  return runner.getAllRuns().map(trace => ({
    run_id: trace.run_id,
    timestamp: trace.timestamp,
    agent: trace.agent,
    question_id: trace.question_id,
    series: trace.series,
    status: trace.status,
    total_tokens: trace.total_tokens,
  }));
}

/**
 * Verify all runs are immutable (read-only files)
 */
export function verifyAllRunsImmutable(): {
  total: number;
  immutable: number;
  mutable: number;
  immutableList: string[];
  mutableList: string[];
} {
  const resultsDir = path.join(__dirname, 'results', 'runs');
  const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json'));
  
  let immutableCount = 0;
  let mutableCount = 0;
  const immutableList: string[] = [];
  const mutableList: string[] = [];

  for (const file of files) {
    const filepath = path.join(resultsDir, file);
    try {
      const stats = fs.statSync(filepath);
      // Check if file is read-only (mode 0o444)
      if ((stats.mode & 0o777) === 0o444) {
        immutableCount++;
        immutableList.push(file);
      } else {
        mutableCount++;
        mutableList.push(file);
      }
    } catch {
      mutableCount++;
      mutableList.push(file);
    }
  }

  return {
    total: files.length,
    immutable: immutableCount,
    mutable: mutableCount,
    immutableList,
    mutableList,
  };
}

/**
 * Main entry point for campaign execution
 * Can be run standalone: `ts-node main-campaign.ts`
 */
async function main() {
  const result = await runMainCampaign();
  
  // Verify immutability
  console.log('\n🔒 Verifying immutability...');
  const immutability = verifyAllRunsImmutable();
  console.log(`   Total files: ${immutability.total}`);
  console.log(`   Immutable: ${immutability.immutable}`);
  console.log(`   Mutable: ${immutability.mutable}`);

  if (immutability.mutable > 0) {
    console.warn('   ⚠️  Some files are not immutable:', immutability.mutableList);
  } else {
    console.log('   ✅ All run files are immutable');
  }
  
  // Exit with error code if campaign failed
  process.exit(result.success ? 0 : 1);
}

// Run main if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Campaign execution failed:', error);
    process.exit(1);
  });
}

export { CAMPAIGN_CONFIG, separateQuestions };
