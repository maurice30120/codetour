/**
 * Types for Vibe Native Research Sub-Agent Connector
 */

export interface VibeNativeAgent {
  name: string; // Nom du sous-agent (doit contenir "Vibe" ou "vibe")
  version: string; // Version de Vibe
  model: string; // Modèle LLM utilisé
  modelConfig: {
    temperature?: number;
    maxTokens?: number;
    thinking?: string;
  };
  tools: string[]; // Outils disponibles
  agentType: string; // Type de l'agent (subagent, agent, etc.)
}

export interface VibeExecution {
  id: string; // ID d'exécution unique
  agent: VibeNativeAgent;
  question: string;
  response: string;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  toolsUsed: string[];
  timestamp: string; // ISO date string
  durationMs: number;
  executionMetadata: Record<string, unknown>;
}

export interface VibeConnectorConfig {
  vibeCommand?: string; // Chemin vers la commande vibe
  mcpServerUrl?: string; // URL du serveur MCP de Vibe
  model?: string; // Modèle à utiliser
  maxTurns?: number; // Nombre maximum de tours
  timeoutMs?: number; // Timeout en millisecondes
}

export interface VibeToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens?: number;
  input_tokens?: number;
  outputTokens?: number;
  output_tokens?: number;
  totalTokens?: number;
  total_tokens?: number;
  cachedInputTokens?: number;
  cached_input_tokens?: number;
  usageMissing?: boolean;
}
