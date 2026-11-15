import { rmSync } from 'fs';
import { anonymizeResponse, verifyBlinding, createEvaluationBatch, reconstructWithResults } from '../src/blinder';
import { fixture } from './fixture';

describe('blind export', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(); });
  afterEach(() => rmSync(f.root, { recursive: true, force: true }));

  it('strips identity, rank, cost and nested payload metadata while preserving evidence', () => {
    f.response.tour.title = 'Query execution (Vibe Native)';
    f.response.repeat_index = 17;
    f.response.phase = 'run-17';
    Object.assign(f.response.tour.steps[0], { payload: {
      agent: 'Vibe', run_id: 'private-run-17', token_usage: 456789, execution_rank: 17,
    } });
    f.response.tour.description = JSON.stringify({
      response: 'execute calls parse', agent: 'Vibe', session_id: 'secret-session', tokens: 456789,
    });
    const blinded = anonymizeResponse(f.response);
    const serialized = JSON.stringify(blinded);
    expect(serialized).not.toMatch(/Vibe|Native|private-run|secret-session|456789|repeat_index|execution_rank|phase|payload/);
    expect(blinded.tour.description).toBe('execute calls parse');
    expect(blinded.citations[0]).toMatchObject({ file: 'query.c', line: 2, content: 'void execute(void) { parse(); }' });
    expect(verifyBlinding(blinded, f.sha).valid).toBe(true);
    expect(f.response.tour.title).toContain('Vibe Native');
  });

  it('keeps identical responses as distinct runs and reconstructs every result with a separate private map', () => {
    const responses = [f.response, { ...f.response, run_id: 'private-run-18', status: 'error' as const }, f.response];
    const questions = [f.question, f.question, f.question];
    const { set, map } = createEvaluationBatch(responses, questions);
    const results = new Map(set.items.map(item => [item.evaluation_id,
      ['first', 'error', 'duplicate'][map.get(item.evaluation_id)!.responseIndex]]));
    expect(new Set(set.items.map(i => i.evaluation_id)).size).toBe(3);
    expect(reconstructWithResults(set, map, results)).toEqual([
      { responseIndex: 0, questionIndex: 0, result: 'first' },
      { responseIndex: 1, questionIndex: 1, result: 'error' },
      { responseIndex: 2, questionIndex: 2, result: 'duplicate' },
    ]);
    expect(JSON.stringify(set)).not.toMatch(/responseIndex|questionIndex|private-run/);
  });
});
