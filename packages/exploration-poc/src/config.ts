import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max';

export type HarnessConfig = {
  mistral: { apiKey: string; model: string; apiUrl: string; reasoningEffort: ReasoningEffort; temperature: number; maxRetries: number; retryBaseDelayMs: number };
  budget: { iterations: number; calls: number; tokens: number; durationMs: number };
  limits: { scriptTimeoutMs: number; maxOutputTokens: number; planMaxOutputTokens: number; memorySynthesisAttempts: number };
  citations: { maxReferences: number };
  memoryOutput: { maxItems: number; maxBytes: number };
  log: { size: string; maxFiles: number };
  search: { exclude: string[] };
  context: { keepToolResults: number; maxResultBytes: number };
};

// The only place where defaults live; .tours/config.json overrides them section by section.
export const DEFAULT_CONFIG: HarnessConfig = {
  mistral: { apiKey: '', model: 'mistral-small-latest', apiUrl: 'https://api.mistral.ai/v1/chat/completions', reasoningEffort: 'high', temperature: 0, maxRetries: 3, retryBaseDelayMs: 20000 },
  budget: { iterations: 100, calls: 400, tokens: 1000000, durationMs: 900000 },
  limits: { scriptTimeoutMs: 5000, maxOutputTokens: 16384, planMaxOutputTokens: 4096, memorySynthesisAttempts: 5 },
  citations: { maxReferences: 300 },
  memoryOutput: { maxItems: 50, maxBytes: 8000 },
  log: { size: '10M', maxFiles: 10 },
  search: { exclude: ['.tours/research-reports', '.tours/.log', '.tours/.memory', '.tours/.scratch'] },
  context: { keepToolResults: 8, maxResultBytes: 8000 }
};

const EFFORTS = ['low', 'medium', 'high', 'max'];

function merge(defaults: Record<string, any>, overrides: unknown, path: string): any {
  if (overrides === undefined) return defaults;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error(`${path} must be an object`);
  const result: Record<string, any> = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in defaults)) throw new Error(`Unknown setting ${path}.${key}`);
    if (typeof defaults[key] !== typeof value) throw new Error(`${path}.${key} must be a ${typeof defaults[key]}`);
    result[key] = value;
  }
  return result;
}

export function parseConfig(raw: unknown): HarnessConfig {
  if (raw === undefined) return DEFAULT_CONFIG;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Configuration must be an object');
  for (const key of Object.keys(raw)) if (!(key in DEFAULT_CONFIG)) throw new Error(`Unknown section ${key}`);
  const input = raw as Record<string, unknown>;
  const config = Object.fromEntries(Object.entries(DEFAULT_CONFIG).map(([section, defaults]) => [section, merge(defaults, input[section], section)])) as HarnessConfig;
  for (const [section, values] of Object.entries(config)) {
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === 'number' && (!Number.isFinite(value) || value <= 0) && !(section === 'mistral' && ['temperature', 'maxRetries'].includes(key) && value >= 0) && !(section === 'context' && key === 'keepToolResults' && value >= 0)) throw new Error(`${section}.${key} must be a positive number`);
    }
  }
  if (config.mistral.temperature > 1) throw new Error('Temperature must be between 0 and 1');
  if (!Number.isSafeInteger(config.limits.memorySynthesisAttempts)) throw new Error('limits.memorySynthesisAttempts must be a positive integer');
  if (!Array.isArray(config.search.exclude) || config.search.exclude.some(entry => typeof entry !== 'string' || !entry.trim())) throw new Error('search.exclude must be an array of non-empty strings');
  if (!EFFORTS.includes(config.mistral.reasoningEffort)) throw new Error('reasoningEffort must be low, medium, high or max');
  return config;
}

/** Load <root>/.tours/config.json; a missing file yields the defaults. */
export async function loadConfig(root: string): Promise<HarnessConfig> {
  let text: string;
  try { text = await readFile(join(root, '.tours', 'config.json'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_CONFIG;
    throw error;
  }
  try { return parseConfig(JSON.parse(text)); }
  catch (error) { throw new Error(`Invalid .tours/config.json: ${(error as Error).message}`); }
}
