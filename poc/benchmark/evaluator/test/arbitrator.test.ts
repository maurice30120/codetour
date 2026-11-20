import { rmSync } from 'fs';
import { Arbitrator } from '../src/arbitrator';
import { TourGrader } from '../src/grader';
import { fixture, reviewed } from './fixture';

describe('independent arbitration', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(); });
  afterEach(() => rmSync(f.root, { recursive: true, force: true }));
  const grader = (data: ReturnType<typeof fixture>, id: string, verdict: 'supported' | 'refuted') =>
    new TourGrader({ postgres_path: data.root, postgres_sha: data.sha, semantic_reviewer: { ...reviewed(verdict), id } });

  it('preserves disagreeing judgments and uses an explicitly supplied independent adjudicator with the same fixture and thresholds', async () => {
    const arb = new Arbitrator([grader(f, 'human-a', 'supported'), grader(f, 'human-b', 'refuted')],
      grader(f, 'human-c', 'refuted'));
    const record = await arb.arbitrate(f.response, f.question);
    expect(record.initial_judgments.map(j => j.correct)).toEqual([true, false]);
    expect(record.final_judgment.correct).toBe(false);
    expect(record.final_judgment).toEqual(record.arbitrator_judgment);
    expect(record.arbitrator_id).toBe('human-c');
    expect(record.evaluation_id).toMatch(/^eval-/);
    expect(record.reason).toMatch(/disagree/i);
    expect(JSON.stringify(record)).not.toContain('private-run-17');
  });
});
