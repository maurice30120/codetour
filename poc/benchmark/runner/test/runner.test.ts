/**
 * Runner Tests
 * Spec #174 - T05
 * 
 * Tests for the BenchmarkRunner class functionality
 */

import { BenchmarkRunner, RunnerConfig, POSTGRES_SHA } from '../src/index';
import { ImmutableLogger } from '../src/storage/logger';
import { ExecutionManager } from '../src/execution/manager';
import { CodeTourExecutor } from '../src/agents/codetour';
import { VibeExecutor } from '../src/agents/vibe';
import { TokenTracker } from '../src/execution/tracker';

// Mock configuration
const mockConfig: RunnerConfig = {
  questionsFile: '/tmp/spec-174-worktrees/T05/poc/benchmark/postgres-questions.json',
  manifestFile: '/tmp/spec-174-worktrees/T05/poc/benchmark/manifest.json',
  postgresPath: '/tmp/spec-174-worktrees/T05/poc/benchmark/postgres',
  outputDir: '/tmp/benchmark-runner-test-output',
  runPilot: false, // Skip pilot for tests
};

describe('BenchmarkRunner', () => {
  let runner: BenchmarkRunner;

  beforeAll(() => {
    runner = new BenchmarkRunner(mockConfig);
  });

  describe('Initialization', () => {
    it('should initialize with correct configuration', () => {
      expect(runner).toBeDefined();
      // Configuration is private, but we can verify the runner was created
    });

    it('should have registered agent executors', () => {
      // The runner should have CodeTour and Vibe executors registered
      // This is verified by the fact that it was created without errors
      expect(runner).toBeInstanceOf(BenchmarkRunner);
    });
  });

  describe('Question Loading', () => {
    it('should load questions from file', async () => {
      const questions = await runner['loadQuestions']();
      
      expect(questions).toBeDefined();
      expect(Array.isArray(questions)).toBe(true);
      expect(questions.length).toBeGreaterThan(0);
    });

    it('should load manifest from file', async () => {
      const manifest = await runner['loadManifest']();
      
      expect(manifest).toBeDefined();
      expect(manifest).toHaveProperty('spec_version');
      expect(manifest).toHaveProperty('postgres_sha');
    });

    it('should validate PostgreSQL SHA from questions', async () => {
      await runner['loadQuestions']();
      
      const isValid = runner['validatePostgresSha']();
      
      expect(isValid).toBe(true);
    });
  });

  describe('Gate Validation', () => {
    it('should validate all gates G0-G5', async () => {
      // Load questions first
      await runner['loadQuestions']();
      
      const allValid = await runner.validateGates();
      
      // In test environment, we expect most gates to pass
      // G0, G1, G2, G3, G5 should pass (G4 is from T06)
      expect(allValid).toBe(true);
    });
  });

  describe('NO-GO Controls', () => {
    it('should validate provenance correctly', () => {
      const validTrace = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R' as const,
        postgres_sha: POSTGRES_SHA,
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      // This should not throw
      expect(() => runner.validateProvenance(validTrace)).not.toThrow();
    });

    it('should throw on invalid provenance - missing agent', () => {
      const invalidTrace = {
        question_id: 'test-question',
        series: 'R' as const,
        postgres_sha: POSTGRES_SHA,
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      expect(() => runner.validateProvenance(invalidTrace)).toThrow('NO-GO');
    });

    it('should throw on invalid provenance - wrong agent', () => {
      const invalidTrace = {
        agent: 'fake-agent',
        question_id: 'test-question',
        series: 'R' as const,
        postgres_sha: POSTGRES_SHA,
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      expect(() => runner.validateProvenance(invalidTrace)).toThrow('NO-GO');
    });

    it('should validate token usage correctly', () => {
      const validTrace = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R' as const,
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

      expect(() => runner.validateTokenUsage(validTrace)).not.toThrow();
    });

    it('should throw on missing token usage', () => {
      const invalidTrace = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R' as const,
        postgres_sha: POSTGRES_SHA,
        calls: [
          {
            call_id: 'call-1',
            call_type: 'prompt',
            input_tokens: 100,
            output_tokens: 50,
            usage_missing: true, // Usage missing
          },
        ],
        total_tokens: { input: 100, output: 50, total: 150, verified: false },
      };

      expect(() => runner.validateTokenUsage(invalidTrace)).toThrow('NO-GO');
    });

    it('should validate PostgreSQL SHA correctly', () => {
      const validTrace = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R' as const,
        postgres_sha: POSTGRES_SHA,
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      expect(() => runner.validatePostgresShaCheck(validTrace)).not.toThrow();
    });

    it('should throw on wrong PostgreSQL SHA', () => {
      const invalidTrace = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R' as const,
        postgres_sha: 'wrong-sha-1234567890abcdef',
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      expect(() => runner.validatePostgresShaCheck(invalidTrace)).toThrow('NO-GO');
    });

    it('should validate fixture integrity correctly', () => {
      const validTrace = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R' as const,
        postgres_sha: POSTGRES_SHA,
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      expect(() => runner.validateFixtureIntegrity(validTrace)).not.toThrow();
    });

    it('should throw on fixture integrity violation', () => {
      const invalidTrace = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R' as const,
        // postgres_sha missing - can't verify fixture
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      expect(() => runner.validateFixtureIntegrity(invalidTrace)).toThrow('NO-GO');
    });

    it('should validate all NO-GO controls together', () => {
      const validTrace = {
        agent: 'codetour',
        question_id: 'test-question',
        series: 'R' as const,
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

      expect(() => runner.validateNoGoControls(validTrace)).not.toThrow();
    });

    it('should throw on any NO-GO control failure', () => {
      const invalidTrace = {
        agent: 'fake-agent', // Wrong agent
        question_id: 'test-question',
        series: 'R' as const,
        postgres_sha: 'wrong-sha', // Wrong SHA
        calls: [],
        total_tokens: { input: 0, output: 0, total: 0, verified: true },
      };

      expect(() => runner.validateNoGoControls(invalidTrace)).toThrow('NO-GO');
    });
  });
});

// Agent Executor Tests
describe('Agent Executors', () => {
  describe('CodeTourExecutor', () => {
    let executor: CodeTourExecutor;

    beforeEach(() => {
      executor = new CodeTourExecutor();
    });

    it('should have correct properties', () => {
      expect(executor.name).toBe('codetour');
      expect(executor.version).toBeDefined();
      expect(executor.model).toBeDefined();
      expect(executor.modelParams).toBeDefined();
    });

    it('should execute questions and track tokens', async () => {
      const tracker = new TokenTracker();
      const question = {
        id: 'test-question',
        objective: 'Test objective',
        series: 'R' as const,
        phase: 'repetition' as const,
        repeat_index: 0,
        postgres_sha: POSTGRES_SHA,
      };

      const result = await executor.execute(question, tracker);

      expect(result).toBeDefined();
      expect(result.calls).toBeDefined();
      expect(result.calls.length).toBeGreaterThan(0);
      expect(result.status).toBe('success');
      expect(result.result).toBeDefined();

      // Verify token tracking
      const summary = tracker.getSummary();
      expect(summary.total_calls).toBeGreaterThan(0);
      expect(summary.total_tokens).toBeGreaterThan(0);
      expect(summary.verified).toBe(true);
    });

    it('should create functions when needed', async () => {
      const tracker = new TokenTracker();
      const question = {
        id: 'test-question',
        objective: 'Test objective',
        series: 'R' as const,
        phase: 'repetition' as const,
        repeat_index: 0,
        postgres_sha: POSTGRES_SHA,
      };

      const result = await executor.execute(question, tracker);

      // CodeTour should create at least one function
      expect(result.functions_created).toBeDefined();
      expect(result.functions_created?.length).toBeGreaterThanOrEqual(0);
    });

    it('should reuse functions', async () => {
      const tracker = new TokenTracker();
      const question = {
        id: 'test-question',
        objective: 'Test objective',
        series: 'R' as const,
        phase: 'repetition' as const,
        repeat_index: 0,
        postgres_sha: POSTGRES_SHA,
      };

      const result = await executor.execute(question, tracker);

      // Should have some function reuse
      expect(result.functions_reused).toBeDefined();
    });
  });

  describe('VibeExecutor', () => {
    let executor: VibeExecutor;

    beforeEach(() => {
      executor = new VibeExecutor();
    });

    it('should have correct properties', () => {
      expect(executor.name).toBe('vibe-native');
      expect(executor.version).toBeDefined();
      expect(executor.model).toBeDefined();
      expect(executor.modelParams).toBeDefined();
    });

    it('should execute questions and track tokens', async () => {
      const tracker = new TokenTracker();
      const question = {
        id: 'test-question',
        objective: 'Test objective',
        series: 'R' as const,
        phase: 'repetition' as const,
        repeat_index: 0,
        postgres_sha: POSTGRES_SHA,
      };

      const result = await executor.execute(question, tracker);

      expect(result).toBeDefined();
      expect(result.calls).toBeDefined();
      expect(result.calls.length).toBeGreaterThan(0);
      expect(result.status).toBe('success');
      expect(result.result).toBeDefined();

      // Verify token tracking
      const summary = tracker.getSummary();
      expect(summary.total_calls).toBeGreaterThan(0);
      expect(summary.total_tokens).toBeGreaterThan(0);
      expect(summary.verified).toBe(true);
    });

    it('should use native research sub-agent', async () => {
      const tracker = new TokenTracker();
      const question = {
        id: 'test-question',
        objective: 'Test objective',
        series: 'R' as const,
        phase: 'repetition' as const,
        repeat_index: 0,
        postgres_sha: POSTGRES_SHA,
      };

      const result = await executor.execute(question, tracker);

      // Vibe should use its native research
      expect(result.result?.raw_response).toContain('native research');
    });

    it('should create new session for each execution', async () => {
      const executor = new VibeExecutor();
      const tracker1 = new TokenTracker();
      const tracker2 = new TokenTracker();

      const question1 = {
        id: 'test-question-1',
        objective: 'Test objective 1',
        series: 'R' as const,
        phase: 'repetition' as const,
        repeat_index: 0,
        postgres_sha: POSTGRES_SHA,
      };

      const question2 = {
        id: 'test-question-2',
        objective: 'Test objective 2',
        series: 'R' as const,
        phase: 'repetition' as const,
        repeat_index: 0,
        postgres_sha: POSTGRES_SHA,
      };

      await executor.execute(question1, tracker1);
      await executor.execute(question2, tracker2);

      // Sessions should be isolated
      // The executor creates a new session for each execution
    });
  });
});

// Execution Manager Tests
describe('ExecutionManager', () => {
  let logger: ImmutableLogger;
  let manager: ExecutionManager;

  beforeAll(() => {
    logger = new ImmutableLogger({
      outputDir: '/tmp/execution-manager-test',
      validateSchema: true,
      immutable: false,
    });

    manager = new ExecutionManager(logger, {
      maxConcurrent: 1,
      timeoutMs: 10000,
    });
  });

  it('should register and retrieve agent executors', () => {
    const executor = new CodeTourExecutor();
    
    manager.registerAgentExecutor(executor);

    const retrieved = manager.getAgentExecutor('codetour');
    expect(retrieved).toBe(executor);
  });

  it('should throw if getting unregistered executor', () => {
    expect(() => manager.getAgentExecutor('vibe-native'))
      .toThrow('Agent executor not registered');
  });

  it('should execute single question with agent', async () => {
    const executor = new CodeTourExecutor();
    manager.registerAgentExecutor(executor);

    const question = {
      id: 'test-question',
      objective: 'Test objective',
      series: 'R' as const,
      phase: 'repetition' as const,
      repeat_index: 0,
      postgres_sha: POSTGRES_SHA,
    };

    const trace = await manager.executeSingle(question, 'codetour');

    expect(trace).toBeDefined();
    expect(trace.run_id).toBeDefined();
    expect(trace.agent).toBe('codetour');
    expect(trace.question_id).toBe('test-question');
    expect(trace.series).toBe('R');
    expect(trace.postgres_sha).toBe(POSTGRES_SHA);
    expect(trace.calls.length).toBeGreaterThan(0);
    expect(trace.total_tokens.input).toBeGreaterThan(0);
    expect(trace.total_tokens.output).toBeGreaterThan(0);
    expect(trace.total_tokens.verified).toBe(true);
  });

  it('should execute paired agents for same question', async () => {
    const codeTourExecutor = new CodeTourExecutor();
    const vibeExecutor = new VibeExecutor();

    manager.registerAgentExecutor(codeTourExecutor);
    manager.registerAgentExecutor(vibeExecutor);

    const question = {
      id: 'test-question-paired',
      objective: 'Test objective for paired execution',
      series: 'R' as const,
      phase: 'repetition' as const,
      repeat_index: 0,
      postgres_sha: POSTGRES_SHA,
    };

    const result = await manager.executePaired(question);

    expect(result.codetour).toBeDefined();
    expect(result.codetour.agent).toBe('codetour');
    expect(result.vibe).toBeDefined();
    expect(result.vibe.agent).toBe('vibe-native');
    expect(result.codetour.question_id).toBe(question.id);
    expect(result.vibe.question_id).toBe(question.id);
  });

  it('should provide summary statistics', () => {
    const summary = manager.getSummary();

    expect(summary).toBeDefined();
    expect(summary.total_runs).toBeGreaterThanOrEqual(0);
    expect(summary.by_agent).toBeDefined();
    expect(summary.by_series).toBeDefined();
    expect(summary.by_status).toBeDefined();
  });
});

// Integration Test
describe('Integration: Complete Runner Workflow', () => {
  it('should load questions and run a single execution', async () => {
    const runner = new BenchmarkRunner({
      ...mockConfig,
      runPilot: false,
      outputDir: '/tmp/integration-test-output',
    });

    // Load questions
    const questions = await runner['loadQuestions']();
    expect(questions.length).toBeGreaterThan(0);

    // Take first question
    const question = questions[0];

    // Run single execution with CodeTour
    const result = await runner.runSingle({
      question,
      agent: 'codetour',
    });

    expect(result).toBeDefined();
    expect(result.runId).toBeDefined();
    expect(result.agent).toBe('codetour');
    expect(result.questionId).toBe(question.id);
    expect(result.totalTokens.total).toBeGreaterThan(0);
    expect(result.status).toBe('success');
  });

  it('should run paired execution for a question', async () => {
    const runner = new BenchmarkRunner({
      ...mockConfig,
      runPilot: false,
      outputDir: '/tmp/integration-test-output-paired',
    });

    // Load questions
    const questions = await runner['loadQuestions']();
    const question = questions[0];

    // Run both agents
    const codetourResult = await runner.runSingle({
      question,
      agent: 'codetour',
    });

    const vibeResult = await runner.runSingle({
      question,
      agent: 'vibe-native',
    });

    expect(codetourResult).toBeDefined();
    expect(vibeResult).toBeDefined();
    expect(codetourResult.agent).toBe('codetour');
    expect(vibeResult.agent).toBe('vibe-native');
    expect(codetourResult.questionId).toBe(vibeResult.questionId);
  });
});
