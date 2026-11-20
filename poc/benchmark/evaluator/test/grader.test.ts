import { rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { TourGrader } from '../src/grader';
import { fixture, reviewed } from './fixture';
import { anonymizeResponse } from '../src/blinder';

describe('TourGrader.evaluate', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(); });
  afterEach(() => rmSync(f.root, { recursive: true, force: true }));

  it('accepts a complete tour whose claims and directed relations have justified independent review and real committed evidence', async () => {
    const grader = new TourGrader({ postgres_path: f.root, postgres_sha: f.sha, semantic_reviewer: reviewed() });
    const result = await grader.evaluate(f.response, f.question);
    expect(result).toMatchObject({ correct: true, evidence_supported: true, coverage: 1,
      major_missing_relation: false, critical_false_claim: false, review_required: false,
      review_id: 'human-review-1', verified_lines: ['query.c:2'] });
  });

  it('keeps natural language claims unsupported without independent semantic review, even with exact code citations', async () => {
    const grader = new TourGrader({ postgres_path: f.root, postgres_sha: f.sha });
    const result = await grader.evaluate(f.response, f.question);
    expect(result.correct).toBe(false);
    expect(result.evidence_supported).toBe(false);
    expect(result.failed_claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ claim_id: expect.any(String), reason: 'unsupported' }),
    ]));
    expect(result.justification).toMatch(/review|unsupported/i);
  });

  it.each(['partial', 'error', 'truncated'] as const)('keeps %s runs incorrect even when the available content is reviewed as supported', async state => {
    if (state === 'truncated') f.response.truncated = true;
    else f.response.status = state;
    const grader = new TourGrader({ postgres_path: f.root, postgres_sha: f.sha, semantic_reviewer: reviewed() });
    const result = await grader.evaluate(f.response, f.question);
    expect(result.correct).toBe(false);
    expect(result.justification).toMatch(/incomplete/i);
  });

  it('treats a claim with no evidence as unknown rather than claiming it is false', async () => {
    f.response.claims[0].citations = [];
    const grader = new TourGrader({ postgres_path: f.root, postgres_sha: f.sha, semantic_reviewer: reviewed() });
    const result = await grader.evaluate(f.response, f.question);
    expect(result).toMatchObject({ correct: false, evidence_supported: false,
      critical_false_claim: false, review_required: true });
    expect(result.failed_claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'unsupported' }),
    ]));
  });

  it('rejects fabricated extra citations even when the reviewed claims reference valid evidence', async () => {
    f.response.citations.push({ id: 'extra', file: 'missing.c', line: 500, content: 'invented' });
    const grader = new TourGrader({ postgres_path: f.root, postgres_sha: f.sha, semantic_reviewer: reviewed() });
    const result = await grader.evaluate(f.response, f.question);
    expect(result).toMatchObject({ correct: false, evidence_supported: false });
    expect(result.verified_lines).toEqual(['query.c:2']);
  });

  it('does not silently verify an invalid source range attached to a location-only citation', async () => {
    delete f.response.citations[0].content;
    f.response.citations[0].startLine = 50;
    f.response.citations[0].endLine = 1;
    const grader = new TourGrader({ postgres_path: f.root, postgres_sha: f.sha, semantic_reviewer: reviewed() });
    const result = await grader.evaluate(f.response, f.question);
    expect(result).toMatchObject({ correct: false, coverage: 0, verified_lines: [] });
  });

  it('requires committed regular source files rather than symlink target text', async () => {
    symlinkSync('query.c', join(f.root, 'link.c'));
    f.git('add', 'link.c');
    f.git('-c', 'user.name=T06', '-c', 'user.email=t06@example.test', 'commit', '-qm', 'symlink');
    f.sha = f.git('rev-parse', 'HEAD');
    f.question.postgres_sha = f.response.postgres_sha = f.sha;
    f.response.citations[0] = { id: 'c1', file: 'link.c', line: 1, content: 'query.c' };
    f.question.expected_areas = [{ file: 'link.c', lines: [1], critical: true, description: 'link' }];
    const grader = new TourGrader({ postgres_path: f.root, postgres_sha: f.sha, semantic_reviewer: reviewed() });
    expect(await grader.evaluate(f.response, f.question)).toMatchObject({ correct: false, coverage: 0 });
  });

  it('refuses a supposedly blinded payload containing nested run metadata before sending it for review', async () => {
    const response = anonymizeResponse(f.response);
    Object.assign(response.tour.steps[0], { payload: { run_id: 'private-run-17' } });
    const grader = new TourGrader({ postgres_path: f.root, postgres_sha: f.sha, semantic_reviewer: reviewed() });
    await expect(grader.evaluate(response, f.question)).rejects.toThrow(/blind/i);
  });

  it('sends only the blind question context and actual committed source to an independent reviewer', async () => {
    f.question.phase = 'private-order-17';
    Object.assign(f.question, { run_id: 'private-run-17', token_usage: 3333 });
    const reviewer = reviewed();
    const grader = new TourGrader({ postgres_path: f.root, postgres_sha: f.sha, semantic_reviewer: {
      id: reviewer.id,
      review: async context => {
        expect(JSON.stringify(context)).not.toMatch(/private-order|private-run|token_usage|3333/);
        expect(context.verified_citations[0].context).toContain('void execute(void) { parse(); }');
        return reviewer.review(context);
      },
    } });
    expect((await grader.evaluate(f.response, f.question)).correct).toBe(true);
  });
});
