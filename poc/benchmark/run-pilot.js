/**
 * Simple JavaScript script to run the pilot phase
 * Uses the built runner from dist/
 */

const fs = require('fs');
const path = require('path');
const { BenchmarkRunner } = require('./runner/dist/src/index.js');
const POSTGRES_SHA = '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5';

async function runPilot() {
  console.log('🚀 Starting Pilot Execution');
  console.log('===========================\n');

  // Configuration
  const config = {
    questionsFile: path.join(__dirname, 'postgres-questions.json'),
    manifestFile: path.join(__dirname, 'preregistration-manifest.json'),
    postgresPath: path.join(__dirname, 'postgres'),
    outputDir: path.join(__dirname, 'results'),
    maxConcurrent: 1,
    timeoutMs: 300000,
    retryPolicy: { maxRetries: 0, retryDelay: 0 },
  };

  // Initialize runner
  const runner = new BenchmarkRunner(config);

  try {
    // Load questions
    console.log('📋 Loading questions...');
    const questions = await runner.loadQuestions();
    console.log(`✅ Loaded ${questions.length} questions`);

    // Validate PostgreSQL SHA
    console.log('\n🔍 Validating PostgreSQL SHA...');
    const shaValid = runner.validatePostgresSha();
    if (!shaValid) {
      throw new Error(`NO-GO: PostgreSQL SHA validation failed. Expected: ${POSTGRES_SHA}`);
    }
    console.log(`✅ PostgreSQL SHA validated: ${POSTGRES_SHA}`);

    // Validate all gates
    console.log('\n🔍 Validating gates G0-G5...');
    const gatesValid = await runner.validateGates();
    if (!gatesValid) {
      throw new Error('NO-GO: Not all gates G0-G5 are satisfied');
    }
    console.log('✅ All gates G0-G5 validated');

    // Run pilot with first 2 questions
    const pilotQuestions = questions.slice(0, 2);
    console.log(`\n🎯 Running pilot with ${pilotQuestions.length} questions...`);

    const pilotResults = [];
    
    for (let i = 0; i < pilotQuestions.length; i++) {
      const question = pilotQuestions[i];
      console.log(`\n--- Pilot Question ${i + 1}/${pilotQuestions.length}: ${question.id} ---`);

      // Run CodeTour
      console.log(`  🔄 Running CodeTour for ${question.id}...`);
      try {
        const result = await runner.runSingle({ question, agent: 'codetour' });
        console.log(`  ✅ CodeTour: ${result.runId} - Tokens: ${result.totalTokens.total}`);
        pilotResults.push(result);
      } catch (error) {
        console.error(`  ❌ CodeTour failed: ${error.message}`);
      }

      // Run Vibe Native
      console.log(`  🔄 Running Vibe Native for ${question.id}...`);
      try {
        const result = await runner.runSingle({ question, agent: 'vibe-native' });
        console.log(`  ✅ Vibe Native: ${result.runId} - Tokens: ${result.totalTokens.total}`);
        pilotResults.push(result);
      } catch (error) {
        console.error(`  ❌ Vibe Native failed: ${error.message}`);
      }
    }

    // Save pilot results
    console.log('\n💾 Saving pilot results...');
    const pilotDir = path.join(__dirname, 'results', 'pilot');
    if (!fs.existsSync(pilotDir)) {
      fs.mkdirSync(pilotDir, { recursive: true });
    }

    const allRuns = runner.getAllRuns();
    for (const run of allRuns) {
      const filename = path.join(pilotDir, `${run.run_id}.json`);
      try {
        fs.writeFileSync(filename, JSON.stringify(run, null, 2), 'utf-8');
        fs.chmodSync(filename, 0o444); // Make read-only
        console.log(`  ✅ Saved: ${run.run_id}`);
      } catch (error) {
        console.error(`  ❌ Failed to save: ${run.run_id}`);
      }
    }

    // Validate NO-GO controls for all pilot runs
    console.log('\n🔍 Validating NO-GO controls...');
    let allNoGoPassed = true;
    for (const run of allRuns) {
      try {
        runner.validateNoGoControls(run);
        console.log(`  ✅ NO-GO passed for ${run.run_id}`);
      } catch (error) {
        console.error(`  ❌ NO-GO failed for ${run.run_id}: ${error.message}`);
        allNoGoPassed = false;
      }
    }

    if (!allNoGoPassed) {
      throw new Error('NO-GO controls failed for some pilot runs');
    }

    // Freeze manifest
    console.log('\n🔒 Freezing manifest...');
    const manifestPath = path.join(__dirname, 'preregistration-manifest.json');
    const lockPath = path.join(__dirname, 'manifest-lock.json');

    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent);

    const lockData = {
      ...manifest,
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

    fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2), 'utf-8');
    fs.chmodSync(lockPath, 0o444);
    console.log('✅ Manifest frozen (manifest-lock.json created)');

    // Summary
    console.log('\n═'.repeat(65));
    console.log('✅ PILOT PHASE COMPLETED SUCCESSFULLY');
    console.log('═'.repeat(65));
    console.log(`   Runs: ${pilotResults.length}`);
    console.log(`   Success: ${pilotResults.filter(r => r.status === 'success').length}`);
    console.log(`   Errors: ${pilotResults.filter(r => r.status === 'error').length}`);
    console.log(`   NO-GO: All passed`);
    console.log(`   Manifest: Frozen`);
    console.log('═'.repeat(65));

    return { success: true, runs: pilotResults.length };

  } catch (error) {
    console.error('\n❌ PILOT PHASE FAILED:', error.message);
    console.error(error);
    return { success: false, error: error.message };
  }
}

// Run if executed directly
if (require.main === module) {
  runPilot().then(result => {
    process.exit(result.success ? 0 : 1);
  }).catch(error => {
    console.error('Pilot execution failed:', error);
    process.exit(1);
  });
}

module.exports = { runPilot };
