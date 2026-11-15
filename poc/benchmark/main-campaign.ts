/**
 * Main Campaign Execution for Spec #174 T07
 *
 * Executes 80 runs:
 * - Series R: 20 questions × 2 agents (CodeTour + Vibe-native) = 40 runs
 * - Series T: 20 questions × 2 agents = 40 runs
 *
 * All runs are REAL executions (no mocks, no simulations). Both run series
 * share ONE series-implementation (no R/T twins). Each runSingle executes a
 * fresh CodeTour harness process, so per-run memory state is genuinely empty.
 */

import fs from 'fs';
import path from 'path';
import { BenchmarkRunner, RunnerConfig, RunSummary, Question, POSTGRES_SHA } from './runner/src/index';
import {
  NoGoResult,
  validateManifestFrozen,
} from './runner/src/storage/logger';
import { handleFailure } from './runner/src/failure-handler';

// Configuration for main campaign
export const CAMPAIGN_CONFIG: RunnerConfig = {
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
  runPilot: false, // Pilot already done before the campaign.
};

/** The ONE manifest-lock location (same file the pilot freeze created). */
const MANIFEST_LOCK_PATH = path.join(__dirname, 'manifest-lock.json');

export interface SeriesResult {
  runs: RunSummary[];
  errors: string[];
  noGoChecks: NoGoResult[];
}

/**
 * Separate Series R and Series T questions
 */
export function separateQuestions(questions: Question[]): {
  seriesR: Question[];
  seriesT: Question[];
} {
  const seriesR = questions.filter(q => q.series === 'R');
  const seriesT = questions.filter(q => q.series === 'T');
  return { seriesR, seriesT };
}

/**
 * THE single series implementation, shared by R and T (no duplicated twin
 * functions). Each question is executed by both agents; failures are recorded
 * and count in the denominator — never replaced by fabricated runs.
 */
async function runSeries(
  runner: BenchmarkRunner,
  questions: Question[],
  seriesLabel: string
): Promise<SeriesResult> {
  console.log(`\n📊 Starting Series ${seriesLabel} (${questions.length * 2} runs)`);
  console.log('='.repeat(44));

  const runs: RunSummary[] = [];
  const errors: string[] = [];
  const noGoChecks: NoGoResult[] = [];
  const logger = runner.getLogger();

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    console.log(`\n--- Series ${seriesLabel}, Question ${i + 1}/${questions.length}: ${question.id} ---`);

    for (const agent of ['codetour', 'vibe-native'] as const) {
      console.log(`  🔄 Running ${agent} for ${question.id}...`);
      try {
        const result = await runner.runSingle({ question, agent });

        console.log(`  ✅ ${agent} completed: ${result.runId}`);
        console.log(`     Tokens: ${result.totalTokens.total}`);
        console.log(`     Status: ${result.status}`);

        runs.push(result);

        // NO-GO controls come from the logger's REAL validators.
        const trace = logger.listRuns().find(r => r.run_id === result.runId);
        if (trace) {
          const noGoResult = logger.validateNoGoControls(trace);
          noGoChecks.push(noGoResult);
          if (!noGoResult.passed) {
            console.warn(`  ⚠️  NO-GO controls failed: ${noGoResult.errors.join(', ')}`);
            errors.push(`NO-GO controls failed for ${agent} ${question.id}: ${noGoResult.errors.join(', ')}`);
          } else {
            console.log('  ✅ NO-GO controls passed');
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`  ❌ ${agent} failed for ${question.id}: ${errorMsg}`);
        errors.push(`${agent} failed for ${question.id}: ${errorMsg}`);
        runs.push({
          runId: '',
          questionId: question.id,
          agent,
          series: question.series,
          totalTokens: { input: 0, output: 0, total: 0 },
          status: 'error',
          error: errorMsg,
        });

        // Distinguish infrastructure failures (retryable) from agent failures.
        const failureResult = handleFailure(error instanceof Error ? error : new Error(String(error)), { questionId: question.id, agent });
        if (failureResult.action === 'retry') {
          console.log('  🔄 Infrastructure failure - will retry according to policy');
        } else {
          console.log('  📝 Agent failure - recorded and continues');
        }
      }
    }
  }

  console.log(`\n✅ Series ${seriesLabel} completed: ${runs.length} runs`);
  return { runs, errors, noGoChecks };
}

/**
 * Run the main campaign (80 runs total)
 */
export async function runMainCampaign(): Promise<{
  success: boolean;
  totalRuns: number;
  seriesR: SeriesResult;
  seriesT: SeriesResult;
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

    // Validate manifest is frozen — REAL validation: lock present AND the
    // current manifest content hashes to the recorded digest.
    console.log('\n🔒 Validating manifest is frozen...');
    const manifestValid = validateManifestFrozen(CAMPAIGN_CONFIG.manifestFile, MANIFEST_LOCK_PATH);
    if (!manifestValid) {
      throw new Error('NO-GO: Manifest is not frozen (manifest-lock.json missing, tampered, or hash mismatch)');
    }
    console.log('✅ Manifest is frozen and authentic');

    // Run Series R (single shared series implementation)
    const seriesRResult = await runSeries(runner, seriesR, 'R');
    allErrors.push(...seriesRResult.errors);
    allNoGoChecks.push(...seriesRResult.noGoChecks);

    // Run Series T (same shared implementation)
    const seriesTResult = await runSeries(runner, seriesT, 'T');
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
    const retrievableCount = allRunTraces.length;
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

    // Verify manifest was not modified after the campaign (tamper detection).
    console.log('\n🔒 Verifying manifest was not modified...');
    const manifestStillValid = validateManifestFrozen(CAMPAIGN_CONFIG.manifestFile, MANIFEST_LOCK_PATH);
    if (!manifestStillValid) {
      throw new Error('NO-GO: Manifest lock invalid after campaign (content changed since freeze)');
    }
    console.log('✅ Manifest unchanged after campaign');

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

    const success = totalRuns === 80 && allErrors.length === 0 && allNoGoPassed && retrievableCount === 80 && manifestStillValid;

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
      manifestValid: manifestStillValid,
      allGatesValid,
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

  if (!fs.existsSync(resultsDir)) {
    return { total: 0, immutable: 0, mutable: 0, immutableList: [], mutableList: [] };
  }

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
 * Can be run standalone: `npx ts-node main-campaign.ts`
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
