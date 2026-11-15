/**
 * Sentinel Execution Script for T03
 * 
 * This script invokes the REAL Vibe native research sub-agent,
 * validates G1 and G2, and generates the manifeste.
 */

import { invokeVibeNativeAgent, validateG1, validateG2 } from '../src/agent';
import * as path from 'path';
import * as fs from 'fs';

interface SentinelManifest {
  execution: any;
  g1Passed: boolean;
  g2Passed: boolean;
  timestamp: string;
  connectorVersion: string;
  vibeVersion: string;
}

async function runSentinelExecution(): Promise<void> {
  console.log('\n=== T03 Sentinel Execution ===');
  console.log('Invoking Vibe native research sub-agent...\n');
  
  try {
    // Ask a question about the CodeTour codebase
    const question = 'Explain the main entry point and architecture of the CodeTour codebase';
    
    // Invoke the native research sub-agent
    const execution = await invokeVibeNativeAgent(question, {
      maxTurns: 20,
      timeoutMs: 300000,
    });

    console.log('\n--- Execution Details ---');
    console.log(`Execution ID: ${execution.id}`);
    console.log(`Agent: ${execution.agent.name}@${execution.agent.version}`);
    console.log(`Model: ${execution.agent.model}`);
    console.log(`Tokens (input/output/total): ${execution.tokens.input}/${execution.tokens.output}/${execution.tokens.total}`);
    console.log(`Tools: ${execution.agent.tools.join(', ')}`);
    console.log(`Duration: ${execution.durationMs}ms`);
    
    // Validate G1 and G2
    const g1Passed = validateG1(execution);
    const g2Passed = validateG2(execution);
    
    console.log('\n--- Gate Validation ---');
    console.log(`G1 (Authentic Vibe): ${g1Passed ? '✓ PASSED' : '✗ FAILED'}`);
    console.log(`G2 (Total Instrumentation): ${g2Passed ? '✓ PASSED' : '✗ FAILED'}`);
    
    if (g1Passed && g2Passed) {
      console.log('\n✓ T03 READY: Both G1 and G2 passed!');
      
      // Save the manifeste
      const manifest: SentinelManifest = {
        execution,
        g1Passed,
        g2Passed,
        timestamp: new Date().toISOString(),
        connectorVersion: '0.1.0',
        vibeVersion: execution.agent.version,
      };
      
      const manifestPath = path.join(
        process.cwd(),
        '..',
        '..',
        'docs',
        'specs',
        'spec-174-tickets',
        '03-connecteur-vibe-natif-manifeste.json'
      );
      
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      
      console.log(`\n✓ Manifeste saved to: ${manifestPath}`);
      console.log('\n=== T03 DONE ===');
      console.log('G1 PASSED, G2 PASSED');
      
      process.exit(0);
    } else {
      console.log('\n✗ T03 NO-GO');
      if (!g1Passed) {
        console.log('G1 FAILED: Authentic Vibe not verified');
      }
      if (!g2Passed) {
        console.log('G2 FAILED: Token instrumentation missing');
      }
      process.exit(1);
    }
  } catch (error) {
    console.error('\n✗ T03 NO-GO: Error invoking Vibe native agent');
    console.error(error);
    process.exit(1);
  }
}

runSentinelExecution().catch(() => {
  process.exit(1);
});
