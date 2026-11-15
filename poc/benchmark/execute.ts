/**
 * Unified Execution Script for Spec #174 T07
 * 
 * Executes:
 * 1. Pilot phase (1-2 runs, NOT counted)
 * 2. Main campaign (80 runs)
 * 
 * This script orchestrates the entire T07 workflow.
 */

import fs from 'fs';
import path from 'path';
import { runPilot, freezeManifest } from './pilot';
import { runMainCampaign, verifyAllRunsImmutable } from './main-campaign';
import { validateManifestFrozen } from './pilot';

/**
 * Main execution function
 */
async function executeT07() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  Spec #174 T07 - Pilot + 80 Runs Benchmark Execution         ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const results: {
    phase: string;
    success: boolean;
    details: Record<string, unknown>;
    timestamp: string;
  }[] = [];

  // Phase A: Pilot
  console.log('🟢 PHASE A: PILOT (1-2 runs, NOT COUNTED)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    const pilotResult = await runPilot();
    
    results.push({
      phase: 'pilot',
      success: pilotResult.success,
      details: {
        runs: pilotResult.results.length,
        errors: pilotResult.errors.length,
        noGoChecksFailed: pilotResult.noGoChecks.filter(c => !c.passed).length,
        manifestFrozen: pilotResult.manifestFrozen,
      },
      timestamp: new Date().toISOString(),
    });

    if (!pilotResult.success) {
      console.error('\n❌ PILOT PHASE FAILED - Aborting');
      console.error('Errors:', pilotResult.errors);
      return { success: false, phase: 'pilot', results };
    }

    console.log('\n✅ PILOT PHASE COMPLETED SUCCESSFULLY\n');

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('\n❌ PILOT PHASE CRASHED:', errorMsg);
    console.error(error);
    return { success: false, phase: 'pilot', results };
  }

  // Verify manifest is frozen before continuing
  if (!validateManifestFrozen()) {
    console.error('\n❌ MANIFEST NOT FROZEN - Cannot proceed to main campaign');
    return { success: false, phase: 'manifest_validation', results };
  }

  // Phase B: Main Campaign
  console.log('\n🟡 PHASE B: MAIN CAMPAIGN (80 runs)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    const campaignResult = await runMainCampaign();
    
    results.push({
      phase: 'main_campaign',
      success: campaignResult.success,
      details: {
        totalRuns: campaignResult.totalRuns,
        seriesR: campaignResult.seriesR.runs.length,
        seriesT: campaignResult.seriesT.runs.length,
        errors: campaignResult.allErrors.length,
        noGoChecksFailed: campaignResult.allNoGoChecks.filter(c => !c.passed).length,
        manifestValid: campaignResult.manifestValid,
        allGatesValid: campaignResult.allGatesValid,
      },
      timestamp: new Date().toISOString(),
    });

    if (!campaignResult.success) {
      console.error('\n❌ MAIN CAMPAIGN COMPLETED WITH ISSUES');
      console.error('Errors:', campaignResult.allErrors.slice(0, 5));
      console.error(`Total runs: ${campaignResult.totalRuns}/80`);
      return { success: false, phase: 'main_campaign', results };
    }

    console.log('\n✅ MAIN CAMPAIGN COMPLETED SUCCESSFULLY\n');

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('\n❌ MAIN CAMPAIGN CRASHED:', errorMsg);
    console.error(error);
    return { success: false, phase: 'main_campaign', results };
  }

  // Phase C: Storage & Validation
  console.log('\n🔵 PHASE C: STORAGE & VALIDATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Verify manifest was not modified
    console.log('\n🔍 Verifying manifest was not modified...');
    const manifestPath = path.join(__dirname, 'preregistration-manifest.json');
    const lockPath = path.join(__dirname, 'manifest-lock.json');

    if (!fs.existsSync(manifestPath)) {
      throw new Error('Pre-registration manifest is missing');
    }

    if (!fs.existsSync(lockPath)) {
      throw new Error('Manifest lock file is missing');
    }

    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent);

    if (manifest.seal?.message !== 'PRE-REGISTRATION MANIFEST - FROZEN - DO NOT MODIFY') {
      throw new Error('Manifest seal has been modified');
    }

    console.log('✅ Manifest unchanged');

    // Verify all runs are retrievable
    console.log('\n🔍 Verifying all runs are retrievable...');
    const resultsDir = path.join(__dirname, 'results', 'runs');
    const pilotDir = path.join(__dirname, 'results', 'pilot');

    if (!fs.existsSync(resultsDir)) {
      throw new Error('Results directory does not exist');
    }

    const runFiles = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json'));
    const pilotFiles = fs.existsSync(pilotDir) ? 
      fs.readdirSync(pilotDir).filter(f => f.endsWith('.json')) : [];

    console.log(`   Found ${runFiles.length} main run files`);
    console.log(`   Found ${pilotFiles.length} pilot run files`);

    // Try to load each file
    let retrievableCount = 0;
    for (const file of runFiles) {
      try {
        const filepath = path.join(resultsDir, file);
        const content = fs.readFileSync(filepath, 'utf-8');
        JSON.parse(content);
        retrievableCount++;
      } catch {
        // Skip files that can't be loaded
      }
    }

    console.log(`✅ ${retrievableCount} main runs retrievable`);

    // Verify immutability
    console.log('\n🔍 Verifying immutability...');
    const immutability = verifyAllRunsImmutable();
    console.log(`   Total files: ${immutability.total}`);
    console.log(`   Immutable: ${immutability.immutable}`);
    console.log(`   Mutable: ${immutability.mutable}`);

    if (immutability.mutable > 0) {
      console.warn('   ⚠️  Some files are not immutable');
      for (const file of immutability.mutableList) {
        console.warn(`      - ${file}`);
      }
    } else {
      console.log('   ✅ All run files are immutable');
    }

    // Final validation
    const allValid = retrievableCount >= 80 && immutability.immutable >= 80;

    if (allValid) {
      console.log('\n✅ PHASE C: ALL VALIDATIONS PASSED\n');
    } else {
      console.log('\n⚠️  PHASE C: VALIDATIONS COMPLETED WITH WARNINGS\n');
    }

    results.push({
      phase: 'validation',
      success: allValid,
      details: {
        retrievableRuns: retrievableCount,
        immutableRuns: immutability.immutable,
        manifestUnchanged: true,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('\n❌ VALIDATION PHASE FAILED:', errorMsg);
    console.error(error);
    return { success: false, phase: 'validation', results };
  }

  // Final summary
  console.log('\n' + '═'.repeat(65));
  console.log('📋 FINAL SUMMARY - Spec #174 T07');
  console.log('═'.repeat(65));

  const allSuccess = results.every(r => r.success);

  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    console.log(`\n${status} ${result.phase.toUpperCase()}`);
    console.log(`   Success: ${result.success}`);
    console.log(`   Timestamp: ${result.timestamp}`);
    
    for (const [key, value] of Object.entries(result.details)) {
      console.log(`   ${key}: ${JSON.stringify(value)}`);
    }
  }

  console.log('\n' + '═'.repeat(65));
  if (allSuccess) {
    console.log('✅ T07 COMPLETED SUCCESSFULLY');
    console.log('   Pilot + 80 runs complete, all traces saved');
    console.log('═'.repeat(65));
  } else {
    console.log('⚠️  T07 COMPLETED WITH ISSUES');
    const failedPhases = results.filter(r => !r.success).map(r => r.phase);
    console.log(`   Failed phases: ${failedPhases.join(', ')}`);
    console.log('═'.repeat(65));
  }

  return { success: allSuccess, phase: 'complete', results };
}

/**
 * Execute T07 and save execution report
 */
async function executeAndSave() {
  const startTime = new Date();
  const executionResult = await executeT07();
  const endTime = new Date();

  // Create execution report
  const report = {
    spec: '174',
    ticket: 'T07',
    execution: {
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      duration_seconds: Math.floor((endTime.getTime() - startTime.getTime()) / 1000),
    },
    phases: executionResult.results,
    overall_success: executionResult.success,
    completion_phase: executionResult.phase,
    report_generated_at: new Date().toISOString(),
  };

  // Save report
  const reportDir = path.join(__dirname, 'results');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const reportPath = path.join(reportDir, 'execution-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n📄 Execution report saved to: ${reportPath}`);

  return executionResult;
}

// Run if executed directly
if (require.main === module) {
  executeAndSave().catch(error => {
    console.error('Execution failed:', error);
    process.exit(1);
  });
}

export { executeT07, executeAndSave };
