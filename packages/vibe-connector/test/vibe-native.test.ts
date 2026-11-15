/**
 * Sentinel Execution Test for Vibe Native Research Sub-Agent
 * 
 * This test validates G1 (Authentic Vibe) and G2 (Total instrumentation)
 * by invoking the REAL Vibe native research sub-agent and capturing all metadata.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  invokeVibeNativeAgent,
  getVibeNativeAgentInfo,
  validateG1,
  validateG2,
} from '../src/agent';
import { VibeExecution } from '../src/types';

// Manifeste to store the execution metadata
interface SentinelManifest {
  execution: VibeExecution;
  g1Passed: boolean;
  g2Passed: boolean;
  timestamp: string;
  connectorVersion: string;
  vibeVersion: string;
}

function saveManifest(manifest: SentinelManifest): string {
  // Calculate the path from the test directory to the repo root
  // test directory is packages/vibe-connector/test
  // repo root is ../../..
  const manifestPath = path.join(
    process.cwd(),
    '..',
    '..',
    '..',
    'docs',
    'specs',
    'spec-174-tickets',
    '03-connecteur-vibe-natif-manifeste.json'
  );
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

describe('T03 - Vibe Native Research Sub-Agent Integration', () => {
  it('should invoke REAL Vibe native research sub-agent and pass G1/G2', async () => {
    // Ask a simple but real question about the codebase
    const question = 'Explain the main entry point and architecture of the CodeTour codebase';
    
    // Invoke the native research sub-agent
    const execution = await invokeVibeNativeAgent(question, {
      maxTurns: 20,
      timeoutMs: 300000,
    });

    // Validate G1: Authentic Vibe
    expect(execution.agent.name.toLowerCase()).toMatch(/vibe/i);
    expect(execution.agent.version).toBeDefined();
    expect(execution.agent.version).toBeTruthy();
    expect(execution.agent.tools).toBeDefined();
    expect(execution.agent.tools.length).toBeGreaterThan(0);
    expect(execution.agent.tools).toContainEqual(expect.stringMatching(/search|grep|read/i));
    expect(execution.agent.model).toBeDefined();
    expect(execution.agent.model).toBeTruthy();
    expect(execution.response).toBeDefined();
    // Response might be empty if extraction failed, but other metadata should be present
    expect(execution.id).toBeDefined();
    expect(execution.id).toBeTruthy();
    
    // Validate G1
    const g1Passed = validateG1(execution);
    expect(g1Passed).toBe(true);

    // Validate G2: Total instrumentation
    expect(execution.tokens.input).toBeGreaterThan(0);
    expect(execution.tokens.output).toBeGreaterThan(0);
    expect(execution.tokens.total).toBeGreaterThan(0);
    
    // Validate G2
    const g2Passed = validateG2(execution);
    expect(g2Passed).toBe(true);

    // Save the manifeste
    const manifest: SentinelManifest = {
      execution,
      g1Passed,
      g2Passed,
      timestamp: new Date().toISOString(),
      connectorVersion: '0.1.0',
      vibeVersion: execution.agent.version,
    };
    
    const manifestPath = saveManifest(manifest);
    expect(fs.existsSync(manifestPath)).toBe(true);
    
    // Verify the manifeste was saved correctly
    const savedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(savedManifest.execution.id).toBe(execution.id);
    expect(savedManifest.g1Passed).toBe(true);
    expect(savedManifest.g2Passed).toBe(true);
    
    console.log('\n=== Sentinel Execution Results ===');
    console.log(`G1 (Authentic Vibe): ${g1Passed ? '✓ PASSED' : '✗ FAILED'}`);
    console.log(`G2 (Total Instrumentation): ${g2Passed ? '✓ PASSED' : '✗ FAILED'}`);
    console.log(`\nExecution ID: ${execution.id}`);
    console.log(`Agent: ${execution.agent.name}@${execution.agent.version}`);
    console.log(`Model: ${execution.agent.model}`);
    console.log(`Tokens: ${execution.tokens.input}/${execution.tokens.output}/${execution.tokens.total}`);
    console.log(`Manifeste saved to: ${manifestPath}`);
  }, 300000); // 5 minute timeout

  it('should have valid Vibe native agent info', () => {
    const agent = getVibeNativeAgentInfo();
    
    expect(agent.name).toBeDefined();
    expect(agent.version).toBeDefined();
    expect(agent.model).toBeDefined();
    expect(agent.tools).toBeDefined();
    expect(agent.tools.length).toBeGreaterThan(0);
    expect(agent.agentType).toBeDefined();
    
    // Verify agent name contains vibe or is a known sub-agent
    expect(agent.name.toLowerCase()).toMatch(/vibe|explore/i);
  });
});
