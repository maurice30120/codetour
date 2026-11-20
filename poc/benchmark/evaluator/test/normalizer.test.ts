import { rmSync } from 'fs';
import { normalizeRunnerResult, TourGrader, anonymizeResponse } from '../src';
import { fixture, reviewed } from './fixture';

describe('normalizeRunnerResult', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(); });
  afterEach(() => rmSync(f.root, { recursive: true, force: true }));

  it('converts runner JSON and unwraps native payload metadata without inventing semantic assertions', async () => {
    const result = {
      tour_title: 'Execution (Vibe Native)',
      raw_response: JSON.stringify({ agent: 'Vibe', session_id: 'hidden-session',
        response: 'execute calls parse', tools_used: ['private-tool'] }),
      steps: [{ step_id: 'private-step', description: 'execute calls parse', file: 'query.c', line: 2, citations: ['query.c:2'] }],
      citations: ['query.c:2'],
    };
    const response = normalizeRunnerResult(result, { ...f.response, postgres_sha: f.sha, status: 'success' });
    expect(response.claims).toEqual([]);
    expect(response.relations).toEqual([]);
    expect(response.citations).toEqual([expect.objectContaining({ file: 'query.c', line: 2 })]);
    const blinded = anonymizeResponse(response);
    expect(JSON.stringify(blinded)).not.toMatch(/Vibe|Native|hidden-session|private-tool|private-step/);
    expect(blinded.tour.description).toBe('execute calls parse');
    const grader = new TourGrader({ postgres_path: f.root, postgres_sha: f.sha, semantic_reviewer: reviewed() });
    const grade = await grader.evaluate(response, f.question);
    expect(grade.correct).toBe(true);
    expect(grade.verified_lines).toEqual(['query.c:2']);
  });
});
