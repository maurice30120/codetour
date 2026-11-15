import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AgentResponse, Question, SemanticReview, SemanticReviewer } from '../src/types';

export function fixture() {
  const root = mkdtempSync(join(tmpdir(), 't06-evaluator-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  writeFileSync(join(root, 'query.c'), 'void parse(void) {}\nvoid execute(void) { parse(); }\nvoid authorize(void) {}\n');
  git('add', 'query.c');
  git('-c', 'user.name=T06', '-c', 'user.email=t06@example.test', 'commit', '-qm', 'fixture');
  const sha = git('rev-parse', 'HEAD');
  const question: Question = {
    id: 'q1', objective: 'Explain how execute invokes parse', series: 'R', postgres_sha: sha,
    expected_areas: [{ file: 'query.c', lines: [2], critical: true, description: 'execute call' }],
    relations_to_verify: [{ from: 'execute', to: 'parse', type: 'calls', critical: true }],
    criteria: [],
  };
  const response: AgentResponse = {
    run_id: 'private-run-17', agent: 'Vibe', timestamp: '2026-11-15T12:00:00Z',
    question_id: 'q1', objective: question.objective, series: 'R',
    ...{ postgres_sha: sha },
    tour: { title: 'Query execution', description: 'execute calls parse', steps: [
      { id: 's1', description: 'execute calls parse', file: 'query.c', line: 2 },
    ] },
    citations: [{ id: 'c1', file: 'query.c', line: 2, content: 'void execute(void) { parse(); }', context: '' }],
    claims: [{ id: 'claim1', statement: 'execute calls parse', confidence: 1, citations: ['c1'], critical: true }],
    relations: [{ id: 'r1', from: 'execute', to: 'parse', type: 'calls', citations: ['c1'] }],
  };
  return { root, sha, git, question, response };
}

export function reviewed(verdict: 'supported' | 'refuted' | 'unsupported' = 'supported'): SemanticReviewer {
  const review: SemanticReview = {
    review_id: 'human-review-1',
    response: { verdict, reason: 'The execute body invokes parse on query.c line 2.', citations: ['c1'] },
    claims: [{ claim_id: 'claim1', verdict, reason: 'Direct invocation in execute body.', citations: ['c1'] }],
    relations: [{ relation_id: 'r1', verdict, reason: 'Caller is execute, callee is parse.', citations: ['c1'] }],
    expected_relations: [{ from: 'execute', to: 'parse', type: 'calls', verdict,
      reason: 'The answer identifies execute as caller and parse as callee.', citations: ['c1'] }],
    criteria: [],
  };
  return { id: 'independent-reviewer-1', review: async () => structuredClone(review) };
}
