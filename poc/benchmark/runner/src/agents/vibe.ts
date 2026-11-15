/**
 * Vibe Native Agent Executor — REAL connector invocation (remediation).
 *
 * This replaces the fabricated simulator (previously: invented sessions,
 * Math.random() file/line "citations", fake retry/orchestrator calls with
 * hardcoded token estimates). The Vibe arm now invokes the REAL vibe CLI
 * through packages/vibe-connector (its native research sub-agent invocation)
 * and maps its REAL telemetry into the run trace.
 *
 * Hard honesty rules enforced here:
 * - The connector must be present (built) and the vibe CLI available, or the
 *   execution FAILS explicitly — the runner surfaces that as NO-GO/stop.
 *   There is no simulated fallback path.
 * - Per-call token usage comes from the real session journal
 *   (perCallUsage, G2 evidence); a call without counters is recorded as
 *   usage_missing and the run is refused by the NO-GO controls.
 * - Citations are only file:line pairs actually present in the real response
 *   text (extracted, never generated).
 * - The real agent identity (vibe_version, active_model, observed subagent)
 *   is recorded; nothing is renamed to satisfy a check.
 */

import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { TokenTracker } from '../execution/tracker';
import { AgentExecutor, AgentExecution, Question } from '../execution/manager';
import { findRepoRoot } from './codetour';

/** Structural typing over the vibe-connector public API (avoids a build-order dependency). */
export interface VibeConnectorModule {
  invokeVibeNativeAgent(question: string, config?: Record<string, unknown>): Promise<{
    id: string;
    agent: { name: string; version: string; model: string; modelConfig?: Record<string, unknown>; agentType?: string };
    question: string;
    response: string;
    tokens: { input: number; output: number; total: number };
    perCallUsage: Array<{
      callIndex: number;
      sessionId?: string;
      cachedInputTokens?: number | null;
      totalTokens?: number | null;
      inputTokens: number | null;
      outputTokens: number | null;
      usageMissing: boolean;
      finishReason?: string;
    }>;
    toolsUsed: string[];
    subagent?: string;
    outcome?: string;
    stopReason?: string | null;
    durationMs: number;
    executionMetadata: Record<string, unknown>;
  }>;
  validateG1(execution: unknown): boolean;
  validateG2(execution: unknown): boolean;
}

/**
 * Configuration for the Vibe native executor.
 */
export interface VibeConfig {
  /** Explicit path to the built vibe-connector entry (dist/src/index.js). Resolved from the repo root when omitted. */
  connectorModulePath?: string;
  /** Fixture working directory handed to the vibe CLI (the directory the manager verifies per run). */
  workDir?: string;
  /** Path/name of the vibe CLI executable. */
  vibeCommand?: string;
  /** Model alias for headless runs. */
  model?: string;
  maxTurns: number;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  topP?: number;
}

const DEFAULT_CONFIG: VibeConfig = {
  maxTurns: 20,
  timeoutMs: 300000,
  temperature: 0,
  maxTokens: 4096,
};

/** Locate and require the BUILT vibe-connector module. Explicit error when absent. */
export function loadVibeConnector(from: string = __dirname, moduleOverride?: string): VibeConnectorModule {
  const explicit = moduleOverride ?? process.env.VIBE_CONNECTOR_PATH;
  const modulePath = explicit
    ? path.resolve(explicit)
    : (() => {
        const root = findRepoRoot(from);
        if (!root) throw new Error('NO-GO: vibe-connector package not found searching upward; set VIBE_CONNECTOR_PATH explicitly');
        return path.join(root, 'packages', 'vibe-connector', 'dist', 'src', 'index.js');
      })();

  if (!fs.existsSync(modulePath)) {
    throw new Error(`NO-GO: vibe-connector build output not found at ${modulePath}. Run 'npm run build' in packages/vibe-connector — there is no simulated fallback.`);
  }
  const require_ = createRequire(__filename);
  return require_(modulePath) as VibeConnectorModule;
}

export class VibeExecutor implements AgentExecutor {
  readonly name = 'vibe-native' as const;
  readonly version: string;
  readonly model: string;
  readonly modelParams: {
    temperature: number;
    max_tokens: number;
    top_p?: number;
  };

  private config: VibeConfig;

  constructor(config: Partial<VibeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Real identity comes from the execution (vibe_version / active_model),
    // recorded per run in the trace; instance-level labels state the channel.
    this.version = 'vibe-connector';
    this.model = this.config.model ?? 'vibe-native-subagent';
    this.modelParams = {
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      top_p: this.config.topP,
    };
  }

