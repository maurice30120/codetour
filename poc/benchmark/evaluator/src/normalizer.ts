import { AgentResponse, Citation } from './types';

export interface RunnerResult {
  tour_title?: string;
  steps?: Array<{ step_id: string; description: string; file?: string; line?: number; citations?: string[] }>;
  raw_response?: string;
  citations?: string[];
}

export type NormalizationContext = Pick<AgentResponse,
  'run_id' | 'agent' | 'timestamp' | 'question_id' | 'objective' | 'series'> & {
  postgres_sha: string;
  status: 'success' | 'partial' | 'error' | 'timeout';
  truncated?: boolean;
};

export function normalizeRunnerResult(result: RunnerResult, context: NormalizationContext): AgentResponse {
  const citations = new Map<string, Citation>();
  const add = (ref: string): void => {
    const match = /^(.+):(\d+)(?:-(\d+))?$/.exec(ref);
    if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) < 1) {
      throw new Error('Invalid citation reference: ' + ref);
    }
    if (!citations.has(ref)) citations.set(ref, {
      id: 'c' + (citations.size + 1), file: match[1], line: Number(match[2]),
      startLine: match[3] ? Number(match[2]) : undefined,
      endLine: match[3] ? Number(match[3]) : undefined,
    });
  };
  for (const ref of result.citations ?? []) add(ref);
  for (const step of result.steps ?? []) {
    for (const ref of step.citations ?? []) add(ref);
    if (step.file && step.line !== undefined) add(step.file + ':' + step.line);
  }
  let description = result.raw_response ?? '';
  try {
    const envelope: unknown = JSON.parse(description);
    if (envelope && typeof envelope === 'object') {
      if ('response' in envelope && typeof envelope.response === 'string') description = envelope.response;
      else {
        const substantive = Object.fromEntries(Object.entries(envelope).filter(([key]) =>
          ['objective', 'summary', 'entryPoints', 'components', 'relations', 'uncertainties', 'limitations', 'notes'].includes(key)));
        description = Object.keys(substantive).length ? JSON.stringify(substantive) : '';
      }
    }
  } catch {}
  const steps = (result.steps ?? []).map((step, i) => ({
    id: 's' + (i + 1), description: step.description, file: step.file, line: step.line,
  }));
  if (!steps.length && description.trim()) steps.push({ id: 's1', description, file: undefined, line: undefined });
  return {
    run_id: context.run_id, agent: context.agent, timestamp: context.timestamp,
    question_id: context.question_id, objective: context.objective, series: context.series,
    postgres_sha: context.postgres_sha,
    status: context.status === 'success' ? 'complete' : context.status === 'partial' ? 'partial' : 'error',
    truncated: context.truncated ?? false,
    tour: { title: result.tour_title ?? 'Source tour', description, steps },
    citations: [...citations.values()], claims: [], relations: [],
  };
}
