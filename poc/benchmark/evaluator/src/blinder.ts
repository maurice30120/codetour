import { createHash, randomUUID } from 'crypto';
import {
  AgentResponse, BlindedResponse, BlindedEvaluationItem, EvaluationSet, POSTGRES_SHA, Question,
} from './types';

const FORBIDDEN = /^(agent|agent_version|model|memory|memory_state|run_?id|session_?id|timestamp|token.*|.*_tokens|.*_cost|cost|.*rank|.*order|repeat_index|phase|series|metadata|payload|raw_response|tools_used|subagent|provenance_note)$/i;
const IDENTITY = /\b(?:Vibe(?:\s+Native)?|CodeTour)\b/i;

export function blindText(value: string, secrets: string[] = []): string {
  let text = value;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      if ('response' in parsed && typeof parsed.response === 'string') {
        text = parsed.response;
      } else {
        text = JSON.stringify(parsed, (key, item: unknown) => FORBIDDEN.test(key) ? undefined : item);
      }
    }
  } catch {}
  text = text.replace(/\(\s*(?:Vibe(?:\s+Native)?|CodeTour)\s*\)/gi, '')
    .replace(/\b(?:Vibe(?:\s+Native)?|CodeTour)\b/gi, '[redacted]')
    .replace(/\b(?:run_?id|session_?id|tokens?|token_usage|execution_rank|repeat_index|timestamp)\s*[:=]\s*["']?[\w.:-]+["']?/gi, '[redacted]');
  for (const secret of secrets.filter(s => s.length > 3)) {
    text = text.split(secret).join('[redacted]');
  }
  return text.trim();
}

export function generateEvaluationId(content?: unknown): string {
  return content === undefined ? 'eval-' + randomUUID() :
    'eval-' + createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 24);
}
export const generateId = generateEvaluationId;
export function generateSetId(): string { return 'set-' + randomUUID(); }
export function resetEvaluationIdCounter(): void {}

export function anonymizeResponse(response: AgentResponse): BlindedResponse {
  const secrets = [response.agent, response.run_id, response.timestamp].filter((s): s is string => typeof s === 'string');
  const clean = (s: string | undefined): string => blindText(s ?? '', secrets);
  const ids = new Map((response.citations ?? []).map((c, i) => [c.id, 'c' + (i + 1)]));
  const refs = (values: string[]): string[] => values.map(id => ids.get(id) ?? 'missing-citation');
  return {
    evaluation_id: generateEvaluationId(),
    question_id: response.question_id,
    objective: clean(response.objective),
    postgres_sha: response.postgres_sha ?? '',
    status: response.status,
    truncated: response.truncated,
    tour: {
      title: clean(response.tour.title), description: clean(response.tour.description),
      summary: response.tour.summary === undefined ? undefined : clean(response.tour.summary),
      steps: response.tour.steps.map((s, i) => ({
        id: 's' + (i + 1), description: clean(s.description), file: s.file,
        line: s.line, code: s.code, type: s.type,
      })),
    },
    citations: (response.citations ?? []).map(c => ({
      id: ids.get(c.id)!, file: c.file, line: c.line, content: c.content,
      context: c.context, startLine: c.startLine, endLine: c.endLine,
    })),
    claims: (response.claims ?? []).map((c, i) => ({
      id: 'claim' + (i + 1), statement: clean(c.statement), confidence: 0,
      citations: refs(c.citations), category: c.category, critical: c.critical,
    })),
    relations: (response.relations ?? []).map((r, i) => ({
      id: 'r' + (i + 1), from: r.from, to: r.to, type: r.type,
      citations: refs(r.citations), bidirectional: r.bidirectional,
      description: r.description === undefined ? undefined : clean(r.description),
    })),
  };
}

export function createBlindedItem(response: AgentResponse, question: Question): BlindedEvaluationItem {
  if (response.question_id !== question.id) throw new Error('Question ID mismatch');
  const blinded = anonymizeResponse(response);
  return { evaluation_id: blinded.evaluation_id, response: blinded, question: {
    id: question.id, objective: blindText(question.objective), postgres_sha: question.postgres_sha,
  } };
}