  /**
   * Execute a question by invoking the REAL vibe CLI (native research
   * sub-agent) through vibe-connector. Availability problems and invocation
   * failures propagate as explicit errors — the runner records them and
   * surfaces NO-GO. No result is ever fabricated.
   */
  async execute(question: Question, tracker: TokenTracker): Promise<AgentExecution> {
    const connector = loadVibeConnector(__dirname, this.config.connectorModulePath);

    const workDir = this.workDirOf();
    const execution = await connector.invokeVibeNativeAgent(question.objective, {
      workDir,
      vibeCommand: this.config.vibeCommand,
      model: this.config.model && this.config.model !== 'vibe-native-subagent' ? this.config.model : undefined,
      maxTurns: this.config.maxTurns,
      maxTokens: this.config.maxTokens,
      timeoutMs: this.config.timeoutMs,
    });

    // Real gates, evaluated on real telemetry (the connector's own checks).
    const g1 = connector.validateG1(execution);
    const g2 = connector.validateG2(execution);
    const gateFailures: string[] = [];
    if (!g1) gateFailures.push('G1 (Authentic Vibe) failed');
    if (!g2) gateFailures.push('G2 (Total instrumentation) failed');

    // Per-call telemetry from the REAL session journal. Each recorded LLM call
    // gets a call record with REAL provider usage, or an explicit
    // usage_missing record (which NO-GO refuses).
    for (const call of execution.perCallUsage) {
      const callId = tracker.startCall('prompt', 'vibe_native_llm_call', {
        call_index: call.callIndex,
        finish_reason: call.finishReason,
        session_id: call.sessionId ?? execution.id,
      });
      if (call.usageMissing || call.inputTokens === null || call.outputTokens === null) {
        tracker.completeCallWithMissingUsage(callId, { note: 'LLM call returned no usage counters — run refused by NO-GO' });
      } else {
        tracker.completeCall(callId, { input_tokens: call.inputTokens, output_tokens: call.outputTokens, cached_input_tokens: call.cachedInputTokens, cache_included_in_input: true }, { session_id: execution.id });
      }
    }

    // Observed tool names from the real execution are recorded in the result
    // payload (they carry no provider usage of their own — creating a call
    // record with zero tokens would be fabricated telemetry).

    // Citations: only file:line references that actually occur in the real
    // response text. Never generated.
    const citations = extractCitations(execution.response);

    const succeeded = gateFailures.length === 0 && execution.tokens.total > 0 && (execution.outcome === 'finished' || execution.outcome === 'success');
    return {
      calls: tracker.getCalls(),
      result: {
        raw_response: JSON.stringify(execution),
        citations,
      },
      functions_created: [],
      functions_reused: [],
      agent_version: execution.agent.version,
      model_used: execution.agent.model,
      session_id: execution.id,
      observed_model_config: execution.agent.modelConfig,
      tools: execution.toolsUsed,
      no_go: gateFailures.length ? gateFailures.join('; ') : undefined,
      status: succeeded ? 'success' : 'error',
      error: succeeded
        ? null
        : `Vibe arm did not complete with gates satisfied: ${[...gateFailures, execution.outcome ? `outcome=${execution.outcome}` : 'outcome unknown', execution.stopReason ? `stop_reason=${execution.stopReason}` : '']
          .filter(Boolean)
          .join('; ')}`,
    };
  }

  /**
   * The vibe CLI runs in the fixture directory the manager verified — the
   * same tree for both agents. Unconfigured => explicit NO-GO (never a
   * hardcoded worktree path).
   */
  private workDirOf(): string {
    const workDir = this.config.workDir ?? process.env.VIBE_FIXTURE_PATH;
    if (!workDir) {
      throw new Error('NO-GO: Vibe executor has no workDir configured (pass config.postgresPath or set VIBE_FIXTURE_PATH) — refusing to pick an ambient directory');
    }
    if (!fs.existsSync(workDir)) {
      throw new Error(`NO-GO: workDir does not exist: ${workDir}`);
    }
    return path.resolve(workDir);
  }
}

/** Extract file:line references that REALLY appear in the response text. */
export function extractCitations(response: string): string[] {
  const matches = response.match(/[A-Za-z0-9_\-./]+\.[A-Za-z]{1,5}:\d+/g) ?? [];
  return [...new Set(matches)];
}

/**
 * Factory function to create a Vibe executor
 */
export function createVibeExecutor(config?: Partial<VibeConfig>): VibeExecutor {
  return new VibeExecutor(config);
}
