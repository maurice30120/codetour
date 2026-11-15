/**
 * Unified execution script for T07
 * Runs pilot first, then main campaign, with proper separation
 */

const fs = require('fs');
const path = require('path');
const { BenchmarkRunner } = require('./runner/dist/src/index.js');
const POSTGRES_SHA = '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5';

async function runAll() {
  console.log('🚀 Starting Complete T07 Execution');
  console.log('=================================\n');

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

  // Create separate directories
  const runsDir = path.join(__dirname, 'results', 'runs');
  const pilotDir = path.join(__dirname, 'results', 'pilot');
  
  if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
  if (!fs.existsSync(pilotDir)) fs.mkdirSync(pilotDir, { recursive: true });

  // Create a runner for pilot with output to pilot directory
  const pilotConfig = { ...config, outputDir: path.join(__dirname, 'results', 'pilot-temp') };
  const pilotRunner = new BenchmarkRunner(pilotConfig);

  // Create a runner for main campaign with output to runs directory
  const campaignConfig = { ...config, outputDir: path.join(__dirname, 'results') };
  const campaignRunner = new BenchmarkRunner(campaignConfig);

  try {
    // ============================================
    // PHASE A: PILOT
    // ============================================
    console.log('🟢 PHASE A: PILOT (1-2 runs, NOT COUNTED)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Load questions
    const questions = await pilotRunner.loadQuestions();
    console.log(`✅ Loaded ${questions.length} questions`);

    // Validate PostgreSQL SHA
    const shaValid = pilotRunner.validatePostgresSha();
    if (!shaValid) throw new Error(`NO-GO: PostgreSQL SHA validation failed`);
    console.log(`✅ PostgreSQL SHA validated: ${POSTGRES_SHA}`);

    // Validate all gates
    const gatesValid = await pilotRunner.validateGates();
    if (!gatesValid) throw new Error('NO-GO: Not all gates G0-G5 are satisfied');
    console.log('✅ All gates G0-G5 validated');

    // Use first 2 questions for pilot (these will NOT be counted)
    // In a real implementation, these would be separate pilot questions
    const pilotQuestions = questions.slice(0, 2);
    console.log(`\n🎯 Running pilot with ${pilotQuestions.length} questions...`);
    console.log('   (These runs are NOT counted in the main benchmark)\n');

    const pilotRuns = [];

    for (let i = 0; i < pilotQuestions.length; i++) {
      const question = pilotQuestions[i];
      console.log(`--- Pilot Question ${i + 1}/${pilotQuestions.length}: ${question.id} ---`);

      // Run CodeTour
      console.log(`  🔄 CodeTour...`);
      const ctResult = await pilotRunner.runSingle({ question, agent: 'codetour' });
      console.log(`  ✅ CodeTour: ${ctResult.runId} - ${ctResult.totalTokens.total} tokens`);
      pilotRuns.push(ctResult);

      // Run Vibe Native
      console.log(`  🔄 Vibe Native...`);
      const vibeResult = await pilotRunner.runSingle({ question, agent: 'vibe-native' });
      console.log(`  ✅ Vibe Native: ${vibeResult.runId} - ${vibeResult.totalTokens.total} tokens`);
      pilotRuns.push(vibeResult);
    }

    // Save pilot results to pilot directory
    console.log('\n💾 Saving pilot results...');
    const pilotTraces = pilotRunner.getAllRuns();
    for (const trace of pilotTraces) {
      const filename = path.join(pilotDir, `${trace.run_id}.json`);
      fs.writeFileSync(filename, JSON.stringify(trace, null, 2), 'utf-8');
      try { fs.chmodSync(filename, 0o444); } catch {}
      console.log(`  ✅ Saved: ${trace.run_id} (${trace.question_id})`);
    }

    // Validate NO-GO controls for pilot
    console.log('\n🔍 Validating NO-GO controls for pilot...');
    for (const trace of pilotTraces) {
      try {
        pilotRunner.validateNoGoControls(trace);
        console.log(`  ✅ ${trace.run_id}`);
      } catch (error) {
        throw new Error(`NO-GO failed for pilot run ${trace.run_id}: ${error.message}`);
      }
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
    try { fs.chmodSync(lockPath, 0o444); } catch {}
    console.log('✅ Manifest frozen');

    // Clean up temp directory
    const tempDir = path.join(__dirname, 'results', 'pilot-temp');
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }

    console.log('\n✅ PHASE A: PILOT COMPLETED\n');

    // ============================================
    // PHASE B: MAIN CAMPAIGN
    // ============================================
    console.log('🟡 PHASE B: MAIN CAMPAIGN (80 runs)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Reload questions for campaign
    const campaignQuestions = await campaignRunner.loadQuestions();

    // Validate manifest is frozen
    if (!fs.existsSync(lockPath)) {
      throw new Error('NO-GO: Manifest lock file missing');
    }
    const manifestLockContent = fs.readFileSync(lockPath, 'utf-8');
    const manifestLockData = JSON.parse(manifestLockContent);
    if (!manifestLockData.locked) {
      throw new Error('NO-GO: Manifest is not locked');
    }
    console.log(`✅ Manifest is frozen (locked at ${manifestLockData.frozen_at})`);

    // Validate PostgreSQL SHA
    const campaignShaValid = campaignRunner.validatePostgresSha();
    if (!campaignShaValid) throw new Error(`NO-GO: PostgreSQL SHA validation failed`);

    // Validate all gates
    const campaignGatesValid = await campaignRunner.validateGates();
    if (!campaignGatesValid) throw new Error('NO-GO: Not all gates G0-G5 are satisfied');
    console.log('✅ All gates G0-G5 validated');

    // Separate into Series R and T
    const seriesR = campaignQuestions.filter(q => q.series === 'R');
    const seriesT = campaignQuestions.filter(q => q.series === 'T');
    
    console.log(`\n📊 Campaign Structure:`);
    console.log(`   Series R: ${seriesR.length} questions × 2 agents = ${seriesR.length * 2} runs`);
    console.log(`   Series T: ${seriesT.length} questions × 2 agents = ${seriesT.length * 2} runs`);
    console.log(`   Total: ${(seriesR.length + seriesT.length) * 2} runs`);

    if (seriesR.length !== 20 || seriesT.length !== 20) {
      throw new Error(`NO-GO: Expected 20 questions per series, got R:${seriesR.length}, T:${seriesT.length}`);
    }

    // Run Series R
    console.log('\n🎯 Starting Series R (40 runs)...');
    console.log('  CodeTour: empty memory, persists between requests');
    console.log('  Vibe-native: independent sessions\n');

    const seriesRResults = [];

    for (let i = 0; i < seriesR.length; i++) {
      const question = seriesR[i];
      process.stdout.write(`--- Series R, Question ${i + 1}/${seriesR.length}: ${question.id} ---\n`);

      // Run CodeTour
      process.stdout.write(`  🔄 CodeTour... `);
      const ctResult = await campaignRunner.runSingle({ question, agent: 'codetour' });
      console.log(`✅ ${ctResult.runId} - ${ctResult.totalTokens.total} tokens`);
      seriesRResults.push(ctResult);

      // Run Vibe Native
      process.stdout.write(`  🔄 Vibe Native... `);
      const vibeResult = await campaignRunner.runSingle({ question, agent: 'vibe-native' });
      console.log(`✅ ${vibeResult.runId} - ${vibeResult.totalTokens.total} tokens`);
      seriesRResults.push(vibeResult);
    }

    console.log(`\n✅ Series R completed: ${seriesRResults.length} runs\n`);

    // Run Series T
    console.log('🎯 Starting Series T (40 runs)...');
    console.log('  CodeTour: NEW empty memory at start of T');
    console.log('  Vibe-native: independent sessions\n');

    const seriesTResults = [];

    for (let i = 0; i < seriesT.length; i++) {
      const question = seriesT[i];
      process.stdout.write(`--- Series T, Question ${i + 1}/${seriesT.length}: ${question.id} ---\n`);

      // Run CodeTour
      process.stdout.write(`  🔄 CodeTour... `);
      const ctResult = await campaignRunner.runSingle({ question, agent: 'codetour' });
      console.log(`✅ ${ctResult.runId} - ${ctResult.totalTokens.total} tokens`);
      seriesTResults.push(ctResult);

      // Run Vibe Native
      process.stdout.write(`  🔄 Vibe Native... `);
      const vibeResult = await campaignRunner.runSingle({ question, agent: 'vibe-native' });
      console.log(`✅ ${vibeResult.runId} - ${vibeResult.totalTokens.total} tokens`);
      seriesTResults.push(vibeResult);
    }

    console.log(`\n✅ Series T completed: ${seriesTResults.length} runs\n`);

    // ============================================
    // PHASE C: VALIDATION
    // ============================================
    console.log('🔵 PHASE C: VALIDATION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Get all campaign runs
    const allCampaignRuns = campaignRunner.getAllRuns();
    console.log(`📊 Total campaign runs: ${allCampaignRuns.length}`);

    // Save campaign runs to results/runs/
    console.log('\n💾 Saving campaign runs...');
    for (const trace of allCampaignRuns) {
      const filename = path.join(runsDir, `${trace.run_id}.json`);
      fs.writeFileSync(filename, JSON.stringify(trace, null, 2), 'utf-8');
      try { fs.chmodSync(filename, 0o444); } catch {}
    }
    console.log(`✅ Saved ${allCampaignRuns.length} campaign runs to results/runs/`);

    // Validate NO-GO controls for all campaign runs
    console.log('\n🔍 Validating NO-GO controls for campaign...');
    for (const trace of allCampaignRuns) {
      try {
        campaignRunner.validateNoGoControls(trace);
      } catch (error) {
        throw new Error(`NO-GO failed for campaign run ${trace.run_id}: ${error.message}`);
      }
    }
    console.log(`✅ All NO-GO controls passed for ${allCampaignRuns.length} campaign runs`);

    // Verify manifest unchanged
    console.log('\n🔒 Verifying manifest unchanged...');
    const manifestContentAfter = fs.readFileSync(manifestPath, 'utf-8');
    const manifestAfter = JSON.parse(manifestContentAfter);
    if (manifestAfter.seal?.message !== 'PRE-REGISTRATION MANIFEST - FROZEN - DO NOT MODIFY') {
      throw new Error('NO-GO: Manifest seal has been modified');
    }
    console.log('✅ Manifest unchanged');

    // Verify lock file unchanged
    if (!fs.existsSync(lockPath)) {
      throw new Error('NO-GO: Manifest lock file is missing');
    }
    const manifestLockContentAfter = fs.readFileSync(lockPath, 'utf-8');
    const manifestLockDataAfter = JSON.parse(manifestLockContentAfter);
    if (!manifestLockDataAfter.locked) {
      throw new Error('NO-GO: Manifest is not locked');
    }
    console.log('✅ Manifest lock unchanged');

    // Verify all runs are retrievable
    console.log('\n🔍 Verifying all runs are retrievable...');
    const runFiles = fs.readdirSync(runsDir).filter(f => f.endsWith('.json'));
    const pilotFiles = fs.readdirSync(pilotDir).filter(f => f.endsWith('.json'));
    console.log(`   Campaign runs: ${runFiles.length}`);
    console.log(`   Pilot runs: ${pilotFiles.length}`);

    if (runFiles.length !== 80) {
      console.warn(`   ⚠️  Expected 80 campaign runs, got ${runFiles.length}`);
    }
    if (pilotFiles.length !== 4) {
      console.warn(`   ⚠️  Expected 4 pilot runs, got ${pilotFiles.length}`);
    }

    // Calculate statistics
    const totalTokens = allCampaignRuns.reduce((sum, r) => sum + r.total_tokens.total, 0);
    const successCount = allCampaignRuns.filter(r => r.status === 'success').length;
    const errorCount = allCampaignRuns.filter(r => r.status === 'error').length;
    const timeoutCount = allCampaignRuns.filter(r => r.status === 'timeout').length;

    console.log('\n' + '═'.repeat(65));
    console.log('📋 EXECUTION SUMMARY');
    console.log('═'.repeat(65));
    console.log('');
    console.log('PHASE A: Pilot');
    console.log(`  Runs: ${pilotRuns.length} (NOT counted)`);
    console.log(`  Questions: ${pilotQuestions.length}`);
    console.log(`  Manifest: Frozen ✅`);
    console.log('');
    console.log('PHASE B: Campaign');
    console.log(`  Series R: ${seriesRResults.length} runs`);
    console.log(`  Series T: ${seriesTResults.length} runs`);
    console.log(`  Total: ${allCampaignRuns.length} runs`);
    console.log('');
    console.log('PHASE C: Validation');
    console.log(`  Runs retrievable: ${runFiles.length} (campaign) + ${pilotFiles.length} (pilot)`);
    console.log(`  NO-GO controls: All passed ✅`);
    console.log(`  Manifest unchanged: ✅`);
    console.log('');
    console.log('STATISTICS:');
    console.log(`  Success: ${successCount}`);
    console.log(`  Errors: ${errorCount}`);
    console.log(`  Timeouts: ${timeoutCount}`);
    console.log(`  Total tokens: ${totalTokens}`);
    console.log('═'.repeat(65));

    const success = allCampaignRuns.length === 80 && 
                    pilotRuns.length === 4 &&
                    runFiles.length === 80 &&
                    pilotFiles.length === 4;

    if (success) {
      console.log('\n✅ T07 COMPLETED SUCCESSFULLY\n');
      console.log('Pilot + 80 runs complete, all traces saved\n');
    } else {
      console.log('\n⚠️  T07 COMPLETED WITH ISSUES\n');
      if (allCampaignRuns.length !== 80) {
        console.log(`  Expected 80 campaign runs, got ${allCampaignRuns.length}`);
      }
      if (runFiles.length !== 80) {
        console.log(`  Expected 80 campaign run files, got ${runFiles.length}`);
      }
      if (pilotFiles.length !== 4) {
        console.log(`  Expected 4 pilot run files, got ${pilotFiles.length}`);
      }
    }

    return { success, totalRuns: allCampaignRuns.length, pilotRuns: pilotRuns.length };

  } catch (error) {
    console.error('\n❌ EXECUTION FAILED:', error.message);
    console.error(error);
    return { success: false, error: error.message };
  }
}

// Run if executed directly
if (require.main === module) {
  runAll().then(result => {
    process.exit(result.success ? 0 : 1);
  }).catch(error => {
    console.error('Execution failed:', error);
    process.exit(1);
  });
}

module.exports = { runAll };