export function shuffleArray<T>(array: T[], seed = randomUUID()): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const n = createHash('sha256').update(seed + ':' + i).digest().readUInt32BE(0);
    const j = Math.floor(n / 0x100000000 * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createEvaluationSet(responses: AgentResponse[], questions: Question[]): EvaluationSet {
  return createEvaluationBatch(responses, questions).set;
}

export function createEvaluationBatch(responses: AgentResponse[], questions: Question[]): {
  set: EvaluationSet;
  map: Map<string, { responseIndex: number; questionIndex: number }>;
} {
  if (responses.length !== questions.length) throw new Error('Responses and questions must have the same length');
  const items = responses.map((r, i) => createBlindedItem(r, questions[i]));
  const map = createEvaluationMap(items);
  const seed = randomUUID();
  const set: EvaluationSet = {
    evaluation_set_id: generateSetId(),
    items: shuffleArray(items, seed),
    created_at: new Date().toISOString(), postgres_sha: POSTGRES_SHA,
    evaluator_version: '2.0.0', shuffle_seed: seed,
  };
  return { set, map };
}

export function verifyBlinding(response: BlindedResponse, expectedSha = POSTGRES_SHA): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const visit = (value: unknown, path: string): void => {
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (FORBIDDEN.test(key)) issues.push('Forbidden field: ' + path + key);
        visit(item, path + key + '.');
      }
    } else if (typeof value === 'string' && IDENTITY.test(value)) {
      issues.push('Identity in content: ' + path);
    }
  };
  visit(response, '');
  for (const key of ['evaluation_id', 'question_id', 'objective', 'tour', 'citations', 'claims', 'relations']) {
    if (!(key in response)) issues.push('Missing required field: ' + key);
  }
  if (!response.evaluation_id?.startsWith('eval-')) issues.push('Invalid evaluation_id format');
  if (response.postgres_sha !== expectedSha) issues.push('Invalid postgres_sha');
  return { valid: issues.length === 0, issues };
}

export function verifyEvaluationSet(set: EvaluationSet): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (set.postgres_sha !== POSTGRES_SHA) issues.push('Invalid postgres_sha');
  if (!set.evaluation_set_id?.startsWith('set-')) issues.push('Invalid evaluation_set_id');
  const ids = new Set<string>();
  for (const item of set.items) {
    issues.push(...verifyBlinding(item.response).issues);
    if (ids.has(item.evaluation_id)) issues.push('Duplicate evaluation_id');
    ids.add(item.evaluation_id);
    if (item.evaluation_id !== item.response.evaluation_id || item.question.id !== item.response.question_id ||
        item.question.postgres_sha !== item.response.postgres_sha) issues.push('Mismatched item');
    if (Object.keys(item.question).some(k => !['id', 'objective', 'postgres_sha'].includes(k))) {
      issues.push('Question contains hidden metadata or expected answers');
    }
  }
  return { valid: issues.length === 0, issues };
}

export function createEvaluationMap(itemsInOriginalOrder: BlindedEvaluationItem[]):
  Map<string, { responseIndex: number; questionIndex: number }> {
  return new Map(itemsInOriginalOrder.map((item, i) => [item.evaluation_id, { responseIndex: i, questionIndex: i }]));
}

export function reconstructWithResults<T>(set: EvaluationSet,
  map: Map<string, { responseIndex: number; questionIndex: number }>, results: Map<string, T>):
  Array<{ responseIndex: number; questionIndex: number; result: T }> {
  return set.items.map(item => {
    const mapping = map.get(item.evaluation_id);
    if (!mapping || !results.has(item.evaluation_id)) throw new Error('Missing mapping or result');
    return { ...mapping, result: results.get(item.evaluation_id)! };
  }).sort((a, b) => a.responseIndex - b.responseIndex);
}
