/**
 * NO-GO Controls Injection Tests
 * Spec #174 - T05
 * 
 * Tests that verify the runner refuses to produce main results when:
 * - Provenance is missing (which agent? which question?)
 * - Token usage is missing
 * - Wrong agent (not codetour or vibe-native)
 * - Wrong PostgreSQL SHA
 * - Corrupted fixture
 */

import { ImmutableLogger, RunTrace, POSTGRES_SHA } from '../src/storage/logger';
import { TokenTracker } from '../src/execution/tracker';

// Test setup
const OUTPUT_DIR = '/tmp/benchmark-test-output';
let logger: ImmutableLogger;

beforeAll(() => {
  // Create logger instance for tests
  logger = new ImmutableLogger({
    outputDir: OUTPUT_DIR,
    resultsDir: `${OUTPUT_DIR}/results/runs`,
    validateSchema: true,
    immutable: false, // Allow cleanup for tests
  });
});

beforeEach(() => {
  // Clean up any previous test files
  // In a real implementation, we'd clean the output directory
});

// Helper to create a minimal valid run trace
define function createValidTrace(): RunTrace {
  return {
    run_id: 'test-run-id',
    timestamp: new Date().toISOString(),
    agent: 'codetour',
    question_id: 'test-question',
    series: 'R',
    postgres_sha: POSTGRES_SHA,
    calls: [
      {
        call_id: 'call-1',
        call_type: 'prompt',
        input_tokens: 100,
        output_tokens: 50,
        usage_missing: false,
      },
    ],
    total_tokens: {
      input: 100,
      output: 50,
      total: 150,
      verified: true,
    },
    status: 'success',
  };
}

