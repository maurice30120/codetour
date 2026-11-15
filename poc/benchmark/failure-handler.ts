/**
 * Failure Handler for Spec #174 T07
 * 
 * Implements failure handling according to the spec:
 * - Agent failures: count in denominator, do NOT erase, do NOT replace
 * - Infrastructure failures: trigger replay (network_error, service_unavailable, timeout)
 * - Partial runs: count in denominator
 * - Errors: count in denominator
 * - Timeouts: count in denominator
 */

/**
 * Context for a run failure
 */
export interface RunContext {
  questionId: string;
  agent: 'codetour' | 'vibe-native';
  series?: 'R' | 'T';
  runId?: string;
  attempt?: number;
}

/**
 * Result of handling a failure
 */
export interface FailureResult {
  /** Action to take: 'record' (count in denominator) or 'retry' (replay) */
  action: 'record' | 'retry' | 'stop';
  /** Reason for the action */
  reason: string;
  /** Whether this is an infrastructure failure */
  isInfrastructure: boolean;
  /** Whether this is an agent failure */
  isAgentFailure: boolean;
}

/**
 * List of infrastructure error types that trigger replay
 * According to spec: "network_error", "service_unavailable", "timeout"
 */
const INFRASTRUCTURE_ERRORS = [
  'network_error',
  'service_unavailable',
  'timeout',
  'connection_refused',
  'connection_reset',
  'connection_timeout',
  'dns_resolution_failed',
  'socket_error',
  'http_502',
  'http_503',
  'http_504',
  'rate_limit_exceeded',
];

/**
 * List of keywords that indicate infrastructure issues
 */
const INFRASTRUCTURE_KEYWORDS = [
  'network',
  'connection',
  'timeout',
  'service unavailable',
  'service_unavailable',
  '502',
  '503',
  '504',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'rate limit',
  'ratelimit',
];

/**
 * Handle a failure during benchmark execution
 * 
 * @param error - The error that occurred
 * @param context - Context about the run
 * @returns FailureResult with action to take
 */
export function handleFailure(error: Error, context: RunContext): FailureResult {
  const errorMessage = error.message.toLowerCase();
  const errorName = error.name.toLowerCase();

  // Check for infrastructure errors
  const isInfrastructure = checkInfrastructureError(errorMessage, errorName);

  if (isInfrastructure) {
    // Infrastructure failures trigger replay
    const reason = `Infrastructure failure for ${context.agent} on ${context.questionId}: ${error.message}`;
    
    console.warn(`⚠️  Infrastructure failure detected: ${error.message}`);
    console.warn(`🔄 Replaying according to documented rule...`);
    
    return {
      action: 'retry',
      reason,
      isInfrastructure: true,
      isAgentFailure: false,
    };
  }

  // Check for timeout errors
  if (errorMessage.includes('timeout') || errorName.includes('timeout')) {
    const reason = `Timeout for ${context.agent} on ${context.questionId}: ${error.message}`;
    
    console.warn(`⚠️  Timeout detected: ${error.message}`);
    console.warn(`🔄 Replaying according to documented rule...`);
    
    return {
      action: 'retry',
      reason,
      isInfrastructure: true,
      isAgentFailure: false,
    };
  }

  // For all other errors: this is an agent failure
  // According to spec: "Ne PAS effacer, Ne PAS remplacer, Compter dans le dénominateur"
  // (Do NOT erase, do NOT replace, count in denominator)
  const reason = `Agent failure for ${context.agent} on ${context.questionId}: ${error.message}`;
  
  console.error(`❌ Agent failure: ${error.message}`);
  console.error(`📝 Recording in denominator (will NOT be erased or replaced)`);

  return {
    action: 'record',
    reason,
    isInfrastructure: false,
    isAgentFailure: true,
  };
}

/**
 * Check if an error is an infrastructure error
 */
function checkInfrastructureError(errorMessage: string, errorName: string): boolean {
  // Check exact matches with infrastructure errors
  for (const exactError of INFRASTRUCTURE_ERRORS) {
    if (errorMessage.includes(exactError) || errorName.includes(exactError)) {
      return true;
    }
  }

  // Check for keywords
  for (const keyword of INFRASTRUCTURE_KEYWORDS) {
    if (errorMessage.includes(keyword) || errorName.includes(keyword)) {
      return true;
    }
  }

  return false;
}

