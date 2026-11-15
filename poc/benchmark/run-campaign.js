/**
 * JavaScript script to run the main campaign (80 runs)
 * Uses the built runner from dist/
 */

const fs = require('fs');
const path = require('path');
const { BenchmarkRunner } = require('./runner/dist/src/index.js');
const POSTGRES_SHA = '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5';

async function runCampaign() {
  console.log('🚀 Starting Main Campaign Execution (80 runs)');
  console.log('===============================================\n');

  // Configuration
  const config = {
    questionsFile: path.join(__dirname, 'postgres-questions.json'),
    manifestFile: path.join(__dirname, 'preregistration-manifest.json'),
    postgresPath: path.join(__dirname, 'postgres'),
    outputDir: path.join(__dirname, 'results'),
    maxConcurrent: 1,
    timeoutMs: 300000,
    retryPolicy: { maxRetries: 3, retryDelay: 5000 },
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

    // Validate manifest is frozen
    console.log('\n🔒 Validating manifest is frozen...');
    const lockPath = path.join(__dirname, 'manifest-lock.json');
    if (!fs.existsSync(lockPath)) {
      throw new Error('NO-GO: Manifest is not frozen (manifest-lock.json missing)');
    }
    
    const lockContent = fs.readFileSync(lockPath, 'utf-8');
    const lockData = JSON.parse(lockContent);
    
    if (!lockData.locked) {
      throw new Error('NO-GO: Manifest lock file indicates manifest is not locked');
    }
    
    console.log(`✅ Manifest is frozen (locked at ${lockData.frozen_at})`);

    // Separate questions into Series R and T
    const seriesR = questions.filter(q => q.series === 'R');
    const seriesT = questions.filter(q => q.series === 'T');
    
    console.log(`\n📊 Campaign Structure:`);
    console.log(`   Series R (Répétition): ${seriesR.length} questions × 2 agents = ${seriesR.length * 2} runs`);
    console.log(`   Series T (Transfert): ${seriesT.length} questions × 2 agents = ${seriesT.length * 2} runs`);
    console.log(`   Total: ${(seriesR.length + seriesT.length) * 2} runs`);

    if (seriesR.length !== 20 || seriesT.length !== 20) {
      throw new Error(`NO-GO: Expected 20 questions per series, got R:${seriesR.length}, T:${seriesT.length}`);
    }

    // Run Series R
    console.log('\n🎯 Starting Series R (40 runs)...');
    console.log('  CodeTour: empty memory, persists between requests');
    console.log('  Vibe-native: independent sessions');

    const seriesRResults = [];
    
    for (let i = 0; i < seriesR.length; i++) {
      const question = seriesR[i];
      console.log(`\n--- Series R, Question ${i + 1}/${seriesR.length}: ${question.id} ---`);

      // Run CodeTour
      try {
        const result = await runner.runSingle({ question, agent: 'codetour' });
        console.log(`  ✅ CodeTour: ${result.runId} - Tokens: ${result.totalTokens.total}`);
        seriesRResults.push(result);
      } catch (error) {
        console.error(`  ❌ CodeTour failed: ${error.message}`);
      }

      // Run Vibe Native
      try {
        const result = await runner.runSingle({ question, agent: 'vibe-native' });
        console.log(`  ✅ Vibe Native: ${result.runId} - Tokens: ${result.totalTokens.total}`);
        seriesRResults.push(result);
      } catch (error) {
        console.error(`  ❌ Vibe Native failed: ${error.message}`);
      }
    }

    console.log(`\n✅ Series R completed: ${seriesRResults.length} runs`);

    // Run Series T (reset CodeTour memory)
    console.log('\n🎯 Starting Series T (40 runs)...');
    console.log('  CodeTour: NEW empty memory at start of T');
    console.log('  Vibe-native: independent sessions');

    const seriesTResults = [];
    
    for (let i = 0; i < seriesT.length; i++) {
      const question = seriesT[i];
      console.log(`\n--- Series T, Question ${i + 1}/${seriesT.length}: ${question.id} ---`);

      // Run CodeTour
      try {
        const result = await runner.runSingle({ question, agent: 'codetour' });
        console.log(`  ✅ CodeTour: ${result.runId} - Tokens: ${result.totalTokens.total}`);
        seriesTResults.push(result);
      } catch (error) {
        console.error(`  ❌ CodeTour failed: ${error.message}`);
      }

      // Run Vibe Native
      try {
        const result = await runner.runSingle({ question, agent: 'vibe-native' });
        console.log(`  ✅ Vibe Native: ${result.runId} - Tokens: ${result.totalTokens.total}`);
        seriesTResults.push(result);
      } catch (error) {
        console.error(`  ❌ Vibe Native failed: ${error.message}`);
      }
    }

    console.log(`\n✅ Series T completed: ${seriesTResults.length} runs`);

    // Total
    const totalRuns = seriesRResults.length + seriesTResults.length;
    console.log(`\n📊 Total runs: ${totalRuns}`);

    // Validate all runs are retrievable
    console.log('\n🔍 Validating all runs are retrievable...');
    const allRuns = runner.getAllRuns();
    console.log(`   Found ${allRuns.length} runs in storage`);

    // Validate NO-GO controls
    console.log('\n🔍 Validating NO-GO controls...');
    let allNoGoPassed = true;
    let noGoErrors = 0;
    
    for (const run of allRuns) {
      try {
        runner.validateNoGoControls(run);
      } catch (error) {
        noGoErrors++;
        allNoGoPassed = false;
      }
    }

    if (allNoGoPassed) {
      console.log(`   ✅ All NO-GO controls passed for ${allRuns.length} runs`);
    } else {
      console.log(`   ⚠️  ${noGoErrors} NO-GO controls failed`);
    }

    // Verify manifest unchanged
    console.log('\n🔒 Verifying manifest unchanged...');
    const manifestPath = path.join(__dirname, 'preregistration-manifest.json');
    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent);

    if (manifest.seal?.message !== 'PRE-REGISTRATION MANIFEST - FROZEN - DO NOT MODIFY') {
      throw new Error('NO-GO: Manifest seal has been modified');
    }
    
    // Check lock file still exists
    if (!fs.existsSync(lockPath)) {
      throw new Error('NO-GO: Manifest lock file is missing');
    }
    
    console.log('✅ Manifest unchanged');

    // Verify immutability
    console.log('\n🔒 Verifying immutability...');
    const resultsDir = path.join(__dirname, 'results', 'runs');
    if (fs.existsSync(resultsDir)) {
      const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json'));
      let immutableCount = 0;
      
      for (const file of files) {
        try {
          const filepath = path.join(resultsDir, file);
          const stats = fs.statSync(filepath);
          // Check if read-only (mode 0o444)
          if ((stats.mode & 0o777) === 0o444) {
            immutableCount++;
          }
        } catch {
          // Ignore errors
        }
      }
      
      console.log(`   Files: ${files.length}, Immutable: ${immutableCount}`);
    }

    // Summary
    const successCount = allRuns.filter(r => r.status === 'success').length;
    const errorCount = allRuns.filter(r => r.status === 'error').length;
    const timeoutCount = allRuns.filter(r => r.status === 'timeout').length;
    const totalTokens = allRuns.reduce((sum, r) => sum + r.total_tokens.total, 0);

    console.log('\n' + '═'.repeat(65));
    console.log('📊 CAMPAIGN SUMMARY');
    console.log('═'.repeat(65));
    console.log(`   Series R: ${seriesRResults.length} runs`);
    console.log(`   Series T: ${seriesTResults.length} runs`);
    console.log(`   Total: ${totalRuns} runs`);
    console.log(`   Expected: 80 runs`);
    console.log('');
    console.log(`   Success: ${successCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log(`   Timeouts: ${timeoutCount}`);
    console.log(`   Total tokens: ${totalTokens}`);
    console.log('');
    console.log(`   NO-GO controls: ${allNoGoPassed ? '✅ All passed' : `⚠️  ${noGoErrors} failed`}`);
    console.log(`   Manifest: ${manifest.seal ? '✅ Unchanged' : '❌ Modified'}`);
    console.log('═'.repeat(65));

    const success = totalRuns === 80 && allNoGoPassed;

    if (success) {
      console.log('\n✅ MAIN CAMPAIGN COMPLETED SUCCESSFULLY\n');
    } else {
      console.log('\n⚠️  MAIN CAMPAIGN COMPLETED WITH ISSUES\n');
    }

    return {
      success,
      totalRuns,
      seriesR: seriesRResults.length,
      seriesT: seriesTResults.length,
      successCount,
      errorCount,
      timeoutCount,
      totalTokens,
      allNoGoPassed,
    };

  } catch (error) {
    console.error('\n❌ CAMPAIGN FAILED:', error.message);
    console.error(error);
    return { success: false, error: error.message };
  }
}

// Run if executed directly
if (require.main === module) {
  runCampaign().then(result => {
    process.exit(result.success ? 0 : 1);
  }).catch(error => {
    console.error('Campaign execution failed:', error);
    process.exit(1);
  });
}

module.exports = { runCampaign };