describe('NO-GO Controls', () => {
  describe('Provenance Validation', () => {
    it('should refuse if agent is missing', () => {
      const trace: Partial<RunTrace> = {
        question_id: 'test-question',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      const result = logger.validateProvenance(trace);
      
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('NO-GO: Missing agent');
    });

    it('should refuse if question_id is missing', () => {
      const trace: Partial<RunTrace> = {
        agent: 'codetour',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      const result = logger.validateProvenance(trace);
      
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('NO-GO: Missing question_id');
    });

    it('should refuse if agent is invalid', () => {
      const trace: Partial<RunTrace> = {
        agent: 'fake-agent',
        question_id: 'test-question',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      const result = logger.validateProvenance(trace);
      
      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid agent'))).toBe(true);
    });

    it('should accept valid provenance', () => {
      const trace: Partial<RunTrace> = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      const result = logger.validateProvenance(trace);
      
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Token Usage Validation', () => {
    it('should refuse if calls array is empty', () => {
      const trace: Partial<RunTrace> = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      const result = logger.validateTokenUsage(trace);
      
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('NO-GO: No calls recorded');
    });

    it('should refuse if any call has usage_missing=true', () => {
      const trace: Partial<RunTrace> = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        calls: [
          {
            call_id: 'call-1',
            call_type: 'prompt',
            input_tokens: 100,
            output_tokens: 50,
            usage_missing: true, // Missing usage
          },
        ],
        total_tokens: { input: 100, output: 50, total: 150, verified: false },
      };

      const result = logger.validateTokenUsage(trace);
      
      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.includes('Usage missing'))).toBe(true);
    });

    it('should refuse if total_tokens is missing', () => {
      const trace: Partial<RunTrace> = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        calls: [
          {
            call_id: 'call-1',
            call_type: 'prompt',
            input_tokens: 100,
            output_tokens: 50,
            usage_missing: false,
          },
        ],
        // total_tokens is missing
      };

      const result = logger.validateTokenUsage(trace);
      
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('NO-GO: Missing total_tokens');
    });

    it('should refuse if total_tokens.verified is false', () => {
      const trace: Partial<RunTrace> = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        calls: [
          {
            call_id: 'call-1',
            call_type: 'prompt',
            input_tokens: 100,
            output_tokens: 50,
            usage_missing: false,
          },
        ],
        total_tokens: { input: 100, output: 50, total: 150, verified: false },
      };

      const result = logger.validateTokenUsage(trace);
      
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('NO-GO: Total tokens not verified');
    });

    it('should refuse if call has negative token count', () => {
      const trace: Partial<RunTrace> = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        calls: [
          {
            call_id: 'call-1',
            call_type: 'prompt',
            input_tokens: -10, // Negative tokens
            output_tokens: 50,
            usage_missing: false,
          },
        ],
        total_tokens: { input: -10, output: 50, total: 40, verified: true },
      };

      const result = logger.validateTokenUsage(trace);
      
      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.includes('Negative token count'))).toBe(true);
    });

    it('should accept valid token usage', () => {
      const trace: Partial<RunTrace> = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        calls: [
          {
            call_id: 'call-1',
            call_type: 'prompt',
            input_tokens: 100,
            output_tokens: 50,
            usage_missing: false,
          },
        ],
        total_tokens: { input: 100, output: 50, total: 150, verified: true },
      };

      const result = logger.validateTokenUsage(trace);
      
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('PostgreSQL SHA Validation', () => {
    it('should refuse if postgres_sha is missing', () => {
      const trace: Partial<RunTrace> = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R',
        // postgres_sha is missing
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      const result = logger.validatePostgresShaCheck(trace);
      
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('NO-GO: Missing postgres_sha');
    });

    it('should refuse if postgres_sha is wrong', () => {
      const trace: Partial<RunTrace> = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R',
        postgres_sha: 'wrong-sha-1234567890abcdef',
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      const result = logger.validatePostgresShaCheck(trace);
      
      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.includes('Wrong PostgreSQL SHA'))).toBe(true);
    });

    it('should accept correct postgres_sha', () => {
      const trace: Partial<RunTrace> = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      const result = logger.validatePostgresShaCheck(trace);
      
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Fixture Integrity Validation', () => {
    it('should refuse if fixture cannot be verified', () => {
      const trace: Partial<RunTrace> = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R',
        // postgres_sha is missing, so fixture can't be verified
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      const result = logger.validateFixtureIntegrity(trace);
      
      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.includes('Cannot verify fixture'))).toBe(true);
    });

    it('should accept if postgres_sha is present', () => {
      const trace: Partial<RunTrace> = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      const result = logger.validateFixtureIntegrity(trace);
      
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Complete NO-GO Validation', () => {
    it('should refuse if any NO-GO control fails', () => {
      const trace: Partial<RunTrace> = {
        agent: 'fake-agent', // Invalid agent
        question_id: 'test-question',
        series: 'R',
        postgres_sha: 'wrong-sha', // Wrong SHA
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      const result = logger.validateNoGoControls(trace);
      
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should accept if all NO-GO controls pass', () => {
      const validTrace = createValidTrace();
      
      const result = logger.validateNoGoControls(validTrace);
      
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

// Token Tracker Tests
describe('Token Tracker', () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    tracker = new TokenTracker();
  });

  it('should track calls correctly', () => {
    const callId1 = tracker.startCall('prompt', 'test_tool');
    const callId2 = tracker.startCall('search', 'test_tool');

    tracker.completeCall(callId1, { input_tokens: 100, output_tokens: 50 });
    tracker.completeCall(callId2, { input_tokens: 200, output_tokens: 100 });

    const calls = tracker.getCalls();
    
    expect(calls).toHaveLength(2);
    expect(calls[0].input_tokens).toBe(100);
    expect(calls[0].output_tokens).toBe(50);
    expect(calls[1].input_tokens).toBe(200);
    expect(calls[1].output_tokens).toBe(100);
  });

  it('should mark calls with missing usage', () => {
    const callId = tracker.startCall('prompt', 'test_tool');
    
    tracker.completeCallWithMissingUsage(callId);

    const calls = tracker.getCalls();
    
    expect(calls).toHaveLength(1);
    expect(calls[0].usage_missing).toBe(true);
    expect(calls[0].input_tokens).toBe(0);
    expect(calls[0].output_tokens).toBe(0);
  });

  it('should detect missing usage', () => {
    const callId1 = tracker.startCall('prompt', 'test_tool');
    const callId2 = tracker.startCall('search', 'test_tool');

    tracker.completeCall(callId1, { input_tokens: 100, output_tokens: 50 });
    tracker.completeCallWithMissingUsage(callId2);

    expect(tracker.hasMissingUsage()).toBe(true);
    expect(tracker.getMissingUsageCount()).toBe(1);
  });

  it('should calculate total tokens correctly', () => {
    const callId1 = tracker.startCall('prompt', 'test_tool');
    const callId2 = tracker.startCall('search', 'test_tool');

    tracker.completeCall(callId1, { input_tokens: 100, output_tokens: 50 });
    tracker.completeCall(callId2, { input_tokens: 200, output_tokens: 100 });

    const totalTokens = tracker.calculateTotalTokens();
    
    expect(totalTokens.input).toBe(300);
    expect(totalTokens.output).toBe(150);
    expect(totalTokens.total).toBe(450);
    expect(totalTokens.verified).toBe(true);
  });

  it('should mark total as unverified if any call has missing usage', () => {
    const callId1 = tracker.startCall('prompt', 'test_tool');
    const callId2 = tracker.startCall('search', 'test_tool');

    tracker.completeCall(callId1, { input_tokens: 100, output_tokens: 50 });
    tracker.completeCallWithMissingUsage(callId2);

    const totalTokens = tracker.calculateTotalTokens();
    
    expect(totalTokens.verified).toBe(false);
  });

  it('should clear all data', () => {
    const callId = tracker.startCall('prompt', 'test_tool');
    tracker.completeCall(callId, { input_tokens: 100, output_tokens: 50 });

    expect(tracker.getCalls()).toHaveLength(1);

    tracker.clear();

    expect(tracker.getCalls()).toHaveLength(0);
    expect(tracker.getPendingCount()).toBe(0);
  });

  it('should provide summary statistics', () => {
    const callId1 = tracker.startCall('prompt', 'test_tool');
    const callId2 = tracker.startCall('search', 'test_tool');
    const callId3 = tracker.startCall('memory_list', 'test_tool');

    tracker.completeCall(callId1, { input_tokens: 100, output_tokens: 50 });
    tracker.completeCall(callId2, { input_tokens: 200, output_tokens: 100 });
    tracker.completeCallWithMissingUsage(callId3);

    const summary = tracker.getSummary();
    
    expect(summary.total_calls).toBe(3);
    expect(summary.pending_calls).toBe(0);
    expect(summary.missing_usage_calls).toBe(1);
    expect(summary.total_input_tokens).toBe(300);
    expect(summary.total_output_tokens).toBe(150);
    expect(summary.total_tokens).toBe(450);
    expect(summary.verified).toBe(false);
  });
});

// Logger Save Tests
describe('Immutable Logger Save', () => {
  it('should throw if trying to save with NO-GO violations', () => {
    const trace: RunTrace = {
      run_id: 'test-run-id',
      timestamp: new Date().toISOString(),
      agent: 'fake-agent', // Invalid agent
      question_id: 'test-question',
      series: 'R',
      postgres_sha: POSTGRES_SHA,
      calls: [],
      total_tokens: { input: 0, output: 0, total: 0, verified: true },
      status: 'success',
    };

    expect(() => logger.saveRun(trace)).toThrow('NO-GO');
  });

  it('should throw if trying to save with missing provenance', () => {
    const trace: RunTrace = {
      run_id: 'test-run-id',
      timestamp: new Date().toISOString(),
      agent: 'codetour',
      // question_id is missing
      series: 'R' as const,
      postgres_sha: POSTGRES_SHA,
      calls: [],
      total_tokens: { input: 0, output: 0, total: 0, verified: true },
      status: 'success',
    };

    expect(() => logger.saveRun(trace)).toThrow('NO-GO');
  });

  it('should throw if trying to save with missing token usage', () => {
    const trace: RunTrace = {
      run_id: 'test-run-id',
      timestamp: new Date().toISOString(),
      agent: 'codetour',
      question_id: 'test-question',
      series: 'R',
      postgres_sha: POSTGRES_SHA,
      calls: [],
      total_tokens: { input: 0, output: 0, total: 0, verified: true },
      status: 'success',
    };

    expect(() => logger.saveRun(trace)).toThrow('NO-GO');
  });

  it('should throw if trying to save with wrong PostgreSQL SHA', () => {
    const trace: RunTrace = {
      run_id: 'test-run-id',
      timestamp: new Date().toISOString(),
      agent: 'codetour',
      question_id: 'test-question',
      series: 'R',
      postgres_sha: 'wrong-sha-1234567890abcdef',
      calls: [
        {
          call_id: 'call-1',
          call_type: 'prompt',
          input_tokens: 100,
          output_tokens: 50,
          usage_missing: false,
        },
      ],
      total_tokens: { input: 100, output: 50, total: 150, verified: true },
      status: 'success',
    };

    expect(() => logger.saveRun(trace)).toThrow('NO-GO');
  });

  it('should save successfully with valid trace', () => {
    const validTrace = createValidTrace();
    
    // This should not throw
    expect(() => logger.saveRun(validTrace)).not.toThrow();
  });
});