/**
 * Common documented rule for replay
 * According to spec: "replay_rule": "common_documented_rule"
 * Replay cases: ["network_error", "service_unavailable", "timeout"]
 */
export const REPLAY_RULE = {
  trigger_on: ['network_error', 'service_unavailable', 'timeout'],
  max_retries: 3,
  retry_delay_seconds: 5,
  note: 'Only infrastructure failures trigger replay. Agent failures count in denominator.',
};

/**
 * Determine if a run should be retried based on error
 */
export function shouldRetry(error: Error): boolean {
  const errorMessage = error.message.toLowerCase();
  const errorName = error.name.toLowerCase();

  return checkInfrastructureError(errorMessage, errorName);
}

/**
 * Determine if a run should be recorded as a failure
 */
export function shouldRecord(error: Error): boolean {
  return !shouldRetry(error);
}

/**
 * Validate that failures are handled correctly
 */
export function validateFailureHandling(
  results: Array<{
    runId: string;
    status: 'success' | 'error' | 'timeout';
    error?: string;
    isInfrastructure?: boolean;
  }>
): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check that infrastructure failures were retried (not recorded as final errors)
  const infrastructureErrors = results.filter(
    r => r.isInfrastructure && r.status !== 'success'
  );

  if (infrastructureErrors.length > 0) {
    warnings.push(
      `Found ${infrastructureErrors.length} infrastructure errors that should have been retried`
    );
  }

  // Check that agent failures were recorded (not erased)
  const agentFailures = results.filter(
    r => !r.isInfrastructure && r.status === 'error'
  );

  if (agentFailures.length > 0) {
    // This is expected - agent failures should be recorded
    console.log(`ℹ️  ${agentFailures.length} agent failures recorded in denominator`);
  }

  // All runs should have a valid status
  const invalidStatus = results.filter(
    r => !['success', 'error', 'timeout'].includes(r.status)
  );

  if (invalidStatus.length > 0) {
    errors.push(
      `Found ${invalidStatus.length} runs with invalid status`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get the replay policy for the benchmark
 */
export function getReplayPolicy() {
  return {
    ...REPLAY_RULE,
    current_attempt: 0,
    shouldRetry: (error: Error) => shouldRetry(error),
    shouldRecord: (error: Error) => shouldRecord(error),
  };
}

/**
 * Test cases for failure handling
 * These can be used to verify the handler works correctly
 */
export const TEST_CASES = {
  infrastructure: [
    new Error('network_error: connection refused'),
    new Error('Service unavailable'),
    new Error('timeout after 300000ms'),
    new Error('ECONNREFUSED 127.0.0.1:8080'),
    new Error('HTTP 503 Service Unavailable'),
  ],
  agent: [
    new Error('Function execution failed'),
    new Error('Invalid input parameters'),
    new Error('Memory limit exceeded'),
    new Error('Execution aborted by user'),
  ],
};

/**
 * Run test cases to verify failure handling
 */
export function runFailureHandlerTests(): {
  passed: number;
  failed: number;
  results: Array<{
    testName: string;
    error: Error;
    context: RunContext;
    result: FailureResult;
    expected: 'retry' | 'record';
    passed: boolean;
  }>;
} {
  const results: Array<{
    testName: string;
    error: Error;
    context: RunContext;
    result: FailureResult;
    expected: 'retry' | 'record';
    passed: boolean;
  }> = [];

  const context: RunContext = {
    questionId: 'test-question',
    agent: 'codetour',
    series: 'R',
  };

  // Test infrastructure errors (should retry)
  for (const error of TEST_CASES.infrastructure) {
    const result = handleFailure(error, context);
    results.push({
      testName: `Infrastructure: ${error.message}`,
      error,
      context,
      result,
      expected: 'retry',
      passed: result.action === 'retry' && result.isInfrastructure,
    });
  }

  // Test agent errors (should record)
  for (const error of TEST_CASES.agent) {
    const result = handleFailure(error, context);
    results.push({
      testName: `Agent: ${error.message}`,
      error,
      context,
      result,
      expected: 'record',
      passed: result.action === 'record' && result.isAgentFailure,
    });
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;

  return { passed, failed, results };
}
