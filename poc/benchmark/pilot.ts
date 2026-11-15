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
 * After pilot: manifest is frozen with the REAL freeze implementation
 * (content hash + TBD refusal + readback verification — single source:
 * runner/src/storage/logger.ts).
 *
 * This is the canonical TS pilot orchestration; the former JavaScript
 * duplicates (run-pilot.js / run-campaign.js / run-all.js) have been deleted.
 */

import fs from 'fs';
import path from 'path';
import { BenchmarkRunner, RunnerConfig, POSTGRES_SHA } from './runner/src/index';
import {
  NoGoResult,
  freezeManifest,
  validateManifestFrozen,
} from './runner/src/storage/logger';

// Configuration for pilot
export const PILOT_CONFIG: RunnerConfig = {
  questionsFile: path.join(__dirname, 'postgres-questions.json'),
  manifestFile: path.join(__dirname, 'preregistration-manifest.json'),
  postgresPath: path.join(__dirname, 'postgres'),
  outputDir: path.join(__dirname, 'results'),
  maxConcurrent: 1,
  timeoutMs: 300000,
  retryPolicy: { maxRetries: 0, retryDelay: 0 },
  runPilot: false, // The pilot is orchestrated individually below.
  pilotCount: 2,
};

/** The ONE manifest-lock location for the whole campaign. */
export const MANIFEST_LOCK_PATH = path.join(__dirname, 'manifest-lock.json');

export interface PilotSummary {
  runId: string;
  questionId: string;
  agent: string;
  status: string;
  error?: string;
  tokens: { input: number; output: number; total: number };
}

/**
 * Run the pilot phase (1-2 questions for connectivity testing)
 *
 * Tests:
 * - Runner functionality
 * - Agent execution (CodeTour and Vibe Native, REAL paths only)
 * - Token tracking
 * - NO-GO controls
 * - Storage immutability
 *
 * Any infrastructure failure here is a NO-GO: it is recorded and returned,
 * never replaced with fabricated runs.
 */
export async function runPilot(): Promise<{
  success: boolean;
  results: PilotSummary[];
  errors: string[];
  noGoChecks: NoGoResult[];
  manifestFrozen: boolean;
}> {
  console.log('🚀 Starting Pilot Phase (Spec #174 T07)');
  console.log('========================================');

  const results: PilotSummary[] = [];
  const errors: string[] = [];
  const noGoChecks: NoGoResult[] = [];

  // Initialize runner
  const runner = new BenchmarkRunner(PILOT_CONFIG);
  const logger = runner.getLogger();

  try {
    // Load questions
    console.log('\n📋 Loading questions...');
    const questions = await runner.loadQuestions();
    console.log(`✅ Loaded ${questions.length} questions (${questions.filter(q => q.series === 'R').length} R + ${questions.filter(q => q.series === 'T').length} T)`);

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

      for (const agent of ['codetour', 'vibe-native'] as const) {
        console.log(`  🔄 Running ${agent} for ${question.id}...`);
        try {
          const result = await runner.runSingle({ question, agent });

          console.log(`  ✅ ${agent} completed: ${result.runId}`);
          console.log(`     Status: ${result.status}`);
          console.log(`     Tokens: ${result.totalTokens.total} (in: ${result.totalTokens.input}, out: ${result.totalTokens.output})`);

          results.push({
            runId: result.runId,
            questionId: result.questionId,
            agent: result.agent,
            status: result.status,
            error: result.error,
            tokens: {
              input: result.totalTokens.input,
              output: result.totalTokens.output,
              total: result.totalTokens.total,
            },
          });

          // NO-GO controls come from the logger's REAL validators.
          const trace = logger
            .listRuns()
            .find(r => r.run_id === result.runId);
          if (trace) {
            const noGoResult = logger.validateNoGoControls(trace);
            noGoChecks.push(noGoResult);
            if (!noGoResult.passed) {
              console.warn(`  ⚠️  NO-GO controls failed for ${agent}: ${noGoResult.errors.join(', ')}`);
            } else {
              console.log(`  ✅ NO-GO controls passed for ${agent}`);
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`  ❌ ${agent} failed for ${question.id}: ${errorMsg}`);
          errors.push(`${agent} failed for ${question.id}: ${errorMsg}`);

          results.push({
            runId: `pilot-error-${agent}-${i}`,
            questionId: question.id,
            agent,
            status: 'error',
            error: errorMsg,
            tokens: { input: 0, output: 0, total: 0 },
          });
        }
      }
    }

    // Persist pilot traces to the pilot directory (real traces written by the
    // logger stay in results/runs; copies are made read-only here too).
    console.log('\n💾 Saving pilot results...');
    const pilotDir = path.join(__dirname, 'results', 'pilot');
    if (!fs.existsSync(pilotDir)) {
      fs.mkdirSync(pilotDir, { recursive: true });
    }

    const allPilotRuns = logger.listRuns();
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

    // Freeze manifest after pilot with the REAL freeze: content hash,
    // TBD refusal, atomic write, readback verification. This THROWS if the
    // manifest still carries TBD/placeholder fields or if the readback fails —
    // in that case the pilot is NOT considered successful.
    console.log('\n🔒 Freezing manifest (real content hash + readback)...');
    try {
      const frozen = freezeManifest(PILOT_CONFIG.manifestFile, MANIFEST_LOCK_PATH);
      console.log(`✅ Manifest frozen (sha256:${frozen.manifestSha256})`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Manifest freeze refused: ${errorMsg}`);
      errors.push(`Manifest freeze refused: ${errorMsg}`);
    }

    // Validate the freeze with the real validator (tamper detection) once.
    const manifestFrozenForReal = validateManifestFrozen(
      PILOT_CONFIG.manifestFile,
      MANIFEST_LOCK_PATH
    );
    if (manifestFrozenForReal) {
      console.log('✅ Manifest lock verified by readback');
    } else {
      errors.push('Manifest lock invalid after freeze');
    }

    // Summary
    console.log('\n========================================');
    console.log('📊 Pilot Phase Summary:');
    console.log(`   Total runs: ${results.length}`);
    console.log(`   Success: ${results.filter(r => r.status === 'success').length}`);
    console.log(`   Errors: ${results.filter(r => r.status === 'error').length}`);
    console.log(`   Total tokens: ${results.reduce((sum, r) => sum + r.tokens.total, 0)}`);
    console.log(`   NO-GO checks passed: ${allNoGoPassed ? '✅' : '❌'}`);
    console.log(`   Manifest frozen: ${manifestFrozenForReal ? '✅' : '❌'}`);

    const success = errors.length === 0 && allNoGoPassed && manifestFrozenForReal;

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
      manifestFrozen: manifestFrozenForReal,
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
 * Main entry point for pilot execution
 * Can be run standalone: `npx ts-node pilot.ts`
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
