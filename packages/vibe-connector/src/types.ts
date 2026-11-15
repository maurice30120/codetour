/**
 * Types for Vibe Native Research Sub-Agent Connector.
 *
 * Every field is populated from REAL Vibe CLI output (export.json, meta.json,
 * session journal). No dual naming, no speculative types: values that the CLI
 * does not report stay undefined and the validations fail explicitly.
 */

export interface VibeNativeAgent {
  /** REAL agent/subagent name observed in the execution journal. Never renamed to satisfy a check. */
  name: string;
  /** REAL Vibe version from export.json `vibe_version` (no default fallback). */
  version: string;
  /** REAL model from export.json `config.active_model`. */
  model: string;
  modelConfig: {
    temperature?: number;
    maxTokens?: number;
    thinking?: string;
  };
  /** Tools ACTUALLY used, extracted from the journal tool_call parts. */
  tools: string[];
  /** 'subagent' when a task-tool subagent invocation is observed in the journal; otherwise 'direct'. */
  agentType: string;
}

/** Usage counters attached to ONE LLM call, from the session journal action_result records. */
export interface VibeCallUsage {
  sessionId?: string;
  /** Index of the LLM call in the run (root session journal order). */
  callIndex: number;
  finishReason?: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  totalTokens: number | null;
  /** True when the call produced no usage counters — G2 requires false for every call. */
  usageMissing: boolean;
}

export interface VibeExecution {
  /** Session id (export.json `session_id`). */
  id: string;
  agent: VibeNativeAgent;
  question: string;
  /** Last assistant text captured from the real output. Empty when nothing was captured — NOT a placeholder. */
  response: string;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  /** Per-LLM-call usage telemetry extracted from the session journal (G2 evidence). */
  perCallUsage: VibeCallUsage[];
  toolsUsed: string[];
  /** Name of the subagent invoked through the task tool, when the journal proves it. */
  subagent?: string;
  /** export.json `outcome` (e.g. 'finished', 'token_limit'). */
  outcome?: string;
  /** export.json `stop_reason`. */
  stopReason?: string | null;
  timestamp: string;
  durationMs: number;
  executionMetadata: Record<string, unknown>;
}

export interface VibeConnectorConfig {
  /** Path to the vibe CLI executable. */
  vibeCommand?: string;
  /**
   * Working directory handed to the CLI (spawn cwd). NEVER hardcode a worktree
   * path here: explicit value or `defaultWorkDir()` (validated fixture
   * `poc/benchmark/postgres` below the repo root).
   */
  workDir?: string;
  /** Model alias passed as `--model` (headless). Defaults to the real alias 'mistral-medium-3.5'. */
  model?: string;
  maxTurns?: number;
  maxTokens?: number;
  timeoutMs?: number;
  outputDir?: string;
}

export interface VibeAvailability {
  available: boolean;
  /** Real CLI version when available (`vibe --version`). */
  version?: string;
  error?: string;
}
